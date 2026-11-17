from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import User
from ..schemas import AuthTokenResponse, UserLogin, UserRegister, UserResponse
from ..services.auth import (
    create_user,
    create_user_session,
    get_current_user,
    get_user_by_email,
    invalidate_session,
    security,
    validate_email_format,
    verify_password,
)

router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)


@router.post(
    "/register",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register a new RoadSense account",
)
def register_user(payload: UserRegister, db: Session = Depends(get_db)):
    """
    Register a new user account with secure password hashing.
    Rejects duplicate email addresses and ensures password confirmation matches.
    """
    full_name = payload.full_name.strip()
    if len(full_name) < 2:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Full name must be at least 2 characters long.",
        )

    email = payload.email.strip().lower()
    if not validate_email_format(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Please provide a valid email address.",
        )

    if len(payload.password) < 6:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Password must be at least 6 characters long.",
        )

    if payload.confirm_password is not None and payload.password != payload.confirm_password:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Passwords do not match. Please verify both fields.",
        )

    # Check for duplicate email
    existing_user = get_user_by_email(db, email)
    if existing_user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="An account with this email address already exists. Please sign in instead.",
        )

    # Create user with bcrypt hashed password
    user = create_user(db, full_name, email, payload.password)

    # Automatically issue session token upon successful registration
    session = create_user_session(db, user, remember_me=True)

    return AuthTokenResponse(
        access_token=session.token,
        token_type="bearer",
        expires_at=session.expires_at,
        user=UserResponse.model_validate(user),
    )


@router.post(
    "/login",
    response_model=AuthTokenResponse,
    status_code=status.HTTP_200_OK,
    summary="Authenticate user and issue session token",
)
def login_user(payload: UserLogin, db: Session = Depends(get_db)):
    """
    Authenticate user credentials and issue a cryptographically secure session token.
    Supports extended 30-day session if 'remember_me' is selected.
    """
    email = payload.email.strip().lower()
    user = get_user_by_email(db, email)

    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password. Please check your credentials.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="This account has been deactivated. Please contact support.",
        )

    session = create_user_session(db, user, remember_me=payload.remember_me)

    return AuthTokenResponse(
        access_token=session.token,
        token_type="bearer",
        expires_at=session.expires_at,
        user=UserResponse.model_validate(user),
    )


@router.get(
    "/me",
    response_model=UserResponse,
    status_code=status.HTTP_200_OK,
    summary="Retrieve authenticated user profile",
)
def get_authenticated_user_profile(current_user: User = Depends(get_current_user)):
    """
    Return currently authenticated user profile based on Bearer token.
    Used for page-refresh session validation.
    """
    return UserResponse.model_validate(current_user)


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Terminate active session",
)
def logout_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
    db: Session = Depends(get_db),
):
    """
    Invalidate active session token in the database upon user logout.
    """
    if credentials and credentials.credentials:
        invalidate_session(db, credentials.credentials)
    return {"message": "Successfully signed out of RoadSense."}
