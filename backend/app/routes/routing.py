import logging
import math
from typing import Any, Dict, List
import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RoadReport
from ..schemas import HazardSummary, RoadReportResponse, RouteHazardItem, RouteResponse
from ..services.auth import get_current_user
from .reports import distance_km

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/routing",
    tags=["Route Planning"],
    dependencies=[Depends(get_current_user)],
)

OSRM_URL = "https://router.project-osrm.org/route/v1/driving"


def point_to_segment_details(
    plat: float, plon: float, lat1: float, lon1: float, lat2: float, lon2: float
) -> tuple[float, float]:
    """Calculate the shortest distance (in km) and the projection ratio t [0, 1] from a point to a line segment."""
    cos_lat = math.cos(math.radians((lat1 + lat2) / 2))
    dx = (lon2 - lon1) * cos_lat
    dy = lat2 - lat1
    rx = (plon - lon1) * cos_lat
    ry = plat - lat1

    seg_len_sq = dx * dx + dy * dy
    if seg_len_sq == 0:
        return distance_km(plat, plon, lat1, lon1), 0.0

    t = max(0.0, min(1.0, (rx * dx + ry * dy) / seg_len_sq))
    proj_lat = lat1 + t * (lat2 - lat1)
    proj_lon = lon1 + t * (lon2 - lon1)
    return distance_km(plat, plon, proj_lat, proj_lon), t


def point_to_segment_distance_km(
    plat: float, plon: float, lat1: float, lon1: float, lat2: float, lon2: float
) -> float:
    """Calculate the shortest distance (in km) from a point to a line segment on Earth."""
    d, _ = point_to_segment_details(plat, plon, lat1, lon1, lat2, lon2)
    return d


def find_hazards_along_route(
    coordinates: List[List[float]],
    reports: List[RoadReport],
    corridor_km: float,
) -> List[tuple[RoadReport, float, float]]:
    """
    Find stored reports situated within corridor_km of ANY segment along the route geometry.
    Coordinates are formatted as [lon, lat].
    Returns list of (RoadReport, route_km, distance_from_route_km) sorted by route_km.
    """
    if not coordinates or len(coordinates) < 2 or not reports:
        return []

    # Precalculate cumulative distance along polyline segments
    cum_dist = [0.0]
    for i in range(len(coordinates) - 1):
        seg_d = distance_km(
            coordinates[i][1], coordinates[i][0], coordinates[i + 1][1], coordinates[i + 1][0]
        )
        cum_dist.append(cum_dist[-1] + seg_d)

    hazards_found = []

    for report in reports:
        min_dist = float("inf")
        best_route_km = 0.0

        for i in range(len(coordinates) - 1):
            lon1, lat1 = coordinates[i][0], coordinates[i][1]
            lon2, lat2 = coordinates[i + 1][0], coordinates[i + 1][1]

            d, t = point_to_segment_details(report.latitude, report.longitude, lat1, lon1, lat2, lon2)
            if d < min_dist:
                min_dist = d
                seg_span = cum_dist[i + 1] - cum_dist[i]
                best_route_km = cum_dist[i] + t * seg_span

        if min_dist <= corridor_km:
            hazards_found.append((report, round(best_route_km, 2), round(min_dist, 3)))

    # Sort hazards by distance along route from journey start
    hazards_found.sort(key=lambda x: x[1])
    return hazards_found


@router.get("/route", response_model=RouteResponse)
async def get_route(
    start_lat: float = Query(..., ge=-90, le=90, description="Origin latitude"),
    start_lon: float = Query(..., ge=-180, le=180, description="Origin longitude"),
    end_lat: float = Query(..., ge=-90, le=90, description="Destination latitude"),
    end_lon: float = Query(..., ge=-180, le=180, description="Destination longitude"),
    corridor_km: float = Query(
        default=0.5,
        ge=0.05,
        le=10.0,
        description="Hazard detection corridor width along route (in km)",
    ),
    db: Session = Depends(get_db),
):
    """
    Retrieve an authentic driving route from OSRM and scan the entire corridor for database road reports.
    Corridor width is user-configurable (e.g. 0.1km, 0.25km, 0.5km, 1.0km, 2.0km, 5.0km).
    Never invents or fabricates routes.
    """
    coordinates_str = f"{start_lon},{start_lat};{end_lon},{end_lat}"
    params = {
        "overview": "full",
        "geometries": "geojson",
        "steps": "false",
    }

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(
                f"{OSRM_URL}/{coordinates_str}",
                params=params,
            )
            if response.status_code != 200:
                raise HTTPException(
                    status_code=status.HTTP_502_BAD_GATEWAY,
                    detail=f"Routing service returned HTTP {response.status_code}. Please verify that the selected points are on drivable land.",
                )

            data = response.json()
            if data.get("code") != "Ok" or not data.get("routes"):
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="No drivable route found between the specified coordinates. Please adjust your origin or destination.",
                )

            route = data["routes"][0]
            distance_km = round(route["distance"] / 1000.0, 2)
            duration_minutes = round(route["duration"] / 60.0, 1)
            geometry = route["geometry"]
            coords = geometry.get("coordinates", [])

    except httpx.HTTPError as exc:
        logger.error(f"OSRM request failed: {exc}")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="The OSRM routing service is temporarily unreachable. Please check your internet connection and retry.",
        )

    # Spatial query for reports along the route corridor
    if coords and len(coords) >= 2:
        lats = [c[1] for c in coords]
        lons = [c[0] for c in coords]
        lat_margin = (corridor_km / 111.0) * 1.5
        lon_margin = (corridor_km / 85.0) * 1.5

        min_lat, max_lat = min(lats) - lat_margin, max(lats) + lat_margin
        min_lon, max_lon = min(lons) - lon_margin, max(lons) + lon_margin

        # Filter database records inside the route bounding box first
        candidate_reports = (
            db.query(RoadReport)
            .filter(
                RoadReport.latitude.between(min_lat, max_lat),
                RoadReport.longitude.between(min_lon, max_lon),
            )
            .all()
        )

        hazards_along_route = find_hazards_along_route(
            coords, candidate_reports, corridor_km
        )
    else:
        hazards_along_route = []

    verified_count = sum(1 for h, _, _ in hazards_along_route if h.status == "verified")
    unverified_count = len(hazards_along_route) - verified_count
    total_hazards = len(hazards_along_route)

    highest_sev = "None"
    if any(
        h.hazard_type.lower() in ["pothole", "waterlogging", "road obstruction"]
        for h, _, _ in hazards_along_route
    ):
        highest_sev = "High"
    elif total_hazards > 0:
        highest_sev = "Moderate"

    if total_hazards == 0:
        advisory = (
            f"No recorded road hazards found for this route (within {corridor_km} km corridor). "
            "Please note: absence of reports reflects pending community data and does not confirm that the road is defect-free."
        )
    elif verified_count > 0:
        advisory = (
            f"Caution: {total_hazards} road defect(s) identified along this route corridor within {corridor_km} km "
            f"({verified_count} verified defect(s), {unverified_count} pending review). Proceed with caution."
        )
    else:
        advisory = (
            f"Notice: {total_hazards} unverified community hazard report(s) noted along route within {corridor_km} km corridor. "
            "Drive with normal vigilance."
        )

    return RouteResponse(
        distance_km=distance_km,
        duration_minutes=duration_minutes,
        geometry=geometry,
        source="OSRM Driving Service",
        corridor_km=corridor_km,
        hazards_along_route=[
            RouteHazardItem(
                id=h.id,
                hazard_type=h.hazard_type,
                description=h.description,
                location_name=h.location_name,
                locality=h.locality,
                city=h.city,
                district=h.district,
                state=h.state,
                country=h.country,
                image_url=h.image_url,
                source=h.source,
                detection_method=h.detection_method,
                updated_at=h.updated_at,
                latitude=h.latitude,
                longitude=h.longitude,
                status=h.status,
                is_sample=h.is_sample,
                created_at=h.created_at,
                route_km=r_km,
                distance_from_route_km=d_km,
            )
            for h, r_km, d_km in hazards_along_route
        ],
        hazard_summary=HazardSummary(
            total_hazards=total_hazards,
            verified_hazards=verified_count,
            unverified_hazards=unverified_count,
            corridor_km=corridor_km,
            highest_severity=highest_sev,
            advisory=advisory,
        ),
    )
