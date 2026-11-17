import asyncio
import logging
import os
import time
from typing import List, Optional
import httpx
from fastapi import APIRouter, Depends, Query, status
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RoadReport
from ..schemas import GeocodeResult, ReverseGeocodeResult

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/geocode", tags=["Geocoding"])

# Provider URLs
PHOTON_SEARCH_URL = "https://photon.komoot.io/api/"
PHOTON_REVERSE_URL = "https://photon.komoot.io/reverse"
NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
NOMINATIM_REVERSE_URL = "https://nominatim.openstreetmap.org/reverse"

HEADERS = {
    "User-Agent": "RoadSense-Platform/1.0 (road-intelligence-and-safety; contact=support@roadsense.local)",
    "Accept": "application/json",
    "Accept-Language": "en",
}

# In-memory caches to protect against rate limits and provide instant results (TTL = 3600 seconds)
_GEOCODE_CACHE: dict[str, tuple[float, List[GeocodeResult]]] = {}
_REVERSE_CACHE: dict[str, tuple[float, ReverseGeocodeResult]] = {}
CACHE_TTL_SECONDS = 3600.0


def build_display_name(parts: List[Optional[str]]) -> str:
    """Build clean display name with deduplicated components."""
    seen = set()
    cleaned = []
    for part in parts:
        if part:
            p = str(part).strip()
            p_lower = p.lower()
            if p and p_lower not in seen:
                seen.add(p_lower)
                cleaned.append(p)
    return ", ".join(cleaned)


def parse_photon_feature(feature: dict) -> Optional[GeocodeResult]:
    """Parse a single GeoJSON feature from Photon into a GeocodeResult schema."""
    try:
        props = feature.get("properties", {})
        geom = feature.get("geometry", {})
        coords = geom.get("coordinates", [])
        if len(coords) < 2:
            return None

        lon = float(coords[0])
        lat = float(coords[1])
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None

        name = props.get("name")
        locality = props.get("locality") or props.get("street")
        district = props.get("district") or props.get("county")
        city = props.get("city") or props.get("town") or props.get("village")
        state = props.get("state")
        country = props.get("country")
        place_type = props.get("type") or props.get("osm_value") or "locality"

        display_name = build_display_name([name, locality, district, city, state, country])
        if not display_name:
            display_name = f"Location ({lat:.4f}, {lon:.4f})"

        osm_id = props.get("osm_id", "")
        place_id = f"osm-{osm_id}" if osm_id else f"pt-{lat:.4f}-{lon:.4f}"

        return GeocodeResult(
            display_name=display_name,
            name=name or (city or display_name.split(",")[0].strip()),
            locality=locality,
            district=district,
            city=city,
            state=state,
            country=country,
            latitude=lat,
            longitude=lon,
            place_id=place_id,
            type=place_type,
        )
    except Exception as exc:
        logger.debug(f"Error parsing Photon feature: {exc}")
        return None


def parse_nominatim_item(item: dict) -> Optional[GeocodeResult]:
    """Parse a single Nominatim item into a GeocodeResult schema."""
    try:
        lat = float(item.get("lat", 0.0))
        lon = float(item.get("lon", 0.0))
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            return None

        address = item.get("address", {})
        name = (
            item.get("name")
            or address.get("road")
            or address.get("suburb")
            or address.get("city")
            or address.get("town")
            or address.get("village")
            or item.get("display_name", "").split(",")[0].strip()
        )
        locality = (
            address.get("suburb")
            or address.get("neighbourhood")
            or address.get("residential")
            or address.get("road")
            or address.get("village")
        )
        district = (
            address.get("state_district")
            or address.get("county")
            or address.get("city_district")
            or address.get("district")
        )
        city = (
            address.get("city")
            or address.get("town")
            or address.get("municipality")
            or address.get("county")
        )
        state = address.get("state")
        country = address.get("country")
        place_type = item.get("type") or item.get("addresstype") or "location"

        return GeocodeResult(
            display_name=item.get("display_name", ""),
            name=name,
            locality=locality,
            district=district,
            city=city,
            state=state,
            country=country,
            latitude=lat,
            longitude=lon,
            place_id=str(item.get("place_id", "")),
            type=place_type,
        )
    except Exception as exc:
        logger.debug(f"Error parsing Nominatim item: {exc}")
        return None


async def search_google_places(client: httpx.AsyncClient, api_key: str, query: str, limit: int) -> List[GeocodeResult]:
    """Search Google Places Autocomplete API if key is configured."""
    try:
        url = "https://maps.googleapis.com/maps/api/place/autocomplete/json"
        resp = await client.get(url, params={"input": query, "key": api_key, "language": "en"})
        if resp.status_code != 200:
            return []
        data = resp.json()
        predictions = data.get("predictions", [])[:limit]
        results = []
        for pred in predictions:
            place_id = pred.get("place_id")
            desc = pred.get("description", "")
            # Fetch coordinates from Details
            det_url = "https://maps.googleapis.com/maps/api/place/details/json"
            det_resp = await client.get(det_url, params={"place_id": place_id, "fields": "geometry,name,address_components", "key": api_key})
            if det_resp.status_code == 200:
                det_data = det_resp.json().get("result", {})
                geom = det_data.get("geometry", {}).get("location", {})
                lat = geom.get("lat")
                lon = geom.get("lng")
                if lat is not None and lon is not None:
                    results.append(
                        GeocodeResult(
                            display_name=desc,
                            name=det_data.get("name") or desc.split(",")[0].strip(),
                            latitude=lat,
                            longitude=lon,
                            place_id=place_id,
                            type="google_place",
                        )
                    )
        return results
    except Exception as exc:
        logger.warning(f"Google Places search error: {exc}")
        return []


async def search_mapbox(client: httpx.AsyncClient, token: str, query: str, limit: int) -> List[GeocodeResult]:
    """Search Mapbox Geocoding API if token is configured."""
    try:
        url = f"https://api.mapbox.com/geocoding/v5/mapbox.places/{query}.json"
        resp = await client.get(url, params={"access_token": token, "limit": limit, "language": "en"})
        if resp.status_code != 200:
            return []
        data = resp.json()
        features = data.get("features", [])
        results = []
        for feat in features:
            coords = feat.get("center", [])
            if len(coords) >= 2:
                lon, lat = coords[0], coords[1]
                name = feat.get("text")
                place_name = feat.get("place_name", "")
                context = feat.get("context", [])
                district = None
                city = None
                state = None
                country = None
                for c in context:
                    c_id = c.get("id", "")
                    if c_id.startswith("district"):
                        district = c.get("text")
                    elif c_id.startswith("place"):
                        city = c.get("text")
                    elif c_id.startswith("region"):
                        state = c.get("text")
                    elif c_id.startswith("country"):
                        country = c.get("text")

                results.append(
                    GeocodeResult(
                        display_name=place_name,
                        name=name,
                        district=district,
                        city=city,
                        state=state,
                        country=country,
                        latitude=lat,
                        longitude=lon,
                        place_id=feat.get("id"),
                        type="mapbox_place",
                    )
                )
        return results
    except Exception as exc:
        logger.warning(f"Mapbox search error: {exc}")
        return []


async def search_photon(client: httpx.AsyncClient, query: str, limit: int) -> List[GeocodeResult]:
    """Search Photon (global, typo-tolerant OpenStreetMap Elasticsearch API)."""
    try:
        resp = await client.get(PHOTON_SEARCH_URL, params={"q": query, "limit": limit})
        if resp.status_code == 200:
            data = resp.json()
            features = data.get("features", [])
            results = []
            for feat in features:
                parsed = parse_photon_feature(feat)
                if parsed:
                    results.append(parsed)
            return results
    except Exception as exc:
        logger.debug(f"Photon search failed: {exc}")
    return []


async def search_nominatim(client: httpx.AsyncClient, query: str, limit: int) -> List[GeocodeResult]:
    """Search OpenStreetMap Nominatim globally."""
    try:
        params = {
            "q": query,
            "format": "jsonv2",
            "limit": limit,
            "addressdetails": 1,
        }
        resp = await client.get(NOMINATIM_SEARCH_URL, params=params)
        if resp.status_code == 429:
            await asyncio.sleep(0.6)
            resp = await client.get(NOMINATIM_SEARCH_URL, params=params)

        if resp.status_code == 200:
            data = resp.json()
            if isinstance(data, list):
                results = []
                for item in data:
                    parsed = parse_nominatim_item(item)
                    if parsed:
                        results.append(parsed)
                return results
    except Exception as exc:
        logger.debug(f"Nominatim search failed: {exc}")
    return []


@router.get("", response_model=List[GeocodeResult])
@router.get("/", response_model=List[GeocodeResult])
async def search_location(
    q: str = Query(..., min_length=2, max_length=200, description="Place, locality or address to search"),
    limit: int = Query(default=6, ge=1, le=10),
    db: Session = Depends(get_db),
):
    """
    Search coordinates for a location globally.
    Supports countries, states, districts, cities, towns, villages, localities, streets and landmarks worldwide.
    Provides optional Google Places / Mapbox integrations with zero-key Photon & Nominatim fallbacks.
    """
    query_clean = q.strip()
    if not query_clean or len(query_clean) < 2:
        return []

    cache_key = f"{query_clean.lower()}:{limit}"
    now = time.time()

    # 1. Check in-memory cache
    if cache_key in _GEOCODE_CACHE:
        ts, cached_results = _GEOCODE_CACHE[cache_key]
        if now - ts < CACHE_TTL_SECONDS:
            return cached_results

    results: List[GeocodeResult] = []
    seen_coords = set()

    def add_unique(items: List[GeocodeResult]):
        for it in items:
            coord_key = (round(it.latitude, 4), round(it.longitude, 4))
            if coord_key not in seen_coords:
                seen_coords.add(coord_key)
                results.append(it)

    async with httpx.AsyncClient(timeout=8.0, headers=HEADERS) as client:
        # Check Google Places API if configured
        google_key = os.getenv("GOOGLE_PLACES_API_KEY")
        if google_key:
            g_results = await search_google_places(client, google_key, query_clean, limit)
            add_unique(g_results)
            if len(results) >= limit:
                _GEOCODE_CACHE[cache_key] = (now, results[:limit])
                return results[:limit]

        # Check Mapbox API if configured
        mapbox_token = os.getenv("MAPBOX_ACCESS_TOKEN")
        if mapbox_token:
            mb_results = await search_mapbox(client, mapbox_token, query_clean, limit)
            add_unique(mb_results)
            if len(results) >= limit:
                _GEOCODE_CACHE[cache_key] = (now, results[:limit])
                return results[:limit]

        # Default high-speed global provider: Photon (Elasticsearch over OSM)
        photon_results = await search_photon(client, query_clean, limit)
        add_unique(photon_results)

        # If Photon returned fewer results, augment or fallback to Nominatim
        if len(results) < limit:
            nom_results = await search_nominatim(client, query_clean, limit)
            add_unique(nom_results)

        # Multi-part fallback: e.g. "Nuzvid, Andhra Pradesh" -> "Nuzvid"
        if not results and "," in query_clean:
            parts = [p.strip() for p in query_clean.split(",") if p.strip()]
            if len(parts) >= 2:
                sub_query = parts[0]
                sub_results = await search_photon(client, sub_query, limit)
                add_unique(sub_results)

    # Database matching fallback: check if any reported hazards match the location name
    if len(results) < limit:
        db_matches = (
            db.query(RoadReport)
            .filter(
                (RoadReport.location_name.ilike(f"%{query_clean}%"))
                | (RoadReport.locality.ilike(f"%{query_clean}%"))
                | (RoadReport.city.ilike(f"%{query_clean}%"))
                | (RoadReport.district.ilike(f"%{query_clean}%"))
            )
            .limit(limit)
            .all()
        )
        for report in db_matches:
            coord_key = (round(report.latitude, 4), round(report.longitude, 4))
            if coord_key not in seen_coords:
                seen_coords.add(coord_key)
                results.append(
                    GeocodeResult(
                        display_name=report.location_name,
                        name=report.location_name.split(",")[0].strip(),
                        locality=report.locality,
                        district=report.district,
                        city=report.city,
                        state=report.state,
                        country=report.country,
                        latitude=report.latitude,
                        longitude=report.longitude,
                        place_id=f"db-{report.id}",
                        type="road_report_location",
                    )
                )

    final_results = results[:limit]
    if final_results:
        _GEOCODE_CACHE[cache_key] = (now, final_results)

    return final_results


@router.get("/reverse", response_model=ReverseGeocodeResult)
async def reverse_geocode(
    lat: float = Query(..., ge=-90, le=90, description="Latitude"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude"),
):
    """
    Resolve coordinates to a human-readable street address via reverse geocoding.
    Used for 'Use My Current Location' GPS resolution and map click pins globally.
    """
    cache_key = f"{lat:.4f},{lon:.4f}"
    now = time.time()
    if cache_key in _REVERSE_CACHE:
        ts, cached_result = _REVERSE_CACHE[cache_key]
        if now - ts < CACHE_TTL_SECONDS:
            return cached_result

    try:
        async with httpx.AsyncClient(timeout=8.0, headers=HEADERS) as client:
            # 1. Try Nominatim Reverse
            response = await client.get(
                NOMINATIM_REVERSE_URL,
                params={
                    "lat": lat,
                    "lon": lon,
                    "format": "jsonv2",
                    "addressdetails": 1,
                },
            )
            if response.status_code == 200:
                data = response.json()
                if "error" not in data:
                    addr = data.get("address", {})
                    result = ReverseGeocodeResult(
                        display_name=data.get("display_name", f"Position ({lat:.4f}, {lon:.4f})"),
                        latitude=lat,
                        longitude=lon,
                        road=addr.get("road") or addr.get("pedestrian"),
                        suburb=addr.get("suburb") or addr.get("neighbourhood"),
                        district=addr.get("state_district") or addr.get("county"),
                        city=addr.get("city") or addr.get("town") or addr.get("village"),
                        state=addr.get("state"),
                        country=addr.get("country"),
                    )
                    _REVERSE_CACHE[cache_key] = (now, result)
                    return result

            # 2. Try Photon Reverse fallback
            photon_resp = await client.get(
                PHOTON_REVERSE_URL,
                params={"lat": lat, "lon": lon},
            )
            if photon_resp.status_code == 200:
                data = photon_resp.json()
                features = data.get("features", [])
                if features:
                    props = features[0].get("properties", {})
                    display = build_display_name([
                        props.get("name"),
                        props.get("street"),
                        props.get("district") or props.get("county"),
                        props.get("city"),
                        props.get("state"),
                        props.get("country"),
                    ])
                    result = ReverseGeocodeResult(
                        display_name=display or f"Position ({lat:.4f}, {lon:.4f})",
                        latitude=lat,
                        longitude=lon,
                        road=props.get("street"),
                        suburb=props.get("locality"),
                        district=props.get("district") or props.get("county"),
                        city=props.get("city"),
                        state=props.get("state"),
                        country=props.get("country"),
                    )
                    _REVERSE_CACHE[cache_key] = (now, result)
                    return result

    except Exception as exc:
        logger.warning(f"Reverse geocode failed: {exc}")

    # Fallback when reverse geocoding is unavailable
    return ReverseGeocodeResult(
        display_name=f"Pinned Location ({lat:.5f}, {lon:.5f})",
        latitude=lat,
        longitude=lon,
    )
