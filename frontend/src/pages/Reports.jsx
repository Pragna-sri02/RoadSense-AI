import React, { useState } from "react";
import {
  AlertTriangle,
  Camera,
  Check,
  CheckCircle2,
  Clock,
  Crosshair,
  Eye,
  Filter,
  Image as ImageIcon,
  Loader2,
  MapPin,
  PlusCircle,
  RefreshCw,
  Search,
  Shield,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Header from "../components/Header";
import GpsDiagnosticCard from "../components/GpsDiagnosticCard";
import { getCurrentPositionAsync } from "../utils/geolocation";
import {
  analyzeRoadImage,
  createReport,
  deleteReport,
  getMediaUrl,
  reverseGeocode,
  updateReportStatus,
} from "../services/api";

const HAZARD_CATEGORIES = [
  "Pothole",
  "Cracked Road",
  "Damaged Surface",
  "Waterlogging",
  "Road Obstruction",
  "Other Hazard",
];

export default function Reports({
  reports = [],
  loading = false,
  onRefresh,
  onOpenReportModal,
  isModalOpen,
  onCloseReportModal,
  initialCoords = null,
}) {
  // Filters & Search
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [selectedStatus, setSelectedStatus] = useState("all");

  // Selected report for viewing details
  const [viewReport, setViewReport] = useState(null);

  // Form State for New Report
  const [hazardType, setHazardType] = useState(HAZARD_CATEGORIES[0]);
  const [locationName, setLocationName] = useState("");
  const [description, setDescription] = useState("");
  const [latitude, setLatitude] = useState(
    initialCoords ? initialCoords.latitude : ""
  );
  const [longitude, setLongitude] = useState(
    initialCoords ? initialCoords.longitude : ""
  );
  const [formSubmitting, setFormSubmitting] = useState(false);
  const [gpsFilling, setGpsFilling] = useState(false);
  const [modalGpsDiagnostic, setModalGpsDiagnostic] = useState(null);
  const [modalGpsError, setModalGpsError] = useState("");
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState("");

  // Computer Vision Pothole Scanner State
  const [visionLoading, setVisionLoading] = useState(false);
  const [visionResult, setVisionResult] = useState(null);
  const [visionError, setVisionError] = useState("");

  // Analyze uploaded image using Computer Vision pipeline
  const handleImageAnalysis = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setVisionLoading(true);
    setVisionError("");
    setVisionResult(null);

    try {
      const res = await analyzeRoadImage(file);
      setVisionResult(res);

      // Auto-populate form fields
      if (res.hazard_type && HAZARD_CATEGORIES.includes(res.hazard_type)) {
        setHazardType(res.hazard_type);
      } else if (res.hazard_type && res.hazard_type !== "Normal Road Surface") {
        setHazardType("Pothole");
      }

      if (res.suggested_description) {
        setDescription(res.suggested_description);
      }

      if (res.extracted_gps) {
        setLatitude(res.extracted_gps.latitude);
        setLongitude(res.extracted_gps.longitude);
        if (res.suggested_location) {
          setLocationName(res.suggested_location);
        }
      }
    } catch (err) {
      setVisionError(
        err.response?.data?.detail || err.message || "Failed to analyze road image."
      );
    } finally {
      setVisionLoading(false);
    }
  };

  // Update coords if initialCoords prop changed
  React.useEffect(() => {
    if (initialCoords) {
      setLatitude(initialCoords.latitude);
      setLongitude(initialCoords.longitude);
      if (initialCoords.location_name) {
        setLocationName(initialCoords.location_name);
      }
    }
  }, [initialCoords]);

  // GPS Auto-fill in Report Modal
  const handleAutoFillGps = async () => {
    setModalGpsError("");
    setGpsFilling(true);

    try {
      const pos = await getCurrentPositionAsync();
      const {
        latitude: latF,
        longitude: lonF,
        accuracy,
        timestampFormatted,
        isApproximate,
        accuracyFormatted,
      } = pos;

      setLatitude(latF);
      setLongitude(lonF);

      let resolvedAddr = "";
      try {
        const rev = await reverseGeocode(latF, lonF);
        resolvedAddr = rev.display_name;
        setLocationName(resolvedAddr);
      } catch {
        resolvedAddr = `GPS Coordinates (${latF}, ${lonF})`;
        setLocationName(resolvedAddr);
      }

      setModalGpsDiagnostic({
        location: { latitude: latF, longitude: lonF },
        accuracy,
        accuracyFormatted,
        timestamp: timestampFormatted,
        isApproximate,
        address: resolvedAddr,
      });
    } catch (err) {
      setModalGpsError(err.message || "Failed to acquire fresh GPS coordinates.");
    } finally {
      setGpsFilling(false);
    }
  };

  // Handle Form Submission
  const handleSubmitReport = async (e) => {
    e.preventDefault();
    setFormError("");
    setFormSuccess("");

    if (!locationName.trim() || locationName.trim().length < 2) {
      setFormError("Location name must be at least 2 characters.");
      return;
    }
    if (!description.trim() || description.trim().length < 5) {
      setFormError("Please enter a descriptive note (at least 5 characters).");
      return;
    }

    const latNum = parseFloat(latitude);
    const lonNum = parseFloat(longitude);
    if (isNaN(latNum) || latNum < -90 || latNum > 90) {
      setFormError("Please enter a valid latitude (-90 to 90).");
      return;
    }
    if (isNaN(lonNum) || lonNum < -180 || lonNum > 180) {
      setFormError("Please enter a valid longitude (-180 to 180).");
      return;
    }

    setFormSubmitting(true);
    try {
      await createReport({
        hazard_type: hazardType,
        location_name: locationName.trim(),
        description: description.trim(),
        latitude: latNum,
        longitude: lonNum,
        image_url: visionResult?.image_url || null,
        source: visionResult?.has_damage ? "ai_vision" : "community",
        detection_method: visionResult ? "computer_vision" : "manual",
      });

      setFormSuccess(
        "Road report submitted successfully! Marked as unverified until verified by field inspection."
      );
      setTimeout(() => {
        setLocationName("");
        setDescription("");
        setVisionResult(null);
        setFormSuccess("");
        if (onCloseReportModal) onCloseReportModal();
        if (onRefresh) onRefresh();
      }, 1200);
    } catch (err) {
      setFormError(
        err.response?.data?.detail || "Failed to submit report. Please check inputs."
      );
    } finally {
      setFormSubmitting(false);
    }
  };

  // Toggle Verification status (Simulate municipal / admin review)
  const handleToggleVerification = async (report) => {
    const nextStatus = report.status === "verified" ? "unverified" : "verified";
    try {
      await updateReportStatus(report.id, nextStatus);
      if (viewReport && viewReport.id === report.id) {
        setViewReport({ ...viewReport, status: nextStatus });
      }
      if (onRefresh) onRefresh();
    } catch (err) {
      alert("Failed to update report status: " + (err.response?.data?.detail || err.message));
    }
  };

  // Delete Report
  const handleDeleteReport = async (id) => {
    if (!window.confirm(`Are you sure you want to delete report #${id}?`)) return;
    try {
      await deleteReport(id);
      if (viewReport && viewReport.id === id) setViewReport(null);
      if (onRefresh) onRefresh();
    } catch (err) {
      alert("Failed to delete report: " + (err.response?.data?.detail || err.message));
    }
  };

  // Filtered reports
  const filteredReports = reports.filter((r) => {
    const matchesSearch =
      !searchQuery.trim() ||
      r.location_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      r.hazard_type.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesCategory =
      selectedCategory === "all" ||
      r.hazard_type.toLowerCase() === selectedCategory.toLowerCase();

    const matchesStatus =
      selectedStatus === "all" ||
      r.status.toLowerCase() === selectedStatus.toLowerCase();

    return matchesSearch && matchesCategory && matchesStatus;
  });

  return (
    <div className="page-container">
      <Header
        eyebrow="COMMUNITY & INSPECTION RECORDS"
        title="Road Reports Management"
        onRefresh={onRefresh}
        loading={loading}
        onOpenReportModal={onOpenReportModal}
        totalReports={reports.length}
      />

      {/* Filter and Control Bar */}
      <section className="reports-control-panel">
        <div className="search-box">
          <Search size={16} className="search-icon" />
          <input
            type="text"
            placeholder="Search by street name, city, hazard, or description..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button className="clear-btn" onClick={() => setSearchQuery("")}>
              <X size={14} />
            </button>
          )}
        </div>

        <div className="filter-dropdowns">
          <div className="select-wrapper">
            <Filter size={14} />
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
            >
              <option value="all">All Categories</option>
              {HAZARD_CATEGORIES.map((cat) => (
                <option key={cat} value={cat}>
                  {cat}
                </option>
              ))}
            </select>
          </div>

          <div className="select-wrapper">
            <Shield size={14} />
            <select
              value={selectedStatus}
              onChange={(e) => setSelectedStatus(e.target.value)}
            >
              <option value="all">All Statuses</option>
              <option value="verified">Verified Only</option>
              <option value="unverified">Pending Review</option>
            </select>
          </div>
        </div>
      </section>

      {/* Reports Table Panel */}
      <section className="panel reports-table-panel">
        <div className="panel-heading">
          <div>
            <h2>Community Defect Reports</h2>
            <p>
              Showing {filteredReports.length} of {reports.length} recorded incidents
            </p>
          </div>
          <button className="primary-btn" onClick={onOpenReportModal}>
            <PlusCircle size={15} />
            <span>Submit Report</span>
          </button>
        </div>

        {loading ? (
          <p className="empty-state">Loading reports...</p>
        ) : filteredReports.length === 0 ? (
          <div className="empty-state-box">
            <AlertTriangle size={36} color="#94a3b8" />
            <h3>No Road Reports Found</h3>
            <p>
              {reports.length === 0
                ? "No road reports have been submitted for this area yet."
                : "No reports match your current filters. Try resetting search or category."}
            </p>
          </div>
        ) : (
          <div className="table-responsive">
            <table className="reports-table">
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Hazard Category</th>
                  <th>Location Corridor</th>
                  <th>Coordinates</th>
                  <th>Status</th>
                  <th>Logged Date</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredReports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <code>#{report.id}</code>
                    </td>
                    <td>
                      <span className="hazard-cell-pill">
                        {report.hazard_type}
                      </span>
                    </td>
                    <td>
                      <strong>{report.location_name}</strong>
                      <small className="desc-table-sub">
                        {report.description.length > 55
                          ? `${report.description.substring(0, 55)}...`
                          : report.description}
                      </small>
                    </td>
                    <td>
                      <small>
                        {report.latitude.toFixed(4)}, {report.longitude.toFixed(4)}
                      </small>
                    </td>
                    <td>
                      <span
                        className={`badge ${
                          report.status === "verified"
                            ? "badge-verified"
                            : "badge-pending"
                        }`}
                      >
                        {report.status}
                      </span>
                    </td>
                    <td>
                      <small>
                        {new Date(report.created_at).toLocaleDateString()}
                      </small>
                    </td>
                    <td>
                      <div className="row-action-btns">
                        <button
                          className="icon-action-btn view"
                          onClick={() => setViewReport(report)}
                          title="View Details"
                        >
                          <Eye size={15} />
                        </button>
                        <button
                          className={`icon-action-btn verify ${
                            report.status === "verified" ? "is-verified" : ""
                          }`}
                          onClick={() => handleToggleVerification(report)}
                          title={
                            report.status === "verified"
                              ? "Mark as Pending Review"
                              : "Verify Report"
                          }
                        >
                          <ShieldCheck size={15} />
                        </button>
                        <button
                          className="icon-action-btn delete"
                          onClick={() => handleDeleteReport(report.id)}
                          title="Delete Record"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Modal: View Details */}
      {viewReport && (
        <div className="modal-backdrop" onClick={() => setViewReport(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">ROAD DEFECT DETAILS</p>
                <h3>Report #{viewReport.id}</h3>
              </div>
              <button
                className="close-modal-btn"
                onClick={() => setViewReport(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="modal-body">
              <div className="detail-item">
                <label>Hazard Category</label>
                <p className="detail-value">{viewReport.hazard_type}</p>
              </div>

              <div className="detail-item">
                <label>Location Name</label>
                <p className="detail-value">📍 {viewReport.location_name}</p>
              </div>

              <div className="detail-item">
                <label>Exact Coordinates</label>
                <p className="detail-value">
                  Latitude: <code>{viewReport.latitude}</code> | Longitude:{" "}
                  <code>{viewReport.longitude}</code>
                </p>
              </div>

              <div className="detail-item">
                <label>Condition Description</label>
                <p className="detail-description">{viewReport.description}</p>
              </div>

              <div className="detail-item">
                <label>Verification Status</label>
                <div className="status-verify-row">
                  <span
                    className={`badge ${
                      viewReport.status === "verified"
                        ? "badge-verified"
                        : "badge-pending"
                    }`}
                  >
                    {viewReport.status}
                  </span>
                  <button
                    className="secondary-btn small-btn"
                    onClick={() => handleToggleVerification(viewReport)}
                  >
                    Toggle to{" "}
                    {viewReport.status === "verified"
                      ? "Unverified"
                      : "Verified"}
                  </button>
                </div>
              </div>

              {viewReport.image_url && (
                <div className="detail-item">
                  <label>Captured Hazard Photo</label>
                  <div style={{ marginTop: "6px" }}>
                    <img
                      src={getMediaUrl(viewReport.image_url)}
                      alt="Captured Road Defect"
                      style={{ maxWidth: "100%", maxHeight: "220px", borderRadius: "8px", objectFit: "cover", border: "1px solid #cbd5e1" }}
                      onError={(e) => { e.currentTarget.style.display = 'none'; }}
                    />
                  </div>
                </div>
              )}

              <div className="detail-item">
                <label>Logged Date</label>
                <p className="detail-value">
                  {new Date(viewReport.created_at).toLocaleString()} {viewReport.source ? `• via ${viewReport.source} (${viewReport.detection_method || 'manual'})` : ''}
                </p>
              </div>
            </div>

            <div className="modal-footer">
              <button
                className="secondary-btn"
                onClick={() => setViewReport(null)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Submit New Report */}
      {isModalOpen && (
        <div className="modal-backdrop" onClick={onCloseReportModal}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <p className="eyebrow">COMMUNITY SUBMISSION</p>
                <h3>Report Road Hazard</h3>
              </div>
              <button
                className="close-modal-btn"
                onClick={onCloseReportModal}
              >
                <X size={18} />
              </button>
            </div>

            <form onSubmit={handleSubmitReport} className="modal-body">
              {formError && <div className="form-error-alert">{formError}</div>}
              {formSuccess && (
                <div className="form-success-alert">{formSuccess}</div>
              )}

              {/* Computer Vision Pothole & Road Surface Scanner */}
              <div className="vision-upload-card">
                <div className="vision-card-header">
                  <div className="vision-title">
                    <Sparkles size={16} color="#0284c7" />
                    <strong>AI Vision Pothole Scanner</strong>
                  </div>
                  <span className="vision-badge">Computer Vision</span>
                </div>
                <p className="vision-desc">
                  Upload a photo to automatically detect potholes, evaluate surface damage, and extract GPS coordinates from image metadata.
                </p>

                <div className="vision-action-row">
                  <label className="vision-upload-btn">
                    <Camera size={15} />
                    <span>{visionLoading ? "Analyzing Road Surface..." : "Upload Road Image for AI Analysis"}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleImageAnalysis}
                      disabled={visionLoading}
                      style={{ display: "none" }}
                    />
                  </label>
                  {visionLoading && <Loader2 size={16} className="spin" style={{ color: "#0284c7" }} />}
                </div>

                {visionError && <div className="vision-error-msg">{visionError}</div>}

                {visionResult && (
                  <div className="vision-result-box">
                    <div className="vision-status-banner">
                      <div className="status-indicator">
                        {visionResult.has_damage ? (
                          <span className="badge badge-pending">
                            ⚠️ {visionResult.hazard_type} ({Math.round(visionResult.confidence * 100)}% Confidence)
                          </span>
                        ) : (
                          <span className="badge badge-verified">
                            ✓ {visionResult.hazard_type}
                          </span>
                        )}
                        <span className="severity-pill">Severity: {visionResult.severity}</span>
                      </div>
                      {visionResult.extracted_gps && (
                        <span className="gps-pill">
                          📍 Photo GPS Extracted: {visionResult.extracted_gps.latitude.toFixed(4)}, {visionResult.extracted_gps.longitude.toFixed(4)}
                        </span>
                      )}
                    </div>

                    {visionResult.annotated_image && (
                      <div className="annotated-image-preview">
                        <img src={visionResult.annotated_image} alt="Computer Vision Pothole Detection" />
                      </div>
                    )}
                    <p className="prefill-notice">✓ Form auto-filled with detected hazard & coordinates. Review and submit below.</p>
                  </div>
                )}
              </div>

              <div className="form-group">
                <label>Hazard Category *</label>
                <select
                  value={hazardType}
                  onChange={(e) => setHazardType(e.target.value)}
                  required
                >
                  {HAZARD_CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>

              <div className="form-group">
                <div className="field-label-row">
                  <label>Corridor or Street Name *</label>
                  <button
                    type="button"
                    className="use-gps-link"
                    onClick={handleAutoFillGps}
                    disabled={gpsFilling}
                  >
                    {gpsFilling ? (
                      <Loader2 size={12} className="spin" />
                    ) : (
                      <Crosshair size={12} />
                    )}
                    <span>{gpsFilling ? "Detecting GPS..." : "Auto-fill with GPS"}</span>
                  </button>
                </div>
                <input
                  type="text"
                  placeholder="e.g. Bandar Road, near Benz Circle, Vijayawada"
                  value={locationName}
                  onChange={(e) => setLocationName(e.target.value)}
                  required
                />

                {/* GPS Diagnostic Card in Modal */}
                {modalGpsDiagnostic && (
                  <GpsDiagnosticCard
                    loading={gpsFilling}
                    location={modalGpsDiagnostic.location}
                    accuracy={modalGpsDiagnostic.accuracy}
                    timestamp={modalGpsDiagnostic.timestamp}
                    status={modalGpsDiagnostic.isApproximate ? "approximate" : "locked"}
                    statusMessage={
                      modalGpsDiagnostic.isApproximate
                        ? "Approximate position (Network IP)"
                        : "High precision GPS locked"
                    }
                    address={modalGpsDiagnostic.address}
                    error={modalGpsError}
                    onRefresh={handleAutoFillGps}
                    onClear={() => {
                      setModalGpsDiagnostic(null);
                      setModalGpsError("");
                    }}
                    compact={true}
                  />
                )}
                {modalGpsError && !modalGpsDiagnostic && (
                  <div className="form-error-alert" style={{ marginTop: "8px" }}>
                    ⚠️ {modalGpsError}
                  </div>
                )}
              </div>

              <div className="form-row-2">
                <div className="form-group">
                  <label>Latitude * (-90 to 90)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="16.5062"
                    value={latitude}
                    onChange={(e) => setLatitude(e.target.value)}
                    required
                  />
                </div>
                <div className="form-group">
                  <label>Longitude * (-180 to 180)</label>
                  <input
                    type="number"
                    step="any"
                    placeholder="80.6480"
                    value={longitude}
                    onChange={(e) => setLongitude(e.target.value)}
                    required
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Condition Description *</label>
                <textarea
                  rows="3"
                  placeholder="Describe severity, approximate dimensions, lane obstruction, or water depth..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  required
                />
              </div>

              <p className="form-tip">
                ℹ️ All community submissions initially enter the system as{" "}
                <strong>unverified</strong> to maintain data integrity.
              </p>

              <div className="modal-footer">
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={onCloseReportModal}
                  disabled={formSubmitting}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="primary-btn"
                  disabled={formSubmitting}
                >
                  {formSubmitting ? "Submitting..." : "Submit Hazard Report"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
