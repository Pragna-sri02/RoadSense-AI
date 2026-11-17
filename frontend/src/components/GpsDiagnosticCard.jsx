import React from "react";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Compass,
  Crosshair,
  Info,
  Loader2,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  X,
} from "lucide-react";

/**
 * GpsDiagnosticCard Component
 * Displays transparent GPS diagnostics:
 * - Latitude & Longitude (precision formatted)
 * - Accuracy in metres (with precision rating)
 * - Acquisition timestamp
 * - Retrieval status
 * - Laptop vs mobile hardware explanation
 * - Poor accuracy warning & manual override
 * - Refresh & Clear controls
 */
export default function GpsDiagnosticCard({
  loading = false,
  location = null,
  accuracy = null,
  timestamp = null,
  status = "idle",
  statusMessage = "",
  address = "",
  error = "",
  onRefresh,
  onClear,
  onManualInput,
  onConfirmApproximate,
  compact = false,
}) {
  if (!loading && !location && !error && status === "idle") {
    return null;
  }

  // Determine accuracy tier
  const isApproximate = accuracy == null || accuracy > 500;
  const isHighAccuracy = accuracy != null && accuracy <= 50;
  const isModerateAccuracy = accuracy != null && accuracy > 50 && accuracy <= 500;

  const formattedAccuracy =
    accuracy != null
      ? accuracy >= 1000
        ? `± ${(accuracy / 1000).toFixed(2)} km`
        : `± ${accuracy} m`
      : "Unknown";

  return (
    <div
      className={`gps-diagnostic-card ${
        loading ? "loading" : error ? "has-error" : isApproximate ? "approximate" : "high-precision"
      } ${compact ? "compact" : ""}`}
    >
      {/* 1. ACQUIRING / LOADING STATE */}
      {loading && (
        <div className="gps-diag-loading">
          <Loader2 size={18} className="spin" color="#0284c7" />
          <div className="gps-diag-loading-text">
            <strong>Acquiring Fresh GPS Coordinates...</strong>
            <p>
              Requesting high-precision fix from browser (maximumAge: 0, timeout: 15s). Please allow location permission if prompted.
            </p>
          </div>
        </div>
      )}

      {/* 2. ERROR / DENIED STATE */}
      {!loading && error && (
        <div className="gps-diag-error-section">
          <div className="gps-diag-error-header">
            <AlertCircle size={18} color="#ef4444" />
            <strong>GPS Retrieval Unsuccessful</strong>
          </div>
          <p className="gps-diag-error-msg">{error}</p>

          <div className="gps-diag-error-guidance">
            <p>
              💡 <strong>Troubleshooting:</strong>
            </p>
            <ul>
              <li>If permission was blocked, click the lock/settings icon in your browser URL bar to allow location.</li>
              <li>Ensure device Location Services are enabled in Windows / macOS / Mobile settings.</li>
              <li>Alternatively, type your origin town or street manually into the search box.</li>
            </ul>
          </div>

          <div className="gps-diag-actions">
            {onRefresh && (
              <button
                type="button"
                className="gps-btn primary small"
                onClick={onRefresh}
                title="Retry fresh geolocation request"
              >
                <RefreshCw size={13} />
                <span>Retry GPS</span>
              </button>
            )}
            {onManualInput && (
              <button
                type="button"
                className="gps-btn secondary small"
                onClick={onManualInput}
              >
                <MapPin size={13} />
                <span>Type Location Manually</span>
              </button>
            )}
            {onClear && (
              <button
                type="button"
                className="gps-btn text-only small"
                onClick={onClear}
              >
                Dismiss
              </button>
            )}
          </div>
        </div>
      )}

      {/* 3. SUCCESSFUL GEOLOCATION RESULT */}
      {!loading && location && !error && (
        <div className="gps-diag-body">
          {/* Diagnostic Header */}
          <div className="gps-diag-header">
            <div className="gps-status-badge-group">
              {isHighAccuracy ? (
                <span className="gps-status-pill high">
                  <ShieldCheck size={14} />
                  <span>GPS Lock Confirmed</span>
                </span>
              ) : isModerateAccuracy ? (
                <span className="gps-status-pill med">
                  <Compass size={14} />
                  <span>Wi-Fi / Sensor Position</span>
                </span>
              ) : (
                <span className="gps-status-pill approx">
                  <AlertTriangle size={14} />
                  <span>Approximate Location (Network/IP)</span>
                </span>
              )}

              <span
                className={`gps-acc-pill ${
                  isHighAccuracy ? "high" : isModerateAccuracy ? "med" : "poor"
                }`}
                title={`Radial uncertainty radius: ${formattedAccuracy}`}
              >
                Accuracy: {formattedAccuracy}
              </span>
            </div>

            <div className="gps-header-actions">
              {onRefresh && (
                <button
                  type="button"
                  className="gps-icon-btn"
                  onClick={onRefresh}
                  title="Force fresh GPS request (bypasses browser cache)"
                >
                  <RefreshCw size={13} />
                  <span>Refresh</span>
                </button>
              )}
              {onClear && (
                <button
                  type="button"
                  className="gps-icon-btn clear"
                  onClick={onClear}
                  title="Clear current GPS coordinates"
                >
                  <X size={13} />
                </button>
              )}
            </div>
          </div>

          {/* Diagnostic Metrics Grid */}
          <div className="gps-metrics-grid">
            <div className="gps-metric-item">
              <span className="metric-lbl">Latitude</span>
              <strong className="metric-val">{location.latitude.toFixed(6)}</strong>
            </div>

            <div className="gps-metric-item">
              <span className="metric-lbl">Longitude</span>
              <strong className="metric-val">{location.longitude.toFixed(6)}</strong>
            </div>

            <div className="gps-metric-item">
              <span className="metric-lbl">Accuracy</span>
              <strong
                className={`metric-val ${
                  isHighAccuracy ? "text-green" : isModerateAccuracy ? "text-blue" : "text-amber"
                }`}
              >
                {formattedAccuracy}
              </strong>
            </div>

            <div className="gps-metric-item">
              <span className="metric-lbl">Timestamp</span>
              <span className="metric-val small">{timestamp || "Just now"}</span>
            </div>
          </div>

          {/* Status Message */}
          <div className="gps-status-row">
            <span className="status-label">Status:</span>
            <span className="status-desc">
              {statusMessage ||
                (isApproximate
                  ? "Approximate location derived from network routing or Wi-Fi triangulation."
                  : "Precise coordinates locked from device hardware.")}
            </span>
          </div>

          {/* Reverse Geocoded Address */}
          {address && (
            <div className="gps-address-row">
              <MapPin size={14} className="addr-icon" />
              <div className="addr-content">
                <span className="addr-title">Resolved Area:</span>
                <span className="addr-text">{address}</span>
              </div>
            </div>
          )}

          {/* Approximate Location Warning & Hardware Explanation */}
          {isApproximate && (
            <div className="gps-approx-notice">
              <div className="notice-lead">
                <AlertTriangle size={15} color="#d97706" />
                <strong>Approximate Network Location Detected</strong>
              </div>
              <p>
                The browser reported an accuracy radius of <strong>{formattedAccuracy}</strong>. Most laptops and desktop PCs lack dedicated satellite GPS chips, so the operating system determines coordinates using Wi-Fi access points or ISP network IP routing. This can point to an ISP gateway, proxy, or regional datacenter (e.g. Doha, Qatar or an ISP hub) rather than your actual physical street.
              </p>
              <div className="notice-mobile-callout">
                <Smartphone size={14} />
                <span>
                  <strong>Tip:</strong> For high-precision street navigation, open RoadSense on a smartphone with GPS enabled, or type your street / town name manually.
                </span>
              </div>

              <div className="approx-override-actions">
                {onManualInput && (
                  <button
                    type="button"
                    className="gps-btn primary small"
                    onClick={onManualInput}
                  >
                    <MapPin size={13} />
                    <span>Type My Actual Location Manually</span>
                  </button>
                )}
                {onConfirmApproximate && (
                  <button
                    type="button"
                    className="gps-btn secondary small"
                    onClick={onConfirmApproximate}
                  >
                    <CheckCircle2 size={13} />
                    <span>Use This Location Anyway</span>
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
