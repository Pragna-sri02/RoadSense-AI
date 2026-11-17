from datetime import datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, ConfigDict, Field


class RoadReportCreate(BaseModel):
    hazard_type: str = Field(min_length=2, max_length=50)
    description: str = Field(min_length=5, max_length=2000)
    location_name: str = Field(min_length=2, max_length=200)
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    locality: Optional[str] = Field(default=None, max_length=100)
    city: Optional[str] = Field(default=None, max_length=100)
    district: Optional[str] = Field(default=None, max_length=100)
    state: Optional[str] = Field(default=None, max_length=100)
    country: Optional[str] = Field(default=None, max_length=100)
    image_url: Optional[str] = Field(default=None, max_length=500)
    source: Optional[str] = Field(default="community", max_length=50)
    detection_method: Optional[str] = Field(default="manual", max_length=50)


class RoadReportStatusUpdate(BaseModel):
    status: str = Field(pattern="^(verified|unverified|resolved)$")


class RoadReportResponse(BaseModel):
    id: int
    hazard_type: str
    description: str
    location_name: str
    latitude: float
    longitude: float
    status: str
    is_sample: bool
    created_at: datetime
    locality: Optional[str] = None
    city: Optional[str] = None
    district: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    image_url: Optional[str] = None
    source: Optional[str] = "community"
    detection_method: Optional[str] = "manual"
    updated_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class ReportSummaryResponse(BaseModel):
    total_reports: int
    verified_reports: int
    unverified_reports: int
    hazards_by_type: Dict[str, int]
    area_counts: Dict[str, int]
    recent_count: int


class RoadHealthResponse(BaseModel):
    score: Optional[int]
    label: str
    message: str
    verified_ratio: Optional[float] = None
    total_analyzed: int = 0


class HazardCategory(BaseModel):
    id: str
    label: str
    description: str
    severity: str
    color: str
    icon: str


class GeocodeResult(BaseModel):
    display_name: str
    name: Optional[str] = None
    locality: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None
    latitude: float
    longitude: float
    place_id: Optional[str] = None
    type: Optional[str] = None


class ReverseGeocodeResult(BaseModel):
    display_name: str
    latitude: float
    longitude: float
    road: Optional[str] = None
    suburb: Optional[str] = None
    district: Optional[str] = None
    city: Optional[str] = None
    state: Optional[str] = None
    country: Optional[str] = None


class HazardSummary(BaseModel):
    total_hazards: int
    verified_hazards: int
    unverified_hazards: int = 0
    corridor_km: float = 0.5
    highest_severity: str
    advisory: str


class RouteHazardItem(RoadReportResponse):
    route_km: float = Field(default=0.0, description="Approximate distance along the journey from origin (in km)")
    distance_from_route_km: float = Field(default=0.0, description="Perpendicular distance from the route polyline (in km)")


class RouteResponse(BaseModel):
    distance_km: float
    duration_minutes: float
    geometry: Dict[str, Any]
    source: str
    corridor_km: float
    hazards_along_route: List[RouteHazardItem]
    hazard_summary: HazardSummary


class PotholeDetectionBox(BaseModel):
    box: List[int] = Field(description="Bounding box [x, y, width, height]")
    confidence: float
    label: str
    severity: str


class ExtractedGPS(BaseModel):
    latitude: float
    longitude: float


class PotholeAnalysisResponse(BaseModel):
    has_damage: bool
    hazard_type: str
    confidence: float
    severity: str
    detections: List[PotholeDetectionBox]
    extracted_gps: Optional[ExtractedGPS] = None
    suggested_location: Optional[str] = None
    suggested_description: str
    annotated_image: Optional[str] = None
    image_url: Optional[str] = None
    analysis_method: str = "Computer Vision Surface Analyzer"


class AssistantQuery(BaseModel):
    question: str
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    location_name: Optional[str] = None
    origin_lat: Optional[float] = None
    origin_lon: Optional[float] = None
    dest_lat: Optional[float] = None
    dest_lon: Optional[float] = None
    corridor_km: Optional[float] = None
    history: Optional[List[Dict[str, Any]]] = None
    active_origin: Optional[str] = None
    active_destination: Optional[str] = None
    travel_mode: Optional[str] = None


class AssistantResponse(BaseModel):
    question: str
    answer: str
    speech_text: str
    reports: List[Dict[str, Any]] = []
    source: str
    database_grounded: bool
    total_matches: int
    location_context: Optional[str] = None
    intent: Optional[str] = None
    route_info: Optional[Dict[str, Any]] = None
    active_context: Optional[Dict[str, Any]] = None


# Authentication Schemas
class UserRegister(BaseModel):
    full_name: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=6, max_length=100)
    confirm_password: Optional[str] = None


class UserLogin(BaseModel):
    email: str = Field(min_length=5, max_length=150)
    password: str = Field(min_length=1, max_length=100)
    remember_me: bool = False


class UserResponse(BaseModel):
    id: int
    full_name: str
    email: str
    is_active: bool
    created_at: datetime
    last_login: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_at: datetime
    user: UserResponse
