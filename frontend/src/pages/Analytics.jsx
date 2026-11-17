import React, { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  BarChart2,
  Calendar,
  CheckCircle2,
  Clock,
  Layers,
  MapPin,
  RefreshCw,
  Repeat,
  ShieldAlert,
  ShieldCheck,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Header from "../components/Header";
import StatCard from "../components/StatCard";
import {
  getAnalyticsOverview,
  getAnalyticsTrends,
  getRecurringHazards,
} from "../services/api";

export default function Analytics({ reports = [], onRefresh }) {
  const [analytics, setAnalytics] = useState(null);
  const [trends, setTrends] = useState([]);
  const [recurring, setRecurring] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadData = async () => {
    setLoading(true);
    setError("");
    try {
      const [overviewData, trendsData, recurringData] = await Promise.all([
        getAnalyticsOverview(),
        getAnalyticsTrends(14),
        getRecurringHazards(),
      ]);
      setAnalytics(overviewData);
      setTrends(trendsData.trends || []);
      setRecurring(recurringData.hotspots || []);
    } catch (err) {
      setError("Failed to load analytics: " + (err.response?.data?.detail || err.message));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const total = analytics?.total_reports ?? reports.length;
  const verified = analytics?.verified_reports ?? 0;
  const unverified = analytics?.unverified_reports ?? 0;
  const roadHealth = analytics?.road_health;
  const hazardsByType = analytics?.hazards_by_type || {};
  const topAreas = analytics?.top_areas || [];

  return (
    <div className="page-container">
      <Header
        eyebrow="ANALYTICAL INTELLIGENCE"
        title="Road Analytics & Diagnostics"
        onRefresh={() => {
          loadData();
          if (onRefresh) onRefresh();
        }}
        loading={loading}
        totalReports={total}
      />

      {error && <div className="form-error-alert">{error}</div>}

      {/* Road Health Score Card Deep Dive */}
      <section className="analytics-score-panel">
        <div className="score-badge-circle">
          <span className="score-num">
            {roadHealth?.score != null ? roadHealth.score : "—"}
          </span>
          <span className="score-denom">/ 100</span>
        </div>

        <div className="score-text-area">
          <div className="score-headline">
            <h3>{roadHealth?.label || "Calculating Assessment..."}</h3>
            <span
              className={`badge ${
                roadHealth?.score != null && roadHealth.score >= 70
                  ? "badge-verified"
                  : "badge-pending"
              }`}
            >
              {roadHealth?.score != null ? "Active Formula Score" : "Threshold Not Met"}
            </span>
          </div>

          <p className="score-description">
            {roadHealth?.message ||
              "Grounded condition analysis based on verified versus pending defect density."}
          </p>

          <div className="formula-factors">
            <h4>Documented Scoring Methodology</h4>
            <ul>
              <li>
                <strong>Base Benchmark:</strong> 100 points (Zero recorded defects).
              </li>
              <li>
                <strong>Verified Penalty:</strong> −12 points per verified active hazard.
              </li>
              <li>
                <strong>Pending Penalty:</strong> −4 points per unverified community report.
              </li>
              <li>
                <strong>Minimum Sample:</strong> At least 3 reports required to produce a valid score (prevents skew on small datasets).
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Grid: Breakdown Cards */}
      <section className="analytics-grid-row">
        {/* Category Breakdown */}
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Hazard Categories</h2>
              <p>Breakdown by defect classification</p>
            </div>
            <BarChart2 size={18} color="#64748b" />
          </div>

          {Object.keys(hazardsByType).length === 0 ? (
            <p className="empty-state">No hazard distribution data available.</p>
          ) : (
            <div className="analytics-bars-list">
              {Object.entries(hazardsByType).map(([cat, count]) => {
                const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                  <div key={cat} className="stat-progress-row">
                    <div className="stat-progress-info">
                      <span className="name">{cat}</span>
                      <span className="count">
                        {count} reports ({pct}%)
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

        {/* Verification Ratio */}
        <article className="panel">
          <div className="panel-heading">
            <div>
              <h2>Verification Ratio</h2>
              <p>Inspection confidence distribution</p>
            </div>
            <ShieldCheck size={18} color="#10b981" />
          </div>

          <div className="verification-stat-box">
            <div className="v-metric">
              <span className="label">Verified Defects</span>
              <strong className="num green">{verified}</strong>
              <small>
                {total > 0 ? `${Math.round((verified / total) * 100)}%` : "0%"} of database
              </small>
            </div>
            <div className="v-divider"></div>
            <div className="v-metric">
              <span className="label">Pending Review</span>
              <strong className="num orange">{unverified}</strong>
              <small>
                {total > 0 ? `${Math.round((unverified / total) * 100)}%` : "0%"} of database
              </small>
            </div>
          </div>

          <div className="data-source-note">
            <p>
              Verified reports carry 3x weight in route avoidance warnings due
              to confirmed physical road impairment.
            </p>
          </div>
        </article>
      </section>

      {/* 14-Day Timeline Volume */}
      <section className="panel timeline-panel">
        <div className="panel-heading">
          <div>
            <h2>14-Day Logging Trend</h2>
            <p>Daily report volume across monitored zones</p>
          </div>
          <Calendar size={18} color="#64748b" />
        </div>

        {trends.length === 0 ? (
          <p className="empty-state">No timeline records available.</p>
        ) : (
          <div className="timeline-chart">
            {trends.map((item) => {
              const maxVal = Math.max(1, ...trends.map((t) => t.total));
              const heightPct = Math.max(8, Math.round((item.total / maxVal) * 100));

              return (
                <div key={item.date} className="trend-col">
                  <div className="bar-wrapper">
                    <span className="bar-tooltip">
                      {item.display_date}: {item.total} reports ({item.verified} verified)
                    </span>
                    <div
                      className={`trend-bar ${item.total > 0 ? "has-data" : ""}`}
                      style={{ height: `${heightPct}%` }}
                    />
                  </div>
                  <span className="trend-label">{item.display_date}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* Recurring Hazard Hotspots */}
      <section className="panel recurring-panel">
        <div className="panel-heading">
          <div>
            <h2>Recurring Defect Hotspots</h2>
            <p>
              Corridors with multiple logged incidents indicating chronic road degradation
            </p>
          </div>
          <Repeat size={18} color="#d97706" />
        </div>

        {recurring.length === 0 ? (
          <div className="empty-state-box">
            <CheckCircle2 size={32} color="#10b981" />
            <h4>No Recurring Hotspots Identified</h4>
            <p>
              No location has accumulated multiple independent defect reports.
              All reported hazards currently represent singular logged events.
            </p>
          </div>
        ) : (
          <div className="recurring-grid">
            {recurring.map((item, idx) => (
              <div key={idx} className="recurring-card">
                <div className="rc-top">
                  <MapPin size={16} className="pin-icon" />
                  <h4>{item.location_name}</h4>
                  <span className="hotspot-count-pill">
                    {item.report_count} Reports
                  </span>
                </div>
                <div className="rc-tags">
                  {item.hazard_types.map((ht) => (
                    <span key={ht} className="hazard-mini-tag">
                      {ht}
                    </span>
                  ))}
                </div>
                <p className="rc-note">{item.indication}</p>
                {item.first_reported && item.last_reported && (
                  <div className="rc-dates">
                    <small>
                      First: {new Date(item.first_reported).toLocaleDateString()} ·
                      Latest: {new Date(item.last_reported).toLocaleDateString()}
                    </small>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
