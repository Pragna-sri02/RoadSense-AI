import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertCircle,
  ArrowRight,
  CheckCircle2,
  Eye,
  EyeOff,
  Lock,
  Mail,
  Navigation,
  Shield,
  ShieldCheck,
  User,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

export default function AuthPage({ initialMode = "login" }) {
  const navigate = useNavigate();
  const { login, register } = useAuth();

  const [mode, setMode] = useState(initialMode); // 'login' | 'register'
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [successMsg, setSuccessMsg] = useState("");

  // Login form state
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [rememberMe, setRememberMe] = useState(true);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  // Registration form state
  const [regFullName, setRegFullName] = useState("");
  const [regEmail, setRegEmail] = useState("");
  const [regPassword, setRegPassword] = useState("");
  const [regConfirmPassword, setRegConfirmPassword] = useState("");
  const [showRegPassword, setShowRegPassword] = useState(false);
  const [showRegConfirmPassword, setShowRegConfirmPassword] = useState(false);

  const switchMode = (newMode) => {
    setErrorMsg("");
    setSuccessMsg("");
    setMode(newMode);
  };

  const handleLoginSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const email = loginEmail.trim();
    if (!email) {
      setErrorMsg("Please enter your email address.");
      return;
    }
    if (!loginPassword) {
      setErrorMsg("Please enter your password.");
      return;
    }

    setLoading(true);
    try {
      await login({
        email,
        password: loginPassword,
        remember_me: rememberMe,
      });
      navigate("/", { replace: true });
    } catch (err) {
      setErrorMsg(err.message || "Failed to sign in. Please verify your credentials.");
    } finally {
      setLoading(false);
    }
  };

  const handleRegisterSubmit = async (e) => {
    e.preventDefault();
    setErrorMsg("");
    setSuccessMsg("");

    const fullName = regFullName.trim();
    const email = regEmail.trim();
    const password = regPassword;
    const confirmPassword = regConfirmPassword;

    if (!fullName || fullName.length < 2) {
      setErrorMsg("Please enter your full name (minimum 2 characters).");
      return;
    }
    if (!email || !email.includes("@")) {
      setErrorMsg("Please enter a valid email address.");
      return;
    }
    if (!password || password.length < 6) {
      setErrorMsg("Password must be at least 6 characters long.");
      return;
    }
    if (password !== confirmPassword) {
      setErrorMsg("Passwords do not match. Please ensure both fields are identical.");
      return;
    }

    setLoading(true);
    try {
      await register({
        full_name: fullName,
        email,
        password,
        confirm_password: confirmPassword,
      });
      setSuccessMsg("Account created successfully! Redirecting to RoadSense dashboard...");
      setTimeout(() => {
        navigate("/", { replace: true });
      }, 600);
    } catch (err) {
      setErrorMsg(err.message || "Registration failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-viewport">
      {/* Background ambient lighting */}
      <div className="auth-ambient-glow top-left" />
      <div className="auth-ambient-glow bottom-right" />

      <div className="auth-card-shell">
        {/* Left Column: Brand Hero Presentation (Navy & Cyan Theme) */}
        <section className="auth-hero-panel">
          <div className="hero-brand-top">
            <div className="hero-logo-box">
              <Navigation size={28} className="hero-logo-icon" />
            </div>
            <div className="hero-brand-text">
              <h1 className="hero-app-title">RoadSense</h1>
              <p className="hero-app-tagline">Smarter Roads. Safer Journeys.</p>
            </div>
          </div>

          <div className="hero-center-content">
            <div className="hero-badge">
              <Sparkles size={13} className="hero-badge-icon" />
              <span>Next-Gen Road Intelligence</span>
            </div>
            <h2 className="hero-lead-heading">
              Real-Time Hazard Detection &amp; Corridor Navigation
            </h2>
            <p className="hero-lead-paragraph">
              RoadSense empowers drivers, transit operators, and highway authorities with
              AI-driven pothole identification, route corridor safety scans, and community road monitoring.
            </p>

            <div className="hero-feature-pills">
              <div className="feature-pill">
                <ShieldCheck size={16} className="pill-icon cyan" />
                <span>AI Surface Inspection</span>
              </div>
              <div className="feature-pill">
                <Navigation size={16} className="pill-icon blue" />
                <span>Driving Corridor Scans</span>
              </div>
              <div className="feature-pill">
                <Shield size={16} className="pill-icon green" />
                <span>Community Hazard Reports</span>
              </div>
            </div>
          </div>

          <div className="hero-footer-note">
            <span>Powered by FastAPI &amp; OSRM GIS Routing Engine</span>
          </div>
        </section>

        {/* Right Column: Interactive Login & Registration Form */}
        <section className="auth-form-panel">
          <div className="auth-form-inner">
            {/* Mode Switcher Tabs */}
            <div className="auth-mode-tabs">
              <button
                type="button"
                className={`auth-tab-btn ${mode === "login" ? "active" : ""}`}
                onClick={() => switchMode("login")}
              >
                Sign In
              </button>
              <button
                type="button"
                className={`auth-tab-btn ${mode === "register" ? "active" : ""}`}
                onClick={() => switchMode("register")}
              >
                Create Account
              </button>
            </div>

            {/* Form Header */}
            <div className="auth-header-block">
              <h3 className="auth-title">
                {mode === "login" ? "Welcome to RoadSense" : "Create Your Account"}
              </h3>
              <p className="auth-subtitle">
                {mode === "login"
                  ? "Enter your credentials to access the road intelligence dashboard."
                  : "Join the community to report road hazards and navigate safely."}
              </p>
            </div>

            {/* Error & Success Notification Banners */}
            {errorMsg && (
              <div className="auth-alert error" role="alert">
                <AlertCircle size={16} className="alert-icon" />
                <span>{errorMsg}</span>
              </div>
            )}

            {successMsg && (
              <div className="auth-alert success" role="alert">
                <CheckCircle2 size={16} className="alert-icon" />
                <span>{successMsg}</span>
              </div>
            )}

            {/* SIGN IN FORM */}
            {mode === "login" ? (
              <form onSubmit={handleLoginSubmit} className="auth-form" noValidate>
                <div className="form-group">
                  <label htmlFor="loginEmail">Email Address</label>
                  <div className="input-field-wrap">
                    <Mail size={16} className="field-icon" />
                    <input
                      id="loginEmail"
                      type="email"
                      placeholder="driver@example.com"
                      value={loginEmail}
                      onChange={(e) => setLoginEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <div className="label-row">
                    <label htmlFor="loginPassword">Password</label>
                  </div>
                  <div className="input-field-wrap">
                    <Lock size={16} className="field-icon" />
                    <input
                      id="loginPassword"
                      type={showLoginPassword ? "text" : "password"}
                      placeholder="••••••••"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      autoComplete="current-password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      aria-label={showLoginPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {showLoginPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="form-options-row">
                  <label className="remember-me-checkbox">
                    <input
                      type="checkbox"
                      checked={rememberMe}
                      onChange={(e) => setRememberMe(e.target.checked)}
                    />
                    <span>Remember me on this device</span>
                  </label>
                </div>

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={17} className="spin" />
                      <span>Signing In...</span>
                    </>
                  ) : (
                    <>
                      <span>Sign In</span>
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>

                <div className="auth-switch-prompt">
                  <span>Don't have an account yet?</span>
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={() => switchMode("register")}
                  >
                    Create Account
                  </button>
                </div>
              </form>
            ) : (
              /* REGISTRATION FORM */
              <form onSubmit={handleRegisterSubmit} className="auth-form" noValidate>
                <div className="form-group">
                  <label htmlFor="regFullName">Full Name</label>
                  <div className="input-field-wrap">
                    <User size={16} className="field-icon" />
                    <input
                      id="regFullName"
                      type="text"
                      placeholder="e.g. Ramesh Kumar"
                      value={regFullName}
                      onChange={(e) => setRegFullName(e.target.value)}
                      autoComplete="name"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="regEmail">Email Address</label>
                  <div className="input-field-wrap">
                    <Mail size={16} className="field-icon" />
                    <input
                      id="regEmail"
                      type="email"
                      placeholder="name@example.com"
                      value={regEmail}
                      onChange={(e) => setRegEmail(e.target.value)}
                      autoComplete="email"
                      required
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="regPassword">Password</label>
                  <div className="input-field-wrap">
                    <Lock size={16} className="field-icon" />
                    <input
                      id="regPassword"
                      type={showRegPassword ? "text" : "password"}
                      placeholder="At least 6 characters"
                      value={regPassword}
                      onChange={(e) => setRegPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowRegPassword(!showRegPassword)}
                      aria-label={showRegPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {showRegPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <div className="form-group">
                  <label htmlFor="regConfirmPassword">Confirm Password</label>
                  <div className="input-field-wrap">
                    <Lock size={16} className="field-icon" />
                    <input
                      id="regConfirmPassword"
                      type={showRegConfirmPassword ? "text" : "password"}
                      placeholder="Re-enter your password"
                      value={regConfirmPassword}
                      onChange={(e) => setRegConfirmPassword(e.target.value)}
                      autoComplete="new-password"
                      required
                    />
                    <button
                      type="button"
                      className="password-toggle-btn"
                      onClick={() => setShowRegConfirmPassword(!showRegConfirmPassword)}
                      aria-label={showRegConfirmPassword ? "Hide password" : "Show password"}
                      tabIndex={-1}
                    >
                      {showRegConfirmPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  className="auth-submit-btn"
                  disabled={loading}
                >
                  {loading ? (
                    <>
                      <Loader2 size={17} className="spin" />
                      <span>Creating Account...</span>
                    </>
                  ) : (
                    <>
                      <span>Create Account</span>
                      <ArrowRight size={17} />
                    </>
                  )}
                </button>

                <div className="auth-switch-prompt">
                  <span>Already have an account?</span>
                  <button
                    type="button"
                    className="auth-link-btn"
                    onClick={() => switchMode("login")}
                  >
                    Sign In
                  </button>
                </div>
              </form>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
