import React, { useEffect, useRef, useState } from "react";
import axios from "axios";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
  Droplets,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  Navigation,
  PlusCircle,
  Radio,
  Route,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sliders,
  X,
} from "lucide-react";
import Header from "../components/Header";
import GpsDiagnosticCard from "../components/GpsDiagnosticCard";
import { getMediaUrl, getRoute, reverseGeocode, searchLocation } from "../services/api";
import {
  getCurrentPositionAsync,
  formatGpsAccuracy,
  getAccuracyRating,
  getGeolocationErrorMessage,
  calculateDistanceKm,
} from "../utils/geolocation";

function formatDuration(minutes = 0) {
  if (minutes >= 60) {
    const hrs = Math.floor(minutes / 60);
    const mins = Math.round(minutes % 60);
    return mins > 0 ? `${hrs}h ${mins}m` : `${hrs} hr`;
  }
  return `${Math.round(minutes)} min`;
}

function getHazardTheme(type = "") {
  const t = (type || "").toLowerCase();
  if (t.includes("pothole")) {
    return {
      color: "#dc2626",
      border: "#fca5a5",
      lightBg: "#fef2f2",
      label: "Pothole",
      iconSmall: <AlertCircle size={12} />,
      icon: <AlertCircle size={20} color="#dc2626" />,
      svgGlyph: `
        <ellipse cx="14" cy="13" rx="5.2" ry="3.2" fill="#FFFFFF" opacity="0.95"/>
        <ellipse cx="14" cy="13.2" rx="3.1" ry="1.7" fill="#dc2626"/>
      `,
    };
  }
  if (t.includes("water")) {
    return {
      color: "#0284c7",
      border: "#bae6fd",
      lightBg: "#f0f9ff",
      label: "Waterlogging",
      iconSmall: <Droplets size={12} />,
      icon: <Droplets size={20} color="#0284c7" />,
      svgGlyph: `
        <path d="M14 8C14 8 10 12.2 10 14.3C10 16.3 11.8 17.5 14 17.5C16.2 17.5 18 16.3 18 14.3C18 12.2 14 8 14 8Z" fill="#FFFFFF"/>
      `,
    };
  }
  if (t.includes("crack")) {
    return {
      color: "#d97706",
      border: "#fde68a",
      lightBg: "#fffbeb",
      label: "Cracked Road",
      iconSmall: <AlertTriangle size={12} />,
      icon: <AlertTriangle size={20} color="#d97706" />,
      svgGlyph: `
        <path d="M12.5 8.5L15.5 12L13 14L16 17.5" stroke="#FFFFFF" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      `,
    };
  }
  if (t.includes("surface") || t.includes("damage")) {
    return {
      color: "#ea580c",
      border: "#fed7aa",
      lightBg: "#fff7ed",
      label: "Damaged Surface",
      iconSmall: <Layers size={12} />,
      icon: <Layers size={20} color="#ea580c" />,
      svgGlyph: `
        <path d="M9.5 13.5C11 11.5 12.5 15.5 14 13.5C15.5 11.5 17 15.5 18.5 13.5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round"/>
      `,
    };
  }
  if (t.includes("obstruct")) {
    return {
      color: "#7c3aed",
      border: "#ddd6fe",
      lightBg: "#f5f3ff",
      label: "Road Obstruction",
      iconSmall: <ShieldAlert size={12} />,
      icon: <ShieldAlert size={20} color="#7c3aed" />,
      svgGlyph: `
        <path d="M10 16.5H18M11.5 16.5L14 9.5L16.5 16.5M12 14H16" stroke="#FFFFFF" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
      `,
    };
  }
  return {
    color: "#475569",
    border: "#cbd5e1",
    lightBg: "#f8fafc",
    label: "Road Defect",
    iconSmall: <AlertTriangle size={12} />,
    icon: <AlertTriangle size={20} color="#475569" />,
    svgGlyph: `
      <circle cx="14" cy="13" r="4.2" fill="#FFFFFF"/>
      <circle cx="14" cy="13" r="2.1" fill="#475569"/>
    `,
  };
}

function createGisMarkerIcon(hazardType, isVerified, isSelected = false) {
  const theme = getHazardTheme(hazardType);
  const width = isSelected ? 34 : 28;
  const height = isSelected ? 40 : 34;
  const anchorX = width / 2;
  const anchorY = height - 1;

  // Status Badge SVG at top-right
  const statusBadge = isVerified
    ? `<circle cx="22" cy="6" r="4.2" fill="#10B981" stroke="#FFFFFF" stroke-width="1.5"/>
       <path d="M20.5 6L21.8 7.3L23.8 5" stroke="#FFFFFF" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>`
    : `<circle cx="22" cy="6" r="4.2" fill="#F59E0B" stroke="#FFFFFF" stroke-width="1.5"/>
       <circle cx="22" cy="6" r="1.3" fill="#FFFFFF"/>`;

  const haloHtml = isSelected
    ? `<div class="pin-pulse-halo" style="border-color: ${theme.color};"></div>`
    : "";

  return L.divIcon({
    className: `roadsense-gis-pin ${isSelected ? "is-selected" : ""}`,
    html: `
      <div style="position: relative; width: ${width}px; height: ${height}px; display: flex; align-items: center; justify-content: center; cursor: pointer;">
        ${haloHtml}
        <svg width="${width}" height="${height}" viewBox="0 0 28 34" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; filter: drop-shadow(0 3px 6px rgba(15,23,42,0.35)); transition: transform 0.2s ease;">
          <path d="M14 1C6.82 1 1 6.82 1 14C1 22.8 14 33 14 33C14 33 27 22.8 27 14C27 6.82 21.18 1 14 1Z"
                fill="${theme.color}" stroke="#FFFFFF" stroke-width="2"/>
          ${theme.svgGlyph}
          ${statusBadge}
        </svg>
      </div>
    `,
    iconSize: [width, height],
    iconAnchor: [anchorX, anchorY],
    popupAnchor: [0, -anchorY + 2],
  });
}

function createRouteEndpointIcon(letter, isOrigin = true) {
  const bg = isOrigin ? "#10b981" : "#ef4444";
  return L.divIcon({
    className: "roadsense-waypoint-pin",
    html: `
      <div style="
        width: 30px;
        height: 30px;
        background: ${bg};
        border: 2.5px solid #ffffff;
        box-shadow: 0 4px 10px rgba(0,0,0,0.35);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: #ffffff;
        font-weight: 800;
        font-size: 13px;
        font-family: inherit;
        letter-spacing: -0.5px;
      ">
        ${letter}
      </div>
    `,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
    popupAnchor: [0, -15],
  });
}

function createGpsBeaconIcon() {
  return L.divIcon({
    className: "roadsense-gps-beacon",
    html: `
      <div style="
        position: relative;
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          position: absolute;
          width: 26px;
          height: 26px;
          border-radius: 50%;
          background: rgba(14, 165, 233, 0.35);
          animation: pulse 1.8s infinite;
        "></div>
        <div style="
          width: 13px;
          height: 13px;
          border-radius: 50%;
          background: #0284c7;
          border: 2.5px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          z-index: 2;
        "></div>
      </div>
    `,
    iconSize: [26, 26],
    iconAnchor: [13, 13],
    popupAnchor: [0, -13],
  });
}

function createAreaCenterIcon() {
  return L.divIcon({
    className: "roadsense-area-center-beacon",
    html: `
      <div style="
        position: relative;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
      ">
        <div style="
          position: absolute;
          width: 32px;
          height: 32px;
          border-radius: 50%;
          background: rgba(16, 185, 129, 0.28);
          animation: pulse 2s infinite;
        "></div>
        <div style="
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: #059669;
          border: 2.5px solid #ffffff;
          box-shadow: 0 2px 6px rgba(0,0,0,0.3);
          z-index: 2;
        "></div>
      </div>
    `,
    iconSize: [32, 32],
    iconAnchor: [16, 16],
    popupAnchor: [0, -16],
  });
}

function buildPopupHtml(rep) {
  const theme = getHazardTheme(rep.hazard_type);
  const isVerified = rep.status === "verified";
  const imgUrl = getMediaUrl(rep.image_url);

  return `
    <div class="roadsense-gis-popup">
      <div class="popup-header">
        <span class="popup-category-badge" style="background: ${theme.lightBg}; color: ${theme.color}; border: 1px solid ${theme.border};">
          ${rep.hazard_type}
        </span>
        <span class="popup-status-badge ${isVerified ? "verified" : "pending"}">
          ${isVerified ? "✓ Verified" : "⏳ Pending Review"}
        </span>
      </div>
      ${
        imgUrl
          ? `<div class="popup-image-wrap">
               <img src="${imgUrl}" alt="${rep.hazard_type}" onerror="this.parentElement.style.display='none'" />
             </div>`
          : ""
      }
      <div class="popup-location-name">📍 ${rep.location_name}</div>
      ${
        typeof rep.route_km === "number"
          ? `<div class="popup-route-km">
               Km ${rep.route_km.toFixed(1)} of journey ${
              typeof rep.distance_from_route_km === "number"
                ? `(${Math.round(rep.distance_from_route_km * 1000)}m off route)`
                : ""
            }
             </div>`
          : ""
      }
      <p class="popup-description">${rep.description}</p>
      <div class="popup-footer">
        <span>Logged: ${new Date(rep.created_at).toLocaleDateString()}</span>
        ${rep.source ? `<span>via ${rep.source}</span>` : ""}
      </div>
    </div>
  `;
}

export default function RoadMap({
  reports = [],
  loading = false,
  onRefresh,
  onOpenReportModalWithCoords,
  onRouteCalculated,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const markersLayerRef = useRef(null);
  const routeLayerRef = useRef(null);
  const routePointsLayerRef = useRef(null);
  const gpsMarkerRef = useRef(null);
  const gpsCircleRef = useRef(null);
  const watchIdRef = useRef(null);
  const startInputRef = useRef(null);

  // References to Leaflet markers on the route for click synchronization
  const hazardMarkersRef = useRef({});

  // Area Monitoring State & Layer References
  const areaCircleRef = useRef(null);
  const areaCenterMarkerRef = useRef(null);
  const areaHazardMarkersRef = useRef({});
  const [monitoringCenter, setMonitoringCenter] = useState(null); // { latitude, longitude, display_name, source, accuracy }
  const [monitoringRadiusKm, setMonitoringRadiusKm] = useState(10); // 5, 10, 25, 50 km
  const [areaHazards, setAreaHazards] = useState([]);
  const [selectedAreaHazardId, setSelectedAreaHazardId] = useState(null);
  const [gpsOriginWarning, setGpsOriginWarning] = useState("");

  // Active view tab: "monitoring" or "routing"
  const [activeTab, setActiveTab] = useState("routing");

  // Selected defect card ID (highlights both card and map marker)
  const [selectedHazardId, setSelectedHazardId] = useState(null);

  // Floating map legend state
  const [isLegendOpen, setIsLegendOpen] = useState(true);

  // Geolocation & Diagnostic state
  const [gpsLoading, setGpsLoading] = useState(false);
  const [gpsLocation, setGpsLocation] = useState(null); // { latitude, longitude }
  const [gpsAccuracy, setGpsAccuracy] = useState(null); // accuracy radius in metres
  const [gpsTimestamp, setGpsTimestamp] = useState(null); // ISO formatted string
  const [gpsStatus, setGpsStatus] = useState("idle"); // 'idle' | 'acquiring' | 'locked' | 'approximate' | 'error'
  const [gpsStatusMessage, setGpsStatusMessage] = useState("");
  const [gpsAddress, setGpsAddress] = useState("");
  const [isLiveTracking, setIsLiveTracking] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [gpsDiagnosticVisible, setGpsDiagnosticVisible] = useState(false);

  // Map search state with debouncing and abort controller
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchNoResults, setSearchNoResults] = useState(false);
  const searchAbortRef = useRef(null);

  // Selected map coordinates
  const [clickedCoords, setClickedCoords] = useState(null);
  const [clickedAddress, setClickedAddress] = useState("");

  // Route Planning State
  const [startQuery, setStartQuery] = useState("");
  const [startSelected, setStartSelected] = useState(null);
  const [startSuggestions, setStartSuggestions] = useState([]);
  const [startLoading, setStartLoading] = useState(false);
  const [startNoResults, setStartNoResults] = useState(false);
  const startAbortRef = useRef(null);

  const [endQuery, setEndQuery] = useState("");
  const [endSelected, setEndSelected] = useState(null);
  const [endSuggestions, setEndSuggestions] = useState([]);
  const [endLoading, setEndLoading] = useState(false);
  const [endNoResults, setEndNoResults] = useState(false);
  const endAbortRef = useRef(null);

  // Configurable corridor (km): 0.1, 0.25, 0.5, 1.0, 2.0, 5.0
  const [corridorKm, setCorridorKm] = useState(0.5);

  const [routeResult, setRouteResult] = useState(null);
  const [routeLoading, setRouteLoading] = useState(false);
  const [routeError, setRouteError] = useState("");

  // Initialize Leaflet Map (defaults to AP / Central Corridor, never auto-fits whole country)
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const defaultLat = 16.5062;
    const defaultLon = 80.6480;

    const map = L.map(mapContainerRef.current, {
      center: [defaultLat, defaultLon],
      zoom: 11,
      zoomControl: false,
    });

    L.control.zoom({ position: "bottomright" }).addTo(map);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);

    markersLayerRef.current = L.layerGroup().addTo(map);
    routeLayerRef.current = L.layerGroup().addTo(map);
    routePointsLayerRef.current = L.layerGroup().addTo(map);

    // Click anywhere on map to pin coordinates & reverse geocode
    map.on("click", async (e) => {
      const { lat, lng } = e.latlng;
      const latF = parseFloat(lat.toFixed(6));
      const lonF = parseFloat(lng.toFixed(6));
      setClickedCoords({ latitude: latF, longitude: lonF });
      setClickedAddress("Resolving street address...");

      try {
        const rev = await reverseGeocode(latF, lonF);
        setClickedAddress(rev.display_name);
      } catch {
        setClickedAddress(`Pinned Coordinates (${latF}, ${lonF})`);
      }
    });

    mapInstanceRef.current = map;

    return () => {
      if (watchIdRef.current) navigator.geolocation.clearWatch(watchIdRef.current);
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Tab-Aware Layer & Marker Synchronization
  // In Routing mode: displays ONLY genuine corridor hazards when route is calculated; NO random nationwide pins.
  // In Monitoring mode: displays ONLY hazards within the selected radius circle of confirmed center.
  useEffect(() => {
    if (!mapInstanceRef.current || !markersLayerRef.current) return;

    if (activeTab === "routing") {
      // Clean up Area Monitoring visual overlays
      if (areaCircleRef.current) {
        areaCircleRef.current.remove();
        areaCircleRef.current = null;
      }
      if (areaCenterMarkerRef.current) {
        areaCenterMarkerRef.current.remove();
        areaCenterMarkerRef.current = null;
      }
      markersLayerRef.current.clearLayers();

      // Show route layers if routeResult is active
      if (routeResult && routeLayerRef.current && routePointsLayerRef.current) {
        if (!mapInstanceRef.current.hasLayer(routeLayerRef.current)) {
          routeLayerRef.current.addTo(mapInstanceRef.current);
        }
        if (!mapInstanceRef.current.hasLayer(routePointsLayerRef.current)) {
          routePointsLayerRef.current.addTo(mapInstanceRef.current);
        }
      }
    } else if (activeTab === "monitoring") {
      // In Area Monitoring: Hide route geometry
      if (routeLayerRef.current && mapInstanceRef.current.hasLayer(routeLayerRef.current)) {
        routeLayerRef.current.remove();
      }
      if (
        routePointsLayerRef.current &&
        mapInstanceRef.current.hasLayer(routePointsLayerRef.current)
      ) {
        routePointsLayerRef.current.remove();
      }

      if (monitoringCenter) {
        // 1. Draw/Update Monitored Radius Circle
        if (areaCircleRef.current) {
          areaCircleRef.current.setLatLng([
            monitoringCenter.latitude,
            monitoringCenter.longitude,
          ]);
          areaCircleRef.current.setRadius(monitoringRadiusKm * 1000);
          if (!mapInstanceRef.current.hasLayer(areaCircleRef.current)) {
            areaCircleRef.current.addTo(mapInstanceRef.current);
          }
        } else {
          areaCircleRef.current = L.circle(
            [monitoringCenter.latitude, monitoringCenter.longitude],
            {
              radius: monitoringRadiusKm * 1000,
              color: "#059669",
              weight: 2,
              fillColor: "#10b981",
              fillOpacity: 0.08,
              dashArray: "5, 5",
            }
          ).addTo(mapInstanceRef.current);
        }

        // 2. Draw/Update Monitored Center Pin
        if (areaCenterMarkerRef.current) {
          areaCenterMarkerRef.current.setLatLng([
            monitoringCenter.latitude,
            monitoringCenter.longitude,
          ]);
          if (!mapInstanceRef.current.hasLayer(areaCenterMarkerRef.current)) {
            areaCenterMarkerRef.current.addTo(mapInstanceRef.current);
          }
        } else {
          areaCenterMarkerRef.current = L.marker(
            [monitoringCenter.latitude, monitoringCenter.longitude],
            { icon: createAreaCenterIcon() }
          )
            .bindPopup(`<b>Monitored Area Center:</b><br/>${monitoringCenter.display_name}`)
            .addTo(mapInstanceRef.current);
        }

        // 3. Filter reports strictly by distance <= monitoringRadiusKm
        const filtered = [];
        reports.forEach((rep) => {
          const dist = calculateDistanceKm(
            monitoringCenter.latitude,
            monitoringCenter.longitude,
            rep.latitude,
            rep.longitude
          );
          if (dist <= monitoringRadiusKm) {
            filtered.push({
              ...rep,
              distance_from_center_km: dist,
            });
          }
        });

        filtered.sort((a, b) => a.distance_from_center_km - b.distance_from_center_km);
        setAreaHazards(filtered);

        // 4. Render markers ONLY for matching area hazards
        markersLayerRef.current.clearLayers();
        areaHazardMarkersRef.current = {};

        filtered.forEach((rep) => {
          const isVerified = rep.status === "verified";
          const icon = createGisMarkerIcon(
            rep.hazard_type,
            isVerified,
            rep.id === selectedAreaHazardId
          );
          const marker = L.marker([rep.latitude, rep.longitude], { icon });
          marker.bindPopup(buildPopupHtml(rep));
          marker.on("click", () => {
            setSelectedAreaHazardId(rep.id);
            const cardEl = document.getElementById(`defect-card-${rep.id}`);
            if (cardEl) {
              cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          });
          marker.addTo(markersLayerRef.current);
          areaHazardMarkersRef.current[rep.id] = marker;
        });

        // 5. Fit bounds to the monitoring circle
        if (areaCircleRef.current) {
          mapInstanceRef.current.fitBounds(areaCircleRef.current.getBounds(), {
            padding: [30, 30],
            maxZoom: 15,
          });
        }
      } else {
        // No area selected yet: map is clean
        if (areaCircleRef.current) {
          areaCircleRef.current.remove();
          areaCircleRef.current = null;
        }
        if (areaCenterMarkerRef.current) {
          areaCenterMarkerRef.current.remove();
          areaCenterMarkerRef.current = null;
        }
        markersLayerRef.current.clearLayers();
        setAreaHazards([]);
      }
    }
  }, [
    activeTab,
    monitoringCenter,
    monitoringRadiusKm,
    reports,
    selectedAreaHazardId,
    routeResult,
  ]);

  // Update Marker Selection highlights when selectedHazardId changes
  useEffect(() => {
    if (!routeResult?.hazards_along_route) return;
    routeResult.hazards_along_route.forEach((h) => {
      const marker = hazardMarkersRef.current[h.id];
      if (marker) {
        const isSel = selectedHazardId === h.id;
        marker.setIcon(createGisMarkerIcon(h.hazard_type, h.status === "verified", isSel));
        if (isSel) {
          marker.setZIndexOffset(1000);
        } else {
          marker.setZIndexOffset(0);
        }
      }
    });
  }, [selectedHazardId, routeResult]);

  // Real GPS Location Acquisition with Accuracy Diagnostics & Anti-Stale Options
  const acquireGpsLocation = async (options = {}) => {
    const { setAsOrigin = false, setAsMonitoringCenter = false } = options;

    setGeoError("");
    setGpsLoading(true);
    setGpsStatus("acquiring");
    setGpsStatusMessage("Requesting high-precision GPS fix from browser...");
    setGpsDiagnosticVisible(true);

    try {
      const pos = await getCurrentPositionAsync();
      const { latitude, longitude, accuracy, timestampFormatted, isApproximate, accuracyRating } = pos;

      setGpsLocation({ latitude, longitude });
      setGpsAccuracy(accuracy);
      setGpsTimestamp(timestampFormatted);
      setGpsStatus(isApproximate ? "approximate" : "locked");
      setGpsStatusMessage(
        isApproximate
          ? `Position resolved via approximate network / Wi-Fi routing (${pos.accuracyFormatted})`
          : `GPS fix confirmed with high precision (${pos.accuracyFormatted})`
      );
      setGpsLoading(false);

      // Reverse geocode the acquired coordinates
      let resolvedName = "";
      try {
        const rev = await reverseGeocode(latitude, longitude);
        resolvedName = rev.display_name;
        setGpsAddress(resolvedName);
      } catch {
        resolvedName = `GPS Coordinates (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`;
        setGpsAddress(resolvedName);
      }

      // If requested to use GPS as route origin
      if (setAsOrigin) {
        if (isApproximate) {
          // Do NOT blindly substitute Doha or approximate network IP location as origin
          setGpsOriginWarning(
            `Approximate network location detected (±${pos.accuracyFormatted}). Laptops lack satellite GPS chips and estimate location via ISP/Wi-Fi routing (which can point to Doha or an ISP hub). Confirm below or type your origin manually.`
          );
        } else {
          setStartSelected({
            display_name: resolvedName,
            latitude,
            longitude,
            accuracy,
          });
          setStartQuery(resolvedName);
          setStartSuggestions([]);
          setGpsOriginWarning("");
        }
      }

      // If requested to use GPS for Area Monitoring
      if (setAsMonitoringCenter) {
        setMonitoringCenter({
          display_name: resolvedName,
          latitude,
          longitude,
          source: "gps",
          accuracy,
        });
      }

      // Render Distinct GPS Marker and Accuracy Circle on Leaflet Map
      if (mapInstanceRef.current) {
        if (gpsMarkerRef.current) {
          gpsMarkerRef.current.remove();
          gpsMarkerRef.current = null;
        }
        if (gpsCircleRef.current) {
          gpsCircleRef.current.remove();
          gpsCircleRef.current = null;
        }

        const beacon = L.marker([latitude, longitude], { icon: createGpsBeaconIcon() })
          .bindPopup(`
            <div style="min-width: 220px; font-size: 12px; line-height: 1.5; color: #0f172a; padding: 2px;">
              <div style="font-weight: 700; color: #0284c7; margin-bottom: 6px; display: flex; align-items: center; gap: 5px;">
                <span>📍 Current Location Diagnostic</span>
              </div>
              <div><b>Coordinates:</b> ${latitude.toFixed(6)}, ${longitude.toFixed(6)}</div>
              <div><b>Accuracy:</b> ${pos.accuracyFormatted} (${accuracyRating.label})</div>
              <div><b>Timestamp:</b> ${timestampFormatted}</div>
              <div style="margin-top: 4px; color: #475569;"><b>Area:</b> ${resolvedName}</div>
              ${
                isApproximate
                  ? `<div style="margin-top: 6px; padding: 4px 8px; background: #fffbeb; border: 1px solid #fde68a; border-radius: 4px; font-size: 11px; color: #92400e;">
                      ⚠️ Approximate Network Location: Laptops lack satellite GPS chips and estimate location via Wi-Fi or ISP routing.
                    </div>`
                  : `<div style="margin-top: 6px; padding: 4px 8px; background: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 4px; font-size: 11px; color: #065f46;">
                      ✓ High-accuracy satellite / device fix.
                    </div>`
              }
            </div>
          `)
          .addTo(mapInstanceRef.current);
        gpsMarkerRef.current = beacon;

        // Create Accuracy Circle
        if (accuracy && accuracy > 0) {
          const circle = L.circle([latitude, longitude], {
            radius: accuracy,
            color: isApproximate ? "#f59e0b" : "#0284c7",
            fillColor: isApproximate ? "#fef3c7" : "#38bdf8",
            fillOpacity: isApproximate ? 0.2 : 0.12,
            weight: 1.5,
            dashArray: isApproximate ? "5, 5" : null,
          }).addTo(mapInstanceRef.current);
          gpsCircleRef.current = circle;
        }

        // Adaptive Map Centering based on accuracy radius
        if (accuracy && accuracy > 1000 && gpsCircleRef.current) {
          // Wide uncertainty radius (e.g. Doha IP 25km): fit bounds to the circle
          const bounds = gpsCircleRef.current.getBounds();
          mapInstanceRef.current.fitBounds(bounds, {
            padding: [40, 40],
            maxZoom: 13,
            duration: 1.2,
          });
        } else {
          // Precise street-level fix: fly directly
          mapInstanceRef.current.flyTo([latitude, longitude], 15, { duration: 1.2 });
        }
      }
    } catch (err) {
      setGpsLoading(false);
      setGpsStatus("error");
      setGeoError(err.message || "Failed to retrieve current location.");
      setGpsStatusMessage(err.message || "Geolocation error");
    }
  };

  const handleLocateMe = () => {
    if (gpsLocation) {
      setMonitoringCenter({
        display_name:
          gpsAddress ||
          `GPS Position (${gpsLocation.latitude.toFixed(6)}, ${gpsLocation.longitude.toFixed(6)})`,
        latitude: gpsLocation.latitude,
        longitude: gpsLocation.longitude,
        source: "gps",
        accuracy: gpsAccuracy,
      });
    } else {
      acquireGpsLocation({ setAsOrigin: false, setAsMonitoringCenter: true });
    }
  };

  const handleClearMonitoringCenter = () => {
    setMonitoringCenter(null);
    setSearchQuery("");
    setAreaHazards([]);
    setSelectedAreaHazardId(null);
    if (areaCircleRef.current) {
      areaCircleRef.current.remove();
      areaCircleRef.current = null;
    }
    if (areaCenterMarkerRef.current) {
      areaCenterMarkerRef.current.remove();
      areaCenterMarkerRef.current = null;
    }
    if (markersLayerRef.current) {
      markersLayerRef.current.clearLayers();
    }
  };

  const handleAreaHazardClick = (hazard) => {
    setSelectedAreaHazardId(hazard.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([hazard.latitude, hazard.longitude], 16, { duration: 0.8 });
      const targetMarker = areaHazardMarkersRef.current[hazard.id];
      if (targetMarker) {
        targetMarker.openPopup();
      }
    }
  };

  // Clear GPS Fix and Map Overlays
  const handleClearGps = () => {
    setGpsLocation(null);
    setGpsAccuracy(null);
    setGpsTimestamp(null);
    setGpsStatus("idle");
    setGpsStatusMessage("");
    setGpsAddress("");
    setGeoError("");
    setGpsDiagnosticVisible(false);
    setGpsOriginWarning("");

    if (gpsMarkerRef.current) {
      gpsMarkerRef.current.remove();
      gpsMarkerRef.current = null;
    }
    if (gpsCircleRef.current) {
      gpsCircleRef.current.remove();
      gpsCircleRef.current = null;
    }
  };

  // Focus manual origin search input
  const handleFocusManualOrigin = () => {
    setGpsOriginWarning("");
    if (startInputRef.current) {
      startInputRef.current.focus();
      startInputRef.current.select();
    }
  };

  const handleConfirmApproximateOrigin = () => {
    if (gpsLocation) {
      const name =
        gpsAddress ||
        `Current Position (${gpsLocation.latitude.toFixed(6)}, ${gpsLocation.longitude.toFixed(6)})`;
      setStartSelected({
        display_name: name,
        latitude: gpsLocation.latitude,
        longitude: gpsLocation.longitude,
        accuracy: gpsAccuracy,
      });
      setStartQuery(name);
      setStartSuggestions([]);
      setGpsOriginWarning("");
    }
  };

  // Toggle Live Tracking (watchPosition)
  const toggleLiveTracking = () => {
    if (isLiveTracking) {
      if (watchIdRef.current) {
        navigator.geolocation.clearWatch(watchIdRef.current);
        watchIdRef.current = null;
      }
      setIsLiveTracking(false);
    } else {
      if (!navigator.geolocation) {
        setGeoError("Geolocation not supported.");
        return;
      }
      setIsLiveTracking(true);
      watchIdRef.current = navigator.geolocation.watchPosition(
        (pos) => {
          const { latitude, longitude, accuracy } = pos.coords;
          setGpsLocation({ latitude, longitude });
          if (accuracy) setGpsAccuracy(Math.round(accuracy));
          if (gpsMarkerRef.current) {
            gpsMarkerRef.current.setLatLng([latitude, longitude]);
          }
          if (gpsCircleRef.current && accuracy) {
            gpsCircleRef.current.setLatLng([latitude, longitude]);
            gpsCircleRef.current.setRadius(accuracy);
          }
        },
        () => setIsLiveTracking(false),
        { enableHighAccuracy: true }
      );
    }
  };

  // Debounced Map Place Search with AbortController
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.trim().length < 2) {
      setSearchResults([]);
      setSearchNoResults(false);
      setSearchLoading(false);
      return;
    }

    if (searchAbortRef.current) searchAbortRef.current.abort();
    const controller = new AbortController();
    searchAbortRef.current = controller;

    const timeoutId = setTimeout(async () => {
      setSearchLoading(true);
      setSearchNoResults(false);
      try {
        const results = await searchLocation(searchQuery, 6, controller.signal);
        setSearchResults(results);
        setSearchNoResults(results.length === 0);
        setSearchLoading(false);
      } catch (err) {
        if (
          axios.isCancel(err) ||
          err.code === "ERR_CANCELED" ||
          err.name === "CanceledError" ||
          err.name === "AbortError"
        ) {
          return;
        }
        setSearchResults([]);
        setSearchNoResults(true);
        setSearchLoading(false);
      }
    }, 350);

    return () => clearTimeout(timeoutId);
  }, [searchQuery]);

  const handleSelectMapSearchResult = (item) => {
    if (!mapInstanceRef.current) return;
    const center = {
      display_name: item.display_name,
      latitude: item.latitude,
      longitude: item.longitude,
      source: "search",
    };
    setMonitoringCenter(center);
    setSearchResults([]);
    setSearchQuery(item.display_name);
  };

  // Debounced Origin (Start) Search
  useEffect(() => {
    if (
      !startQuery.trim() ||
      startQuery.trim().length < 2 ||
      (startSelected && startSelected.display_name === startQuery)
    ) {
      setStartSuggestions([]);
      setStartNoResults(false);
      setStartLoading(false);
      return;
    }

    if (startAbortRef.current) startAbortRef.current.abort();
    const controller = new AbortController();
    startAbortRef.current = controller;

    const timeoutId = setTimeout(async () => {
      setStartLoading(true);
      setStartNoResults(false);
      try {
        const results = await searchLocation(startQuery, 6, controller.signal);
        setStartSuggestions(results);
        setStartNoResults(results.length === 0);
        setStartLoading(false);
      } catch (err) {
        if (
          axios.isCancel(err) ||
          err.code === "ERR_CANCELED" ||
          err.name === "CanceledError" ||
          err.name === "AbortError"
        ) {
          return;
        }
        setStartSuggestions([]);
        setStartNoResults(true);
        setStartLoading(false);
      }
    }, 350);

    return () => clearTimeout(timeoutId);
  }, [startQuery, startSelected]);

  // Debounced Destination (End) Search
  useEffect(() => {
    if (
      !endQuery.trim() ||
      endQuery.trim().length < 2 ||
      (endSelected && endSelected.display_name === endQuery)
    ) {
      setEndSuggestions([]);
      setEndNoResults(false);
      setEndLoading(false);
      return;
    }

    if (endAbortRef.current) endAbortRef.current.abort();
    const controller = new AbortController();
    endAbortRef.current = controller;

    const timeoutId = setTimeout(async () => {
      setEndLoading(true);
      setEndNoResults(false);
      try {
        const results = await searchLocation(endQuery, 6, controller.signal);
        setEndSuggestions(results);
        setEndNoResults(results.length === 0);
        setEndLoading(false);
      } catch (err) {
        if (
          axios.isCancel(err) ||
          err.code === "ERR_CANCELED" ||
          err.name === "CanceledError" ||
          err.name === "AbortError"
        ) {
          return;
        }
        setEndSuggestions([]);
        setEndNoResults(true);
        setEndLoading(false);
      }
    }, 350);

    return () => clearTimeout(timeoutId);
  }, [endQuery, endSelected]);

  // Set Current GPS as Route Origin
  const handleUseCurrentGpsAsOrigin = () => {
    if (gpsLocation) {
      if (gpsAccuracy != null && gpsAccuracy > 500) {
        setGpsDiagnosticVisible(true);
        setGpsOriginWarning(
          `Approximate network location detected (±${gpsAccuracy >= 1000 ? (gpsAccuracy / 1000).toFixed(1) + " km" : gpsAccuracy + " m"}). Laptops lack satellite GPS chips and estimate location via ISP/Wi-Fi routing (which can point to Doha or an ISP hub). Confirm below or type your origin manually.`
        );
      } else {
        const name =
          gpsAddress ||
          `Current Position (${gpsLocation.latitude.toFixed(6)}, ${gpsLocation.longitude.toFixed(6)})`;
        setStartSelected({
          display_name: name,
          latitude: gpsLocation.latitude,
          longitude: gpsLocation.longitude,
          accuracy: gpsAccuracy,
        });
        setStartQuery(name);
        setStartSuggestions([]);
        setGpsOriginWarning("");
      }
      setGpsDiagnosticVisible(true);
    } else {
      acquireGpsLocation({ setAsOrigin: true });
    }
  };

  // Calculate Route with Configurable Corridor
  const handleCalculateRoute = async (e) => {
    e.preventDefault();
    setRouteError("");
    setRouteResult(null);
    setSelectedHazardId(null);
    hazardMarkersRef.current = {};

    if (!startSelected || !endSelected) {
      setRouteError("Please select both a valid origin and destination from the search suggestions.");
      return;
    }

    setRouteLoading(true);

    try {
      const data = await getRoute(
        startSelected.latitude,
        startSelected.longitude,
        endSelected.latitude,
        endSelected.longitude,
        corridorKm
      );

      setRouteResult(data);

      if (onRouteCalculated) {
        onRouteCalculated({
          origin: startSelected,
          destination: endSelected,
          distance_km: data.distance_km,
          duration_minutes: data.duration_minutes,
          corridor_km: corridorKm,
          hazard_summary: data.hazard_summary,
        });
      }

      // Render high-visibility GIS route on map
      if (mapInstanceRef.current && routeLayerRef.current && routePointsLayerRef.current) {
        routeLayerRef.current.clearLayers();
        routePointsLayerRef.current.clearLayers();

        // 1. High contrast route casing (outer line)
        L.geoJSON(data.geometry, {
          style: {
            color: "#0369a1",
            weight: 8,
            opacity: 0.85,
            lineCap: "round",
            lineJoin: "round",
          },
        }).addTo(routeLayerRef.current);

        // 2. High-visibility core route line
        const coreRouteLayer = L.geoJSON(data.geometry, {
          style: {
            color: "#38bdf8",
            weight: 4.5,
            opacity: 1,
            lineCap: "round",
            lineJoin: "round",
          },
        }).addTo(routeLayerRef.current);

        // 3. Start Pin "A" & End Pin "B"
        L.marker([startSelected.latitude, startSelected.longitude], {
          icon: createRouteEndpointIcon("A", true),
        })
          .bindPopup(`<b>Origin (A):</b><br/>${startSelected.display_name}`)
          .addTo(routePointsLayerRef.current);

        L.marker([endSelected.latitude, endSelected.longitude], {
          icon: createRouteEndpointIcon("B", false),
        })
          .bindPopup(`<b>Destination (B):</b><br/>${endSelected.display_name}`)
          .addTo(routePointsLayerRef.current);

        // 4. Place individual GIS hazard markers for all defects along the corridor
        hazardMarkersRef.current = {};
        if (data.hazards_along_route && data.hazards_along_route.length > 0) {
          data.hazards_along_route.forEach((h) => {
            const hMarker = L.marker([h.latitude, h.longitude], {
              icon: createGisMarkerIcon(h.hazard_type, h.status === "verified", false),
            });

            hMarker.bindPopup(buildPopupHtml(h));

            hMarker.on("click", () => {
              setSelectedHazardId(h.id);
              const cardEl = document.getElementById(`defect-card-${h.id}`);
              if (cardEl) {
                cardEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            });

            hMarker.addTo(routePointsLayerRef.current);
            hazardMarkersRef.current[h.id] = hMarker;
          });
        }

        // Fit map bounds smoothly to the complete route
        mapInstanceRef.current.fitBounds(coreRouteLayer.getBounds(), {
          padding: [50, 50],
        });
      }
    } catch (err) {
      setRouteError(
        err.response?.data?.detail || "Route planning failed. Please try a different route or verify network access."
      );
    } finally {
      setRouteLoading(false);
    }
  };

  const handleClearRoute = () => {
    setRouteResult(null);
    setRouteError("");
    setStartQuery("");
    setStartSelected(null);
    setEndQuery("");
    setEndSelected(null);
    setSelectedHazardId(null);
    hazardMarkersRef.current = {};
    if (routeLayerRef.current) routeLayerRef.current.clearLayers();
    if (routePointsLayerRef.current) routePointsLayerRef.current.clearLayers();
  };

  // Zoom to and highlight corresponding marker when a defect card is clicked
  const handleDefectCardClick = (hazard) => {
    setSelectedHazardId(hazard.id);
    if (mapInstanceRef.current) {
      mapInstanceRef.current.flyTo([hazard.latitude, hazard.longitude], 16, { duration: 0.8 });
      const targetMarker = hazardMarkersRef.current[hazard.id];
      if (targetMarker) {
        targetMarker.openPopup();
      }
    }
  };

  const hazardCount = routeResult?.hazards_along_route?.length || 0;

  return (
    <div className="page-container map-page">
      <Header
        eyebrow="ROAD INTELLIGENCE & GIS ROUTE PLANNER"
        title="Interactive Hazard Map & Route Intelligence"
        onRefresh={onRefresh}
        loading={loading}
        totalReports={reports.length}
      />

      {/* Main 35% / 65% Two-Column Responsive Shell */}
      <div className="map-view-shell">
        {/* Left Panel: 35% Width - Route Planning, Controls, & Identified Defect Cards */}
        <aside className="map-controls-panel">
          {/* View Mode Switcher */}
          <div className="tab-pill-group">
            <button
              className={`tab-pill ${activeTab === "routing" ? "active" : ""}`}
              onClick={() => setActiveTab("routing")}
            >
              <Route size={15} />
              <span>Route Planner</span>
            </button>
            <button
              className={`tab-pill ${activeTab === "monitoring" ? "active" : ""}`}
              onClick={() => setActiveTab("monitoring")}
            >
              <Layers size={15} />
              <span>Area Monitoring</span>
            </button>
          </div>

          {activeTab === "routing" ? (
            /* ========================================================
               TAB 1: ROUTE PLANNER & IDENTIFIED DEFECTS ALONG ROUTE
               ======================================================== */
            <div className="routing-controls">
              <div className="panel-title-row">
                <Route size={18} color="#059669" />
                <h3>Intelligent Route Scanner</h3>
              </div>
              <p className="route-explainer">
                Computes driving corridors across any road network and scans the entire geometry
                for community-reported potholes and road hazards.
              </p>

              {/* Origin & Destination Inputs Form */}
              <form onSubmit={handleCalculateRoute} className="route-form">
                {/* Origin Field */}
                <div className="route-field origin-field">
                  <div className="field-label-row">
                    <label>Origin (Start Location)</label>
                    <button
                      type="button"
                      className="use-gps-link"
                      onClick={handleUseCurrentGpsAsOrigin}
                    >
                      <LocateFixed size={12} />
                      <span>Use Current GPS</span>
                    </button>
                  </div>

                  <div className="input-with-icon">
                    <MapPin size={16} className="input-icon green" />
                    <input
                      ref={startInputRef}
                      type="text"
                      placeholder="Search origin city, street or landmark..."
                      value={startQuery}
                      onChange={(e) => {
                        setStartQuery(e.target.value);
                        setStartSelected(null);
                      }}
                    />
                    {startLoading && <Loader2 size={15} className="input-loader spin" />}

                    {/* Origin Autocomplete Dropdown */}
                    {startSuggestions.length > 0 && !startSelected && (
                      <div className="autocomplete-dropdown">
                        {startSuggestions.map((item, idx) => (
                          <div
                            key={idx}
                            className="autocomplete-item"
                            onClick={() => {
                              setStartSelected(item);
                              setStartQuery(item.display_name);
                              setStartSuggestions([]);
                            }}
                          >
                            <MapPin size={15} className="auto-icon green" />
                            <div className="auto-text">
                              <div className="auto-title-row">
                                <strong>{item.name || item.display_name.split(",")[0]}</strong>
                                {item.type && <span className="place-type-pill">{item.type}</span>}
                              </div>
                              <small className="auto-subtext">
                                {[item.locality, item.district, item.city, item.state]
                                  .filter(Boolean)
                                  .filter((v, i, a) => a.indexOf(v) === i)
                                  .join(" • ") || item.display_name}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {startNoResults && (
                    <div className="no-results-notice">No locations found.</div>
                  )}

                  {startSelected ? (
                    <span className="coords-confirmed">
                      ✓ Confirmed: ({startSelected.latitude.toFixed(4)},{" "}
                      {startSelected.longitude.toFixed(4)})
                      {startSelected.accuracy ? ` • ±${Math.round(startSelected.accuracy)}m` : ""}
                    </span>
                  ) : (
                    startQuery.length > 2 && (
                      <span className="coords-pending">
                        Select a suggestion to confirm coordinates
                      </span>
                    )
                  )}

                  {/* GPS Origin Warning Banner if approximate position detected */}
                  {gpsOriginWarning && (
                    <div className="gps-origin-warning-banner">
                      <div className="warning-banner-top">
                        <AlertTriangle size={15} color="#d97706" />
                        <strong>Approximate Network Location Detected</strong>
                      </div>
                      <p className="warning-banner-desc">
                        {gpsOriginWarning}
                      </p>
                      <div className="warning-banner-actions">
                        <button
                          type="button"
                          className="gps-btn primary small"
                          onClick={handleFocusManualOrigin}
                        >
                          <MapPin size={12} />
                          <span>Type Origin Manually</span>
                        </button>
                        <button
                          type="button"
                          className="gps-btn secondary small"
                          onClick={handleConfirmApproximateOrigin}
                        >
                          <CheckCircle2 size={12} />
                          <span>Use This Location Anyway</span>
                        </button>
                      </div>
                    </div>
                  )}

                  {/* GPS Diagnostic Card in Route Planning */}
                  {gpsDiagnosticVisible && (
                    <GpsDiagnosticCard
                      loading={gpsLoading}
                      location={gpsLocation}
                      accuracy={gpsAccuracy}
                      timestamp={gpsTimestamp}
                      status={gpsStatus}
                      statusMessage={gpsStatusMessage}
                      address={gpsAddress}
                      error={geoError}
                      onRefresh={() => acquireGpsLocation({ setAsOrigin: true })}
                      onClear={handleClearGps}
                      onManualInput={handleFocusManualOrigin}
                      onConfirmApproximate={handleConfirmApproximateOrigin}
                      compact={false}
                    />
                  )}
                </div>

                {/* Destination Field */}
                <div className="route-field dest-field">
                  <label className="field-label">Destination (End Location)</label>
                  <div className="input-with-icon">
                    <MapPin size={16} className="input-icon red" />
                    <input
                      type="text"
                      placeholder="Search destination city, street or landmark..."
                      value={endQuery}
                      onChange={(e) => {
                        setEndQuery(e.target.value);
                        setEndSelected(null);
                      }}
                    />
                    {endLoading && <Loader2 size={15} className="input-loader spin" />}

                    {/* Destination Autocomplete Dropdown */}
                    {endSuggestions.length > 0 && !endSelected && (
                      <div className="autocomplete-dropdown">
                        {endSuggestions.map((item, idx) => (
                          <div
                            key={idx}
                            className="autocomplete-item"
                            onClick={() => {
                              setEndSelected(item);
                              setEndQuery(item.display_name);
                              setEndSuggestions([]);
                            }}
                          >
                            <MapPin size={15} className="auto-icon red" />
                            <div className="auto-text">
                              <div className="auto-title-row">
                                <strong>{item.name || item.display_name.split(",")[0]}</strong>
                                {item.type && <span className="place-type-pill">{item.type}</span>}
                              </div>
                              <small className="auto-subtext">
                                {[item.locality, item.district, item.city, item.state]
                                  .filter(Boolean)
                                  .filter((v, i, a) => a.indexOf(v) === i)
                                  .join(" • ") || item.display_name}
                              </small>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>

                  {endNoResults && (
                    <div className="no-results-notice">No locations found.</div>
                  )}

                  {endSelected ? (
                    <span className="coords-confirmed">
                      ✓ Confirmed: ({endSelected.latitude.toFixed(4)},{" "}
                      {endSelected.longitude.toFixed(4)})
                    </span>
                  ) : (
                    endQuery.length > 2 && (
                      <span className="coords-pending">
                        Select a suggestion to confirm coordinates
                      </span>
                    )
                  )}
                </div>

                {/* Configurable Corridor Width */}
                <div className="route-field corridor-field">
                  <div className="field-label-row">
                    <label>Hazard Scan Corridor Width</label>
                    <Sliders size={13} color="#64748b" />
                  </div>
                  <select
                    className="corridor-select"
                    value={corridorKm}
                    onChange={(e) => setCorridorKm(parseFloat(e.target.value))}
                  >
                    <option value={0.1}>100 meters (Direct Road Surface)</option>
                    <option value={0.25}>250 meters (Immediate Roadway)</option>
                    <option value={0.5}>500 meters (Standard Corridor)</option>
                    <option value={1.0}>1.0 km (Extended Corridor)</option>
                    <option value={2.0}>2.0 km (Wide Area Scan)</option>
                    <option value={5.0}>5.0 km (Regional Corridor)</option>
                  </select>
                </div>

                {routeError && <p className="control-error">{routeError}</p>}

                <div className="route-form-actions">
                  <button
                    type="submit"
                    className="primary-btn full-width"
                    disabled={routeLoading || !startSelected || !endSelected}
                  >
                    {routeLoading ? (
                      <>
                        <Loader2 size={16} className="spin" />
                        <span>Scanning Driving Corridor...</span>
                      </>
                    ) : (
                      <>
                        <Route size={16} />
                        <span>Calculate Safe Route</span>
                      </>
                    )}
                  </button>

                  {(routeResult || startSelected || endSelected) && (
                    <button
                      type="button"
                      className="secondary-btn full-width"
                      onClick={handleClearRoute}
                    >
                      Clear Route
                    </button>
                  )}
                </div>
              </form>

              {/* ========================================================
                  ROUTE SUMMARY METRICS & DEFECT CARDS
                  ======================================================== */}
              {routeResult && (
                <div className="route-summary-panel">
                  {/* Compact 4-Metric Grid */}
                  <div className="route-metrics-grid">
                    <div className="route-metric-card">
                      <div className="metric-icon-wrap blue">
                        <Route size={16} />
                      </div>
                      <div className="metric-data">
                        <span className="metric-label">Route Distance</span>
                        <strong className="metric-value">{routeResult.distance_km} km</strong>
                      </div>
                    </div>

                    <div className="route-metric-card">
                      <div className="metric-icon-wrap emerald">
                        <Clock size={16} />
                      </div>
                      <div className="metric-data">
                        <span className="metric-label">Est. Drive Time</span>
                        <strong className="metric-value">{formatDuration(routeResult.duration_minutes)}</strong>
                      </div>
                    </div>

                    <div className="route-metric-card">
                      <div className="metric-icon-wrap purple">
                        <Sliders size={16} />
                      </div>
                      <div className="metric-data">
                        <span className="metric-label">Scan Corridor</span>
                        <strong className="metric-value">
                          {corridorKm < 1 ? `${Math.round(corridorKm * 1000)} m` : `${corridorKm} km`}
                        </strong>
                      </div>
                    </div>

                    <div className={`route-metric-card ${hazardCount > 0 ? "has-hazards" : "hazard-free"}`}>
                      <div className={`metric-icon-wrap ${hazardCount > 0 ? "red" : "green"}`}>
                        {hazardCount > 0 ? <AlertTriangle size={16} /> : <ShieldCheck size={16} />}
                      </div>
                      <div className="metric-data">
                        <span className="metric-label">Identified Hazards</span>
                        <strong className="metric-value">
                          {hazardCount} {hazardCount === 1 ? "Defect" : "Defects"}
                        </strong>
                      </div>
                    </div>
                  </div>

                  {/* Hazard Advisory Banner */}
                  <div className={`hazard-advisory-card ${hazardCount > 0 ? "warning" : "safe"}`}>
                    <div className="advisory-icon-col">
                      {hazardCount > 0 ? <AlertTriangle size={20} /> : <ShieldCheck size={20} />}
                    </div>
                    <div className="advisory-content-col">
                      <h6>
                        {hazardCount > 0
                          ? `${hazardCount} Road Hazard(s) Found Along Corridor`
                          : "No Recorded Road Hazards Within Selected Corridor"}
                      </h6>
                      <p>{routeResult.hazard_summary.advisory}</p>
                    </div>
                  </div>

                  {/* Identified Defects Along Route List */}
                  {hazardCount > 0 ? (
                    <div className="route-hazards-section">
                      <div className="hazards-section-header">
                        <div className="hazards-section-title">
                          <AlertTriangle size={15} className="hazard-title-icon" />
                          <h5>Identified Defects Along Route</h5>
                          <span className="hazards-count-badge">{hazardCount}</span>
                        </div>
                        <span className="hazards-section-hint">Click a card to focus on map</span>
                      </div>
                      <p className="hazards-section-sub">
                        Scanned across all {routeResult.distance_km} km ({corridorKm < 1 ? `${Math.round(corridorKm * 1000)}m` : `${corridorKm}km`} corridor), ordered from origin to destination:
                      </p>

                      <div className="defects-card-list">
                        {routeResult.hazards_along_route.map((h, i) => (
                          <DefectCard
                            key={h.id || i}
                            hazard={h}
                            isSelected={selectedHazardId === h.id}
                            onClick={() => handleDefectCardClick(h)}
                          />
                        ))}
                      </div>
                    </div>
                  ) : (
                    <div className="neutral-empty-hazards-card">
                      <div className="neutral-empty-icon">
                        <ShieldCheck size={22} color="#059669" />
                      </div>
                      <div className="neutral-empty-body">
                        <h6>Clear Route Corridor ({corridorKm < 1 ? `${Math.round(corridorKm * 1000)}m` : `${corridorKm}km`} scan)</h6>
                        <p>
                          RoadSense inspected the entire {routeResult.distance_km} km route geometry. No active road hazards are currently logged in the community database for this corridor.
                        </p>
                        <small className="neutral-empty-note">
                          Absence of recorded reports reflects pending community data and does not prove the absence of road defects.
                        </small>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            /* ========================================================
               TAB 2: AREA MONITORING & GENERAL MAP SEARCH
               ======================================================== */
            <div className="monitoring-controls">
              {/* Location Autocomplete Search */}
              <div className="search-field-container">
                <label className="field-label">Search Any City, Town or Road</label>
                <div className="input-with-icon">
                  <Search size={16} className="input-icon" />
                  <input
                    type="text"
                    placeholder="e.g. Vijayawada, Agiripalli, Nuzvid..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchLoading && <Loader2 size={15} className="input-loader spin" />}
                  {searchQuery && (
                    <button
                      type="button"
                      className="clear-input-btn"
                      onClick={() => {
                        setSearchQuery("");
                        setSearchResults([]);
                      }}
                    >
                      <X size={14} />
                    </button>
                  )}

                  {/* Autocomplete Dropdown */}
                  {searchResults.length > 0 && (
                    <div className="autocomplete-dropdown">
                      {searchResults.map((item, idx) => (
                        <div
                          key={idx}
                          className="autocomplete-item"
                          onClick={() => handleSelectMapSearchResult(item)}
                        >
                          <MapPin size={15} className="auto-icon" />
                          <div className="auto-text">
                            <div className="auto-title-row">
                              <strong>{item.name || item.display_name.split(",")[0]}</strong>
                              {item.type && <span className="place-type-pill">{item.type}</span>}
                            </div>
                            <small className="auto-subtext">
                              {[item.locality, item.district, item.city, item.state]
                                .filter(Boolean)
                                .filter((v, i, a) => a.indexOf(v) === i)
                                .join(" • ") || item.display_name}
                            </small>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {searchNoResults && (
                  <div className="no-results-notice">
                    No matching locations found for "{searchQuery}". Try adding city or state.
                  </div>
                )}
              </div>

              {/* Real GPS Location Button */}
              <div className="gps-action-group">
                <button
                  className="locate-btn"
                  onClick={handleLocateMe}
                  disabled={gpsLoading}
                >
                  {gpsLoading ? (
                    <Loader2 size={16} className="spin" />
                  ) : (
                    <Crosshair size={16} />
                  )}
                  <span>
                    {gpsLoading ? "Acquiring GPS Position..." : "Use My Current Location"}
                  </span>
                </button>

                {gpsLocation && (
                  <button
                    className={`live-track-btn ${isLiveTracking ? "active" : ""}`}
                    onClick={toggleLiveTracking}
                    title="Toggle continuous GPS tracking"
                  >
                    <Radio size={14} />
                    <span>{isLiveTracking ? "Tracking On" : "Track Me"}</span>
                  </button>
                )}
              </div>

              {/* GPS Diagnostic Card in Map View */}
              {(gpsLocation || gpsLoading || geoError) && (
                <GpsDiagnosticCard
                  loading={gpsLoading}
                  location={gpsLocation}
                  accuracy={gpsAccuracy}
                  timestamp={gpsTimestamp}
                  status={gpsStatus}
                  statusMessage={gpsStatusMessage}
                  address={gpsAddress}
                  error={geoError}
                  onRefresh={() => acquireGpsLocation({ setAsOrigin: false, setAsMonitoringCenter: true })}
                  onClear={handleClearGps}
                  onManualInput={() => {
                    const searchInput = document.querySelector(".search-field-container input");
                    if (searchInput) searchInput.focus();
                  }}
                  compact={true}
                />
              )}

              {/* Monitored Area Panel (When an Area Center is Active) */}
              {monitoringCenter ? (
                <div className="monitored-area-container">
                  <div className="monitored-area-header-card">
                    <div className="area-header-top">
                      <div className="area-title-badge">
                        <Layers size={14} />
                        <span>Active Monitored Center</span>
                      </div>
                      <button
                        type="button"
                        className="clear-area-btn"
                        onClick={handleClearMonitoringCenter}
                        title="Clear monitored area center"
                      >
                        <X size={14} />
                        <span>Change Area</span>
                      </button>
                    </div>

                    <div className="area-center-name">
                      <strong>{monitoringCenter.display_name}</strong>
                    </div>

                    <div className="area-center-coords">
                      <span>Coordinates: <code>{monitoringCenter.latitude.toFixed(4)}, {monitoringCenter.longitude.toFixed(4)}</code></span>
                      {monitoringCenter.accuracy && (
                        <span> • ±{Math.round(monitoringCenter.accuracy)}m accuracy</span>
                      )}
                    </div>

                    {/* Radius Selector Pills */}
                    <div className="monitoring-radius-picker">
                      <span className="radius-picker-label">Scan Radius:</span>
                      <div className="radius-pills-row">
                        {[5, 10, 25, 50].map((r) => (
                          <button
                            key={r}
                            type="button"
                            className={`radius-pill ${monitoringRadiusKm === r ? "active" : ""}`}
                            onClick={() => setMonitoringRadiusKm(r)}
                          >
                            {r} km
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* Hazards In Monitored Area */}
                  <div className="area-hazards-section">
                    <div className="hazards-section-header">
                      <div className="hazards-section-title">
                        <AlertTriangle size={15} className="hazard-title-icon" />
                        <h5>Hazards in Monitored Area</h5>
                        <span className="hazards-count-badge">{areaHazards.length}</span>
                      </div>
                      <span className="hazards-section-hint">Within {monitoringRadiusKm} km radius</span>
                    </div>

                    {areaHazards.length > 0 ? (
                      <div className="defects-card-list">
                        {areaHazards.map((h) => (
                          <DefectCard
                            key={h.id}
                            hazard={h}
                            isSelected={selectedAreaHazardId === h.id}
                            onClick={() => handleAreaHazardClick(h)}
                          />
                        ))}
                      </div>
                    ) : (
                      <div className="neutral-empty-hazards-card">
                        <div className="neutral-empty-icon">
                          <ShieldCheck size={22} color="#059669" />
                        </div>
                        <div className="neutral-empty-body">
                          <h6>Zero Hazards Recorded ({monitoringRadiusKm} km radius)</h6>
                          <p>
                            RoadSense inspected all community reports within {monitoringRadiusKm} km of {monitoringCenter.display_name.split(",")[0]}. No road hazards are currently logged for this area.
                          </p>
                          <small className="neutral-empty-note">
                            Absence of recorded reports reflects pending community data and does not prove the absence of road defects.
                          </small>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Empty Prompt when no Area Center is Selected */
                <div className="area-empty-prompt">
                  <div className="area-prompt-icon">
                    <Layers size={26} color="#059669" />
                  </div>
                  <h5>Select an Area to Monitor</h5>
                  <p>
                    Search for any city, town, or village above (e.g. <b>Vijayawada</b>, <b>Agiripalli</b>, <b>Nuzvid</b>) or click <b>Use My Current Location</b> to scan a 5 to 50 km radius for community road hazards.
                  </p>
                  <div className="quick-suggestions-row">
                    <span>Quick Scan Areas:</span>
                    <button
                      type="button"
                      className="quick-area-btn"
                      onClick={() => handleSelectMapSearchResult({
                        display_name: "Vijayawada, NTR District, Andhra Pradesh, India",
                        latitude: 16.506174,
                        longitude: 80.648015,
                      })}
                    >
                      Vijayawada
                    </button>
                    <button
                      type="button"
                      className="quick-area-btn"
                      onClick={() => handleSelectMapSearchResult({
                        display_name: "Agiripalli, Eluru District, Andhra Pradesh, India",
                        latitude: 16.6667,
                        longitude: 80.8000,
                      })}
                    >
                      Agiripalli
                    </button>
                    <button
                      type="button"
                      className="quick-area-btn"
                      onClick={() => handleSelectMapSearchResult({
                        display_name: "Nuzvid, Eluru District, Andhra Pradesh, India",
                        latitude: 16.7850,
                        longitude: 80.8465,
                      })}
                    >
                      Nuzvid
                    </button>
                  </div>
                </div>
              )}

              {/* Selected Coordinate Details */}
              {clickedCoords ? (
                <div className="clicked-coords-card">
                  <div className="card-top">
                    <h4>📍 Point Selected on Map</h4>
                    <button
                      className="close-pin-btn"
                      onClick={() => setClickedCoords(null)}
                    >
                      <X size={14} />
                    </button>
                  </div>
                  <p className="clicked-addr">{clickedAddress}</p>
                  <small>
                    Lat: <code>{clickedCoords.latitude}</code> | Lon:{" "}
                    <code>{clickedCoords.longitude}</code>
                  </small>
                  <button
                    className="primary-btn full-width"
                    style={{ marginTop: 10 }}
                    onClick={() =>
                      onOpenReportModalWithCoords({
                        ...clickedCoords,
                        location_name:
                          clickedAddress && !clickedAddress.startsWith("Resolving")
                            ? clickedAddress
                            : "",
                      })
                    }
                  >
                    <PlusCircle size={15} />
                    <span>Report Hazard at This Spot</span>
                  </button>
                </div>
              ) : (
                <p className="click-tip">
                  💡 Tip: Click anywhere on the map to pin exact coordinates, reverse-geocode
                  the address, and submit a road hazard report.
                </p>
              )}
            </div>
          )}
        </aside>

        {/* Right Panel: 65% Width - Full-Height Interactive GIS Leaflet Map */}
        <section className="map-view-area">
          <div ref={mapContainerRef} className="leaflet-map-element" />

          {/* Floating Map Legend (Collapsible) */}
          <div className={`map-floating-legend ${isLegendOpen ? "is-expanded" : "is-collapsed"}`}>
            <button
              type="button"
              className="legend-toggle-btn"
              onClick={() => setIsLegendOpen(!isLegendOpen)}
              title={isLegendOpen ? "Collapse Map Legend" : "Expand Map Legend"}
            >
              <Layers size={14} />
              <span>Map Legend</span>
              {isLegendOpen ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            </button>

            {isLegendOpen && (
              <div className="legend-dropdown-body">
                <div className="legend-category-list">
                  <div className="legend-row">
                    <span className="legend-swatch" style={{ background: "#dc2626" }}></span>
                    <span>Pothole</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch" style={{ background: "#d97706" }}></span>
                    <span>Cracked Road</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch" style={{ background: "#ea580c" }}></span>
                    <span>Damaged Surface</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch" style={{ background: "#0284c7" }}></span>
                    <span>Waterlogging</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-swatch" style={{ background: "#7c3aed" }}></span>
                    <span>Obstruction</span>
                  </div>
                </div>
                <div className="legend-status-list">
                  <div className="legend-row">
                    <span className="legend-status-badge verified">✓</span>
                    <span>Verified Defect</span>
                  </div>
                  <div className="legend-row">
                    <span className="legend-status-badge pending">⏳</span>
                    <span>Pending Review</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Map Overlay Live Reports Badge */}
          <div className="map-overlay-badge">
            <span className="pulse-dot"></span>
            <span>
              {activeTab === "routing"
                ? routeResult
                  ? `Route Corridor: ${hazardCount} Hazard${hazardCount === 1 ? "" : "s"} (${corridorKm < 1 ? Math.round(corridorKm * 1000) + "m" : corridorKm + "km"} corridor)`
                  : "Route Planner (No Route Active)"
                : monitoringCenter
                  ? `Area Monitoring: ${areaHazards.length} Hazard${areaHazards.length === 1 ? "" : "s"} (${monitoringRadiusKm} km radius)`
                  : "Area Monitoring (Select an Area)"}
            </span>
          </div>
        </section>
      </div>
    </div>
  );
}

/* ===================================================
   IDENTIFIED DEFECT CARD COMPONENT
   =================================================== */
function DefectCard({ hazard, isSelected, onClick }) {
  const theme = getHazardTheme(hazard.hazard_type);
  const isVerified = hazard.status === "verified";
  const imgUrl = getMediaUrl(hazard.image_url);

  return (
    <div
      id={`defect-card-${hazard.id}`}
      className={`defect-item-card ${isVerified ? "is-verified" : "is-pending"} ${
        isSelected ? "is-selected" : ""
      }`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      title="Click to view and highlight on map"
    >
      {/* Left Media Thumbnail / Placeholder */}
      <div className="defect-media-thumb">
        {imgUrl ? (
          <img
            src={imgUrl}
            alt={hazard.hazard_type}
            className="defect-real-thumb"
            onError={(e) => {
              e.currentTarget.style.display = "none";
              const fb = e.currentTarget.nextElementSibling;
              if (fb) fb.style.display = "flex";
            }}
          />
        ) : null}
        <div
          className="defect-thumb-fallback"
          style={{
            display: imgUrl ? "none" : "flex",
            backgroundColor: theme.lightBg,
            borderColor: theme.border,
          }}
        >
          {theme.icon}
        </div>
      </div>

      {/* Main Content Details */}
      <div className="defect-card-info">
        <div className="defect-top-row">
          <div
            className="defect-category-pill"
            style={{
              color: theme.color,
              backgroundColor: theme.lightBg,
              borderColor: theme.border,
            }}
          >
            {theme.iconSmall}
            <span>{hazard.hazard_type}</span>
          </div>

          <div className="defect-status-group">
            {hazard.severity && (
              <span className={`severity-tag severity-${hazard.severity.toLowerCase()}`}>
                {hazard.severity}
              </span>
            )}
            <span className={`status-badge-compact ${isVerified ? "verified" : "pending"}`}>
              {isVerified ? (
                <>
                  <CheckCircle2 size={11} />
                  <span>Verified</span>
                </>
              ) : (
                <>
                  <Clock size={11} />
                  <span>Pending Review</span>
                </>
              )}
            </span>
          </div>
        </div>

        <div className="defect-loc-name" title={hazard.location_name}>
          <MapPin size={13} className="loc-icon" />
          <span>{hazard.location_name}</span>
        </div>

        <p className="defect-desc-text">{hazard.description}</p>

        <div className="defect-meta-badges">
          {typeof hazard.distance_from_center_km === "number" && (
            <span className="meta-badge center-dist" title="Distance from monitored area center">
              <Compass size={11} />
              <span>{hazard.distance_from_center_km.toFixed(1)} km from center</span>
            </span>
          )}
          {typeof hazard.route_km === "number" && (
            <span className="meta-badge journey-km" title="Approximate distance along travel route">
              <Navigation size={11} />
              <span>Km {hazard.route_km.toFixed(1)} of journey</span>
            </span>
          )}
          {typeof hazard.distance_from_route_km === "number" && (
            <span className="meta-badge offset-m" title="Distance from center line of driving route">
              <span>{Math.round(hazard.distance_from_route_km * 1000)}m off route</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
