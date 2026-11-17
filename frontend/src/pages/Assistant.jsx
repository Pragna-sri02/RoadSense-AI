import React, { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  Bike,
  Bot,
  Bus,
  Car,
  Compass,
  Crosshair,
  Footprints,
  HelpCircle,
  Loader2,
  LocateFixed,
  MapPin,
  Mic,
  MicOff,
  Navigation,
  RefreshCcw,
  Route,
  Send,
  ShieldCheck,
  Sparkles,
  User,
  Volume2,
  VolumeX,
} from "lucide-react";
import Header from "../components/Header";
import FormattedMessage from "../components/FormattedMessage";
import { getCurrentPositionAsync } from "../utils/geolocation";
import {
  askAssistant,
  getAssistantSuggestions,
  reverseGeocode,
} from "../services/api";

export default function Assistant({
  reports = [],
  onRefresh,
  activeRouteContext = null,
}) {
  const [messages, setMessages] = useState([
    {
      id: "welcome",
      sender: "assistant",
      text:
        "Hello! I am your RoadSense AI Assistant. I provide intelligent driving guidance, travel duration estimates, route hazard corridor scanning, and road safety explanations grounded strictly in our community database.\n\nYou can ask about travel times between cities, road conditions along your route, reported potholes near your GPS position, or road engineering principles.",
      source: "RoadSense Intelligence",
      database_grounded: true,
      reports: [],
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    },
  ]);

  const [inputQuestion, setInputQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState([]);

  // Multi-Turn Context State (Origin, Destination, Corridor, Coords)
  const [activeContext, setActiveContext] = useState(
    activeRouteContext
      ? {
          origin: activeRouteContext.origin?.name || "Vijayawada",
          destination: activeRouteContext.destination?.name || "Agiripalli",
          origin_lat: activeRouteContext.origin?.latitude,
          origin_lon: activeRouteContext.origin?.longitude,
          dest_lat: activeRouteContext.destination?.latitude,
          dest_lon: activeRouteContext.destination?.longitude,
          corridor_km: activeRouteContext.corridor_km || 0.5,
        }
      : null
  );

  // Sync when activeRouteContext changes from parent
  useEffect(() => {
    if (activeRouteContext?.origin && activeRouteContext?.destination) {
      setActiveContext({
        origin: activeRouteContext.origin?.name,
        destination: activeRouteContext.destination?.name,
        origin_lat: activeRouteContext.origin?.latitude,
        origin_lon: activeRouteContext.origin?.longitude,
        dest_lat: activeRouteContext.destination?.latitude,
        dest_lon: activeRouteContext.destination?.longitude,
        corridor_km: activeRouteContext.corridor_km || 0.5,
      });
    }
  }, [activeRouteContext]);

  // GPS Location Context for Assistant
  const [gpsLocation, setGpsLocation] = useState(null);
  const [gpsAddress, setGpsAddress] = useState("");
  const [gpsLoading, setGpsLoading] = useState(false);

  // Voice Recognition (Speech-to-Text) State
  const [isListening, setIsListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(true);
  const recognitionRef = useRef(null);

  // Voice Synthesis (Text-to-Speech) State
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [ttsSupported, setTtsSupported] = useState(true);

  const messagesEndRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Load suggested questions and speech APIs
  useEffect(() => {
    getAssistantSuggestions()
      .then((data) => setSuggestions(data))
      .catch(() => {
        setSuggestions([
          {
            category: "Car Travel",
            question: "How long does it take from Agiripalli to Vijayawada by car?",
          },
          {
            category: "Bus & Transit",
            question: "How long does it take by bus?",
          },
          {
            category: "Walking",
            question: "What about by walking?",
          },
          {
            category: "Route Hazards",
            question: "Are there potholes along this route?",
          },
          {
            category: "Destination",
            question: "What hazards are near my destination?",
          },
          {
            category: "Road Knowledge",
            question: "What is a pothole and why do potholes form?",
          },
        ]);
      });

    // Web Speech API - Recognition
    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechSupported(false);
    } else {
      const recognition = new SpeechRecognition();
      recognition.continuous = false;
      recognition.interimResults = false;
      recognition.lang = "en-US";

      recognition.onresult = (event) => {
        const transcript = event.results[0][0].transcript;
        setInputQuestion(transcript);
        setIsListening(false);
      };

      recognition.onerror = () => setIsListening(false);
      recognition.onend = () => setIsListening(false);

      recognitionRef.current = recognition;
    }

    if (!window.speechSynthesis) {
      setTtsSupported(false);
    }

    return () => {
      if (window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Acquire GPS Location for Assistant Context
  const handleAcquireGps = async () => {
    setGpsLoading(true);
    try {
      const pos = await getCurrentPositionAsync();
      const { latitude, longitude, accuracy, accuracyFormatted, isApproximate } = pos;

      setGpsLocation({
        latitude,
        longitude,
        accuracy,
        accuracyFormatted,
        isApproximate,
      });

      try {
        const rev = await reverseGeocode(latitude, longitude);
        setGpsAddress(rev.display_name);
      } catch {
        setGpsAddress(`GPS Coordinates (${latitude.toFixed(6)}, ${longitude.toFixed(6)})`);
      }
    } catch (err) {
      alert("Failed to acquire GPS location: " + (err.message || "Unknown error"));
    } finally {
      setGpsLoading(false);
    }
  };

  const clearGpsContext = () => {
    setGpsLocation(null);
    setGpsAddress("");
  };

  // Toggle Microphone
  const toggleListening = () => {
    if (!speechSupported || !recognitionRef.current) {
      alert("Voice speech recognition is not supported in this browser. Please use text input.");
      return;
    }

    if (isListening) {
      recognitionRef.current.stop();
      setIsListening(false);
    } else {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch (err) {
        setIsListening(false);
      }
    }
  };

  // Text-to-Speech Playback
  const speakText = (text) => {
    if (!ttsSupported || !window.speechSynthesis) {
      alert("Text-to-speech is not supported by your browser.");
      return;
    }

    window.speechSynthesis.cancel();

    if (isSpeaking) {
      setIsSpeaking(false);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = 1.0;
    utterance.pitch = 1.0;
    utterance.onstart = () => setIsSpeaking(true);
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => setIsSpeaking(false);

    window.speechSynthesis.speak(utterance);
  };

  const stopSpeaking = () => {
    if (window.speechSynthesis) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
    }
  };

  // Submit Query to Grounded Assistant
  const handleSend = async (questionToSend) => {
    const q = (questionToSend || inputQuestion).trim();
    if (!q || loading) return;

    const userMessage = {
      id: Date.now().toString(),
      sender: "user",
      text: q,
      timestamp: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInputQuestion("");
    setLoading(true);

    try {
      const recentHistory = messages.slice(-6).map((m) => ({
        sender: m.sender,
        text: m.text,
      }));

      const context = {
        latitude: gpsLocation?.latitude ?? null,
        longitude: gpsLocation?.longitude ?? null,
        location_name: gpsAddress || null,
        origin_lat: activeContext?.origin_lat ?? activeRouteContext?.origin?.latitude ?? null,
        origin_lon: activeContext?.origin_lon ?? activeRouteContext?.origin?.longitude ?? null,
        dest_lat: activeContext?.dest_lat ?? activeRouteContext?.destination?.latitude ?? null,
        dest_lon: activeContext?.dest_lon ?? activeRouteContext?.destination?.longitude ?? null,
        corridor_km: activeContext?.corridor_km ?? activeRouteContext?.corridor_km ?? 0.5,
        history: recentHistory,
        active_origin: activeContext?.origin ?? null,
        active_destination: activeContext?.destination ?? null,
        travel_mode: activeContext?.travel_mode ?? null,
      };

      const response = await askAssistant(q, context);

      if (response.active_context) {
        setActiveContext(response.active_context);
      }

      const botMessage = {
        id: (Date.now() + 1).toString(),
        sender: "assistant",
        text: response.answer,
        speechText: response.speech_text || response.answer,
        source: response.source || "RoadSense Database",
        database_grounded: response.database_grounded,
        reports: response.reports || [],
        location_context: response.location_context,
        intent: response.intent,
        route_info: response.route_info,
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };

      setMessages((prev) => [...prev, botMessage]);
    } catch (err) {
      const errorMessage = {
        id: (Date.now() + 1).toString(),
        sender: "assistant",
        text:
          "Unable to query road intelligence database. Please verify the backend connection.",
        source: "System Error",
        database_grounded: false,
        reports: [],
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setLoading(false);
    }
  };

  const handleResetChat = () => {
    stopSpeaking();
    setActiveContext(null);
    setMessages([
      {
        id: Date.now().toString(),
        sender: "assistant",
        text:
          "Conversation reset. Ask any question about active road reports, verified hazards, driving durations, or road mechanics.",
        source: "RoadSense Intelligence",
        database_grounded: true,
        reports: [],
        timestamp: new Date().toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        }),
      },
    ]);
  };

  return (
    <div className="page-container assistant-page">
      <Header
        eyebrow="GROUNDED ROAD INTELLIGENCE"
        title="AI Road Intelligence Assistant"
        onRefresh={onRefresh}
        totalReports={reports.length}
      />

      {/* Geospatial Context Bar */}
      <div className="assistant-context-bar">
        <div className="context-item">
          <LocateFixed size={15} className="context-icon" />
          {gpsLocation ? (
            <div className="context-detail">
              <span>
                <strong>GPS Active:</strong> {gpsAddress || `${gpsLocation.latitude.toFixed(6)}, ${gpsLocation.longitude.toFixed(6)}`}
                {gpsLocation.accuracyFormatted && (
                  <span
                    className={`ctx-mode-pill ${
                      gpsLocation.isApproximate ? "approx" : "high"
                    }`}
                    style={{
                      background: gpsLocation.isApproximate ? "#fef3c7" : "#dcfce7",
                      color: gpsLocation.isApproximate ? "#92400e" : "#166534",
                    }}
                  >
                    {gpsLocation.accuracyFormatted}
                  </span>
                )}
              </span>
              <button
                className="clear-ctx-btn"
                onClick={handleAcquireGps}
                disabled={gpsLoading}
                title="Refresh fresh GPS location"
              >
                {gpsLoading ? "Refreshing..." : "Refresh"}
              </button>
              <button className="clear-ctx-btn" onClick={clearGpsContext}>
                Clear
              </button>
            </div>
          ) : (
            <div className="context-detail">
              <span>GPS Location: None attached</span>
              <button
                className="attach-gps-btn"
                onClick={handleAcquireGps}
                disabled={gpsLoading}
              >
                {gpsLoading ? (
                  <Loader2 size={13} className="spin" />
                ) : (
                  <Crosshair size={13} />
                )}
                <span>Share My Location</span>
              </button>
            </div>
          )}
        </div>

        {activeContext && activeContext.origin && activeContext.destination ? (
          <div className="context-item route-ctx">
            <Route size={15} className="context-icon blue" />
            <div className="context-detail">
              <span>
                <strong>Active Route:</strong> {activeContext.origin} → {activeContext.destination}{" "}
                <span className="ctx-mode-pill">
                  {activeContext.travel_mode
                    ? activeContext.travel_mode.toUpperCase()
                    : "CAR"}
                </span>{" "}
                ({activeContext.corridor_km || 0.5} km corridor)
              </span>
              <button
                className="clear-ctx-btn"
                onClick={() => setActiveContext(null)}
                title="Clear current route context"
              >
                Clear Route
              </button>
            </div>
          </div>
        ) : activeRouteContext ? (
          <div className="context-item route-ctx">
            <Route size={15} className="context-icon blue" />
            <div className="context-detail">
              <span>
                <strong>Route Context Active:</strong>{" "}
                {activeRouteContext.origin?.name || "Origin"} →{" "}
                {activeRouteContext.destination?.name || "Destination"} (
                {activeRouteContext.distance_km} km, {activeRouteContext.corridor_km} km corridor)
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div className="assistant-layout">
        {/* Main Chat Shell */}
        <div className="chat-container">
          <div className="chat-header">
            <div className="chat-title-info">
              <div className="bot-avatar">
                <Bot size={22} color="#ffffff" />
              </div>
              <div>
                <strong>RoadSense Grounded Assistant</strong>
                <p>
                  <span className="live-dot" /> Grounded in SQLite Database (
                  {reports.length} stored reports)
                </p>
              </div>
            </div>

            <div className="chat-header-actions">
              {isSpeaking && (
                <button
                  className="speech-active-btn"
                  onClick={stopSpeaking}
                  title="Stop speech playback"
                >
                  <VolumeX size={15} />
                  <span>Stop Speaking</span>
                </button>
              )}

              <button
                className="reset-chat-btn"
                onClick={handleResetChat}
                title="Reset conversation"
              >
                <RefreshCcw size={14} />
                <span>Reset</span>
              </button>
            </div>
          </div>

          {/* Messages Feed */}
          <div className="chat-messages">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={`chat-bubble-row ${msg.sender === "user" ? "user-row" : "bot-row"}`}
              >
                {msg.sender === "assistant" && (
                  <div className="sender-avatar bot">
                    <Bot size={16} />
                  </div>
                )}

                <div className={`message-bubble ${msg.sender}`}>
                  <div className="bubble-text">
                    <FormattedMessage content={msg.text} />
                  </div>

                  {/* Route Information Card */}
                  {msg.route_info && (
                    <div className="bubble-route-badge-card">
                      <div className="br-route-header">
                        {msg.route_info.travel_mode === "bus" ? (
                          <Bus size={15} className="br-route-nav-icon bus" />
                        ) : msg.route_info.travel_mode === "walking" ? (
                          <Footprints size={15} className="br-route-nav-icon walking" />
                        ) : msg.route_info.travel_mode === "bicycle" ? (
                          <Bike size={15} className="br-route-nav-icon bike" />
                        ) : (
                          <Car size={15} className="br-route-nav-icon car" />
                        )}
                        <strong>
                          {msg.route_info.origin} → {msg.route_info.destination}
                        </strong>
                      </div>
                      <div className="br-route-metrics">
                        {msg.route_info.status === "unavailable" || !msg.route_info.duration_formatted ? (
                          <span className="br-metric-pill unavail">
                            ⚠️ Transit Schedule Unavailable
                          </span>
                        ) : (
                          <>
                            {msg.route_info.distance_km != null && (
                              <span className="br-metric-pill dist">
                                {msg.route_info.travel_mode === "walking"
                                  ? "🚶 "
                                  : msg.route_info.travel_mode === "bicycle"
                                  ? "🚲 "
                                  : msg.route_info.travel_mode === "motorcycle"
                                  ? "🏍️ "
                                  : "🚗 "}
                                {msg.route_info.distance_km} km
                              </span>
                            )}
                            <span className="br-metric-pill dur">
                              ⏱️ {msg.route_info.duration_formatted}
                            </span>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Render grounded reports cards if attached */}
                  {msg.reports && msg.reports.length > 0 && (
                    <div className="bubble-reports-grid">
                      {msg.reports.map((r) => (
                        <div key={r.id} className="bubble-report-card">
                          <div className="br-card-layout">
                            {r.image_url ? (
                              <img
                                src={r.image_url}
                                alt={r.hazard_type}
                                className="br-thumb"
                                onError={(e) => {
                                  e.currentTarget.style.display = "none";
                                  const placeholder = e.currentTarget.nextElementSibling;
                                  if (placeholder) placeholder.style.display = "flex";
                                }}
                              />
                            ) : null}
                            <div
                              className="br-thumb-placeholder"
                              style={{ display: r.image_url ? "none" : "flex" }}
                            >
                              <AlertTriangle size={16} />
                            </div>
                            <div className="br-content">
                              <div className="br-header">
                                <strong className="br-hazard-title">⚠️ {r.hazard_type}</strong>
                                <span
                                  className={`badge ${
                                    r.status === "verified"
                                      ? "badge-verified"
                                      : "badge-pending"
                                  }`}
                                >
                                  {r.status === "verified" ? "Verified" : "Pending Review"}
                                </span>
                              </div>

                              {r.route_km !== undefined && r.route_km !== null && (
                                <div className="br-km-badge">
                                  <span>Km {Number(r.route_km).toFixed(1)} of route</span>
                                  {r.distance_from_route_km !== undefined && (
                                    <span className="br-offset">
                                      (~{Number(r.distance_from_route_km).toFixed(2)} km off centerline)
                                    </span>
                                  )}
                                </div>
                              )}

                              <p className="br-loc">📍 {r.location_name}</p>
                              <small className="br-desc">{r.description}</small>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="bubble-footer">
                    <span className="bubble-time">{msg.timestamp}</span>
                    {msg.sender === "assistant" && (
                      <div className="bubble-actions">
                        <span className="grounded-tag">
                          ✓ {msg.source}
                        </span>
                        {ttsSupported && (
                          <button
                            className="tts-btn"
                            onClick={() => speakText(msg.speechText || msg.text)}
                            title="Read answer aloud"
                          >
                            <Volume2 size={13} />
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                {msg.sender === "user" && (
                  <div className="sender-avatar user">
                    <User size={16} />
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div className="chat-bubble-row bot-row">
                <div className="sender-avatar bot">
                  <Bot size={16} />
                </div>
                <div className="message-bubble assistant loading-bubble">
                  <div className="typing-dots">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                  <span className="typing-text">
                    Consulting database records & geospatial context...
                  </span>
                </div>
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>

          {/* Voice Listening Bar Indicator */}
          {isListening && (
            <div className="listening-bar">
              <span className="pulsing-mic">
                <Mic size={16} />
              </span>
              <span>Listening to your voice... Speak now</span>
              <button onClick={toggleListening} className="stop-mic-btn">
                Stop
              </button>
            </div>
          )}

          {/* Input Box */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="chat-input-bar"
          >
            <button
              type="button"
              className={`mic-toggle-btn ${isListening ? "active-listening" : ""}`}
              onClick={toggleListening}
              title={
                speechSupported
                  ? isListening
                    ? "Stop voice input"
                    : "Activate voice input"
                  : "Voice input not supported in this browser"
              }
            >
              {isListening ? <MicOff size={18} /> : <Mic size={18} />}
            </button>

            <input
              type="text"
              placeholder="Ask about potholes, safe routes, or defects near your location..."
              value={inputQuestion}
              onChange={(e) => setInputQuestion(e.target.value)}
              disabled={loading}
            />

            <button
              type="submit"
              className="send-btn"
              disabled={loading || !inputQuestion.trim()}
            >
              <Send size={16} />
            </button>
          </form>
        </div>

        {/* Suggested Inquiries Sidebar */}
        <div className="suggestions-panel">
          <div className="sugg-header">
            <Sparkles size={17} color="#0ea5e9" />
            <h4>Suggested Inquiries</h4>
          </div>
          <p className="sugg-desc">
            Click any question to query real database reports directly:
          </p>

          <div className="sugg-list">
            {suggestions.map((item, idx) => (
              <button
                key={idx}
                className="sugg-chip"
                onClick={() => handleSend(item.question)}
                disabled={loading}
              >
                <span className="chip-cat">{item.category}</span>
                <span className="chip-text">{item.question}</span>
              </button>
            ))}
          </div>

          <div className="grounding-guarantee-card">
            <ShieldCheck size={20} color="#10b981" />
            <div>
              <strong>Strict Geospatial Grounding</strong>
              <p>
                RoadSense Assistant resolves locations authentically and never
                substitutes cities or invents hazard coordinates. If an area has
                no stored reports, it states so clearly.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
