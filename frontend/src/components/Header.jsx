import React from "react";
import { Menu, RefreshCw, PlusCircle } from "lucide-react";

export default function Header({
  eyebrow = "ROAD INTELLIGENCE PLATFORM",
  title = "Overview",
  onRefresh,
  loading = false,
  onOpenReportModal,
  onOpenMobileMenu,
  totalReports = 0,
}) {
  return (
    <header className="topbar">
      <div className="topbar-left">
        {onOpenMobileMenu && (
          <button
            className="mobile-menu-btn"
            onClick={onOpenMobileMenu}
            aria-label="Open navigation menu"
          >
            <Menu size={22} />
          </button>
        )}
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
        </div>
      </div>

      <div className="topbar-actions">
        {onOpenReportModal && (
          <button className="primary-btn" onClick={onOpenReportModal}>
            <PlusCircle size={16} />
            <span>Report Hazard</span>
          </button>
        )}

        {onRefresh && (
          <button
            className="refresh-button"
            onClick={onRefresh}
            disabled={loading}
            title="Refresh database records"
          >
            <RefreshCw size={16} className={loading ? "spin" : ""} />
            <span>Refresh</span>
          </button>
        )}
      </div>
    </header>
  );
}
