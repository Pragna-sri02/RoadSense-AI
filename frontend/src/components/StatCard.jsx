import React from "react";

export default function StatCard({
  label,
  value,
  subtext,
  icon: Icon,
  variant = "blue",
  badgeText = null,
  badgeType = "neutral",
  loading = false,
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        {Icon && (
          <div className={`stat-icon ${variant}`}>
            <Icon size={20} />
          </div>
        )}
      </div>

      <div className="stat-value-row">
        <h3>{loading ? "..." : value}</h3>
        {badgeText && (
          <span className={`stat-badge ${badgeType}`}>{badgeText}</span>
        )}
      </div>

      {subtext && <p className="stat-subtext">{subtext}</p>}
    </article>
  );
}
