import re
import secrets
from datetime import datetime, timedelta, timezone
from typing import Optional

import bcrypt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User, UserSession

# Bearer token security scheme for OpenAPI and dependency injection
security = HTTPBearer(auto_error=False)

EMAIL_REGEX = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def validate_email_format(email: str) -> bool:
    """Validate standard email address syntax."""
    if not email or not isinstance(email, str):
        return False
    return bool(EMAIL_REGEX.match(email.strip()))


def hash_password(password: str) -> str:
    """Securely hash a password using bcrypt with a work factor of 12."""
    if not password:
        raise ValueError("Password cannot be empty")
    # Bcrypt operates on at most 72 bytes
    pwd_bytes = password.encode("utf-8")[:72]
    salt = bcrypt.gensalt(rounds=12)
    return bcrypt.hashpw(pwd_bytes, salt).decode("utf-8")


def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify a plaintext password against a stored bcrypt hash."""
    if not plain_password or not hashed_password:
        return False
    try:
        pwd_bytes = plain_password.encode("utf-8")[:72]
        hash_bytes = hashed_password.encode("utf-8")
        return bcrypt.checkpw(pwd_bytes, hash_bytes)
    except Exception:
        return False


def generate_session_token() -> str:
    """Generate a high-entropy URL-safe cryptographic session token."""
    return secrets.token_urlsafe(48)


def get_user_by_email(db: Session, email: str) -> Optional[User]:
    """Retrieve an active user by email (case-insensitive)."""
    if not email:
        return None
    normalized_email = email.strip().lower()
    return db.query(User).filter(func.lower(User.email) == normalized_email).first()


def create_user(db: Session, full_name: str, email: str, password: str) -> User:
    """Create and persist a new user with hashed credentials."""
    normalized_email = email.strip().lower()
    hashed = hash_password(password)

    user = User(
        full_name=full_name.strip(),
        email=normalized_email,
        password_hash=hashed,
        is_active=True,
        created_at=datetime.now(timezone.utc),
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def create_user_session(db: Session, user: User, remember_me: bool = False) -> UserSession:
    """
    Issue a new session token for the user.
    Session lifetime:
      - Remember Me = True: 30 days
      - Remember Me = False: 24 hours
    """
    lifetime = timedelta(days=30) if remember_me else timedelta(hours=24)
    now = datetime.now(timezone.utc)
    expires_at = now + lifetime
    token = generate_session_token()

    session = UserSession(
        user_id=user.id,
        token=token,
        is_active=True,
        expires_at=expires_at,
        created_at=now,
    )
    db.add(session)

    # Update user's last login timestamp
    user.last_login = now
    db.commit()
    db.refresh(session)
    return session


def get_session_by_token(db: Session, token: str) -> Optional[UserSession]:
    """Find an active, unexpired session matching the provided token."""
    if not token:
        return None
    now = datetime.now(timezone.utc)
    return (
        db.query(UserSession)
        .filter(
            UserSession.token == token,
            UserSession.is_active == True,
            UserSession.expires_at > now,
        )
        .first()
    )


def invalidate_session(db: Session, token: str) -> bool:
    """Invalidate an active session upon logout."""
    if not token:
        return False
    session = (
        db.query(UserSession)
        .filter(UserSession.token == token, UserSession.is_active == True)
        .first()
    )
    if session:
        session.is_active = False
        db.commit()
        return True
    return False


def get_current_user(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> User:
    """
    FastAPI dependency to protect endpoints against unauthorized access.
    Validates the Bearer token against active database sessions.
    """
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required. Please sign in to access RoadSense.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials
    session = get_session_by_token(db, token)
    if not session:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Your session has expired or is invalid. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == session.user_id, User.is_active == True).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User account not found or deactivated.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def get_current_user_optional(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(security),
    db: Session = Depends(get_db),
) -> Optional[User]:
    """Optional authentication dependency for endpoints that support public or authenticated access."""
    if not credentials or not credentials.credentials:
        return None
    session = get_session_by_token(db, credentials.credentials)
    if not session:
        return None
    return db.query(User).filter(User.id == session.user_id, User.is_active == True).first()
