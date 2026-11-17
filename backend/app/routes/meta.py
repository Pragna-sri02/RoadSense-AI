from typing import List
from fastapi import APIRouter
from ..schemas import HazardCategory

router = APIRouter(prefix="/api/meta", tags=["Metadata & System"])

STANDARD_CATEGORIES = [
    {
        "id": "pothole",
        "label": "Pothole",
        "description": "Deep depression, hole, or road crater hazardous to vehicles and two-wheelers.",
        "severity": "high",
        "color": "#ef4444",
        "icon": "AlertTriangle",
    },
    {
        "id": "cracked_road",
        "label": "Cracked Road",
        "description": "Severe longitudinal, alligator, or block cracking indicating structural distress.",
        "severity": "medium",
        "color": "#f59e0b",
        "icon": "Activity",
    },
    {
        "id": "damaged_surface",
        "label": "Damaged Surface",
        "description": "Uneven pavement, rutting, raveling, or loose gravel on the driving corridor.",
        "severity": "medium",
        "color": "#d97706",
        "icon": "AlertCircle",
    },
    {
        "id": "waterlogging",
        "label": "Waterlogging",
        "description": "Standing water or flooding obscuring road surface hazards and reducing traction.",
        "severity": "high",
        "color": "#3b82f6",
        "icon": "Droplets",
    },
    {
        "id": "road_obstruction",
        "label": "Road Obstruction",
        "description": "Debris, fallen branches, illegal barrier, or stalled objects blocking transit lanes.",
        "severity": "high",
        "color": "#8b5cf6",
        "icon": "ShieldAlert",
    },
    {
        "id": "other_hazard",
        "label": "Other Hazard",
        "description": "Missing manhole cover, faded lane markings, or unclassified road safety concern.",
        "severity": "low",
        "color": "#64748b",
        "icon": "HelpCircle",
    },
]


@router.get("/categories", response_model=List[HazardCategory])
def get_categories():
    """Return standard road hazard categories recognized across the RoadSense platform."""
    return STANDARD_CATEGORIES
