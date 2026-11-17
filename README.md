# RoadSense: AI-Powered Road Intelligence Platform

RoadSense is a full-stack road intelligence and navigation safety platform built with **FastAPI** (Python 3.12, SQLite, SQLAlchemy, Pydantic) and **React** (Vite, Leaflet, React Router, Lucide Icons).

---

## 🚀 Quick Start Guide

### 1. Start the Backend API Server

Run from the workspace root (`RoadSense_1`):

```powershell
& ".\backend\.venv\Scripts\uvicorn.exe" app.main:app --app-dir backend --host 127.0.0.1 --port 8000 --reload
```

Or change directory to `backend`:

```powershell
cd backend
.\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000 --reload
```

- **API Base URL:** [http://127.0.0.1:8000](http://127.0.0.1:8000)
- **Interactive Swagger Docs:** [http://127.0.0.1:8000/docs](http://127.0.0.1:8000/docs)
- **API Health Endpoint:** [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

---

### 2. Start the Frontend Application

Run from the `frontend` folder:

```powershell
cd frontend
npm.cmd run dev
```

- **Frontend URL:** [http://localhost:5173](http://localhost:5173) (or the port indicated by Vite, e.g. `5174`)

---

## 🧪 Running Automated Tests

To run the complete test suite:

```powershell
& ".\backend\.venv\Scripts\pytest.exe" backend/tests/test_api.py -v
```

To build the frontend for production:

```powershell
cd frontend
npm.cmd run build
```

---

## 🏛️ Project Architecture

```text
RoadSense_1/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app lifecycle, CORS, route registration
│   │   ├── database.py          # Absolute workspace DB path resolution & SQLAlchemy session
│   │   ├── models.py            # RoadReport database model
│   │   ├── schemas.py           # Pydantic request & response validation schemas
│   │   ├── routes/
│   │   │   ├── reports.py       # CRUD, summaries, nearby spatial filtering, status updates
│   │   │   ├── routing.py       # OSRM driving routes with 1km corridor hazard detection
│   │   │   ├── analytics.py     # Health index, recurrence hotspots, 14-day trends
│   │   │   ├── assistant.py     # Database-grounded Q&A assistant
│   │   │   ├── meta.py          # Hazard categories metadata & demo sample seeding
│   │   │   └── geocode.py       # Nominatim geocoding with local fallback
│   │   └── services/
│   │       ├── road_analysis.py # Documented Road Health scoring & recurrence clustering
│   │       └── voice_support.py # TTS speech text normalization & suggested inquiries
│   ├── tests/
│   │   └── test_api.py          # 11 comprehensive automated tests
│   ├── .env.example
│   └── requirements.txt
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Header.jsx       # Header bar with live refresh & action triggers
│   │   │   ├── Sidebar.jsx      # Navigation sidebar with real-time status dot
│   │   │   └── StatCard.jsx     # Metric cards with status badges
│   │   ├── pages/
│   │   │   ├── Dashboard.jsx    # Real-time statistics, distributions, quick actions
│   │   │   ├── RoadMap.jsx      # Interactive Leaflet map & corridor route planner
│   │   │   ├── Reports.jsx      # Filterable report management table & submission modal
│   │   │   ├── Analytics.jsx    # Score formula breakdown, trends chart, repeat defect hotspots
│   │   │   └── Assistant.jsx    # Voice-enabled chat assistant grounded in database
│   │   ├── services/
│   │   │   └── api.js           # Centralized Axios client & error handler
│   │   ├── App.jsx              # React Router layout & application state
│   │   ├── App.css              # Cohesive, responsive styling system
│   │   └── main.jsx
│   ├── .env.example
│   └── package.json
├── roadsense.db                 # Persistent SQLite database (preserved)
└── README.md
```

---

## 🛡️ Core Features Implemented

1. **Root Cause Fix for `Not Found` Error:**
   - Centralized Axios client to automatically detect `VITE_API_BASE_URL` with default `http://127.0.0.1:8000`.
   - Resolved missing route endpoints: `/api/reports/summary`, `/api/reports/near`, `/api/geocode`, `/api/meta/categories`.
   - Prevented integer path parameter collision on `/{report_id}` by registering specialized endpoints first.
   - Guaranteed absolute SQLite path resolution to root `roadsense.db` regardless of working directory.
   - Comprehensive error message formatter replacing raw `Not Found` with actionable status messages.

2. **Dashboard Overview:**
   - Real-time statistics: Total reports, verified reports, pending review, and documented Road Condition Score.
   - Hazard type distribution bars with percentage shares.
   - Latest 5 reports feed with category tags, location corridors, and timestamps.
   - Connection status indicator with live API ping timestamp.

3. **Road Monitoring & Interactive Map:**
   - Interactive Leaflet map with OpenStreetMap tiles.
   - Custom colored SVG markers for each hazard category (Pothole, Waterlogging, Cracked Road, Damaged Surface, Obstruction, Other).
   - Rings distinguishing verified vs. unverified status.
   - Marker popups displaying full defect details.
   - Click anywhere on map to pin coordinates and submit a report.
   - Geolocation positioning via browser permissions.
   - Place name search with coordinate auto-centering.

4. **Intelligent Corridor Route Planner:**
   - Origin and destination search with geocoding suggestions.
   - Driving route calculation via OSRM with intelligent offline fallback.
   - Automatic 1 km corridor scan of the database to detect defects situated along the driving path.
   - Clear hazard advisory banners warning drivers of upcoming verified or pending hazards.

5. **Road Reports Management:**
   - Complete CRUD operations: Create report, list reports, view details modal, toggle verification status, delete report.
   - Real-time search by keyword across street name, description, and hazard category.
   - Filters by category, verification status, and data source (genuine community vs demo sample).
   - Validation on both client and server (coordinates, text lengths).
   - Submissions default to unverified status to preserve community data integrity.

6. **Road Analytics & Recurring Defects:**
   - Documented Road Condition Score (0–100) with transparent factor breakdown (100 base, -12 per verified hazard, -4 per pending report, minimum 3 reports threshold).
   - 14-day daily report volume chart.
   - Recurring defect hotspot detection: groups multiple independent events by location to identify chronic road degradation.

7. **Voice-Enabled Road Intelligence Assistant:**
   - Interactive chat interface grounded strictly in actual database records.
   - Never fabricates coordinates, hazards, or traffic conditions.
   - Voice input via Web Speech API (SpeechRecognition) with explicit user mic toggle.
   - Voice output via browser SpeechSynthesis (TTS) with text cleanup.
   - Suggested question chips for single-click queries.
