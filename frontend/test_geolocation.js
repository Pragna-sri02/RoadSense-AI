/**
 * Automated Test Suite for RoadSense Geolocation Services
 * Verifies:
 * 1. High-accuracy option enforcement & anti-stale cache busting (maximumAge: 0)
 * 2. High-precision GPS retrieval (mobile / hardware GPS)
 * 3. Approximate / low-accuracy location detection (e.g. Doha IP, 25.2809, 51.5509 with 25.4km radius)
 * 4. Error classification: Denied permission (code 1), Unavailable (code 2), Timeout (code 3)
 * 5. Formatting functions (meters vs kilometers)
 * 6. Refreshing location capability
 */

import {
  GEOLOCATION_OPTIONS,
  formatGpsAccuracy,
  getAccuracyRating,
  getGeolocationErrorMessage,
  getCurrentPositionAsync,
} from "./src/utils/geolocation.js";

// Mock browser window environment
globalThis.window = globalThis;

let testsPassed = 0;
let testsFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ PASS: ${message}`);
    testsPassed++;
  } else {
    console.error(`  ✗ FAIL: ${message}`);
    testsFailed++;
  }
}

console.log("=== RUNNING ROADSENSE GEOLOCATION TEST SUITE ===\n");

// Test 1: Configuration Options
console.log("Test 1: Verification of Geolocation Request Parameters");
assert(
  GEOLOCATION_OPTIONS.maximumAge === 0,
  "maximumAge must be 0 to prevent serving stale cached positions"
);
assert(
  GEOLOCATION_OPTIONS.enableHighAccuracy === true,
  "enableHighAccuracy must be true to request hardware GPS"
);
assert(
  GEOLOCATION_OPTIONS.timeout >= 10000,
  "timeout must be at least 10,000 ms to give GPS fix sufficient time"
);

// Test 2: Accuracy Formatting
console.log("\nTest 2: Accuracy Unit Formatting");
assert(formatGpsAccuracy(15) === "± 15 m", "15m formatted as '± 15 m'");
assert(formatGpsAccuracy(450) === "± 450 m", "450m formatted as '± 450 m'");
assert(formatGpsAccuracy(25400) === "± 25.40 km", "25,400m formatted as '± 25.40 km'");
assert(formatGpsAccuracy(1000) === "± 1.00 km", "1000m formatted as '± 1.00 km'");
assert(formatGpsAccuracy(null) === "Unknown", "null formatted as 'Unknown'");

// Test 3: Accuracy Tier Classification & Poor Accuracy Detection
console.log("\nTest 3: Accuracy Tier Classification & Poor Accuracy Detection");
const highAcc = getAccuracyRating(12);
assert(highAcc.tier === "high", "12m classified as 'high' precision tier");
assert(!highAcc.isApproximate, "12m is NOT flagged as approximate");

const modAcc = getAccuracyRating(120);
assert(modAcc.tier === "moderate", "120m classified as 'moderate' precision tier");
assert(!modAcc.isApproximate, "120m is NOT flagged as approximate");

// Testing the Doha Qatar case reported by user (e.g. 25,400m radius from IP-based geolocation)
const dohaNetworkAcc = getAccuracyRating(25400);
assert(
  dohaNetworkAcc.tier === "approximate",
  "25,400m (Doha IP network geolocation) correctly classified as 'approximate'"
);
assert(
  dohaNetworkAcc.isApproximate === true,
  "25,400m correctly flagged as isApproximate=true for user warning"
);

// Test 4: Error Handling & Guidance
console.log("\nTest 4: Error Code Classification & Actionable Guidance");
const errDenied = getGeolocationErrorMessage({ code: 1, message: "User denied" });
assert(
  errDenied.toLowerCase().includes("denied") &&
    errDenied.toLowerCase().includes("browser settings"),
  "Code 1 (PERMISSION_DENIED) contains browser settings instructions"
);

const errUnavail = getGeolocationErrorMessage({ code: 2, message: "Position unavailable" });
assert(
  errUnavail.toLowerCase().includes("unavailable") &&
    errUnavail.toLowerCase().includes("location services"),
  "Code 2 (POSITION_UNAVAILABLE) contains device settings instructions"
);

const errTimeout = getGeolocationErrorMessage({ code: 3, message: "Timeout" });
assert(
  errTimeout.toLowerCase().includes("timed out") &&
    errTimeout.toLowerCase().includes("refresh"),
  "Code 3 (TIMEOUT) contains refresh / retry guidance"
);

// Test 5: Simulated Mock Geolocation Retrieval (High Precision)
console.log("\nTest 5: Simulated Hardware GPS Retrieval");
const mockPositionHigh = {
  coords: {
    latitude: 16.506174,
    longitude: 80.648015,
    accuracy: 14.5,
    altitude: 18.0,
    speed: 0.0,
    heading: null,
  },
  timestamp: 1773000000000,
};

Object.defineProperty(globalThis.navigator, "geolocation", {
  value: {
    getCurrentPosition: (success, error, options) => {
      assert(options.maximumAge === 0, "Called getCurrentPosition with maximumAge: 0");
      assert(options.enableHighAccuracy === true, "Called with enableHighAccuracy: true");
      success(mockPositionHigh);
    },
  },
  configurable: true,
  writable: true,
});

const resultHigh = await getCurrentPositionAsync();
assert(resultHigh.latitude === 16.506174, `Returned latitude ${resultHigh.latitude}`);
assert(resultHigh.longitude === 80.648015, `Returned longitude ${resultHigh.longitude}`);
assert(resultHigh.accuracy === 15, `Returned rounded accuracy ${resultHigh.accuracy}m`);
assert(resultHigh.isApproximate === false, "High precision fix marked isApproximate=false");

// Test 6: Simulated Approximate / Network IP Location (Doha, Qatar scenario)
console.log("\nTest 6: Simulated Network / IP Geolocation (Doha Coordinates)");
const mockPositionDoha = {
  coords: {
    latitude: 25.2809,
    longitude: 51.5509,
    accuracy: 25410, // ~25.4 km accuracy radius typical of laptop IP lookup
    altitude: null,
    speed: null,
    heading: null,
  },
  timestamp: Date.now(),
};

global.navigator.geolocation.getCurrentPosition = (success, error, options) => {
  success(mockPositionDoha);
};

const resultDoha = await getCurrentPositionAsync();
assert(resultDoha.latitude === 25.2809, `Actual coordinates returned: Latitude ${resultDoha.latitude}`);
assert(resultDoha.longitude === 51.5509, `Actual coordinates returned: Longitude ${resultDoha.longitude}`);
assert(resultDoha.accuracy === 25410, `Actual accuracy returned: ${resultDoha.accuracy}m`);
assert(resultDoha.isApproximate === true, "Large accuracy radius automatically flagged as approximate");
assert(
  resultDoha.accuracyFormatted === "± 25.41 km",
  `Formatted accuracy correctly shows km: ${resultDoha.accuracyFormatted}`
);

// Test 7: Simulated Permission Denied
console.log("\nTest 7: Simulated Permission Denied Response");
global.navigator.geolocation.getCurrentPosition = (success, error, options) => {
  error({ code: 1, message: "User denied Geolocation" });
};

try {
  await getCurrentPositionAsync();
  assert(false, "Should have thrown on error code 1");
} catch (err) {
  assert(err.code === 1, "Caught error code 1 (PERMISSION_DENIED)");
  assert(
    err.message.includes("browser settings"),
    "Error message guides user on how to allow permission"
  );
}

// Test 8: Simulated Timeout Error
console.log("\nTest 8: Simulated Timeout Response");
global.navigator.geolocation.getCurrentPosition = (success, error, options) => {
  error({ code: 3, message: "Position acquisition timed out" });
};

try {
  await getCurrentPositionAsync();
  assert(false, "Should have thrown on timeout");
} catch (err) {
  assert(err.code === 3, "Caught error code 3 (TIMEOUT)");
  assert(err.message.includes("timed out"), "Timeout error message verified");
}

console.log("\n================================================");
console.log(`TOTAL TESTS: ${testsPassed + testsFailed}`);
console.log(`PASSED: ${testsPassed}`);
console.log(`FAILED: ${testsFailed}`);
console.log("================================================\n");

if (testsFailed > 0) {
  process.exit(1);
}
