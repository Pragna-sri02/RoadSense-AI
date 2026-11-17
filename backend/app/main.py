from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .database import Base, engine, ensure_db_schema
from . import models
from .routes import reports, routing, analytics, assistant, meta, geocode, auth

UPLOADS_DIR = Path(__file__).resolve().parent.parent / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure database schema is up-to-date with non-destructive migrations
    ensure_db_schema(engine)
    yield


app = FastAPI(
    title="RoadSense API",
    description="AI-Powered Road Intelligence and Voice Navigation Assistant Platform",
    version="1.0.0",
    lifespan=lifespan,
)

# Static file serving for road hazard images
app.mount("/uploads", StaticFiles(directory=str(UPLOADS_DIR)), name="uploads")

# Comprehensive CORS setup allowing any local development port
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def home():
    return {
        "message": "Welcome to RoadSense API!",
        "project": "RoadSense",
        "status": "running",
        "version": app.version,
        "docs": "/docs",
        "auth": "/api/auth",
        "health": "/api/health",
        "reports": "/api/reports",
        "routing": "/api/routing/route",
        "analytics": "/api/analytics/overview",
        "assistant": "/api/assistant/ask",
        "categories": "/api/meta/categories",
        "geocode": "/api/geocode",
    }


@app.get("/api/health")
def health_check():
    return {
        "status": "healthy",
        "service": "RoadSense Backend",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


# Register all application routers
app.include_router(auth.router)
app.include_router(reports.router)
app.include_router(routing.router)
app.include_router(analytics.router)
app.include_router(assistant.router)
app.include_router(meta.router)
app.include_router(geocode.router)
