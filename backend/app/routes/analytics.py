from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from ..database import get_db
from ..services.auth import get_current_user
from ..services.road_analysis import (
    calculate_road_health,
    get_recurring_hazards,
    get_reporting_trends,
    get_road_statistics,
)

router = APIRouter(
    prefix="/api/analytics",
    tags=["Road Analytics"],
    dependencies=[Depends(get_current_user)],
)


@router.get("/overview")
def analytics_overview(db: Session = Depends(get_db)):
    """Return consolidated analytics overview including counts, categories, and road health."""
    statistics = get_road_statistics(db)
    health = calculate_road_health(
        statistics["total_reports"],
        statistics["verified_reports"],
        statistics["unverified_reports"],
    )

    return {
        **statistics,
        "road_health": health,
    }


@router.get("/trends")
def analytics_trends(
    days: int = Query(default=14, ge=3, le=60),
    db: Session = Depends(get_db),
):
    """Return daily trend metrics over the requested number of days."""
    return {
        "days": days,
        "trends": get_reporting_trends(db, days=days),
    }


@router.get("/recurring")
def analytics_recurring(db: Session = Depends(get_db)):
    """Return locations exhibiting repeat road hazard reports."""
    clusters = get_recurring_hazards(db)
    return {
        "recurring_count": len(clusters),
        "hotspots": clusters,
        "note": "Only locations with 2 or more distinct database records are included." if clusters else "No recurring hazard clusters identified in the current database.",
    }
