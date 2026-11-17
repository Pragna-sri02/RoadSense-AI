import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool
import sys
from pathlib import Path

# Ensure backend directory is in sys.path
backend_dir = Path(__file__).resolve().parent.parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from datetime import datetime, timezone, timedelta
from app.main import app
from app.database import Base, get_db
from app.models import RoadReport, User, UserSession
from app.services.auth import hash_password

# Isolated in-memory SQLite database for tests so production roadsense.db is never touched
TEST_DATABASE_URL = "sqlite:///:memory:"
test_engine = create_engine(
    TEST_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=test_engine)


def override_get_db():
    db = TestingSessionLocal()
    try:
        yield db
    finally:
        db.close()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


@pytest.fixture(autouse=True)
def setup_and_teardown_db():
    Base.metadata.create_all(bind=test_engine)
    db = TestingSessionLocal()
    try:
        user = User(
            full_name="Test Operator",
            email="test.operator@roadsense.ai",
            password_hash=hash_password("Secr3tPass!"),
            is_active=True,
            created_at=datetime.now(timezone.utc),
        )
        db.add(user)
        db.commit()
        db.refresh(user)

        session = UserSession(
            user_id=user.id,
            token="test-active-session-token-12345",
            is_active=True,
            expires_at=datetime.now(timezone.utc) + timedelta(days=7),
            created_at=datetime.now(timezone.utc),
        )
        db.add(session)
        db.commit()

        client.headers["Authorization"] = f"Bearer {session.token}"
    finally:
        db.close()
    yield
    client.headers.pop("Authorization", None)
    Base.metadata.drop_all(bind=test_engine)


def test_health_check():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"


def test_meta_categories():
    response = client.get("/api/meta/categories")
    assert response.status_code == 200
    categories = response.json()
    assert len(categories) == 6
    ids = [c["id"] for c in categories]
    assert "pothole" in ids
    assert "waterlogging" in ids
    assert "cracked_road" in ids


def test_geocode_and_reverse():
    # Test location search for Vijayawada
    res = client.get("/api/geocode", params={"q": "Vijayawada, Andhra Pradesh"})
    assert res.status_code == 200
    results = res.json()
    if results:
        top = results[0]
        # Must be in Andhra Pradesh, around lat 16.5, lon 80.6
        assert 15.5 <= top["latitude"] <= 17.5
        assert 79.5 <= top["longitude"] <= 81.5
        # Must not be in New Delhi
        assert "delhi" not in top["display_name"].lower()

    # Test reverse geocoding
    rev_res = client.get("/api/geocode/reverse", params={"lat": 16.5115, "lon": 80.6160})
    assert rev_res.status_code == 200
    rev_data = rev_res.json()
    assert "display_name" in rev_data
    assert rev_data["latitude"] == 16.5115


def test_report_lifecycle_and_validation():
    # Valid report creation
    payload = {
        "hazard_type": "Pothole",
        "description": "Deep dangerous pothole on MG Road near bus bay",
        "location_name": "MG Road, Vijayawada",
        "latitude": 16.5062,
        "longitude": 80.6480,
    }
    create_res = client.post("/api/reports", json=payload)
    assert create_res.status_code == 201
    rep = create_res.json()
    assert rep["id"] > 0
    assert rep["status"] == "unverified"
    assert rep["is_sample"] is False

    # Retrieve by ID
    get_res = client.get(f"/api/reports/{rep['id']}")
    assert get_res.status_code == 200
    assert get_res.json()["location_name"] == "MG Road, Vijayawada"

    # Status update to verified
    patch_res = client.patch(f"/api/reports/{rep['id']}/status", json={"status": "verified"})
    assert patch_res.status_code == 200
    assert patch_res.json()["status"] == "verified"

    # Invalid coordinates validation
    invalid_payload = {
        "hazard_type": "Pothole",
        "description": "Invalid coordinates report",
        "location_name": "Invalid St",
        "latitude": 150.0,
        "longitude": 80.0,
    }
    bad_res = client.post("/api/reports", json=invalid_payload)
    assert bad_res.status_code == 422


def test_routing_with_configurable_corridor():
    # Insert a test hazard near the route
    db = TestingSessionLocal()
    rep = RoadReport(
        hazard_type="Pothole",
        description="Pothole on highway",
        location_name="Nuzvid Road",
        latitude=16.6000,
        longitude=80.7000,
        status="verified",
        is_sample=False,
    )
    db.add(rep)
    db.commit()

    # Route from Vijayawada to Agiripalli
    response = client.get(
        "/api/routing/route",
        params={
            "start_lat": 16.5115,
            "start_lon": 80.6160,
            "end_lat": 16.6850,
            "end_lon": 80.7878,
            "corridor_km": 1.0,
        },
    )
    assert response.status_code == 200
    data = response.json()
    assert data["distance_km"] > 10.0
    assert data["duration_minutes"] > 10.0
    assert data["corridor_km"] == 1.0
    assert "geometry" in data
    assert "hazard_summary" in data


def test_assistant_grounded_queries():
    # Empty DB behavior
    res_empty = client.get("/api/assistant/ask", params={"question": "Are there potholes in Vijayawada?"})
    assert res_empty.status_code == 200
    empty_ans = res_empty.json()["answer"]
    # Must not claim the road is safe or invent hazards
    assert "insufficient" in empty_ans.lower() or "0" in empty_ans

    # Add a report in Vijayawada
    db = TestingSessionLocal()
    rep = RoadReport(
        hazard_type="Pothole",
        description="Large crater on Bandar Road",
        location_name="Bandar Road, Vijayawada",
        latitude=16.5000,
        longitude=80.6400,
        status="verified",
        is_sample=False,
    )
    db.add(rep)
    db.commit()

    # Ask with location coordinates of Vijayawada
    res_loc = client.get(
        "/api/assistant/ask",
        params={
            "question": "Are there any reported potholes near my current location?",
            "latitude": 16.5010,
            "longitude": 80.6410,
        },
    )
    assert res_loc.status_code == 200
    data = res_loc.json()
    assert data["total_matches"] >= 1
    assert data["database_grounded"] is True
    assert "Bandar Road" in data["reports"][0]["location_name"]


def test_analytics_calculated_from_db():
    res = client.get("/api/analytics/overview")
    assert res.status_code == 200
    data = res.json()
    assert "road_health" in data
    assert "total_reports" in data


def test_nuzvid_destination_search_and_osrm_route():
    # 1. Geocoding search for Nuzvid, Andhra Pradesh, India
    res = client.get("/api/geocode", params={"q": "Nuzvid, Andhra Pradesh, India"})
    assert res.status_code == 200
    results = res.json()
    assert len(results) >= 1
    top = results[0]
    assert "nuzvid" in top["display_name"].lower() or "nuzvid" in top["name"].lower()
    assert 16.5 <= top["latitude"] <= 17.0
    assert 80.7 <= top["longitude"] <= 81.0

    nuzvid_lat = top["latitude"]
    nuzvid_lon = top["longitude"]
    vja_lat = 16.5062
    vja_lon = 80.6480

    # 2. Insert one report right along the route (~16.65, 80.75) and one report far away (17.5, 81.5)
    db = TestingSessionLocal()
    on_route_rep = RoadReport(
        hazard_type="Pothole",
        description="Hazard along Nuzvid road",
        location_name="Nuzvid Highway",
        latitude=16.6500,
        longitude=80.7500,
        status="verified",
        is_sample=False,
    )
    far_rep = RoadReport(
        hazard_type="Waterlogging",
        description="Far away hazard in distant district",
        location_name="Rajahmundry Outskirts",
        latitude=17.0000,
        longitude=81.8000,
        status="verified",
        is_sample=False,
    )
    db.add_all([on_route_rep, far_rep])
    db.commit()

    # 3. Calculate genuine driving route from Vijayawada to Nuzvid
    route_res = client.get(
        "/api/routing/route",
        params={
            "start_lat": vja_lat,
            "start_lon": vja_lon,
            "end_lat": nuzvid_lat,
            "end_lon": nuzvid_lon,
            "corridor_km": 2.0,
        },
    )
    assert route_res.status_code == 200
    route_data = route_res.json()

    # Verify distance and duration from real OSRM driving service (~43 km, ~42 min)
    assert 38.0 <= route_data["distance_km"] <= 55.0
    assert 30.0 <= route_data["duration_minutes"] <= 75.0
    assert route_data["corridor_km"] == 2.0
    assert len(route_data["geometry"]["coordinates"]) > 50

    # Ensure distant report is NOT in hazards_along_route
    hazard_ids = [h["id"] for h in route_data["hazards_along_route"]]
    assert far_rep.id not in hazard_ids

    # 4. Query Assistant about this route
    asst_res = client.get(
        "/api/assistant/ask",
        params={
            "question": "Are there any hazards on the road from Vijayawada to Nuzvid?",
            "route_origin": "Vijayawada",
            "route_destination": "Nuzvid",
            "latitude": vja_lat,
            "longitude": vja_lon,
        },
    )
    assert asst_res.status_code == 200
    asst_data = asst_res.json()
    assert asst_data["database_grounded"] is True


def test_cv_pothole_detection_api():
    import io
    import cv2
    import numpy as np
    from PIL import Image

    # 1. Test image with a simulated pothole
    img = np.full((350, 500, 3), 110, dtype=np.uint8)
    noise = np.random.randint(-12, 12, (350, 500, 3), dtype=np.int16)
    img = np.clip(img.astype(np.int16) + noise, 0, 255).astype(np.uint8)
    cv2.ellipse(img, (250, 220), (60, 35), 10, 0, 360, (28, 25, 22), -1)

    buf = io.BytesIO()
    Image.fromarray(cv2.cvtColor(img, cv2.COLOR_BGR2RGB)).save(buf, format="JPEG")
    buf.seek(0)

    files = {"file": ("road_pothole.jpg", buf, "image/jpeg")}
    response = client.post("/api/reports/analyze-image", files=files)
    assert response.status_code == 200
    data = response.json()
    assert data["has_damage"] is True
    assert data["hazard_type"] == "Pothole"
    assert data["confidence"] >= 0.65
    assert len(data["detections"]) >= 1
    assert data["annotated_image"].startswith("data:image/jpeg;base64,")

    # 2. Test clean road image
    clean_img = np.full((350, 500, 3), 120, dtype=np.uint8)
    clean_buf = io.BytesIO()
    Image.fromarray(cv2.cvtColor(clean_img, cv2.COLOR_BGR2RGB)).save(clean_buf, format="JPEG")
    clean_buf.seek(0)

    clean_files = {"file": ("clean_road.jpg", clean_buf, "image/jpeg")}
    clean_res = client.post("/api/reports/analyze-image", files=clean_files)
    assert clean_res.status_code == 200
    clean_data = clean_res.json()
    assert clean_data["has_damage"] is False
    assert clean_data["hazard_type"] == "Normal Road Surface"


def test_vijayawada_to_agiripalli_route_with_km_markers():
    vja_lat = 16.5062
    vja_lon = 80.6480
    agiripalli_lat = 16.6850
    agiripalli_lon = 80.7878

    # Add a verified defect right on the highway
    db = TestingSessionLocal()
    defect = RoadReport(
        hazard_type="Pothole",
        description="Hazard along Nunna-Agiripalli highway",
        location_name="Nunna Road, Vijayawada Outskirts",
        latitude=16.6140,
        longitude=80.7196,
        status="verified",
        is_sample=False,
    )
    db.add(defect)
    db.commit()

    # Route calculation
    res = client.get(
        "/api/routing/route",
        params={
            "start_lat": vja_lat,
            "start_lon": vja_lon,
            "end_lat": agiripalli_lat,
            "end_lon": agiripalli_lon,
            "corridor_km": 1.0,
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert 25.0 <= data["distance_km"] <= 38.0
    assert 20.0 <= data["duration_minutes"] <= 55.0
    assert len(data["hazards_along_route"]) >= 1

    first_hazard = data["hazards_along_route"][0]
    assert "route_km" in first_hazard
    assert first_hazard["route_km"] > 0.0
    assert first_hazard["status"] == "verified"

    # Test AI Assistant with exact user scenario question
    asst_res = client.get(
        "/api/assistant/ask",
        params={
            "question": "I am travelling from Vijayawada to Agiripalli. Where are the damaged roads?",
        },
    )
    assert asst_res.status_code == 200
    asst_data = asst_res.json()
    assert asst_data["database_grounded"] is True
    ans = asst_data["answer"].lower()
    assert "vijayawada" in ans
    assert "agiripalli" in ans
    assert "nunna" in ans or "pothole" in ans
    assert "verified" in ans


def test_duplicate_report_rejection_within_30m():
    # 1. Create initial report
    payload1 = {
        "hazard_type": "Pothole",
        "description": "Hazard in residential colony",
        "location_name": "Main Road Lane 1",
        "latitude": 16.500000,
        "longitude": 80.600000,
        "locality": "Patamata",
        "city": "Vijayawada",
        "district": "Krishna",
        "state": "Andhra Pradesh",
        "country": "India",
        "source": "community",
        "detection_method": "manual",
    }
    r1 = client.post("/api/reports", json=payload1)
    assert r1.status_code == 201
    data1 = r1.json()
    assert data1["locality"] == "Patamata"
    assert data1["city"] == "Vijayawada"
    assert data1["source"] == "community"

    # 2. Attempt duplicate creation ~12 meters away with same hazard type
    payload2 = {
        "hazard_type": "Pothole",
        "description": "Duplicate hazard report nearby",
        "location_name": "Main Road Lane 1",
        "latitude": 16.500080,
        "longitude": 80.600050,
    }
    r2 = client.post("/api/reports", json=payload2)
    assert r2.status_code == 409
    assert "already reported" in r2.json()["detail"].lower()

    # 3. Create different hazard type at same location (allowed)
    payload3 = {
        "hazard_type": "Waterlogging",
        "description": "Flooding along curb",
        "location_name": "Main Road Lane 1",
        "latitude": 16.500080,
        "longitude": 80.600050,
    }
    r3 = client.post("/api/reports", json=payload3)
    assert r3.status_code == 201


def test_global_geocoding_international():
    # 1. Test search for Oxford, United Kingdom
    res = client.get("/api/geocode", params={"q": "Oxford, United Kingdom"})
    assert res.status_code == 200
    results = res.json()
    assert len(results) >= 1
    top = results[0]
    assert 51.5 <= top["latitude"] <= 52.0
    assert -1.5 <= top["longitude"] <= -1.0
    assert "oxford" in top["display_name"].lower()

    # 2. Test search for Times Square
    ts_res = client.get("/api/geocode", params={"q": "Times Square, New York"})
    assert ts_res.status_code == 200
    ts_results = ts_res.json()
    assert len(ts_results) >= 1
    ts_top = ts_results[0]
    assert 40.5 <= ts_top["latitude"] <= 41.0
    assert -74.5 <= ts_top["longitude"] <= -73.5


def test_assistant_travel_time_and_general_knowledge():
    # 1. Travel time question: "How much time does it take to go to Agiripalli from Vijayawada?"
    res1 = client.post("/api/assistant/ask", json={
        "question": "How much time does it take to go to Agiripalli from Vijayawada?"
    })
    assert res1.status_code == 200
    d1 = res1.json()
    assert d1["intent"] == "travel_time_distance"
    assert d1["route_info"] is not None
    assert 25.0 <= d1["route_info"]["distance_km"] <= 45.0
    assert 20.0 <= d1["route_info"]["duration_minutes"] <= 60.0
    assert "vijayawada" in d1["answer"].lower()
    assert "agiripalli" in d1["answer"].lower()

    # 2. Distance question: "What is the distance from Vijayawada to Nuzvid?"
    res2 = client.post("/api/assistant/ask", json={
        "question": "What is the distance from Vijayawada to Nuzvid?"
    })
    assert res2.status_code == 200
    d2 = res2.json()
    assert d2["intent"] == "travel_time_distance"
    assert d2["route_info"] is not None
    assert 38.0 <= d2["route_info"]["distance_km"] <= 60.0

    # 3. Knowledge: "What is a pothole?"
    res3 = client.post("/api/assistant/ask", json={"question": "What is a pothole?"})
    assert res3.status_code == 200
    d3 = res3.json()
    assert d3["intent"] == "knowledge_pothole_definition"
    assert "depression" in d3["answer"].lower() or "bowl-shaped" in d3["answer"].lower()
    # Must NOT return database count boilerplate
    assert "database currently tracks" not in d3["answer"].lower()

    # 4. Knowledge: "Why do potholes form?"
    res4 = client.post("/api/assistant/ask", json={"question": "Why do potholes form?"})
    assert res4.status_code == 200
    d4 = res4.json()
    assert d4["intent"] == "knowledge_pothole_cause"
    assert "water" in d4["answer"].lower()

    # 5. Knowledge: "What does hazard scan corridor width mean?"
    res5 = client.post("/api/assistant/ask", json={"question": "What does hazard scan corridor width mean?"})
    assert res5.status_code == 200
    d5 = res5.json()
    assert d5["intent"] == "knowledge_corridor_width"
    assert "lateral buffer" in d5["answer"].lower() or "corridor" in d5["answer"].lower()

    # 6. Submission: "How can I submit a road report?"
    res6 = client.post("/api/assistant/ask", json={"question": "How can I submit a road report?"})
    assert res6.status_code == 200
    d6 = res6.json()
    assert d6["intent"] == "help_submit_report"
    assert "road reports" in d6["answer"].lower()


def test_assistant_multi_turn_conversation_flow():
    # Insert a sample report directly on the Vijayawada-Agiripalli highway
    db = TestingSessionLocal()
    rep = RoadReport(
        hazard_type="Pothole",
        description="Hazardous pothole in Nunna highway section",
        location_name="Nunna Road, Vijayawada Outskirts",
        latitude=16.6140,
        longitude=80.7196,
        status="verified",
    )
    db.add(rep)
    db.commit()
    db.close()

    # Turn 1: Travel time
    q1 = "How long does it take to travel from Vijayawada to Agiripalli?"
    r1 = client.post("/api/assistant/ask", json={"question": q1, "corridor_km": 1.0})
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["intent"] == "travel_time_distance"
    active_ctx = d1.get("active_context")
    assert active_ctx is not None
    assert active_ctx["origin"] == "Vijayawada"
    assert active_ctx["destination"] == "Agiripalli"

    # Turn 2: Follow-up "Are there potholes?"
    history = [{"sender": "user", "text": q1}, {"sender": "assistant", "text": d1["answer"]}]
    q2 = "Are there potholes?"
    r2 = client.post("/api/assistant/ask", json={
        "question": q2,
        "history": history,
        "active_origin": active_ctx["origin"],
        "active_destination": active_ctx["destination"],
        "origin_lat": active_ctx["origin_lat"],
        "origin_lon": active_ctx["origin_lon"],
        "dest_lat": active_ctx["dest_lat"],
        "dest_lon": active_ctx["dest_lon"],
        "corridor_km": 1.0,
    })
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["intent"] == "route_hazards"
    assert d2["total_matches"] >= 1
    assert "nunna" in d2["answer"].lower() or "pothole" in d2["answer"].lower()

    # Turn 3: Follow-up "Where exactly?"
    history.extend([{"sender": "user", "text": q2}, {"sender": "assistant", "text": d2["answer"]}])
    q3 = "Where exactly?"
    r3 = client.post("/api/assistant/ask", json={
        "question": q3,
        "history": history,
        "active_origin": active_ctx["origin"],
        "active_destination": active_ctx["destination"],
        "origin_lat": active_ctx["origin_lat"],
        "origin_lon": active_ctx["origin_lon"],
        "dest_lat": active_ctx["dest_lat"],
        "dest_lon": active_ctx["dest_lon"],
        "corridor_km": 1.0,
    })
    assert r3.status_code == 200
    d3 = r3.json()
    assert d3["intent"] == "hazard_exact_locations"
    assert len(d3["reports"]) >= 1
    assert "route_km" in d3["reports"][0]
    assert "nunna" in d3["answer"].lower()


def test_assistant_travel_modes_and_context_switching():
    # 1. Car travel query
    q1 = "How long does it take from Agiripalli to Vijayawada by car?"
    r1 = client.post("/api/assistant/ask", json={"question": q1})
    assert r1.status_code == 200
    d1 = r1.json()
    assert d1["intent"] == "travel_time_distance"
    assert d1["route_info"]["travel_mode"] == "car"
    assert len(d1["reports"]) == 0
    ctx = d1["active_context"]
    assert ctx["origin"] == "Agiripalli"
    assert ctx["destination"] == "Vijayawada"
    history = [{"sender": "user", "text": q1}, {"sender": "assistant", "text": d1["answer"]}]

    # 2. Bus travel query (preserves Agiripalli -> Vijayawada)
    q2 = "How long does it take by bus?"
    r2 = client.post("/api/assistant/ask", json={
        "question": q2,
        "history": history,
        "active_origin": ctx["origin"],
        "active_destination": ctx["destination"],
        "origin_lat": ctx["origin_lat"],
        "origin_lon": ctx["origin_lon"],
        "dest_lat": ctx["dest_lat"],
        "dest_lon": ctx["dest_lon"],
        "corridor_km": ctx["corridor_km"],
        "travel_mode": ctx["travel_mode"],
    })
    assert r2.status_code == 200
    d2 = r2.json()
    assert d2["intent"] == "travel_time_distance"
    assert d2["route_info"]["travel_mode"] == "bus"
    assert "unavailable" in d2["answer"].lower()
    assert len(d2["reports"]) == 0
    ctx = d2["active_context"]
    history.extend([{"sender": "user", "text": q2}, {"sender": "assistant", "text": d2["answer"]}])

    # 3. Walking query (preserves Agiripalli -> Vijayawada)
    q3 = "What about by walking?"
    r3 = client.post("/api/assistant/ask", json={
        "question": q3,
        "history": history,
        "active_origin": ctx["origin"],
        "active_destination": ctx["destination"],
        "origin_lat": ctx["origin_lat"],
        "origin_lon": ctx["origin_lon"],
        "dest_lat": ctx["dest_lat"],
        "dest_lon": ctx["dest_lon"],
        "corridor_km": ctx["corridor_km"],
        "travel_mode": ctx["travel_mode"],
    })
    assert r3.status_code == 200
    d3 = r3.json()
    assert d3["intent"] == "travel_time_distance"
    assert d3["route_info"]["travel_mode"] == "walking"
    assert "walking" in d3["answer"].lower() or "foot" in d3["answer"].lower()
    assert len(d3["reports"]) == 0
    history.extend([{"sender": "user", "text": q3}, {"sender": "assistant", "text": d3["answer"]}])

    # 4. Mode switch back to car
    q4 = "How long by car if I previously asked about the bus?"
    r4 = client.post("/api/assistant/ask", json={
        "question": q4,
        "history": history,
        "active_origin": ctx["origin"],
        "active_destination": ctx["destination"],
        "origin_lat": ctx["origin_lat"],
        "origin_lon": ctx["origin_lon"],
        "dest_lat": ctx["dest_lat"],
        "dest_lon": ctx["dest_lon"],
        "corridor_km": ctx["corridor_km"],
        "travel_mode": ctx["travel_mode"],
    })
    assert r4.status_code == 200
    d4 = r4.json()
    assert d4["intent"] == "travel_time_distance"
    assert d4["route_info"]["travel_mode"] == "car"
    assert "car" in d4["answer"].lower()
    assert len(d4["reports"]) == 0


def test_unauthorized_endpoints_reject_without_token():
    """Verify that protected application endpoints reject unauthenticated requests with HTTP 401."""
    # Test without Authorization header
    res_overview = client.get("/api/analytics/overview", headers={"Authorization": ""})
    assert res_overview.status_code == 401
    assert "authentication required" in res_overview.json()["detail"].lower()

    res_reports = client.get("/api/reports", headers={"Authorization": ""})
    assert res_reports.status_code == 401

    res_me = client.get("/api/auth/me", headers={"Authorization": ""})
    assert res_me.status_code == 401


def test_auth_registration_lifecycle():
    """Verify user registration, validation rules, and duplicate email prevention."""
    # 1. Successful registration
    payload = {
        "full_name": "Kiran Kumar",
        "email": "kiran.kumar@roadsense.ai",
        "password": "RoadSafe!Password2026",
        "confirm_password": "RoadSafe!Password2026",
    }
    reg_res = client.post("/api/auth/register", json=payload)
    assert reg_res.status_code == 201
    data = reg_res.json()
    assert "access_token" in data
    assert data["user"]["full_name"] == "Kiran Kumar"
    assert data["user"]["email"] == "kiran.kumar@roadsense.ai"

    # 2. Duplicate email rejection
    dup_res = client.post("/api/auth/register", json=payload)
    assert dup_res.status_code == 400
    assert "already exists" in dup_res.json()["detail"].lower()

    # 3. Password mismatch rejection
    mismatch_payload = {
        "full_name": "Ravi Teja",
        "email": "ravi.teja@roadsense.ai",
        "password": "Password123",
        "confirm_password": "DifferentPassword456",
    }
    mismatch_res = client.post("/api/auth/register", json=mismatch_payload)
    assert mismatch_res.status_code == 400
    assert "do not match" in mismatch_res.json()["detail"].lower()

    # 4. Short password rejection
    short_pwd_payload = {
        "full_name": "Ravi Teja",
        "email": "ravi.teja2@roadsense.ai",
        "password": "123",
        "confirm_password": "123",
    }
    short_res = client.post("/api/auth/register", json=short_pwd_payload)
    assert short_res.status_code in [400, 422]


def test_auth_login_and_logout():
    """Verify user login verification, invalid password rejection, profile access, and session revocation."""
    # Register test user
    email = "priya.sharma@roadsense.ai"
    password = "PriyaSecretPassword@99"
    reg = client.post("/api/auth/register", json={
        "full_name": "Priya Sharma",
        "email": email,
        "password": password,
        "confirm_password": password,
    })
    assert reg.status_code == 201

    # 1. Login with incorrect password
    bad_login = client.post("/api/auth/login", json={
        "email": email,
        "password": "WrongPasswordAttempt!",
        "remember_me": False,
    })
    assert bad_login.status_code == 401
    assert "invalid email or password" in bad_login.json()["detail"].lower()

    # 2. Login with non-existent email
    bad_email = client.post("/api/auth/login", json={
        "email": "nonexistent.user@roadsense.ai",
        "password": password,
        "remember_me": False,
    })
    assert bad_email.status_code == 401

    # 3. Successful login
    login_res = client.post("/api/auth/login", json={
        "email": email,
        "password": password,
        "remember_me": True,
    })
    assert login_res.status_code == 200
    login_data = login_res.json()
    token = login_data["access_token"]
    assert token
    assert login_data["user"]["email"] == email

    # 4. Verify profile endpoint with acquired token
    me_res = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert me_res.status_code == 200
    assert me_res.json()["email"] == email
    assert me_res.json()["full_name"] == "Priya Sharma"

    # 5. Access protected report endpoint with acquired token
    rep_res = client.get("/api/reports", headers={"Authorization": f"Bearer {token}"})
    assert rep_res.status_code == 200

    # 6. Logout and session invalidation
    logout_res = client.post("/api/auth/logout", headers={"Authorization": f"Bearer {token}"})
    assert logout_res.status_code == 200

    # 7. Subsequent request with invalidated token must be rejected with 401
    expired_me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert expired_me.status_code == 401




