import React, { useEffect, useState } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { AlertTriangle, Loader2, Navigation, RefreshCw } from "lucide-react";

import Sidebar from "./components/Sidebar";
import Dashboard from "./pages/Dashboard";
import RoadMap from "./pages/RoadMap";
import Reports from "./pages/Reports";
import Analytics from "./pages/Analytics";
import Assistant from "./pages/Assistant";
import AuthPage from "./pages/AuthPage";
import { AuthProvider, useAuth } from "./context/AuthContext";

import {
  formatErrorMessage,
  getAnalyticsOverview,
  getHealth,
  getReports,
} from "./services/api";

import "./App.css";

function AuthenticatedApp() {
  const [health, setHealth] = useState(null);
  const [reports, setReports] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Report Modal State
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportModalCoords, setReportModalCoords] = useState(null);

  // Active Route Context (shared between Route Planner & AI Assistant)
  const [activeRouteContext, setActiveRouteContext] = useState(null);

  // Mobile drawer state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  async function loadAllData() {
    setLoading(true);
    setError("");

    try {
      const [healthData, reportsData, analyticsData] = await Promise.all([
        getHealth().catch((err) => {
          throw new Error(formatErrorMessage(err));
        }),
        getReports().catch((err) => {
          throw new Error(formatErrorMessage(err));
        }),
        getAnalyticsOverview().catch((err) => {
          throw new Error(formatErrorMessage(err));
        }),
      ]);

      setHealth(healthData);
      setReports(reportsData);
      setAnalytics(analyticsData);
    } catch (err) {
      setError(
        typeof err === "string"
          ? err
          : err.message || "Failed to connect to RoadSense backend."
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAllData();
  }, []);

  const handleOpenReportModal = (coords = null) => {
    setReportModalCoords(coords);
    setIsReportModalOpen(true);
  };

  const handleCloseReportModal = () => {
    setIsReportModalOpen(false);
    setReportModalCoords(null);
  };

  return (
    <div className="app-shell">
      <Sidebar
        health={health}
        isMobileOpen={isMobileMenuOpen}
        onCloseMobile={() => setIsMobileMenuOpen(false)}
      />

      <main className="main-content">
        {error && (
          <div className="error-message">
            <AlertTriangle size={20} />
            <div className="error-text-col">
              <strong>Connection Error:</strong>
              <span>{error}</span>
            </div>
            <button
              className="retry-btn"
              onClick={loadAllData}
              disabled={loading}
            >
              <RefreshCw size={14} className={loading ? "spin" : ""} />
              <span>Retry</span>
            </button>
          </div>
        )}

        <Routes>
          <Route
            path="/"
            element={
              <Dashboard
                health={health}
                reports={reports}
                analytics={analytics}
                loading={loading}
                onRefresh={loadAllData}
                onOpenReportModal={() => handleOpenReportModal(null)}
              />
            }
          />
          <Route
            path="/monitoring"
            element={
              <RoadMap
                reports={reports}
                loading={loading}
                onRefresh={loadAllData}
                onOpenReportModalWithCoords={(coords) =>
                  handleOpenReportModal(coords)
                }
                onRouteCalculated={(routeCtx) =>
                  setActiveRouteContext(routeCtx)
                }
              />
            }
          />
          <Route
            path="/reports"
            element={
              <Reports
                reports={reports}
                loading={loading}
                onRefresh={loadAllData}
                onOpenReportModal={() => handleOpenReportModal(null)}
                isModalOpen={isReportModalOpen}
                onCloseReportModal={handleCloseReportModal}
                initialCoords={reportModalCoords}
              />
            }
          />
          <Route
            path="/analytics"
            element={
              <Analytics
                reports={reports}
                onRefresh={loadAllData}
              />
            }
          />
          <Route
            path="/assistant"
            element={
              <Assistant
                reports={reports}
                onRefresh={loadAllData}
                activeRouteContext={activeRouteContext}
              />
            }
          />
          {/* Authenticated user redirects for auth routes */}
          <Route path="/login" element={<Navigate to="/" replace />} />
          <Route path="/register" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>

        <footer className="footer">
          RoadSense · AI-Powered Road Intelligence & Safety Platform · Built with FastAPI & React
        </footer>
      </main>
    </div>
  );
}

function RoadSenseAppContent() {
  const { isAuthenticated, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="auth-loading-screen">
        <div className="auth-loading-spinner-wrap">
          <Navigation size={32} color="#38bdf8" />
          <Loader2 size={54} className="spin auth-spinner" color="#0284c7" />
        </div>
        <h3>RoadSense</h3>
        <p>Initializing Road Intelligence Platform...</p>
      </div>
    );
  }

  // When unauthenticated, show the Login page first
  if (!isAuthenticated) {
    return (
      <Routes>
        <Route path="/login" element={<AuthPage initialMode="login" />} />
        <Route path="/register" element={<AuthPage initialMode="register" />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  // When authenticated, render dashboard and application workspace
  return <AuthenticatedApp />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <RoadSenseAppContent />
      </AuthProvider>
    </BrowserRouter>
  );
}
