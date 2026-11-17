import uuid
from datetime import datetime, timezone, timedelta
from math import asin, cos, radians, sin, sqrt
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RoadReport
from ..schemas import (
    PotholeAnalysisResponse,
    ReportSummaryResponse,
    RoadReportCreate,
    RoadReportResponse,
    RoadReportStatusUpdate,
)
from ..services.auth import get_current_user
from ..services.pothole_detector import detect_road_hazards_cv

router = APIRouter(
    prefix="/api/reports",
    tags=["Road Reports"],
    dependencies=[Depends(get_current_user)],
)

UPLOADS_DIR = Path(__file__).resolve().parent.parent.parent / "backend" / "uploads"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate approximate distance between two coordinates in km using Haversine formula."""
    earth_radius_km = 6371.0
    dlat = radians(lat2 - lat1)
    dlon = radians(lon2 - lon1)
    a = (
        sin(dlat / 2) ** 2
        + cos(radians(lat1))
        * cos(radians(lat2))
        * sin(dlon / 2) ** 2
    )
    return 2 * earth_radius_km * asin(sqrt(min(1.0, a)))


@router.post("/analyze-image", response_model=PotholeAnalysisResponse)
async def analyze_road_image(
    file: UploadFile = File(...),
):
    """
    Analyze an uploaded road image using computer vision to detect potholes, fractures, and surface damage.
    Extracts EXIF GPS coordinates when available and generates visual bounding box annotations.
    Saves the uploaded image for verification and evidence preservation.
    """
    if not file.content_type or not (
        file.content_type.startswith("image/")
        or (file.filename and file.filename.lower().endswith((".jpg", ".jpeg", ".png", ".webp")))
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid file format. Please upload a JPEG, PNG, or WebP road photo.",
        )

    try:
        image_bytes = await file.read()
        if len(image_bytes) < 100:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Uploaded file is empty or corrupted.",
            )

        # Run CV analysis
        result = detect_road_hazards_cv(image_bytes)

        # Save image file to uploads
        ext = ".jpg"
        if file.filename and "." in file.filename:
            ext = "." + file.filename.rsplit(".", 1)[-1].lower()
            if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
                ext = ".jpg"

        file_id = f"hazard_{uuid.uuid4().hex[:12]}{ext}"
        save_path = UPLOADS_DIR / file_id
        save_path.write_bytes(image_bytes)

        result["image_url"] = f"/uploads/{file_id}"
        return PotholeAnalysisResponse(**result)

    except ValueError as ve:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(ve))
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Computer vision analysis failed: {exc}",
        )


@router.post("", response_model=RoadReportResponse, status_code=status.HTTP_201_CREATED)
@router.post("/", response_model=RoadReportResponse, status_code=status.HTTP_201_CREATED)
def create_report(
    report_data: RoadReportCreate,
    db: Session = Depends(get_db),
):
    """
    Create a road-hazard report (community or AI-assisted).
    New submissions always default to 'unverified' status and is_sample=False.
    Prevents duplicate submissions if a report with identical hazard type exists within ~30 meters.
    """
    # Duplicate prevention: Check if active defect with same hazard_type exists within 30m
    clean_type = report_data.hazard_type.strip().lower()
    existing_reports = (
        db.query(RoadReport)
        .filter(RoadReport.status != "resolved")
        .all()
    )
    for existing in existing_reports:
        if existing.hazard_type.strip().lower() == clean_type:
            dist = distance_km(report_data.latitude, report_data.longitude, existing.latitude, existing.longitude)
            if dist <= 0.030:  # ~30 meters
                raise HTTPException(
                    status_code=status.HTTP_409_CONFLICT,
                    detail=f"A similar {existing.hazard_type} was already reported at this exact location ({round(dist * 1000)}m away). Report ID #{existing.id} is currently {existing.status}.",
                )

    report = RoadReport(
        hazard_type=report_data.hazard_type.strip(),
        description=report_data.description.strip(),
        location_name=report_data.location_name.strip(),
        locality=report_data.locality.strip() if report_data.locality else None,
        city=report_data.city.strip() if report_data.city else None,
        district=report_data.district.strip() if report_data.district else None,
        state=report_data.state.strip() if report_data.state else None,
        country=report_data.country.strip() if report_data.country else None,
        image_url=report_data.image_url.strip() if report_data.image_url else None,
        source=report_data.source.strip() if report_data.source else "community",
        detection_method=report_data.detection_method.strip() if report_data.detection_method else "manual",
        latitude=round(report_data.latitude, 6),
        longitude=round(report_data.longitude, 6),
        status="unverified",
        is_sample=False,
        created_at=datetime.now(timezone.utc),
    )

    db.add(report)
    db.commit()
    db.refresh(report)

    return report


@router.get("/summary", response_model=ReportSummaryResponse)
def get_reports_summary(db: Session = Depends(get_db)):
    """Return consolidated summary of stored road reports."""
    total_reports = db.query(RoadReport).count()
    verified_reports = db.query(RoadReport).filter(RoadReport.status == "verified").count()
    unverified_reports = db.query(RoadReport).filter(RoadReport.status != "verified").count()

    hazard_counts = (
        db.query(RoadReport.hazard_type, func.count(RoadReport.id))
        .group_by(RoadReport.hazard_type)
        .all()
    )

    # Top area counts by location_name or city
    area_query = (
        db.query(RoadReport.location_name, func.count(RoadReport.id))
        .group_by(RoadReport.location_name)
        .order_by(func.count(RoadReport.id).desc())
        .limit(10)
        .all()
    )

    one_week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    recent_count = db.query(RoadReport).filter(RoadReport.created_at >= one_week_ago).count()

    return {
        "total_reports": total_reports,
        "verified_reports": verified_reports,
        "unverified_reports": unverified_reports,
        "hazards_by_type": {h: count for h, count in hazard_counts},
        "area_counts": {loc: count for loc, count in area_query},
        "recent_count": recent_count,
    }


@router.get("/nearby", response_model=List[RoadReportResponse])
@router.get("/near", response_model=List[RoadReportResponse])
def nearby_reports(
    latitude: float = Query(..., ge=-90, le=90),
    longitude: float = Query(..., ge=-180, le=180),
    radius_km: float = Query(default=5.0, gt=0, le=100),
    status_filter: Optional[str] = Query(default=None, alias="status"),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
):
    """Find road reports within a given radius (km) of specified coordinates."""
    query = db.query(RoadReport)
    if status_filter:
        query = query.filter(RoadReport.status == status_filter.strip().lower())

    reports = query.all()
    nearby = []

    for report in reports:
        dist = distance_km(latitude, longitude, report.latitude, report.longitude)
        if dist <= radius_km:
            nearby.append((dist, report))

    nearby.sort(key=lambda item: (item[0], -item[1].id))
    return [report for _, report in nearby[:limit]]


@router.get("", response_model=List[RoadReportResponse])
@router.get("/", response_model=List[RoadReportResponse])
def list_reports(
    q: Optional[str] = Query(default=None, max_length=100, description="Search keyword"),
    hazard_type: Optional[str] = Query(default=None, max_length=50),
    report_status: Optional[str] = Query(default=None, alias="status"),
    sample_only: Optional[bool] = Query(default=None),
    city: Optional[str] = Query(default=None, max_length=100),
    country: Optional[str] = Query(default=None, max_length=100),
    limit: int = Query(default=100, ge=1, le=500),
    offset: int = Query(default=0, ge=0),
    db: Session = Depends(get_db),
):
    """List reports with keyword search, category, status, city filters, and pagination."""
    query = db.query(RoadReport)

    if q:
        search_term = f"%{q.strip()}%"
        query = query.filter(
            (RoadReport.location_name.ilike(search_term))
            | (RoadReport.description.ilike(search_term))
            | (RoadReport.hazard_type.ilike(search_term))
            | (RoadReport.locality.ilike(search_term))
            | (RoadReport.city.ilike(search_term))
            | (RoadReport.district.ilike(search_term))
        )

    if hazard_type:
        query = query.filter(RoadReport.hazard_type.ilike(f"%{hazard_type.strip()}%"))

    if report_status:
        query = query.filter(RoadReport.status == report_status.strip().lower())

    if city:
        query = query.filter(RoadReport.city.ilike(f"%{city.strip()}%"))

    if country:
        query = query.filter(RoadReport.country.ilike(f"%{country.strip()}%"))

    if sample_only is not None:
        query = query.filter(RoadReport.is_sample == sample_only)

    return (
        query.order_by(RoadReport.created_at.desc(), RoadReport.id.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )


@router.get("/{report_id}", response_model=RoadReportResponse)
def get_report(
    report_id: int,
    db: Session = Depends(get_db),
):
    """Retrieve details for a specific road report by ID."""
    report = db.query(RoadReport).filter(RoadReport.id == report_id).first()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Road report with ID {report_id} not found.",
        )
    return report


@router.patch("/{report_id}/status", response_model=RoadReportResponse)
def update_report_status(
    report_id: int,
    status_update: RoadReportStatusUpdate,
    db: Session = Depends(get_db),
):
    """Update verification status of a report (e.g. verified, unverified, resolved)."""
    report = db.query(RoadReport).filter(RoadReport.id == report_id).first()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Road report with ID {report_id} not found.",
        )

    report.status = status_update.status
    report.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(report)
    return report


@router.delete("/{report_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_report(
    report_id: int,
    db: Session = Depends(get_db),
):
    """Delete a report from the database."""
    report = db.query(RoadReport).filter(RoadReport.id == report_id).first()
    if report is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Road report with ID {report_id} not found.",
        )

    db.delete(report)
    db.commit()
    return None
