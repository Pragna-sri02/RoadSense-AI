from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..models import RoadReport


def get_road_statistics(db: Session) -> Dict[str, Any]:
    """Calculate comprehensive road hazard statistics from actual database records."""
    total_reports = db.query(RoadReport).count()
    verified_reports = db.query(RoadReport).filter(RoadReport.status == "verified").count()
    unverified_reports = db.query(RoadReport).filter(RoadReport.status != "verified").count()
    sample_reports = db.query(RoadReport).filter(RoadReport.is_sample == True).count()
    community_reports = total_reports - sample_reports

    hazard_counts = (
        db.query(RoadReport.hazard_type, func.count(RoadReport.id))
        .group_by(RoadReport.hazard_type)
        .order_by(func.count(RoadReport.id).desc())
        .all()
    )

    area_counts = (
        db.query(RoadReport.location_name, func.count(RoadReport.id))
        .group_by(RoadReport.location_name)
        .order_by(func.count(RoadReport.id).desc())
        .limit(10)
        .all()
    )

    city_counts = (
        db.query(RoadReport.city, func.count(RoadReport.id))
        .filter(RoadReport.city.isnot(None))
        .group_by(RoadReport.city)
        .order_by(func.count(RoadReport.id).desc())
        .limit(10)
        .all()
    )

    state_counts = (
        db.query(RoadReport.state, func.count(RoadReport.id))
        .filter(RoadReport.state.isnot(None))
        .group_by(RoadReport.state)
        .order_by(func.count(RoadReport.id).desc())
        .limit(10)
        .all()
    )

    return {
        "total_reports": total_reports,
        "verified_reports": verified_reports,
        "unverified_reports": unverified_reports,
        "sample_reports": sample_reports,
        "community_reports": community_reports,
        "hazards_by_type": {h: count for h, count in hazard_counts},
        "top_areas": [{"location": loc, "count": count} for loc, count in area_counts],
        "top_cities": [{"city": c, "count": cnt} for c, cnt in city_counts],
        "top_states": [{"state": s, "count": cnt} for s, cnt in state_counts],
    }


def calculate_road_health(total_reports: int, verified_reports: int, unverified_reports: int) -> Dict[str, Any]:
    """
    Compute a transparent, documented Road Health Score (0-100) based on verified and unverified reports.

    Documented Methodology:
    - Minimum threshold: Requires at least 3 reports to avoid small-sample distortion.
    - Base benchmark: 100 (Prone to zero reported defects).
    - Verified hazard penalty: 12 points per verified active defect (heavily weighted).
    - Unverified hazard penalty: 4 points per pending community report (moderately weighted).
    - Maximum total penalty: 85 points (score floor of 15).
    """
    if total_reports < 3:
        return {
            "score": None,
            "label": "Insufficient data",
            "message": (
                f"Currently {total_reports} report(s) in the database. "
                "RoadSense requires at least 3 reports in an analyzed area to compute a statistically sound score."
            ),
            "factors": {
                "total_reports": total_reports,
                "verified_penalty": 0,
                "unverified_penalty": 0,
                "threshold_met": False,
            },
        }

    verified_penalty = verified_reports * 12
    unverified_penalty = unverified_reports * 4
    total_penalty = min(85, verified_penalty + unverified_penalty)
    score = max(15, 100 - total_penalty)

    if score >= 80:
        label = "Good Road Condition"
        advisory = "Low density of verified defects reported. Typical driving conditions expected."
    elif score >= 55:
        label = "Moderate Road Hazards"
        advisory = "Several defects reported. Drivers should proceed with elevated awareness."
    else:
        label = "High Hazard Density"
        advisory = "Significant number of severe road hazards verified. Caution advised, especially in low visibility."

    return {
        "score": score,
        "label": label,
        "message": advisory,
        "factors": {
            "total_reports": total_reports,
            "verified_reports": verified_reports,
            "unverified_reports": unverified_reports,
            "verified_penalty": verified_penalty,
            "unverified_penalty": unverified_penalty,
            "threshold_met": True,
        },
    }


def get_reporting_trends(db: Session, days: int = 14) -> List[Dict[str, Any]]:
    """Retrieve daily report volume for the past N days."""
    now = datetime.now(timezone.utc)
    trends = []

    for i in range(days - 1, -1, -1):
        target_date = (now - timedelta(days=i)).date()
        start = datetime(target_date.year, target_date.month, target_date.day, tzinfo=timezone.utc)
        end = start + timedelta(days=1)

        total = db.query(RoadReport).filter(RoadReport.created_at >= start, RoadReport.created_at < end).count()
        verified = (
            db.query(RoadReport)
            .filter(RoadReport.created_at >= start, RoadReport.created_at < end, RoadReport.status == "verified")
            .count()
        )

        trends.append({
            "date": target_date.strftime("%Y-%m-%d"),
            "display_date": target_date.strftime("%b %d"),
            "total": total,
            "verified": verified,
            "pending": total - verified,
        })

    return trends


def get_recurring_hazards(db: Session) -> List[Dict[str, Any]]:
    """
    Detect recurring damage clusters where multiple reports exist for the same corridor or location name.
    Strictly backed by database records without fabrication.
    """
    results = (
        db.query(
            RoadReport.location_name,
            func.count(RoadReport.id).label("report_count"),
            func.min(RoadReport.created_at).label("first_reported"),
            func.max(RoadReport.created_at).label("last_reported"),
        )
        .group_by(RoadReport.location_name)
        .having(func.count(RoadReport.id) >= 2)
        .order_by(func.count(RoadReport.id).desc())
        .limit(8)
        .all()
    )

    recurring = []
    for row in results:
        types = (
            db.query(RoadReport.hazard_type)
            .filter(RoadReport.location_name == row.location_name)
            .distinct()
            .all()
        )
        recurring.append({
            "location_name": row.location_name,
            "report_count": row.report_count,
            "hazard_types": [t[0] for t in types],
            "first_reported": row.first_reported.isoformat() if row.first_reported else None,
            "last_reported": row.last_reported.isoformat() if row.last_reported else None,
            "indication": "Potential recurring road degradation identified across multiple logged events.",
        })

    return recurring
