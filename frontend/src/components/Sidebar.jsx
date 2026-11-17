import React from "react";
import { NavLink } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  BarChart2,
  LogOut,
  Map,
  MessageSquare,
  Navigation,
  User,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function Sidebar({ health, isMobileOpen, onCloseMobile }) {
  const { user, logout } = useAuth();

  const handleLogout = async () => {
    if (onCloseMobile) onCloseMobile();
    await logout();
  };

  const navItems = [
    { to: "/", label: "Dashboard", icon: Activity, end: true },
    { to: "/monitoring", label: "Road Monitoring", icon: Map },
    { to: "/reports", label: "Road Reports", icon: AlertTriangle },
    { to: "/analytics", label: "Road Analytics", icon: BarChart2 },
    { to: "/assistant", label: "AI Assistant", icon: MessageSquare },
  ];

  return (
    <>
      {isMobileOpen && (
        <div
          className="sidebar-backdrop"
          onClick={onCloseMobile}
          aria-label="Close navigation overlay"
        />
      )}
      <aside className={`sidebar ${isMobileOpen ? "open" : ""}`}>
        <div className="brand">
          <div className="brand-icon">
            <Navigation size={22} color="#ffffff" />
          </div>
          <div>
            <h2>RoadSense</h2>
            <p>Road Intelligence Platform</p>
          </div>
        </div>

        <p className="nav-label">WORKSPACE</p>

        <nav className="nav-menu">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={onCloseMobile}
                className={({ isActive }) =>
                  `nav-item ${isActive ? "active" : ""}`
                }
              >
                <Icon size={19} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
        </nav>

        {user && (
          <div className="sidebar-user-section">
            <div className="sidebar-user-profile">
              <div className="user-avatar-badge">
                {user.full_name ? user.full_name.charAt(0).toUpperCase() : "U"}
              </div>
              <div className="user-info-col">
                <span className="user-name" title={user.full_name}>
                  {user.full_name}
                </span>
                <span className="user-email" title={user.email}>
                  {user.email}
                </span>
              </div>
            </div>
            <button
              type="button"
              className="sidebar-logout-btn"
              onClick={handleLogout}
              title="Sign out of RoadSense"
            >
              <LogOut size={16} />
              <span>Log Out</span>
            </button>
          </div>
        )}

        <div className="sidebar-footer">
          <span
            className={`status-dot ${health?.status === "healthy" ? "online" : ""}`}
            title={health?.status === "healthy" ? "Online" : "Connecting"}
          />
          <div className="status-text">
            <strong>
              {health?.status === "healthy"
                ? "Backend Connected"
                : "Checking System"}
            </strong>
            <small>v1.0.0 · SQLite Database</small>
          </div>
        </div>
      </aside>
    </>
  );
}
