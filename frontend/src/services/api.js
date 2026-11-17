import axios from "axios";

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://127.0.0.1:8010";

export function getMediaUrl(relativeOrAbsoluteUrl) {
  if (!relativeOrAbsoluteUrl) return null;
  if (
    relativeOrAbsoluteUrl.startsWith("http://") ||
    relativeOrAbsoluteUrl.startsWith("https://")
  ) {
    return relativeOrAbsoluteUrl;
  }
  const cleanPath = relativeOrAbsoluteUrl.startsWith("/")
    ? relativeOrAbsoluteUrl
    : `/${relativeOrAbsoluteUrl}`;
  return `${API_BASE_URL}${cleanPath}`;
}

const api = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  headers: {
    "Content-Type": "application/json",
  },
});

export const AUTH_TOKEN_KEY = "roadsense_auth_token";
export const AUTH_USER_KEY = "roadsense_auth_user";

export function getStoredToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY) || sessionStorage.getItem(AUTH_TOKEN_KEY);
}

export function getStoredUser() {
  try {
    const raw = localStorage.getItem(AUTH_USER_KEY) || sessionStorage.getItem(AUTH_USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredAuth(token, user, rememberMe = true) {
  if (rememberMe) {
    localStorage.setItem(AUTH_TOKEN_KEY, token);
    localStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    sessionStorage.removeItem(AUTH_TOKEN_KEY);
    sessionStorage.removeItem(AUTH_USER_KEY);
  } else {
    sessionStorage.setItem(AUTH_TOKEN_KEY, token);
    sessionStorage.setItem(AUTH_USER_KEY, JSON.stringify(user));
    localStorage.removeItem(AUTH_TOKEN_KEY);
    localStorage.removeItem(AUTH_USER_KEY);
  }
}

export function clearStoredAuth() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
  localStorage.removeItem(AUTH_USER_KEY);
  sessionStorage.removeItem(AUTH_TOKEN_KEY);
  sessionStorage.removeItem(AUTH_USER_KEY);
}

// Request interceptor: automatically attach Authorization header when token exists
api.interceptors.request.use(
  (config) => {
    const token = getStoredToken();
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => Promise.reject(error)
);

export function formatErrorMessage(err) {
  if (!err) return "Unknown error occurred.";
  if (err.response?.data?.detail) {
    if (typeof err.response.data.detail === "string") {
      return err.response.data.detail;
    }
    if (Array.isArray(err.response.data.detail)) {
      return err.response.data.detail
        .map((d) => d.msg || d.message || JSON.stringify(d))
        .join("; ");
    }
  }
  if (
    err.message === "Network Error" ||
    err.code === "ECONNABORTED" ||
    !err.response
  ) {
    return `Unable to connect to RoadSense backend at ${API_BASE_URL}. Ensure the server is running on port 8010.`;
  }
  return err.message || "An unexpected error occurred.";
}

// System Health
export const getHealth = async () => {
  const response = await api.get("/api/health");
  return response.data;
};

// Metadata
export const getCategories = async () => {
  const response = await api.get("/api/meta/categories");
  return response.data;
};

// Road Reports
export const getReports = async (params = {}) => {
  const response = await api.get("/api/reports", { params });
  return response.data;
};

export const getReportsSummary = async () => {
  const response = await api.get("/api/reports/summary");
  return response.data;
};

export const getNearbyReports = async (
  latitude,
  longitude,
  radiusKm = 5,
  status = null
) => {
  const params = { latitude, longitude, radius_km: radiusKm };
  if (status) params.status = status;
  const response = await api.get("/api/reports/nearby", { params });
  return response.data;
};

export const getReport = async (reportId) => {
  const response = await api.get(`/api/reports/${reportId}`);
  return response.data;
};

export const createReport = async (reportData) => {
  const response = await api.post("/api/reports", reportData);
  return response.data;
};

// Computer Vision Pothole & Road Hazard Image Analysis
export const analyzeRoadImage = async (file) => {
  const formData = new FormData();
  formData.append("file", file);
  const response = await api.post("/api/reports/analyze-image", formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  });
  return response.data;
};

export const updateReportStatus = async (reportId, status) => {
  const response = await api.patch(`/api/reports/${reportId}/status`, { status });
  return response.data;
};

export const deleteReport = async (reportId) => {
  const response = await api.delete(`/api/reports/${reportId}`);
  return response.data;
};

// Location Geocoding & Autocomplete
export const searchLocation = async (query, limit = 6, cancelSignal = null) => {
  const response = await api.get("/api/geocode", {
    params: { q: query, limit },
    signal: cancelSignal,
  });
  return response.data;
};

export const reverseGeocode = async (lat, lon) => {
  const response = await api.get("/api/geocode/reverse", {
    params: { lat, lon },
  });
  return response.data;
};

// Route Planning with Configurable Corridor
export const getRoute = async (
  startLat,
  startLon,
  endLat,
  endLon,
  corridorKm = 0.5
) => {
  const response = await api.get("/api/routing/route", {
    params: {
      start_lat: startLat,
      start_lon: startLon,
      end_lat: endLat,
      end_lon: endLon,
      corridor_km: corridorKm,
    },
  });
  return response.data;
};

// Analytics
export const getAnalyticsOverview = async () => {
  const response = await api.get("/api/analytics/overview");
  return response.data;
};

export const getAnalyticsTrends = async (days = 14) => {
  const response = await api.get("/api/analytics/trends", {
    params: { days },
  });
  return response.data;
};

export const getRecurringHazards = async () => {
  const response = await api.get("/api/analytics/recurring");
  return response.data;
};

// AI Assistant
export const askAssistant = async (question, context = {}) => {
  const payload = {
    question,
    latitude: context.latitude ?? null,
    longitude: context.longitude ?? null,
    location_name: context.location_name ?? null,
    origin_lat: context.origin_lat ?? null,
    origin_lon: context.origin_lon ?? null,
    dest_lat: context.dest_lat ?? null,
    dest_lon: context.dest_lon ?? null,
    corridor_km: context.corridor_km ?? null,
    history: context.history ?? null,
    active_origin: context.active_origin ?? null,
    active_destination: context.active_destination ?? null,
    travel_mode: context.travel_mode ?? null,
  };
  const response = await api.post("/api/assistant/ask", payload);
  return response.data;
};

export const getAssistantSuggestions = async () => {
  const response = await api.get("/api/assistant/suggestions");
  return response.data;
};

// Authentication & Session Management APIs
export const registerUser = async (registrationData) => {
  const response = await api.post("/api/auth/register", registrationData);
  return response.data;
};

export const loginUser = async (credentials) => {
  const response = await api.post("/api/auth/login", credentials);
  return response.data;
};

export const getMe = async () => {
  const response = await api.get("/api/auth/me");
  return response.data;
};

export const logoutUser = async () => {
  try {
    const response = await api.post("/api/auth/logout");
    return response.data;
  } catch {
    // Gracefully handle logout network issues
    return { message: "Logged out locally" };
  } finally {
    clearStoredAuth();
  }
};

export default api;
