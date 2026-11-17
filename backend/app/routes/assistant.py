import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional
import httpx
from fastapi import APIRouter, Depends, Query
from sqlalchemy import func
from sqlalchemy.orm import Session

from ..database import get_db
from ..models import RoadReport
from ..schemas import AssistantQuery, AssistantResponse
from ..services.auth import get_current_user
from ..services.voice_support import clean_text_for_speech
from .reports import distance_km
from .routing import find_hazards_along_route, OSRM_URL

logger = logging.getLogger(__name__)

router = APIRouter(
    prefix="/api/assistant",
    tags=["RoadSense Assistant"],
    dependencies=[Depends(get_current_user)],
)

NOMINATIM_SEARCH_URL = "https://nominatim.openstreetmap.org/search"
HEADERS = {
    "User-Agent": "RoadSense-Platform/1.0 (road-intelligence-and-safety; contact=support@roadsense.local)",
    "Accept": "application/json",
}


def get_curated_suggestions() -> List[Dict[str, str]]:
    """Curated questions matching actual platform capabilities and user requirements."""
    return [
        {
            "category": "Car Travel",
            "question": "How long does it take from Agiripalli to Vijayawada by car?",
        },
        {
            "category": "Bus & Transit",
            "question": "How long does it take by bus?",
        },
        {
            "category": "Walking",
            "question": "What about by walking?",
        },
        {
            "category": "Route Hazards",
            "question": "Are there potholes along this route?",
        },
        {
            "category": "Destination",
            "question": "What hazards are near my destination?",
        },
        {
            "category": "Road Knowledge",
            "question": "What is a pothole and why do potholes form?",
        },
    ]


@router.get("/suggestions")
def list_suggestions():
    """Return recommended questions grounded in RoadSense capabilities."""
    return get_curated_suggestions()


async def geocode_place_name(place_name: str) -> Optional[dict]:
    """Attempt to resolve a place name mentioned in a question via Photon and Nominatim."""
    clean_query = place_name.strip()
    if not clean_query:
        return None

    try:
        async with httpx.AsyncClient(timeout=6.0, headers=HEADERS) as client:
            # Try Photon first (fast, global)
            p_resp = await client.get("https://photon.komoot.io/api/", params={"q": clean_query, "limit": 1})
            if p_resp.status_code == 200:
                p_data = p_resp.json()
                features = p_data.get("features", [])
                if features:
                    feat = features[0]
                    coords = feat.get("geometry", {}).get("coordinates", [])
                    props = feat.get("properties", {})
                    if len(coords) >= 2:
                        name = props.get("name") or clean_query
                        city = props.get("city") or props.get("county") or ""
                        state = props.get("state") or ""
                        country = props.get("country") or ""
                        parts = [p for p in [name, city, state, country] if p]
                        seen = set()
                        dedup = []
                        for p in parts:
                            p_clean = str(p).strip()
                            if p_clean.lower() not in seen:
                                seen.add(p_clean.lower())
                                dedup.append(p_clean)
                        display_name = ", ".join(dedup)
                        return {
                            "display_name": display_name,
                            "latitude": float(coords[1]),
                            "longitude": float(coords[0]),
                        }

            # Fallback to Nominatim
            resp = await client.get(
                NOMINATIM_SEARCH_URL,
                params={"q": clean_query, "format": "jsonv2", "limit": 1, "addressdetails": 1},
            )
            if resp.status_code == 200:
                data = resp.json()
                if isinstance(data, list) and len(data) > 0:
                    return {
                        "display_name": data[0].get("display_name", clean_query),
                        "latitude": float(data[0]["lat"]),
                        "longitude": float(data[0]["lon"]),
                    }
    except Exception as exc:
        logger.warning(f"Assistant place geocoding failed for '{clean_query}': {exc}")
    return None


def clean_place_name(name: str) -> str:
    """Clean extracted place name by stripping action verbs and trailing travel mode clauses."""
    # Strip leading verbs
    name = re.sub(
        r"^(?:go|travel|drive|commute|head|get|reach|walk|cycle|ride)\s+(?:to\s+)?",
        "",
        name,
        flags=re.IGNORECASE,
    ).strip()
    # Strip trailing travel mode clauses
    name = re.sub(
        r"\s+\b(?:by|on|in|using)\s+(?:car|bus|walking|walk|foot|bicycle|bike|cycle|motorcycle|motorbike|scooter|two-wheeler|road|transit)\b.*$",
        "",
        name,
        flags=re.IGNORECASE,
    ).strip()
    # Strip trailing punctuation
    name = re.sub(r"^[,\s.-]+|[,\s.-]+$", "", name)
    return name


def extract_route_endpoints_from_question(question: str) -> tuple[Optional[str], Optional[str]]:
    """
    Extract origin and destination names from patterns like:
    - 'How long does it take from Agiripalli to Vijayawada by car?'
    - 'to Agiripalli from Vijayawada'
    - 'between Vijayawada and Agiripalli'
    - 'how far is Agiripalli from Vijayawada'
    """
    q = question.strip()
    boundary = r"(?:\.|\?|,|$|\s+(?:where|are|what|how|with|in|safe|is|taking|via|by|on|using|for|as))"

    # 1. 'between <orig> and <dest>'
    m_between = re.search(r"\bbetween\s+([a-zA-Z0-9\s,.-]+?)\s+and\s+([a-zA-Z0-9\s,.-]+?)" + boundary, q, re.I)
    if m_between:
        orig = clean_place_name(m_between.group(1))
        dest = clean_place_name(m_between.group(2))
        if len(orig) >= 2 and len(dest) >= 2:
            return orig, dest

    # 2. 'to <dest> from <orig>' (ensuring <dest> is not an action verb like travel, go, drive)
    m_to_from = re.search(r"\bto\s+([a-zA-Z0-9\s,.-]+?)\s+from\s+([a-zA-Z0-9\s,.-]+?)" + boundary, q, re.I)
    if m_to_from:
        d_cand = clean_place_name(m_to_from.group(1))
        if d_cand and not re.match(r"^(?:travel|go|drive|commute|head|fly|reach|get|take|walk|ride)\b", d_cand, re.I):
            orig = clean_place_name(m_to_from.group(2))
            if len(orig) >= 2 and len(d_cand) >= 2 and orig.lower() not in ["here", "me"] and d_cand.lower() not in ["there"]:
                return orig, d_cand

    # 3. 'from <orig> to <dest>'
    m_from_to = re.search(r"\bfrom\s+([a-zA-Z0-9\s,.-]+?)\s+to\s+([a-zA-Z0-9\s,.-]+?)" + boundary, q, re.I)
    if m_from_to:
        orig = clean_place_name(m_from_to.group(1))
        dest = clean_place_name(m_from_to.group(2))
        if len(orig) >= 2 and len(dest) >= 2 and orig.lower() not in ["here", "me"] and dest.lower() not in ["there"]:
            return orig, dest

    # 4. 'how far is <dest> from <orig>'
    m_far = re.search(r"\bhow far is\s+([a-zA-Z0-9\s,.-]+?)\s+from\s+([a-zA-Z0-9\s,.-]+?)" + boundary, q, re.I)
    if m_far:
        dest = clean_place_name(m_far.group(1))
        orig = clean_place_name(m_far.group(2))
        if len(orig) >= 2 and len(dest) >= 2:
            return orig, dest

    return None, None


def extract_travel_mode(question: str, active_mode: Optional[str] = None) -> str:
    """
    Extract requested travel mode: car, bus, walking, bicycle, motorcycle.
    Gracefully handles past reference phrases like 'if I previously asked about the bus'.
    """
    ql = question.lower().strip()

    # Strip past reference clauses like 'if I previously asked about X', 'instead of X'
    clean_q = re.sub(
        r"\b(?:previously asked about|earlier asked about|instead of|rather than|not by)\s+[a-z\s]+",
        "",
        ql,
    )

    # 1. Direct prepositional phrases: 'by car', 'by bus', 'by walking', etc.
    m_direct = re.search(
        r"\b(?:by|in|on|what about|how about)\s+(car|bus|walking|walk|foot|bicycle|bike|cycle|cycling|motorcycle|motorbike|scooter|two-wheeler)\b",
        clean_q,
    )
    if m_direct:
        target = m_direct.group(1)
        if target in ["bus"]:
            return "bus"
        if target in ["walking", "walk", "foot"]:
            return "walking"
        if target in ["bicycle", "bike", "cycle", "cycling"]:
            return "bicycle"
        if target in ["motorcycle", "motorbike", "scooter", "two-wheeler"]:
            return "motorcycle"
        if target in ["car"]:
            return "car"

    # 2. General keywords in question
    if re.search(r"\b(?:bus|public transit|public transport|transit|coach|apsrtc)\b", clean_q):
        return "bus"
    if re.search(r"\b(?:walk|walking|on foot|pedestrian)\b", clean_q):
        return "walking"
    if re.search(r"\b(?:bicycle|cycling)\b", clean_q):
        return "bicycle"
    if re.search(r"\b(?:motorcycle|motorbike|two-wheeler)\b", clean_q):
        return "motorcycle"
    if re.search(r"\b(?:car|driving|drive|automobile)\b", clean_q):
        return "car"

    return active_mode or "car"


def extract_potential_location_name(question: str) -> Optional[str]:
    """Extract named place from patterns like 'in Vijayawada', 'near Agiripalli', 'at Nuzvid'."""
    ignored_phrases = {
        "this area",
        "my location",
        "current location",
        "my current location",
        "this spot",
        "my area",
        "the route",
        "selected route",
        "my route",
        "my destination",
        "the destination",
        "destination",
        "the database",
        "this place",
        "me",
        "here",
    }

    patterns = [
        r"\b(?:in|near|around|at|for|to)\s+([A-Z][a-zA-Z0-9\s,.-]+(?:\bAndhra Pradesh|\bDelhi|\bIndia|\bCity|\bTown)?)",
        r"\b(?:in|near|around|at|for)\s+([a-zA-Z\s,.-]{3,30})",
    ]
    for pattern in patterns:
        match = re.search(pattern, question, re.IGNORECASE)
        if match:
            candidate = match.group(1).strip()
            candidate_clean = re.sub(r"\s+", " ", candidate).lower()
            if candidate_clean not in ignored_phrases and not any(
                candidate_clean.startswith(ign) for ign in ["my ", "the ", "this "]
            ):
                return candidate
    return None


def format_duration(minutes: float) -> str:
    """Format minutes into human-readable duration."""
    total_mins = int(round(minutes))
    if total_mins < 1:
        return "less than 1 minute"
    if total_mins < 60:
        return f"{total_mins} minute{'s' if total_mins != 1 else ''}"
    hours = total_mins // 60
    rem_mins = total_mins % 60
    if rem_mins == 0:
        return f"{hours} hour{'s' if hours != 1 else ''}"
    return f"{hours} hr {rem_mins} min"


async def fetch_osrm_route(
    start_lat: float, start_lon: float, end_lat: float, end_lon: float
) -> tuple[List[List[float]], float, float]:
    """Fetch route geometry, distance_km, and duration_minutes from OSRM driving engine."""
    coords_str = f"{start_lon},{start_lat};{end_lon},{end_lat}"
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            resp = await client.get(
                f"{OSRM_URL}/{coords_str}?overview=full&geometries=geojson&steps=false"
            )
            if resp.status_code == 200:
                data = resp.json()
                if data.get("routes"):
                    route = data["routes"][0]
                    route_coords = route["geometry"]["coordinates"]
                    dist_km = round(route["distance"] / 1000.0, 1)
                    dur_min = round(route["duration"] / 60.0, 1)
                    return route_coords, dist_km, dur_min
    except Exception as exc:
        logger.warning(f"OSRM query failed: {exc}")

    # Fallback to straight-line estimation if OSRM is unreachable
    straight_km = distance_km(start_lat, start_lon, end_lat, end_lon)
    est_dist_km = round(straight_km * 1.25, 1)
    est_dur_min = round((est_dist_km / 45.0) * 60.0, 1)
    return [[start_lon, start_lat], [end_lon, end_lat]], est_dist_km, est_dur_min


@router.get("/ask", response_model=AssistantResponse)
@router.post("/ask", response_model=AssistantResponse)
async def ask_assistant(
    question: Optional[str] = Query(None, min_length=2, max_length=500),
    latitude: Optional[float] = Query(default=None, ge=-90, le=90),
    longitude: Optional[float] = Query(default=None, ge=-180, le=180),
    location_name: Optional[str] = Query(default=None),
    origin_lat: Optional[float] = Query(default=None, ge=-90, le=90),
    origin_lon: Optional[float] = Query(default=None, ge=-180, le=180),
    dest_lat: Optional[float] = Query(default=None, ge=-90, le=90),
    dest_lon: Optional[float] = Query(default=None, ge=-180, le=180),
    corridor_km: Optional[float] = Query(default=0.5, ge=0.05, le=10.0),
    query_body: Optional[AssistantQuery] = None,
    db: Session = Depends(get_db),
):
    """
    Intelligent, grounded RoadSense AI Assistant.
    Supports travel modes (car, bus, walking, bicycle, motorcycle), multi-turn context retention,
    strict separation between pure travel inquiries and hazard inquiries, and zero robotic boilerplates.
    """
    from fastapi.params import Query as QueryParam
    if isinstance(question, QueryParam):
        question = None
    if isinstance(latitude, QueryParam):
        latitude = None
    if isinstance(longitude, QueryParam):
        longitude = None
    if isinstance(location_name, QueryParam):
        location_name = None
    if isinstance(origin_lat, QueryParam):
        origin_lat = None
    if isinstance(origin_lon, QueryParam):
        origin_lon = None
    if isinstance(dest_lat, QueryParam):
        dest_lat = None
    if isinstance(dest_lon, QueryParam):
        dest_lon = None
    if isinstance(corridor_km, QueryParam):
        corridor_km = 0.5

    history: List[Dict[str, Any]] = []
    active_origin: Optional[str] = None
    active_destination: Optional[str] = None
    active_mode: Optional[str] = None

    if query_body:
        question = query_body.question or question
        latitude = query_body.latitude if query_body.latitude is not None else latitude
        longitude = query_body.longitude if query_body.longitude is not None else longitude
        location_name = query_body.location_name or location_name
        origin_lat = query_body.origin_lat if query_body.origin_lat is not None else origin_lat
        origin_lon = query_body.origin_lon if query_body.origin_lon is not None else origin_lon
        dest_lat = query_body.dest_lat if query_body.dest_lat is not None else dest_lat
        dest_lon = query_body.dest_lon if query_body.dest_lon is not None else dest_lon
        corridor_km = query_body.corridor_km if query_body.corridor_km is not None else corridor_km
        history = query_body.history or []
        active_origin = query_body.active_origin
        active_destination = query_body.active_destination
        active_mode = query_body.travel_mode

    if not question:
        return AssistantResponse(
            question="",
            answer="Please ask a question regarding road hazards, safe routes, travel times, or road safety.",
            speech_text="Please ask a question regarding road hazards, safe routes, travel times, or road safety.",
            reports=[],
            source="RoadSense Assistant",
            database_grounded=False,
            total_matches=0,
            intent="empty",
        )

    q_clean = question.strip()
    q_lower = q_clean.lower()
    corridor_km = corridor_km or 0.5

    # -------------------------------------------------------------
    # 1. GENERAL KNOWLEDGE & ROAD SAFETY EXPLANATIONS
    # Direct, authoritative answers without database boilerplates
    # -------------------------------------------------------------

    # 1a. "What is a pothole?"
    if re.search(r"\bwhat is (?:a )?pothole\b", q_lower):
        answer = (
            "A **pothole** is a bowl-shaped opening or depression in a road surface caused by water infiltration, "
            "temperature changes, and vehicular traffic fatigue.\n\n"
            "Water penetrates microscopic fractures in the asphalt crust and softens the underlying gravel sub-base. "
            "As heavy vehicles repeatedly roll over this weakened foundation, the unsupported asphalt flexes, "
            "cracks, and breaks apart, leaving a depression that damages tires, rims, and vehicle suspensions."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="Road Safety Intelligence",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_pothole_definition",
        )

    # 1b. "Why do potholes form?" / "How do potholes form?"
    if re.search(r"\b(?:why|how) do potholes form\b", q_lower):
        answer = (
            "Potholes form through a three-stage mechanical and environmental process:\n\n"
            "1. **Water Infiltration**: Rainwater or pooling surface water seeps into minor cracks in the asphalt.\n"
            "2. **Sub-base Softening & Erosion**: The trapped water weakens, washes away, or erodes the underlying soil and gravel foundation.\n"
            "3. **Traffic Loading Fatigue**: Heavy traffic passing over the unsupported asphalt layer causes it to sag and collapse under wheel loads, creating an open pothole."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="Road Safety Intelligence",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_pothole_cause",
        )

    # 1c. "How to identify damaged roads?"
    if re.search(r"\b(?:how (?:can i|to) identify (?:damaged|poor|bad) roads|signs of road damage)\b", q_lower):
        answer = (
            "Key visual indicators of damaged road surfaces include:\n\n"
            "• **Potholes**: Sharp-edged cavities or depressions in the asphalt.\n"
            "• **Alligator Cracking**: Interconnected, web-like fracture patterns indicating subgrade failure.\n"
            "• **Rutting**: Sunken longitudinal channels worn into wheel paths from heavy commercial vehicles.\n"
            "• **Raveling**: Disintegration where stones separate from binder, creating loose gravel hazards.\n"
            "• **Edge Drop-offs**: Crumbling asphalt margins between the paved road and the shoulder."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="Road Safety Intelligence",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_road_defects",
        )

    # 1d. "What does hazard scan corridor width mean?"
    if re.search(r"\b(?:what (?:does|is)(?: the)? (?:hazard scan )?corridor width|corridor width mean)\b", q_lower):
        answer = (
            "In RoadSense, the **Hazard Scan Corridor Width** (default: 0.5 km) is the lateral buffer zone searched "
            "on both sides of your planned route polyline.\n\n"
            "For example, with a 0.5 km corridor, RoadSense scans for any reported potholes or hazards located within "
            "500 meters perpendicular to your driving path. This ensures you receive alerts for defects in your lane, "
            "service lanes, and immediate intersection turn-offs along your journey."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="RoadSense Navigation Architecture",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_corridor_width",
        )

    # 1e. "What is latitude and longitude?"
    if re.search(r"\bwhat is latitude (?:and|&) longitude\b", q_lower):
        answer = (
            "**Latitude and Longitude** form the global coordinate system used to pinpoint any position on Earth:\n\n"
            "• **Latitude (Lat)**: Measures North or South distance from the Equator (0°), spanning from -90° (South Pole) to +90° (North Pole).\n"
            "• **Longitude (Lon)**: Measures East or West distance from the Prime Meridian in Greenwich, UK (0°), spanning from -180° to +180°.\n\n"
            "For example, Vijayawada is located at approximately 16.5062° N, 80.6480° E."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="Geospatial Reference",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_coordinates",
        )

    # 1f. "How does AI pothole detection work?"
    if re.search(r"\bhow does (?:ai|the ai) (?:pothole )?detection work\b", q_lower):
        answer = (
            "RoadSense AI Pothole Detection uses Computer Vision algorithms to analyze road surface photographs:\n\n"
            "1. **Surface Inspection**: Scans images for depth contours, shadows, edge irregularities, and asphalt degradation.\n"
            "2. **Defect Classification**: Classifies detected anomalies as Potholes, Damaged Surface, Waterlogging, or Debris, and estimates severity (Low, Medium, High).\n"
            "3. **Automatic Geotagging**: Extracts GPS coordinates embedded in photo EXIF metadata so the defect is plotted accurately on the map without manual entry."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="RoadSense Vision AI",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_ai_detection",
        )

    # 1g. "How can I submit a road report?"
    if re.search(r"\b(?:how (?:can i|do i|to) (?:submit|report|add|log) (?:a )?(?:road report|pothole|hazard|defect))\b", q_lower):
        answer = (
            "To submit a road defect report in RoadSense:\n\n"
            "1. Navigate to the **'Road Reports'** page or click on the interactive **'Road Monitoring'** map.\n"
            "2. Upload a photo of the defect (our Computer Vision will analyze the image and auto-suggest the hazard type and GPS coordinates).\n"
            "3. Verify the location name, hazard type, and add an optional description.\n"
            "4. Click **'Submit Report'**.\n\n"
            "Your report immediately appears on the live map as an unverified community alert to help other motorists travel safely."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="RoadSense Platform Guide",
            database_grounded=False,
            total_matches=0,
            intent="help_submit_report",
        )

    # 1h. "What is RoadSense?"
    if re.search(r"\bwhat is roadsense\b", q_lower):
        answer = (
            "**RoadSense** is an AI-powered road intelligence and route navigation platform. "
            "It combines crowdsourced community reporting, computer vision surface analysis, "
            "and route corridor scanning to warn motorists of potholes, damaged road surfaces, "
            "and other travel hazards before and during their journeys."
        )
        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="RoadSense Overview",
            database_grounded=False,
            total_matches=0,
            intent="knowledge_platform_overview",
        )

    # -------------------------------------------------------------
    # 2. MULTI-TURN CONTEXT RESOLUTION & TRAVEL MODE EXTRACTION
    # Extract endpoints from question, or recover them from active context/history
    # -------------------------------------------------------------
    orig_from_q, dest_from_q = extract_route_endpoints_from_question(question)

    # If endpoints not found in current question, inspect active_context or history
    if not orig_from_q and not dest_from_q:
        if active_origin and active_destination:
            orig_from_q = active_origin
            dest_from_q = active_destination
        elif history:
            for msg in reversed(history):
                prev_text = msg.get("text", "")
                p_orig, p_dest = extract_route_endpoints_from_question(prev_text)
                if p_orig and p_dest:
                    orig_from_q = p_orig
                    dest_from_q = p_dest
                    break

    # Extract requested travel mode (car, bus, walking, bicycle, motorcycle)
    travel_mode = extract_travel_mode(question, active_mode)

    # If we have endpoints and missing coordinates, geocode them
    if orig_from_q and dest_from_q and (origin_lat is None or dest_lat is None):
        orig_geo = await geocode_place_name(orig_from_q)
        dest_geo = await geocode_place_name(dest_from_q)
        if orig_geo and dest_geo:
            origin_lat = orig_geo["latitude"]
            origin_lon = orig_geo["longitude"]
            dest_lat = dest_geo["latitude"]
            dest_lon = dest_geo["longitude"]

    # Check whether the question is explicitly asking about HAZARDS / POTHOLES
    is_hazard_query = bool(
        "pothole" in q_lower
        or "hazard" in q_lower
        or "defect" in q_lower
        or "damaged road" in q_lower
        or "road damage" in q_lower
        or "road condition" in q_lower
        or "safety" in q_lower
        or "safe" in q_lower
    )

    # -------------------------------------------------------------
    # 3. INTENT: "WHERE EXACTLY?" / EXACT DEFECT LOCATIONS
    # Handles multi-turn follow-ups asking for specific coordinates / km markers
    # -------------------------------------------------------------
    is_where_exactly = bool(
        re.search(
            r"\b(?:where exactly|where are the damaged roads|where are the potholes|give me exact locations|exact locations?|which km)\b",
            q_lower,
        )
    )

    if is_where_exactly:
        if origin_lat is not None and dest_lat is not None:
            route_coords, dist_km, dur_min = await fetch_osrm_route(
                origin_lat, origin_lon, dest_lat, dest_lon
            )
            all_reports = db.query(RoadReport).all()
            route_hazards = find_hazards_along_route(route_coords, all_reports, corridor_km)

            route_label = f"from {orig_from_q} to {dest_from_q}" if (orig_from_q and dest_from_q) else "along your route"

            if not route_hazards:
                answer = (
                    f"No road defects are currently recorded in the RoadSense database {route_label} within the {corridor_km} km corridor. "
                    "Remember that an empty record reflects current community submissions and does not guarantee pristine pavement."
                )
                return AssistantResponse(
                    question=question,
                    answer=answer,
                    speech_text=clean_text_for_speech(answer),
                    reports=[],
                    source="RoadSense Route Corridor Scan",
                    database_grounded=True,
                    total_matches=0,
                    intent="hazard_locations_empty",
                )
            else:
                bullets = []
                for h, r_km, d_km in route_hazards:
                    status_lbl = "Verified Defect" if h.status == "verified" else "Pending Review"
                    bullets.append(
                        f"• **At km {r_km:.1f} of journey**: {h.hazard_type} near **{h.location_name}** "
                        f"(GPS: {h.latitude:.6f}, {h.longitude:.6f}, ~{d_km:.2f} km off centerline). "
                        f"Details: \"{h.description}\" [{status_lbl}]."
                    )
                bullets_text = "\n\n".join(bullets)
                answer = (
                    f"Here are the specific locations of the {len(route_hazards)} reported defect(s) {route_label}:\n\n"
                    f"{bullets_text}\n\n"
                    "Slow down and exercise caution when approaching these coordinates."
                )

                report_items = [
                    {
                        "id": h.id,
                        "hazard_type": h.hazard_type,
                        "location_name": h.location_name,
                        "status": h.status,
                        "description": h.description,
                        "created_at": h.created_at.strftime("%Y-%m-%d"),
                        "route_km": r_km,
                        "distance_from_route_km": d_km,
                        "image_url": h.image_url,
                    }
                    for h, r_km, d_km in route_hazards
                ]

                active_context = {
                    "origin": orig_from_q,
                    "destination": dest_from_q,
                    "origin_lat": origin_lat,
                    "origin_lon": origin_lon,
                    "dest_lat": dest_lat,
                    "dest_lon": dest_lon,
                    "corridor_km": corridor_km,
                    "travel_mode": travel_mode,
                }

                return AssistantResponse(
                    question=question,
                    answer=answer,
                    speech_text=clean_text_for_speech(answer),
                    reports=report_items,
                    source=f"RoadSense Exact Locations ({route_label})",
                    database_grounded=True,
                    total_matches=len(route_hazards),
                    location_context=route_label,
                    intent="hazard_exact_locations",
                    active_context=active_context,
                )
        else:
            answer = (
                "Please plan a route or specify origin and destination cities first (for example: "
                "'How much time does it take from Agiripalli to Vijayawada?'), so I can pinpoint defect locations along your path."
            )
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=[],
                source="RoadSense Navigation Context",
                database_grounded=False,
                total_matches=0,
                intent="missing_route_context",
            )

    # -------------------------------------------------------------
    # 4. INTENT: DESTINATION-SPECIFIC HAZARDS
    # e.g. "Which hazards are closest to my destination?"
    # e.g. "What hazards are near my destination?"
    # Evaluated before route corridor scan so destination queries aren't intercepted.
    # -------------------------------------------------------------
    is_dest_query = bool(
        "destination" in q_lower
        or (dest_from_q and ("near destination" in q_lower or "closest to" in q_lower or "at destination" in q_lower))
    )

    if is_dest_query:
        if (dest_lat is None or dest_lon is None) and dest_from_q:
            d_geo = await geocode_place_name(dest_from_q)
            if d_geo:
                dest_lat, dest_lon = d_geo["latitude"], d_geo["longitude"]

        if dest_lat is not None and dest_lon is not None:
            all_reports = db.query(RoadReport).all()
            nearby = []
            for r in all_reports:
                dist = distance_km(dest_lat, dest_lon, r.latitude, r.longitude)
                if dist <= 15.0:
                    nearby.append((dist, r))
            nearby.sort(key=lambda x: x[0])

            dest_label = dest_from_q or f"({dest_lat:.4f}, {dest_lon:.4f})"

            if not nearby:
                answer = (
                    f"No road hazard reports were found within 15 km of your destination ({dest_label}). "
                    "There are currently no community defect notices on file for your arrival area."
                )
                return AssistantResponse(
                    question=question,
                    answer=answer,
                    speech_text=clean_text_for_speech(answer),
                    reports=[],
                    source="RoadSense Destination Analysis",
                    database_grounded=True,
                    total_matches=0,
                    location_context=dest_label,
                    intent="destination_hazards_empty",
                )
            else:
                closest_dist, closest_r = nearby[0]
                bullets = [
                    f"• **{r.hazard_type}** at **{r.location_name}** (~{d:.2f} km away, [{ 'Verified' if r.status == 'verified' else 'Pending Review' }]): \"{r.description}\""
                    for d, r in nearby[:5]
                ]
                bullets_text = "\n".join(bullets)
                answer = (
                    f"I found **{len(nearby)} hazard report(s)** near your destination ({dest_label}):\n\n"
                    f"{bullets_text}\n\n"
                    f"The closest is a **{closest_r.hazard_type}** approx. **{closest_dist:.2f} km** from your arrival point."
                )
                report_items = [
                    {
                        "id": r.id,
                        "hazard_type": r.hazard_type,
                        "location_name": r.location_name,
                        "status": r.status,
                        "description": r.description,
                        "distance_km": round(d, 2),
                        "image_url": r.image_url,
                    }
                    for d, r in nearby[:6]
                ]
                active_context = {
                    "origin": orig_from_q,
                    "destination": dest_from_q,
                    "origin_lat": origin_lat,
                    "origin_lon": origin_lon,
                    "dest_lat": dest_lat,
                    "dest_lon": dest_lon,
                    "corridor_km": corridor_km,
                    "travel_mode": travel_mode,
                }
                return AssistantResponse(
                    question=question,
                    answer=answer,
                    speech_text=clean_text_for_speech(answer),
                    reports=report_items,
                    source="RoadSense Destination Analysis",
                    database_grounded=True,
                    total_matches=len(nearby),
                    location_context=dest_label,
                    intent="destination_hazards",
                    active_context=active_context,
                )
        else:
            answer = (
                "Please plan a route or specify a destination city so I can find hazards near your arrival point. "
                "For example: 'Which hazards are closest to Agiripalli?'"
            )
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=[],
                source="RoadSense Navigation Context",
                database_grounded=False,
                total_matches=0,
                intent="destination_missing_context",
            )

    # -------------------------------------------------------------
    # 5. INTENT: ROUTE HAZARD CORRIDOR SCAN
    # Triggers when the user specifically inquires about hazards / potholes along a route
    # -------------------------------------------------------------
    is_route_hazard_query = bool(
        is_hazard_query
        and not is_dest_query
        and (
            (orig_from_q and dest_from_q)
            or "route" in q_lower
            or "corridor" in q_lower
            or "along my" in q_lower
            or "on the way" in q_lower
            or "on my way" in q_lower
            or (origin_lat is not None and dest_lat is not None)
        )
    )

    if is_route_hazard_query and (origin_lat is not None and dest_lat is not None):
        route_coords, dist_km, dur_min = await fetch_osrm_route(
            origin_lat, origin_lon, dest_lat, dest_lon
        )
        all_reports = db.query(RoadReport).all()
        route_hazards = find_hazards_along_route(route_coords, all_reports, corridor_km)

        route_label = f"from {orig_from_q} to {dest_from_q}" if (orig_from_q and dest_from_q) else "along your selected route"
        transit_note = " (transit corridor)" if travel_mode == "bus" else ""

        if not route_hazards:
            answer = (
                f"I examined the road corridor {route_label}{transit_note} ({dist_km} km). "
                f"There are currently **0 road defect reports** recorded in the RoadSense database within your {corridor_km} km corridor.\n\n"
                "Please note: absence of reports indicates no community submissions have been logged yet and does not guarantee that the route is completely hazard-free."
            )
        else:
            v_count = sum(1 for h, _, _ in route_hazards if h.status == "verified")
            u_count = len(route_hazards) - v_count
            bullets = []
            for h, r_km, d_km in route_hazards[:6]:
                status_lbl = "Verified Defect" if h.status == "verified" else "Pending Review"
                bullets.append(
                    f"• **At km {r_km:.1f} of journey** ({h.location_name}): {h.hazard_type} — \"{h.description}\" [{status_lbl}]"
                )
            bullets_text = "\n".join(bullets)
            answer = (
                f"I analyzed the route corridor {route_label}{transit_note} ({dist_km} km). "
                f"I identified **{len(route_hazards)} road hazard report(s)** along the route corridor "
                f"({v_count} verified, {u_count} pending review within {corridor_km} km):\n\n"
                f"{bullets_text}\n\n"
                "Please exercise caution and maintain safe following distances when approaching these sections."
            )

        report_items = [
            {
                "id": h.id,
                "hazard_type": h.hazard_type,
                "location_name": h.location_name,
                "status": h.status,
                "description": h.description,
                "created_at": h.created_at.strftime("%Y-%m-%d"),
                "route_km": r_km,
                "distance_from_route_km": d_km,
                "image_url": h.image_url,
            }
            for h, r_km, d_km in route_hazards
        ]

        route_info = {
            "origin": orig_from_q or "Origin",
            "destination": dest_from_q or "Destination",
            "travel_mode": travel_mode,
            "distance_km": dist_km,
            "duration_minutes": dur_min,
            "duration_formatted": format_duration(dur_min),
        }

        active_context = {
            "origin": orig_from_q,
            "destination": dest_from_q,
            "origin_lat": origin_lat,
            "origin_lon": origin_lon,
            "dest_lat": dest_lat,
            "dest_lon": dest_lon,
            "corridor_km": corridor_km,
            "travel_mode": travel_mode,
        }

        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=report_items,
            source=f"RoadSense Route Corridor Scan ({route_label})",
            database_grounded=True,
            total_matches=len(route_hazards),
            location_context=f"Route corridor ({corridor_km} km)",
            intent="route_hazards",
            route_info=route_info,
            active_context=active_context,
        )

    # -------------------------------------------------------------
    # 5. INTENT: TRAVEL TIME & DISTANCE (BY MODE)
    # Handles: car, bus, walking, bicycle, motorcycle
    # SEPARATED: Answers travel time first, WITHOUT attaching hazard lists unless requested
    # -------------------------------------------------------------
    is_travel_mode_query = bool(
        not is_hazard_query
        and (
            re.search(
                r"\b(?:how much time|how long|what is the distance|how far|travel time|driving duration|driving time|time does it take|distance from|distance between)\b",
                q_lower,
            )
            or re.search(
                r"\b(?:by bus|by car|by walking|by walk|by foot|by bicycle|by bike|by cycling|by motorcycle|by scooter|what about by|how about by)\b",
                q_lower,
            )
            or q_clean.lower() in [
                "by bus?",
                "by bus",
                "by car?",
                "by car",
                "by walking?",
                "by walk?",
                "by bike?",
                "by bicycle?",
                "what about walking?",
                "what about by bus?",
                "what about by car?",
                "how about by bus?",
                "how about by car?",
            ]
        )
    )

    if is_travel_mode_query:
        if orig_from_q and dest_from_q:
            if origin_lat is None or dest_lat is None:
                orig_geo = await geocode_place_name(orig_from_q)
                dest_geo = await geocode_place_name(dest_from_q)
                if orig_geo and dest_geo:
                    origin_lat, origin_lon = orig_geo["latitude"], orig_geo["longitude"]
                    dest_lat, dest_lon = dest_geo["latitude"], dest_geo["longitude"]

            if origin_lat is not None and dest_lat is not None:
                # Mode 1: BUS / PUBLIC TRANSIT
                if travel_mode == "bus":
                    answer = (
                        f"Public transit routing for bus travel from **{orig_from_q}** to **{dest_from_q}** is currently unavailable "
                        "because authentic public transit schedule feeds (GTFS) and regional bus stop routing services are not configured for this corridor.\n\n"
                        "RoadSense strictly avoids substituting car driving times for public bus journeys. Bus journeys involve scheduled intermediate stops, "
                        "designated stage pick-ups, and varying wait times, resulting in a substantially different travel duration than private automobiles.\n\n"
                        f"For bus travel between {orig_from_q} and {dest_from_q}, please consult local state transport (such as APSRTC) bus station schedules directly."
                    )
                    route_info = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "travel_mode": "bus",
                        "status": "unavailable",
                        "message": "Public transit routing currently unavailable for this corridor",
                    }
                    active_context = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "origin_lat": origin_lat,
                        "origin_lon": origin_lon,
                        "dest_lat": dest_lat,
                        "dest_lon": dest_lon,
                        "corridor_km": corridor_km,
                        "travel_mode": "bus",
                    }
                    return AssistantResponse(
                        question=question,
                        answer=answer,
                        speech_text=clean_text_for_speech(answer),
                        reports=[],
                        source=f"RoadSense Public Transit Protocol ({orig_from_q} → {dest_from_q})",
                        database_grounded=False,
                        total_matches=0,
                        location_context=f"{orig_from_q} to {dest_from_q} (Bus)",
                        intent="travel_time_distance",
                        route_info=route_info,
                        active_context=active_context,
                    )

                # Fetch OSRM route geometry and baseline distance
                route_coords, dist_km, car_dur_min = await fetch_osrm_route(
                    origin_lat, origin_lon, dest_lat, dest_lon
                )

                # Mode 2: WALKING / PEDESTRIAN
                if travel_mode == "walking":
                    # Average pedestrian pace ~ 4.8 km/h
                    walk_dur_min = round((dist_km / 4.8) * 60.0, 1)
                    walk_dur_text = format_duration(walk_dur_min)
                    answer = (
                        f"Walking from **{orig_from_q}** to **{dest_from_q}** covers approximately **{dist_km} km** "
                        f"and takes about **{walk_dur_text}** on foot at an average walking pace of ~4.8 km/h.\n\n"
                        "Please note: this route includes arterial roads and highways without continuous pedestrian sidewalks. "
                        "Exercise caution and stay visible if walking along highway margins."
                    )
                    route_info = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "travel_mode": "walking",
                        "distance_km": dist_km,
                        "duration_minutes": walk_dur_min,
                        "duration_formatted": walk_dur_text,
                    }
                    active_context = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "origin_lat": origin_lat,
                        "origin_lon": origin_lon,
                        "dest_lat": dest_lat,
                        "dest_lon": dest_lon,
                        "corridor_km": corridor_km,
                        "travel_mode": "walking",
                    }
                    return AssistantResponse(
                        question=question,
                        answer=answer,
                        speech_text=clean_text_for_speech(answer),
                        reports=[],
                        source=f"RoadSense Pedestrian Estimation ({orig_from_q} → {dest_from_q})",
                        database_grounded=True,
                        total_matches=0,
                        location_context=f"{orig_from_q} to {dest_from_q} (Walking)",
                        intent="travel_time_distance",
                        route_info=route_info,
                        active_context=active_context,
                    )

                # Mode 3: BICYCLE / CYCLING
                if travel_mode == "bicycle":
                    # Average cycling speed ~ 15 km/h
                    bike_dur_min = round((dist_km / 15.0) * 60.0, 1)
                    bike_dur_text = format_duration(bike_dur_min)
                    answer = (
                        f"Traveling from **{orig_from_q}** to **{dest_from_q}** by bicycle covers approximately **{dist_km} km** "
                        f"and takes about **{bike_dur_text}** at a moderate cycling speed of ~15 km/h."
                    )
                    route_info = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "travel_mode": "bicycle",
                        "distance_km": dist_km,
                        "duration_minutes": bike_dur_min,
                        "duration_formatted": bike_dur_text,
                    }
                    active_context = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "origin_lat": origin_lat,
                        "origin_lon": origin_lon,
                        "dest_lat": dest_lat,
                        "dest_lon": dest_lon,
                        "corridor_km": corridor_km,
                        "travel_mode": "bicycle",
                    }
                    return AssistantResponse(
                        question=question,
                        answer=answer,
                        speech_text=clean_text_for_speech(answer),
                        reports=[],
                        source=f"RoadSense Bicycle Estimation ({orig_from_q} → {dest_from_q})",
                        database_grounded=True,
                        total_matches=0,
                        location_context=f"{orig_from_q} to {dest_from_q} (Bicycle)",
                        intent="travel_time_distance",
                        route_info=route_info,
                        active_context=active_context,
                    )

                # Mode 4: MOTORCYCLE / TWO-WHEELER
                if travel_mode == "motorcycle":
                    moto_dur_min = round(car_dur_min * 0.95, 1)
                    moto_dur_text = format_duration(moto_dur_min)
                    answer = (
                        f"Traveling from **{orig_from_q}** to **{dest_from_q}** by motorcycle covers approximately **{dist_km} km** "
                        f"and takes about **{moto_dur_text}** at standard two-wheeler road cruising speeds."
                    )
                    route_info = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "travel_mode": "motorcycle",
                        "distance_km": dist_km,
                        "duration_minutes": moto_dur_min,
                        "duration_formatted": moto_dur_text,
                    }
                    active_context = {
                        "origin": orig_from_q,
                        "destination": dest_from_q,
                        "origin_lat": origin_lat,
                        "origin_lon": origin_lon,
                        "dest_lat": dest_lat,
                        "dest_lon": dest_lon,
                        "corridor_km": corridor_km,
                        "travel_mode": "motorcycle",
                    }
                    return AssistantResponse(
                        question=question,
                        answer=answer,
                        speech_text=clean_text_for_speech(answer),
                        reports=[],
                        source=f"OSRM Motorcycle Route ({orig_from_q} → {dest_from_q})",
                        database_grounded=True,
                        total_matches=0,
                        location_context=f"{orig_from_q} to {dest_from_q} (Motorcycle)",
                        intent="travel_time_distance",
                        route_info=route_info,
                        active_context=active_context,
                    )

                # Mode 5: CAR (DEFAULT)
                dur_text = format_duration(car_dur_min)
                answer = (
                    f"Traveling from **{orig_from_q}** to **{dest_from_q}** by car covers approximately **{dist_km} km** "
                    f"and takes about **{dur_text}** under typical driving conditions."
                )
                route_info = {
                    "origin": orig_from_q,
                    "destination": dest_from_q,
                    "travel_mode": "car",
                    "distance_km": dist_km,
                    "duration_minutes": car_dur_min,
                    "duration_formatted": dur_text,
                }
                active_context = {
                    "origin": orig_from_q,
                    "destination": dest_from_q,
                    "origin_lat": origin_lat,
                    "origin_lon": origin_lon,
                    "dest_lat": dest_lat,
                    "dest_lon": dest_lon,
                    "corridor_km": corridor_km,
                    "travel_mode": "car",
                }
                return AssistantResponse(
                    question=question,
                    answer=answer,
                    speech_text=clean_text_for_speech(answer),
                    reports=[],
                    source=f"OSRM Driving Engine ({orig_from_q} → {dest_from_q})",
                    database_grounded=True,
                    total_matches=0,
                    location_context=f"{orig_from_q} to {dest_from_q} (Car)",
                    intent="travel_time_distance",
                    route_info=route_info,
                    active_context=active_context,
                )
            else:
                answer = (
                    f"I could not locate both '{orig_from_q}' and '{dest_from_q}' on the map. "
                    "Please specify the full town, city, or district name (e.g., 'Vijayawada to Agiripalli, Andhra Pradesh')."
                )
                return AssistantResponse(
                    question=question,
                    answer=answer,
                    speech_text=clean_text_for_speech(answer),
                    reports=[],
                    source="RoadSense Geocoding",
                    database_grounded=False,
                    total_matches=0,
                    intent="travel_time_distance_failed",
                )
        else:
            answer = (
                "Please specify both origin and destination to calculate travel time and distance. "
                "For example: 'How long does it take from Agiripalli to Vijayawada by car?'"
            )
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=[],
                source="RoadSense Assistant",
                database_grounded=False,
                total_matches=0,
                intent="travel_time_missing_endpoints",
            )


    # -------------------------------------------------------------
    # 7. INTENT: VERIFIED REPORTS & STATUS EXPLANATION
    # e.g. "Are there verified road reports?"
    # e.g. "What does verified mean?"
    # -------------------------------------------------------------
    is_verif_query = bool(
        re.search(
            r"\b(?:are there verified|show verified|what does verified mean|difference between verified and unverified|verified road reports|verified defects?)\b",
            q_lower,
        )
    )

    if is_verif_query:
        verified_reports = db.query(RoadReport).filter(RoadReport.status == "verified").all()
        total_reports = db.query(RoadReport).count()
        unverified_count = total_reports - len(verified_reports)

        protocol_explanation = (
            "**RoadSense Verification System:**\n"
            "• **Verified Defects**: Confirmed hazards validated through municipal road inspections, authority audits, or multi-user cross-verification.\n"
            "• **Pending / Unverified Reports**: Submissions posted directly by community drivers to warn others immediately; awaiting field confirmation."
        )

        if not verified_reports:
            answer = (
                f"Currently, there are **0 verified road reports** in the database "
                f"(all {total_reports} active report(s) are community-submitted and pending review).\n\n"
                f"{protocol_explanation}"
            )
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=[],
                source="RoadSense Verification Protocol",
                database_grounded=True,
                total_matches=0,
                intent="verification_info",
            )
        else:
            bullets = [
                f"• **{r.hazard_type}** at **{r.location_name}**: \"{r.description}\" [Verified]"
                for r in verified_reports[:5]
            ]
            bullets_text = "\n".join(bullets)
            answer = (
                f"Yes, the RoadSense database currently contains **{len(verified_reports)} verified report(s)** "
                f"({unverified_count} pending review):\n\n"
                f"{bullets_text}\n\n"
                f"{protocol_explanation}"
            )
            report_items = [
                {
                    "id": r.id,
                    "hazard_type": r.hazard_type,
                    "location_name": r.location_name,
                    "status": r.status,
                    "description": r.description,
                    "created_at": r.created_at.strftime("%Y-%m-%d"),
                    "image_url": r.image_url,
                }
                for r in verified_reports
            ]
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=report_items,
                source="RoadSense Verified Records",
                database_grounded=True,
                total_matches=len(verified_reports),
                intent="verification_info",
            )

    # -------------------------------------------------------------
    # 8. INTENT: CURRENT GPS LOCATION OR NAMED LOCALITY HAZARDS
    # e.g. "Are there any reported potholes near my current location?"
    # e.g. "Are there potholes in Vijayawada?"
    # -------------------------------------------------------------
    named_place = extract_potential_location_name(question)
    target_lat = latitude
    target_lon = longitude
    resolved_loc_label = location_name

    if named_place:
        geocoded = await geocode_place_name(named_place)
        if geocoded:
            target_lat = geocoded["latitude"]
            target_lon = geocoded["longitude"]
            resolved_loc_label = geocoded["display_name"]
        else:
            answer = (
                f"I could not locate '{named_place}' on the map. Please specify the complete city and state "
                "(for example: 'Vijayawada, Andhra Pradesh') so I can search community reports for that area."
            )
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=[],
                source="RoadSense Geocoding",
                database_grounded=False,
                total_matches=0,
                location_context=None,
                intent="locality_geocoding_failed",
            )

    is_loc_query = bool(
        "current location" in q_lower
        or "near me" in q_lower
        or "near this location" in q_lower
        or "around here" in q_lower
        or named_place is not None
        or ("pothole" in q_lower and target_lat is not None)
    )

    if is_loc_query:
        if target_lat is None or target_lon is None:
            answer = (
                "To search for road defects near your current position, please click the **'Share My Location'** button "
                "above to grant browser GPS permission, or ask about a specific city (for example: 'Are there potholes in Vijayawada?')."
            )
            return AssistantResponse(
                question=question,
                answer=answer,
                speech_text=clean_text_for_speech(answer),
                reports=[],
                source="RoadSense Geolocation Protocol",
                database_grounded=False,
                total_matches=0,
                intent="current_location_missing_gps",
            )

        radius = 8.0
        all_reports = db.query(RoadReport).all()
        matched = []
        for r in all_reports:
            dist = distance_km(target_lat, target_lon, r.latitude, r.longitude)
            if dist <= radius:
                if "pothole" in q_lower and "pothole" not in r.hazard_type.lower():
                    continue
                if "unverified" in q_lower and r.status == "verified":
                    continue
                matched.append((dist, r))

        matched.sort(key=lambda x: x[0])
        loc_str = resolved_loc_label or f"GPS coordinates ({target_lat:.4f}, {target_lon:.4f})"

        if not matched:
            answer = (
                f"There are currently **0 reported road defects** in the RoadSense database within {radius} km of **{loc_str}**.\n\n"
                "Please note: zero reports reflects current community submission data and does not confirm that roads in this area are completely free of hazards."
            )
        else:
            v_cnt = sum(1 for _, r in matched if r.status == "verified")
            u_cnt = len(matched) - v_cnt
            bullets = [
                f"• **{r.hazard_type}** at **{r.location_name}** ({d:.2f} km away): \"{r.description}\" [{'Verified' if r.status == 'verified' else 'Pending Review'}]"
                for d, r in matched[:5]
            ]
            bullets_text = "\n".join(bullets)
            answer = (
                f"I found **{len(matched)} road report(s)** within {radius} km of **{loc_str}** "
                f"({v_cnt} verified, {u_cnt} pending review):\n\n"
                f"{bullets_text}"
            )

        report_items = [
            {
                "id": r.id,
                "hazard_type": r.hazard_type,
                "location_name": r.location_name,
                "status": r.status,
                "description": r.description,
                "distance_km": round(d, 2),
                "image_url": r.image_url,
            }
            for d, r in matched[:6]
        ]

        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=report_items,
            source=f"RoadSense Proximity Scan ({loc_str})",
            database_grounded=True,
            total_matches=len(matched),
            location_context=loc_str,
            intent="nearby_hazards",
        )

    # -------------------------------------------------------------
    # 9. INTENT: DATABASE SUMMARY / AREA STATISTICS
    # e.g. "Summarize the road reports for this area"
    # -------------------------------------------------------------
    if "summarize" in q_lower or "summary" in q_lower or "breakdown" in q_lower:
        total_db_count = db.query(RoadReport).count()
        verified_db_count = db.query(RoadReport).filter(RoadReport.status == "verified").count()
        unverified_db_count = total_db_count - verified_db_count

        if total_db_count == 0:
            answer = (
                "The RoadSense database currently contains 0 road hazard reports. "
                "No community submissions have been logged yet for summary analysis."
            )
        else:
            hazard_counts = (
                db.query(RoadReport.hazard_type, func.count(RoadReport.id))
                .group_by(RoadReport.hazard_type)
                .all()
            )
            cat_summary = ", ".join([f"{h}: {c}" for h, c in hazard_counts])
            answer = (
                f"**RoadSense Database Summary:**\n"
                f"• Total Stored Reports: **{total_db_count}**\n"
                f"• Verified Defects: **{verified_db_count}**\n"
                f"• Pending Review: **{unverified_db_count}**\n"
                f"• Distribution by Category: {cat_summary}."
            )

        return AssistantResponse(
            question=question,
            answer=answer,
            speech_text=clean_text_for_speech(answer),
            reports=[],
            source="RoadSense Database Summary",
            database_grounded=True,
            total_matches=total_db_count,
            intent="database_summary",
        )

    # -------------------------------------------------------------
    # 10. DEFAULT INTELLIGENT GUIDANCE
    # Never repeat a robotic report count; explain how to query effectively
    # -------------------------------------------------------------
    answer = (
        "I am ready to assist with your journey. You can ask me:\n\n"
        "• **Travel Time & Modes**: *'How long does it take from Agiripalli to Vijayawada by car?'*, *'How long by bus?'*, or *'What about by walking?'*\n"
        "• **Route Hazards**: *'Are there potholes along this route?'*\n"
        "• **Defect Locations**: *'Where exactly are the damaged roads along my route?'*\n"
        "• **Arrival Safety**: *'What hazards are near my destination?'*\n"
        "• **Road Safety & Mechanics**: *'What is a pothole?'* or *'What does hazard scan corridor width mean?'*\n"
        "• **GPS Location**: Click *'Share My Location'* to check hazards around your current position."
    )

    return AssistantResponse(
        question=question,
        answer=answer,
        speech_text=clean_text_for_speech(answer),
        reports=[],
        source="RoadSense AI Assistant",
        database_grounded=False,
        total_matches=0,
        intent="general_help",
    )
