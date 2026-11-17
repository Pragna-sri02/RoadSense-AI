import os
from pathlib import Path
from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import declarative_base, sessionmaker

# Always resolve to roadsense.db in the workspace root
BASE_DIR = Path(__file__).resolve().parent.parent.parent
DEFAULT_DB_FILE = BASE_DIR / "roadsense.db"

DATABASE_URL = os.getenv(
    "ROADSENSE_DATABASE_URL",
    os.getenv("DATABASE_URL", f"sqlite:///{DEFAULT_DB_FILE.as_posix()}")
)

# Create the database engine
engine = create_engine(
    DATABASE_URL,
    connect_args={"check_same_thread": False}
)

# Create database sessions
SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

# Base class for database models
Base = declarative_base()


def ensure_db_schema(target_engine=None):
    """
    Ensure all required columns exist in the database without dropping tables,
    applying non-destructive schema migrations automatically.
    """
    eng = target_engine or engine
    Base.metadata.create_all(bind=eng)

    try:
        inspector = inspect(eng)
        table_names = inspector.get_table_names()
        if "road_reports" in table_names:
            existing_cols = {col["name"] for col in inspector.get_columns("road_reports")}
            needed_columns = [
                ("locality", "VARCHAR(100)"),
                ("city", "VARCHAR(100)"),
                ("district", "VARCHAR(100)"),
                ("state", "VARCHAR(100)"),
                ("country", "VARCHAR(100)"),
                ("image_url", "VARCHAR(500)"),
                ("source", "VARCHAR(50) DEFAULT 'community' NOT NULL"),
                ("detection_method", "VARCHAR(50) DEFAULT 'manual' NOT NULL"),
                ("updated_at", "DATETIME"),
            ]
            with eng.begin() as conn:
                for col_name, col_type in needed_columns:
                    if col_name not in existing_cols:
                        conn.execute(text(f"ALTER TABLE road_reports ADD COLUMN {col_name} {col_type}"))
    except Exception as exc:
        import logging
        logging.getLogger(__name__).warning(f"Schema migration notice: {exc}")


# Provide a database session to API endpoints
def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
