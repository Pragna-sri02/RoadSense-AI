import React from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Compass,
  Map,
  MessageSquare,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import Header from "../components/Header";
import StatCard from "../components/StatCard";
import { API_BASE_URL } from "../services/api";

export default function Dashboard({
  health,
  reports = [],
  analytics,
  loading = false,
  onRefresh,
  onOpenReportModal,
}) {
  const totalReports = analytics?.total_reports ?? reports.length;
  const verifiedReports = analytics?.verified_reports ?? 0;
  const unverifiedReports = analytics?.unverified_reports ?? 0;
  const roadHealth = analytics?.road_health;
  const hazardsByType = analytics?.hazards_by_type || {};

  return (
    <div className="page-container">
      <Header
        eyebrow="ROAD INTELLIGENCE PLATFORM"
        title="Dashboard Overview"
        onRefresh={onRefresh}
        loading={loading}
        onOpenReportModal={onOpenReportModal}
        totalReports={totalReports}
      />

      <section className="welcome-panel">
        <div>
          <span className="welcome-tag">LIVE ROAD INTELLIGENCE</span>
          <h2>Understand and monitor your roads.</h2>
          <p>
            Monitor community road reports, review verified hazards,
            track recurrence hotspots, and explore intelligent route planning.
          </p>
          <div className="welcome-buttons">
            <Link to="/monitoring" className="welcome-btn-primary">
              <Map size={16} />
              <span>Explore Interactive Map</span>
            </Link>
            <Link to="/assistant" className="welcome-btn-secondary">
              <MessageSquare size={16} />
              <span>Ask AI Assistant</span>
            </Link>
          </div>
        </div>

        <div className="welcome-icon">
          <Compass size={54} color="#ffffff" />
        </div>
      </section>

      <section className="section-heading">
        <div>
          <h2>System Summary</h2>
          <p>Real-time metrics grounded in your SQLite database</p>
        </div>
      </section>

      <section className="stats-grid">
        <StatCard
          label="Total Reports"
          value={totalReports}
          subtext="All community-submitted reports"
          icon={AlertTriangle}
          variant="blue"
          loading={loading}
        />

        <StatCard
          label="Verified Reports"
          value={verifiedReports}
          subtext="Corroborated by inspection or field audits"
          icon={ShieldCheck}
          variant="green"
          badgeText={
            totalReports > 0
              ? `${Math.round((verifiedReports / totalReports) * 100)}% verified`
              : null
          }
          badgeType="success"
          loading={loading}
        />

        <StatCard
          label="Pending Review"
          value={unverifiedReports}
          subtext="Crowd-sourced reports awaiting verification"
          icon={Activity}
          variant="orange"
          badgeText={unverifiedReports > 0 ? "Needs Review" : null}
          badgeType="warning"
          loading={loading}
        />

        <StatCard
          label="Road Condition Score"
          value={
            roadHealth?.score == null ? "N/A" : `${roadHealth.score}/100`
          }
          subtext={
            roadHealth?.label || "Requires >= 3 reports for calculation"
          }
          icon={TrendingUp}
          variant="purple"
          badgeText={
            roadHealth?.score != null
              ? roadHealth.score >= 70
                ? "Good"
                : "Caution"
              : "No Data"
          }
          badgeType={
            roadHealth?.score != null
              ? roadHealth.score >= 70
                ? "success"
                : "warning"
              : "neutral"
          }
          loading={loading}
        />
      </section>

      <section className="content-grid">
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Recent Road Reports</h2>
              <p>Latest defects logged into the RoadSense platform</p>
            </div>
            <Link to="/reports" className="panel-link">
              View All <ArrowRight size={14} />
            </Link>
          </div>

          {loading ? (
            <p className="empty-state">Loading reports from database...</p>
          ) : reports.length === 0 ? (
            <div className="empty-state-box">
              <AlertTriangle size={36} color="#94a3b8" />
              <h3>No Road Reports Submitted Yet</h3>
              <p>
                The RoadSense database currently contains zero hazard entries for this area.
                Be the first to submit a community road defect report.
              </p>
              <div className="empty-actions">
                <button className="primary-btn" onClick={onOpenReportModal}>
                  Submit First Report
                </button>
              </div>
            </div>
          ) : (
            <div className="report-list">
              {reports.slice(0, 5).map((report) => (
                <div className="report-row" key={report.id}>
                  <div
                    className={`report-icon ${
                      report.hazard_type.toLowerCase().includes("pothole")
                        ? "red"
                        : report.hazard_type.toLowerCase().includes("water")
                        ? "blue"
                        : "amber"
                    }`}
                  >
                    <AlertTriangle size={18} />
                  </div>

                  <div className="report-info">
                    <div className="report-title-line">
                      <strong>{report.hazard_type}</strong>
                    </div>
                    <p className="report-location">📍 {report.location_name}</p>
                    <p className="report-desc-preview">{report.description}</p>
                  </div>

                  <div className="report-meta-col">
                    <span
                      className={`badge ${
                        report.status === "verified"
                          ? "badge-verified"
                          : "badge-pending"
                      }`}
                    >
                      {report.status}
                    </span>
                    <span className="report-date">
                      {new Date(report.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <div className="right-column-stack">
          <article className="panel">
            <div className="panel-heading">
              <div>
                <h2>Hazard Types</h2>
                <p>Distribution across reported defects</p>
              </div>
              <Link to="/analytics" className="panel-link">
                Details <ArrowRight size={14} />
              </Link>
            </div>

            {Object.keys(hazardsByType).length === 0 ? (
              <p className="empty-state">No hazard categories recorded yet.</p>
            ) : (
              <div className="hazard-bars">
                {Object.entries(hazardsByType).map(([hazard, count]) => {
                  const pct =
                    totalReports > 0
                      ? Math.round((count / totalReports) * 100)
                      : 0;
                  return (
                    <div className="hazard-bar-item" key={hazard}>
                      <div className="hazard-bar-labels">
                        <span className="hazard-name">{hazard}</span>
                        <span className="hazard-count">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="progress-track">
                        <div
                          className="progress-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </article>

          <article className="panel">
            <div className="panel-heading">
              <div>
                <h2>System Connectivity</h2>
                <p>FastAPI backend status</p>
              </div>
            </div>

            <div className="system-status">
              <span
                className={`status-dot ${health?.status === "healthy" ? "online" : ""}`}
              />
              <div>
                <strong>
                  {health?.status === "healthy"
                    ? "RoadSense API Connected"
                    : "Connecting to Backend..."}
                </strong>
                <p>
                  {health?.timestamp
                    ? `Live ping: ${new Date(health.timestamp).toLocaleTimeString()}`
                    : `Backend endpoint: ${API_BASE_URL}`}
                </p>
              </div>
            </div>

            <div className="system-note">
              <ShieldCheck size={20} />
              <p>
                Community reports default to <em>unverified</em>.
                Only corroborated hazards impact safety routing advisories.
              </p>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
