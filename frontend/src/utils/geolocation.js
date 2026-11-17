/**
 * RoadSense Geolocation Utility
 * Provides standardized browser geolocation acquisition with:
 * - High accuracy (enableHighAccuracy: true)
 * - Anti-stale cache busting (maximumAge: 0)
 * - Sensible timeout (15000 ms)
 * - Clear error translations
 * - Accuracy classification & hardware diagnostics
 */

export const GEOLOCATION_OPTIONS = {
  enableHighAccuracy: true,
  timeout: 15000,
  maximumAge: 0, // CRITICAL: Never accept stale cached positions from days ago!
};

export function formatGpsAccuracy(accuracy) {
  if (accuracy == null || isNaN(accuracy)) return "Unknown";
  if (accuracy >= 1000) {
    return `± ${(accuracy / 1000).toFixed(2)} km`;
  }
  return `± ${Math.round(accuracy)} m`;
}

export function getAccuracyRating(accuracy) {
  if (accuracy == null || isNaN(accuracy)) {
    return {
      tier: "unknown",
      label: "Unknown Accuracy",
      isApproximate: true,
      color: "#64748b",
    };
  }
  if (accuracy <= 50) {
    return {
      tier: "high",
      label: `High Precision GPS (${formatGpsAccuracy(accuracy)})`,
      isApproximate: false,
      color: "#10b981",
    };
  }
  if (accuracy <= 500) {
    return {
      tier: "moderate",
      label: `Moderate Accuracy (${formatGpsAccuracy(accuracy)})`,
      isApproximate: false,
      color: "#0284c7",
    };
  }
  return {
    tier: "approximate",
    label: `Approximate Network / IP (${formatGpsAccuracy(accuracy)})`,
    isApproximate: true,
    color: "#f59e0b",
  };
}

export function getGeolocationErrorMessage(err) {
  if (!err) return "Unknown geolocation error occurred.";
  switch (err.code) {
    case 1: // PERMISSION_DENIED
      return "Location permission was denied. Please allow location access in your browser settings (click the lock/tune icon near the URL bar), or enter your location manually.";
    case 2: // POSITION_UNAVAILABLE
      return "Location position is currently unavailable. Ensure device Location Services are turned on in your operating system settings.";
    case 3: // TIMEOUT
      return "Location request timed out after 15 seconds. Please click 'Refresh' to try again or enter your location manually.";
    default:
      return err.message || "Unable to acquire current GPS coordinates.";
  }
}

/**
 * Promise-based wrapper around navigator.geolocation.getCurrentPosition
 */
export function getCurrentPositionAsync(customOptions = {}) {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined" || !navigator.geolocation) {
      reject({
        code: 0,
        message: "Geolocation is not supported by your browser.",
      });
      return;
    }

    const options = { ...GEOLOCATION_OPTIONS, ...customOptions };

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy, altitude, speed, heading } =
          pos.coords;
        const latF = parseFloat(latitude.toFixed(6));
        const lonF = parseFloat(longitude.toFixed(6));
        const accM =
          typeof accuracy === "number" ? Math.round(accuracy) : null;
        const rating = getAccuracyRating(accM);
        const dateObj = new Date(pos.timestamp || Date.now());
        const timestampFormatted = dateObj.toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        });

        resolve({
          latitude: latF,
          longitude: lonF,
          accuracy: accM,
          accuracyFormatted: formatGpsAccuracy(accM),
          accuracyRating: rating,
          isApproximate: rating.isApproximate,
          timestamp: pos.timestamp,
          timestampFormatted,
          rawCoords: {
            latitude,
            longitude,
            accuracy,
            altitude,
            speed,
            heading,
          },
        });
      },
      (err) => {
        reject({
          code: err.code,
          message: getGeolocationErrorMessage(err),
          originalError: err,
        });
      },
      options
    );
  });
}

/**
 * Standard Haversine formula to compute great-circle distance in kilometers
 */
export function calculateDistanceKm(lat1, lon1, lat2, lon2) {
  if (
    lat1 == null ||
    lon1 == null ||
    lat2 == null ||
    lon2 == null ||
    isNaN(lat1) ||
    isNaN(lon1) ||
    isNaN(lat2) ||
    isNaN(lon2)
  ) {
    return Infinity;
  }
  const earthRadiusKm = 6371.0;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) *
      Math.cos(lat2 * (Math.PI / 180)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusKm * c * 100) / 100;
}
