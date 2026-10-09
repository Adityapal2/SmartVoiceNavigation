import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useLocalSearchParams } from "expo-router";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";

import {
  StyleSheet,
  View,
  TouchableOpacity,
  Text,
  TextInput,
  ScrollView,
  Alert,
  Modal,
  Animated,
  PanResponder,
  Keyboard,
  Linking,
} from "react-native";


import { SafeAreaView } from "react-native-safe-area-context";

import * as Location from "expo-location";
import * as Speech from "expo-speech";

import MapView, {
  Marker,
  Polyline,
  PROVIDER_GOOGLE,
} from "react-native-maps";

import { Ionicons } from "@expo/vector-icons";


import {
  setNavigationListener,
  clearNavigation,
  type NavigationRequest,
} from "../../services/navigation";

import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../../firebase";


// ==================================================
// GOOGLE MAPS API KEYS
// ==================================================

// Keep Google API keys out of source control.
// Put them in app.json/app.config.js -> extra.googleMapsRoutesApiKey
// and extra.googlePlacesApiKey, or use your preferred secure config layer.
const EXTRA = (Constants.expoConfig?.extra || {}) as Record<string, unknown>;
const ROUTES_API_KEY = String(EXTRA.googleMapsRoutesApiKey || "");
const PLACES_API_KEY = String(EXTRA.googlePlacesApiKey || "");

const assertApiKey = (key: string, service: string) => {
  if (!key || key === "undefined" || key === "null") {
    throw new Error(
      `${service} API key is missing. Add it to Expo extra configuration.`
    );
  }
};



// ==================================================
// NAVIGATION MAP STYLE
// ==================================================

const NAVIGATION_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d2630" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#9aa7b4" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1d2630" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#34424e" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#455867" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#d6dde3" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0f2834" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#23313b" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#9aa7b4" }] },
];


// ==================================================
// DEFAULT MAP REGION
// ==================================================

const DEFAULT_REGION = {
  latitude: 28.6139,
  longitude: 77.2090,
  latitudeDelta: 0.05,
  longitudeDelta: 0.05,
};


// ==================================================
// TYPES
// ==================================================

type Coordinates = {
  latitude: number;
  longitude: number;
};

type RouteStep = {
  distanceMeters: number;
  instruction: string;
  maneuver: string;
  endLocation?: Coordinates;
};


type EmergencyContact = {
  id: string;
  name: string;
  relation: string;
  phone: string;
};

const buildEmergencyMessage = (location?: Coordinates | null) => {
  if (location) {
    const mapsUrl =
      `https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;

    return [
      "🚨 EMERGENCY ALERT",
      "I may need help. Please contact me as soon as possible.",
      "",
      "My current location:",
      mapsUrl,
    ].join("\n");
  }

  return [
    "🚨 EMERGENCY ALERT",
    "I may need help. Please contact me as soon as possible.",
    "My current GPS location is currently unavailable.",
  ].join("\n");
};


// ==================================================
// HELPERS
// ==================================================

const toRadians = (value: number) => (value * Math.PI) / 180;

const distanceBetween = (a: Coordinates, b: Coordinates) => {
  const earthRadius = 6371000;
  const dLat = toRadians(b.latitude - a.latitude);
  const dLon = toRadians(b.longitude - a.longitude);
  const lat1 = toRadians(a.latitude);
  const lat2 = toRadians(b.latitude);
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * earthRadius * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
};

const distanceToRouteMeters = (point: Coordinates, route: Coordinates[]) => {
  if (route.length < 2) return Number.POSITIVE_INFINITY;

  let minimum = Number.POSITIVE_INFINITY;

  // Local equirectangular approximation is accurate enough for short road segments.
  const latScale = 111320;
  const lonScale = 111320 * Math.cos(toRadians(point.latitude));
  const px = point.longitude * lonScale;
  const py = point.latitude * latScale;

  for (let i = 0; i < route.length - 1; i += 1) {
    const ax = route[i].longitude * lonScale;
    const ay = route[i].latitude * latScale;
    const bx = route[i + 1].longitude * lonScale;
    const by = route[i + 1].latitude * latScale;
    const dx = bx - ax;
    const dy = by - ay;
    const lengthSquared = dx * dx + dy * dy;
    const t = lengthSquared === 0
      ? 0
      : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
    const cx = ax + t * dx;
    const cy = ay + t * dy;
    minimum = Math.min(minimum, Math.hypot(px - cx, py - cy));
  }

  return minimum;
};


// ==================================================
// BOTTOM SHEET CONSTANTS
// ==================================================

const SHEET_OPEN = 0;
const SHEET_CLOSED = 430;


// ==================================================
// MAP SCREEN
// ==================================================

export default function MapScreen() {

  // ------------------------------------------------
  // ROUTER PARAMS
  // ------------------------------------------------

  const params = useLocalSearchParams<{
    destination?: string;
    autoStart?: string;
    navigationAction?: string;
  }>();

  const autoNavigationKeyRef = useRef<string | null>(null);
  const autoStartNavigationRef = useRef(false);
  const lastNavigationActionRef = useRef<string | null>(null);
  const navigationHandlerRef = useRef<
    ((payload: { destination: string }) => void | Promise<void>) | null
  >(null);


  // ------------------------------------------------
  // REFS
  // ------------------------------------------------

  const mapRef = useRef<MapView>(null);
  const locationSubscriptionRef = useRef<Location.LocationSubscription | null>(null);
  const routeStepsRef = useRef<RouteStep[]>([]);
  const currentStepIndexRef = useRef(0);
  const offRouteCountRef = useRef(0);
  const reroutingRef = useRef(false);
  const arrivalHandledRef = useRef(false);

  // ==================================================
  // ROUTES API REQUEST PROTECTION
  // ==================================================
  // These guards prevent accidental duplicate/rapid ComputeRoutes calls.
  // They do not change Google's quota; they only reduce requests made by this app.
  const trafficCheckingRef = useRef(false);
  const routeRequestInFlightRef = useRef(false);
  const lastRouteRequestAtRef = useRef(0);
  const lastRouteKeyRef = useRef<string | null>(null);
  const lastRouteSuccessAtRef = useRef(0);
  const routeQuotaBlockedUntilRef = useRef(0);
  const trafficCacheRef = useRef<{
    key: string;
    checkedAt: number;
    travelMinutes: number;
    normalMinutes: number;
    delayMinutes: number;
    trafficLevel: string;
  } | null>(null);

  // Conservative client-side daily budget. This protects the app from
  // runaway loops. It cannot protect the whole Google Cloud project if
  // other apps/devices use the same project.
  const ROUTES_DAILY_CLIENT_LIMIT = 80;
  const ROUTES_MIN_INTERVAL_MS = 5000;
  const ROUTE_CACHE_MS = 60 * 1000;
  const TRAFFIC_CACHE_MS = 2 * 60 * 1000;


  // ------------------------------------------------
  // STATE — CATEGORY
  // ------------------------------------------------

  const [selected, setSelected] = useState("All");

  const categories = ["All", "ATM", "Hospital", "Petrol Pump", "Restaurant", "Police"];


  // ------------------------------------------------
  // STATE — LOCATION
  // ------------------------------------------------

  const [origin, setOrigin] = useState<Coordinates | null>(null);
  const [region, setRegion] = useState(DEFAULT_REGION);
  const [currentSpeed, setCurrentSpeed] = useState(0);


  // ------------------------------------------------
  // STATE — DESTINATION
  // ------------------------------------------------

  const [destination, setDestination] = useState<Coordinates | null>(null);
  const [destinationName, setDestinationName] = useState("");

  // Saved Home/Work addresses are cached locally first so the cards
  // render immediately while Firebase refreshes them in the background.
  const [savedHomeAddress, setSavedHomeAddress] = useState("");
  const [savedWorkAddress, setSavedWorkAddress] = useState("");
  const [savedPlacesLoading, setSavedPlacesLoading] = useState(false);
  const savedPlacesLoadedRef = useRef(false);
  const locationLoadedRef = useRef(false);

  const HOME_WORK_CACHE_KEY = "smartVoiceNavigation_homeWorkCache";


  // ------------------------------------------------
  // STATE — SEARCH
  // ------------------------------------------------

  const [searchActive, setSearchActive] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);

  // Prevent a Google Places request on every typed character.
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSearchQueryRef = useRef("");
  const searchRequestIdRef = useRef(0);


  // ------------------------------------------------
  // STATE — ROUTE
  // ------------------------------------------------

  const [routeReady, setRouteReady] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<Coordinates[]>([]);
  const [routeSteps, setRouteSteps] = useState<RouteStep[]>([]);
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [navigationStarted, setNavigationStarted] = useState(false);
  const [navigationPaused, setNavigationPaused] = useState(false);
  const [avoidTraffic, setAvoidTraffic] = useState(false);
  const [avoidTolls, setAvoidTolls] = useState(false);
  const [avoidHighways, setAvoidHighways] = useState(false);
  const [avoidFerries, setAvoidFerries] = useState(false);
  const [navigationLanguage, setNavigationLanguage] = useState<"en-US" | "hi-IN">("en-US");
  const [voiceSpeed, setVoiceSpeed] = useState(1.0);
  const [travelInfo, setTravelInfo] = useState<{ distance: number; duration: number } | null>(null);


  // ==================================================
  // POLYLINE DECODER
  // ==================================================

  const decodePolyline = useCallback((encoded: string): Coordinates[] => {
    const points: Coordinates[] = [];
    let index = 0;
    let latitude = 0;
    let longitude = 0;

    while (index < encoded.length) {
      let shift = 0;
      let result = 0;
      let byte = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      latitude += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;

      do {
        byte = encoded.charCodeAt(index++) - 63;
        result |= (byte & 0x1f) << shift;
        shift += 5;
      } while (byte >= 0x20);

      longitude += (result & 1) !== 0 ? ~(result >> 1) : result >> 1;

      points.push({ latitude: latitude / 1e5, longitude: longitude / 1e5 });
    }

    return points;
  }, []);


  // ==================================================
  // PERSISTENT NAVIGATION SETTINGS
  // ==================================================
  useEffect(() => {
    void (async () => {
      try {
        const raw = await AsyncStorage.getItem("@smart_voice_navigation_settings");
        if (!raw) return;
        const saved = JSON.parse(raw);
        if (typeof saved.traffic === "boolean") setAvoidTraffic(saved.traffic);
        else if (typeof saved.avoidTraffic === "boolean") setAvoidTraffic(saved.avoidTraffic);
        if (typeof saved.avoidTolls === "boolean") setAvoidTolls(saved.avoidTolls);
        if (typeof saved.avoidHighways === "boolean") setAvoidHighways(saved.avoidHighways);
        if (typeof saved.avoidFerries === "boolean") setAvoidFerries(saved.avoidFerries);
        if (saved.voiceLanguage === "Hindi (India)") setNavigationLanguage("hi-IN");
        else if (saved.voiceLanguage === "English (India)" || saved.voiceLanguage === "Hinglish") setNavigationLanguage("en-US");
        else if (saved.navigationLanguage === "hi-IN" || saved.navigationLanguage === "en-US") setNavigationLanguage(saved.navigationLanguage);
        if (typeof saved.voiceSpeed === "number") setVoiceSpeed(Math.min(1.2, Math.max(0.7, saved.voiceSpeed)));
      } catch (e) { console.warn("[Map] Navigation settings load failed", e); }
    })();
  }, []);

  // Navigation preferences are owned by Settings and read here.
  // Route recalculation uses the latest in-memory values.


  const speakNavigationInstruction = useCallback((instruction: string) => {
    const value = String(instruction || "").trim();
    if (!value) return;
    Speech.stop();
    if (navigationLanguage === "hi-IN") {
      let hindi = value
        .replace(/Make a U-turn/gi, "यू-टर्न लें")
        .replace(/Turn sharp left/gi, "तेज़ बाएँ मुड़ें")
        .replace(/Turn sharp right/gi, "तेज़ दाएँ मुड़ें")
        .replace(/Turn left/gi, "बाएँ मुड़ें")
        .replace(/Turn right/gi, "दाएँ मुड़ें")
        .replace(/Keep left/gi, "बाएँ रहें")
        .replace(/Keep right/gi, "दाएँ रहें")
        .replace(/Continue/gi, "सीधे चलते रहें")
        .replace(/Take the roundabout/gi, "राउंडअबाउट लें")
        .replace(/At the roundabout/gi, "राउंडअबाउट पर")
        .replace(/Destination reached/gi, "आप अपने गंतव्य पर पहुँच गए हैं")
        .replace(/Arrive at/gi, "गंतव्य पर पहुँचें");
      if (hindi === value) hindi = `आगे: ${value}`;
      Speech.speak(hindi, { language: "hi-IN", rate: 0.95 });
    } else {
      Speech.speak(value, { language: "en-US", rate: 0.95 });
    }
  }, [navigationLanguage, voiceSpeed]);

  // ==================================================
  // ROUTES API QUOTA / CACHE HELPERS
  // ==================================================

  const getRoutesUsageKey = useCallback(() => {
    const day = new Date().toISOString().slice(0, 10);
    return `smartVoiceNavigation_routesUsage_${day}`;
  }, []);

  const getRoutesUsageCount = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(getRoutesUsageKey());
      const count = Number(raw || 0);
      return Number.isFinite(count) ? count : 0;
    } catch {
      return 0;
    }
  }, [getRoutesUsageKey]);

  const incrementRoutesUsage = useCallback(async () => {
    const next = (await getRoutesUsageCount()) + 1;
    try {
      await AsyncStorage.setItem(getRoutesUsageKey(), String(next));
    } catch (error) {
      console.warn("[Routes API] Usage counter save failed:", error);
    }
    return next;
  }, [getRoutesUsageCount, getRoutesUsageKey]);

  const makeRouteRequestKey = useCallback((
    routeOrigin: Coordinates,
    routeDestination: Coordinates,
    options: { alternative?: boolean; avoidTraffic?: boolean } = {}
  ) => {
    // Four decimal places is roughly 11 m latitude precision. This avoids
    // treating tiny GPS jitter as a completely new route request.
    const round = (n: number) => Math.round(n * 10000) / 10000;
    return JSON.stringify({
      o: [round(routeOrigin.latitude), round(routeOrigin.longitude)],
      d: [round(routeDestination.latitude), round(routeDestination.longitude)],
      a: Boolean(options.alternative),
      t: Boolean(options.avoidTraffic),
      tolls: Boolean(avoidTolls),
      highways: Boolean(avoidHighways),
      ferries: Boolean(avoidFerries),
      language: navigationLanguage,
    });
  }, [avoidFerries, avoidHighways, avoidTolls, navigationLanguage]);

  // ==================================================
  // CALCULATE ROUTE
  // ==================================================

  const calculateRoute = useCallback(
    async (
      routeOrigin: Coordinates,
      routeDestination: Coordinates,
      options: {
        alternative?: boolean;
        avoidTraffic?: boolean;
      } = {}
    ) => {
      try {
        assertApiKey(ROUTES_API_KEY, "Google Routes");

        const now = Date.now();
        const routeKey = makeRouteRequestKey(routeOrigin, routeDestination, options);

        if (routeQuotaBlockedUntilRef.current > now) {
          const minutes = Math.ceil(
            (routeQuotaBlockedUntilRef.current - now) / 60000
          );
          console.warn(
            `[Routes API] Temporarily blocked after quota error. Retry in about ${minutes} min.`
          );
          Alert.alert(
            "Routes API Limit",
            `Google Routes API quota was reached. The app will wait about ${minutes} minutes before trying again.`
          );
          return false;
        }

        if (routeRequestInFlightRef.current) {
          console.log("[Routes API] Request already in progress. Skipping duplicate.");
          return false;
        }

        if (
          lastRouteKeyRef.current === routeKey &&
          now - lastRouteSuccessAtRef.current < ROUTE_CACHE_MS
        ) {
          console.log("[Routes API] Using cached route. Skipping duplicate request.");
          return true;
        }

        if (now - lastRouteRequestAtRef.current < ROUTES_MIN_INTERVAL_MS) {
          console.log("[Routes API] Rate guard active. Skipping rapid duplicate request.");
          return false;
        }

        const usageCount = await getRoutesUsageCount();
        if (usageCount >= ROUTES_DAILY_CLIENT_LIMIT) {
          console.warn("[Routes API] Daily client safety limit reached:", usageCount);
          Alert.alert(
            "Routes API Safety Limit",
            `This app has stopped new route requests after ${ROUTES_DAILY_CLIENT_LIMIT} requests today to help protect the Google quota. Try again tomorrow.`
          );
          return false;
        }

        routeRequestInFlightRef.current = true;
        lastRouteRequestAtRef.current = now;
        await incrementRoutesUsage();

        console.log("[Routes API] Calculating route...");

        setRouteReady(false);
        setNavigationStarted(false);
        setNavigationPaused(false);
        setTravelInfo(null);
        setRouteCoordinates([]);
        setRouteSteps([]);
        routeStepsRef.current = [];
        setCurrentStepIndex(0);
        currentStepIndexRef.current = 0;

        const response = await fetch(
          "https://routes.googleapis.com/directions/v2:computeRoutes",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": ROUTES_API_KEY,
              "X-Goog-FieldMask":
                "routes.distanceMeters,routes.duration,routes.staticDuration,routes.polyline.encodedPolyline,routes.legs.steps.distanceMeters,routes.legs.steps.navigationInstruction,routes.legs.steps.endLocation",
            },
            body: JSON.stringify({
              origin: { location: { latLng: { latitude: routeOrigin.latitude, longitude: routeOrigin.longitude } } },
              destination: { location: { latLng: { latitude: routeDestination.latitude, longitude: routeDestination.longitude } } },
              travelMode: "DRIVE",
              routingPreference: options.avoidTraffic
                ? "TRAFFIC_AWARE_OPTIMAL"
                : "TRAFFIC_AWARE",
              computeAlternativeRoutes: Boolean(options.alternative),
              routeModifiers: {
                avoidTolls: options.avoidTolls ?? avoidTolls,
                avoidHighways: options.avoidHighways ?? avoidHighways,
                avoidFerries: options.avoidFerries ?? avoidFerries,
              },
              languageCode: navigationLanguage,
              units: "METRIC",
            }),
          }
        );

        const data = await response.json();

        if (!response.ok) {
          throw new Error(data?.error?.message || `Routes API HTTP ${response.status}`);
        }

        const routes = Array.isArray(data?.routes) ? data.routes : [];
        const route =
          options.alternative && routes.length > 1
            ? routes[1]
            : routes[0];

        if (!route) throw new Error("No route found.");

        const steps: RouteStep[] = (route?.legs || []).flatMap((leg: any) =>
          (leg?.steps || []).map((step: any) => ({
            distanceMeters: Number(step?.distanceMeters || 0),
            instruction: step?.navigationInstruction?.instructions || "Continue straight",
            maneuver: step?.navigationInstruction?.maneuver || "STRAIGHT",
            endLocation: step?.endLocation?.latLng
              ? {
                  latitude: Number(step.endLocation.latLng.latitude),
                  longitude: Number(step.endLocation.latLng.longitude),
                }
              : undefined,
          }))
        );

        setRouteSteps(steps);
        routeStepsRef.current = steps;
        setCurrentStepIndex(0);
        currentStepIndexRef.current = 0;

        const encodedPolyline = route?.polyline?.encodedPolyline;
        if (!encodedPolyline) throw new Error("Routes API did not return a route polyline.");

        const coordinates = decodePolyline(encodedPolyline);
        if (coordinates.length < 2) throw new Error("The returned route contains too few points.");

        const distanceKm = Number(route.distanceMeters || 0) / 1000;
        const durationMinutes =
          Number.parseFloat(String(route.duration || "0").replace("s", "")) / 60;

        setRouteCoordinates(coordinates);
        setTravelInfo({ distance: distanceKm, duration: durationMinutes });
        lastRouteKeyRef.current = routeKey;
        lastRouteSuccessAtRef.current = Date.now();
        routeQuotaBlockedUntilRef.current = 0;

        // Save the traffic-aware duration from this route so a voice command
        // like "traffic batao" can answer from the already-fetched route
        // instead of immediately spending another ComputeRoutes request.
        const trafficDurationSeconds = Number(
          String(route.duration || "0").replace("s", "")
        );
        const staticDurationSeconds = Number(
          String(route.staticDuration || route.duration || "0").replace("s", "")
        );
        const delayMinutes = Math.max(
          0,
          Math.round((trafficDurationSeconds - staticDurationSeconds) / 60)
        );
        const travelMinutes = Math.round(trafficDurationSeconds / 60);
        const normalMinutes = Math.round(staticDurationSeconds / 60);
        const trafficLevel =
          delayMinutes > 15 ? "heavy" : delayMinutes > 5 ? "moderate" : "light";
        trafficCacheRef.current = {
          key: routeKey,
          checkedAt: Date.now(),
          travelMinutes,
          normalMinutes,
          delayMinutes,
          trafficLevel,
        };

        setRouteReady(true);

        const shouldAutoStart = autoStartNavigationRef.current;
        autoStartNavigationRef.current = false;
        setNavigationPaused(false);
        offRouteCountRef.current = 0;
        reroutingRef.current = false;
        arrivalHandledRef.current = false;
        setNavigationStarted(shouldAutoStart);

        console.log(
          "[Routes API] Route ready:",
          distanceKm.toFixed(1),
          "km",
          Math.round(durationMinutes),
          "min",
          shouldAutoStart ? "(auto-start)" : ""
        );

        mapRef.current?.fitToCoordinates(coordinates, {
          edgePadding: { top: 180, right: 50, bottom: 350, left: 50 },
          animated: true,
        });

        setTimeout(() => {
          mapRef.current?.animateCamera({ center: routeOrigin, zoom: 17, pitch: 45 }, { duration: 900 });
        }, 900);

        closeSheet();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.warn("[Map] Routes API error:", message);

        if (/quota exceeded|daily quota|rate limit|resource exhausted/i.test(message)) {
          // Stop this app from hammering a project after Google reports quota exhaustion.
          routeQuotaBlockedUntilRef.current = Date.now() + 60 * 60 * 1000;
        }

        setRouteReady(false);
        setNavigationStarted(false);
        setRouteCoordinates([]);
        setTravelInfo(null);
        Alert.alert("Route Error", message);
        return false;
      } finally {
        routeRequestInFlightRef.current = false;
      }
    },
    [
      decodePolyline,
      getRoutesUsageCount,
      incrementRoutesUsage,
      makeRouteRequestKey,
      avoidFerries,
      avoidHighways,
      avoidTolls,
      navigationLanguage,
    ]
  );


  // ==================================================
  // BOTTOM SHEET ANIMATION
  // ==================================================

  const sheetTranslateY = useRef(new Animated.Value(SHEET_OPEN)).current;
  const currentSheetPosition = useRef(SHEET_OPEN);

  useEffect(() => {
    const listener = sheetTranslateY.addListener(({ value }) => {
      currentSheetPosition.current = value;
    });
    return () => sheetTranslateY.removeListener(listener);
  }, [sheetTranslateY]);


  // ==================================================
  // PAN RESPONDER
  // ==================================================

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 5,

      onPanResponderMove: (_, gesture) => {
        const start = currentSheetPosition.current;
        let newPos = Math.min(SHEET_CLOSED, Math.max(SHEET_OPEN, start + gesture.dy));
        sheetTranslateY.setValue(newPos);
      },

      onPanResponderRelease: (_, gesture) => {
        const current = currentSheetPosition.current;
        let target = SHEET_OPEN;

        if (gesture.dy > 100 || gesture.vy > 0.8) target = SHEET_CLOSED;
        else if (gesture.dy < -100 || gesture.vy < -0.8) target = SHEET_OPEN;
        else target = current > SHEET_CLOSED / 2 ? SHEET_CLOSED : SHEET_OPEN;

        Animated.spring(sheetTranslateY, {
          toValue: target,
          useNativeDriver: true,
          tension: 80,
          friction: 12,
        }).start();
      },
    })
  ).current;


  // ==================================================
  // SHEET HELPERS
  // ==================================================

  const openSheet = useCallback(() => {
    Animated.spring(sheetTranslateY, {
      toValue: SHEET_OPEN,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [sheetTranslateY]);

  const closeSheet = useCallback(() => {
    Animated.spring(sheetTranslateY, {
      toValue: SHEET_CLOSED,
      useNativeDriver: true,
      tension: 80,
      friction: 12,
    }).start();
  }, [sheetTranslateY]);


  // ==================================================
  // GET CURRENT LOCATION
  // ==================================================

  const getCurrentLocation = useCallback(async () => {
    if (locationLoadedRef.current) return origin;
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        console.warn("[Map] Location permission denied");
        return null;
      }

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      const coords: Coordinates = {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };

      const currentRegion = { ...coords, latitudeDelta: 0.01, longitudeDelta: 0.01 };

      setRegion(currentRegion);
      setOrigin(coords);
      locationLoadedRef.current = true;
      mapRef.current?.animateToRegion(currentRegion, 1000);

      console.log("[Map] Current location:", coords);
      return coords;
    } catch (error) {
      console.warn("[Map] Location error:", error);
      return null;
    }
  }, []);


  // ==================================================
  // FIND DESTINATION (PLACES API)
  // ==================================================

  const findDestination = useCallback(async (place: string) => {
    try {
      assertApiKey(PLACES_API_KEY, "Google Places");
      console.log("[Map] Searching destination:", place);

      const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": PLACES_API_KEY,
          "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({
          textQuery: place,
          languageCode: "en",
          maxResultCount: 1,
          ...(origin
            ? {
                locationBias: {
                  circle: {
                    center: {
                      latitude: origin.latitude,
                      longitude: origin.longitude,
                    },
                    radius: 50000,
                  },
                },
              }
            : {}),
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data?.error?.message || `Places API HTTP ${response.status}`);
      }

      const result = data?.places?.[0];

      if (!result?.location) {
        Alert.alert("Destination not found", `I couldn't find "${place}".`);
        return null;
      }

      const coords: Coordinates = {
        latitude: Number(result.location.latitude),
        longitude: Number(result.location.longitude),
      };

      return {
        coords,
        formattedAddress: result.formattedAddress || result.displayName?.text || place,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[Map] Places API error:", message);
      Alert.alert("Destination Search Error", message);
      return null;
    }
  }, [origin]);


  // ==================================================
  // FAST HOME / WORK LOADING
  // ==================================================

  const applySavedPlaceData = useCallback((data: any) => {
    const homeObject = data?.homeDetails;
    const workObject = data?.workDetails;

    const home =
      (typeof homeObject === "object" && homeObject
        ? [homeObject.houseNumber, homeObject.street, homeObject.area,
           homeObject.city, homeObject.state, homeObject.country,
           homeObject.pincode, homeObject.landmark]
            .filter(Boolean).join(", ")
        : "") ||
      data?.homeAddress ||
      [data?.homeHouseNumber, data?.homeStreet, data?.homeArea,
       data?.homeCity, data?.homeState, data?.homeCountry,
       data?.homePincode, data?.homeLandmark].filter(Boolean).join(", ");

    const work =
      (typeof workObject === "object" && workObject
        ? [workObject.officeName, workObject.houseNumber, workObject.street,
           workObject.area, workObject.city, workObject.state,
           workObject.country, workObject.pincode, workObject.landmark]
            .filter(Boolean).join(", ")
        : "") ||
      data?.workAddress ||
      [data?.workOfficeName, data?.workArea, data?.workCity,
       data?.workState, data?.workCountry, data?.workPincode,
       data?.workLandmark].filter(Boolean).join(", ");

    setSavedHomeAddress(typeof home === "string" ? home.trim() : "");
    setSavedWorkAddress(typeof work === "string" ? work.trim() : "");
    return {
      home: typeof home === "string" ? home.trim() : "",
      work: typeof work === "string" ? work.trim() : "",
    };
  }, []);

  const loadSavedPlaces = useCallback(async () => {
    // 1. Instant local cache.
    try {
      const cached = await AsyncStorage.getItem(HOME_WORK_CACHE_KEY);
      if (cached) {
        applySavedPlaceData(JSON.parse(cached));
      }
    } catch (error) {
      console.warn("[Map] Home/Work cache read error:", error);
    }

    const user = auth.currentUser;
    if (!user) return;

    // 2. Firebase refresh in background. The map never blocks on this.
    setSavedPlacesLoading(true);
    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return;
      const data = snap.data();
      const places = applySavedPlaceData(data);

      // Keep the cache in sync for the next instant render.
      await AsyncStorage.setItem(
        HOME_WORK_CACHE_KEY,
        JSON.stringify({ homeAddress: places.home, workAddress: places.work })
      );
    } catch (error) {
      console.warn("[Map] Home/Work Firebase load error:", error);
    } finally {
      setSavedPlacesLoading(false);
    }
  }, [applySavedPlaceData]);

  useEffect(() => {
    if (savedPlacesLoadedRef.current) return;
    savedPlacesLoadedRef.current = true;
    void loadSavedPlaces();
  }, [loadSavedPlaces]);

  // Refresh when the authenticated user changes.
  useEffect(() => {
    const unsubscribe = auth.onAuthStateChanged(() => {
      void loadSavedPlaces();
    });
    return unsubscribe;
  }, [loadSavedPlaces]);


  // ==================================================
  // EMERGENCY / SOS
  // ==================================================

  const [sosLoading, setSosLoading] = useState(false);
  const [sosContacts, setSosContacts] = useState<EmergencyContact[]>([]);
  const [selectedSosIds, setSelectedSosIds] = useState<string[]>([]);
  const [sosLocation, setSosLocation] = useState<Coordinates | null>(null);
  const [sosPickerVisible, setSosPickerVisible] = useState(false);

  const loadEmergencyContacts = useCallback(async (): Promise<EmergencyContact[]> => {
    const user = auth.currentUser;
    if (!user) return [];

    try {
      const snap = await getDoc(doc(db, "users", user.uid));
      if (!snap.exists()) return [];

      const data = snap.data();
      const contacts = Array.isArray(data?.emergencyContacts)
        ? data.emergencyContacts
        : data?.emergencyContact
          ? [data.emergencyContact]
          : [];

      return contacts
        .filter((contact: any) => contact?.phone)
        .map((contact: any, index: number) => ({
          id: String(contact?.id || index),
          name: String(contact?.name || "Emergency Contact"),
          relation: String(contact?.relation || "Emergency Contact"),
          phone: String(contact?.phone || ""),
        }));
    } catch (error) {
      console.warn("[SOS] Emergency contacts load error:", error);
      return [];
    }
  }, []);

  const getEmergencyLocation = useCallback(async (): Promise<Coordinates | null> => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return null;

      const location = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.High,
      });

      return {
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
      };
    } catch (error) {
      console.warn("[SOS] Location unavailable:", error);
      return null;
    }
  }, []);

  const buildSosMessage = useCallback((location: Coordinates | null) => {
    if (!location) {
      return "Emergency SOS: I may need help. My GPS location is currently unavailable. Please contact me as soon as possible.";
    }

    return `Emergency SOS: I may need help. Please contact me as soon as possible.

My current location:
https://www.google.com/maps/search/?api=1&query=${location.latitude},${location.longitude}`;
  }, []);

  const openEmergencySms = useCallback(
    async (contacts: EmergencyContact[], location: Coordinates | null) => {
      if (!contacts.length) return false;

      // Most Android SMS apps accept comma-separated recipients. If the
      // device does not support it, fall back to the first selected contact.
      const recipients = contacts.map((c) => c.phone).join(",");
      const body = buildSosMessage(location);
      const url = `sms:${recipients}?body=${encodeURIComponent(body)}`;

      try {
        const supported = await Linking.canOpenURL(url);
        if (!supported) {
          Alert.alert("SMS Unavailable", "Your device cannot open the SMS application.");
          return false;
        }

        await Linking.openURL(url);
        return true;
      } catch (error) {
        console.error("[SOS] SMS error:", error);
        Alert.alert("SMS Error", "Unable to open the SMS application.");
        return false;
      }
    },
    [buildSosMessage]
  );

  const openEmergencyCall = useCallback(async (contact: EmergencyContact) => {
    const url = `tel:${contact.phone}`;
    try {
      const supported = await Linking.canOpenURL(url);
      if (!supported) {
        Alert.alert("Call Unavailable", "Your device cannot open the phone dialer.");
        return;
      }
      await Linking.openURL(url);
    } catch (error) {
      console.error("[SOS] Call error:", error);
      Alert.alert("Call Error", "Unable to open the phone dialer.");
    }
  }, []);

  const openSosActions = useCallback((contacts: EmergencyContact[], location: Coordinates | null) => {
    const names = contacts.map((c) => c.name).join(", ");
    const locationStatus = location
      ? `GPS location attached:
${location.latitude.toFixed(6)}, ${location.longitude.toFixed(6)}`
      : "GPS location unavailable.";

    Alert.alert(
      "Emergency SOS Ready",
      `Selected: ${names}

${locationStatus}`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Open SMS",
          onPress: () => void openEmergencySms(contacts, location),
        },
        {
          text: "Call",
          onPress: () => {
            Alert.alert(
              "Call Emergency Contact",
              "Choose a contact to call.",
              contacts.map((contact) => ({
                text: `${contact.name} • ${contact.phone}`,
                onPress: () => void openEmergencyCall(contact),
              })).concat([{ text: "Cancel", style: "cancel" as const }])
            );
          },
        },
      ]
    );
  }, [openEmergencyCall, openEmergencySms]);

  const confirmSelectedSos = useCallback(async () => {
    const selected = sosContacts.filter((contact) => selectedSosIds.includes(contact.id));
    if (!selected.length) {
      Alert.alert("Select Contact", "Please select at least one emergency contact.");
      return;
    }

    setSosPickerVisible(false);
    setSosLoading(true);

    try {
      const location = await getEmergencyLocation();
      setSosLocation(location);
      openSosActions(selected, location);
    } finally {
      setSosLoading(false);
    }
  }, [getEmergencyLocation, openSosActions, selectedSosIds, sosContacts]);

  const triggerEmergencySOS = useCallback(async () => {
    if (sosLoading) return;

    setSosLoading(true);
    try {
      const contacts = await loadEmergencyContacts();
      if (!contacts.length) {
        Alert.alert("No Emergency Contact", "Please add an emergency contact before using SOS.");
        return;
      }

      setSosContacts(contacts);
      setSelectedSosIds(contacts.map((contact) => contact.id));
      setSosPickerVisible(true);
    } catch (error) {
      console.error("[SOS] Trigger error:", error);
      Alert.alert("SOS Error", "Unable to load emergency contacts.");
    } finally {
      setSosLoading(false);
    }
  }, [loadEmergencyContacts, sosLoading]);

  // ==================================================
  // HANDLE VOICE NAVIGATION
  // ==================================================

  const handleVoiceNavigation = useCallback(
    async ({ destination: place }: { destination: string }) => {
      if (!place.trim()) return;

      console.log("[Map] Voice navigation received:", place);

      let currentOrigin = origin;
      if (!currentOrigin) currentOrigin = await getCurrentLocation();

      if (!currentOrigin) {
        Alert.alert("Location Required", "Please allow location permission first.");
        return;
      }

      const result = await findDestination(place);
      if (!result) return;

      setDestination(result.coords);
      setDestinationName(result.formattedAddress);
      setRouteReady(false);
      setNavigationStarted(false);
      setTravelInfo(null);
      setRouteCoordinates([]);
      setRouteSteps([]);
      routeStepsRef.current = [];
      setCurrentStepIndex(0);
      currentStepIndexRef.current = 0;

      await calculateRoute(currentOrigin, result.coords);

      mapRef.current?.animateToRegion(
        { ...result.coords, latitudeDelta: 0.08, longitudeDelta: 0.08 },
        1000
      );

      openSheet();
      console.log("[Map] Navigation destination set:", result.formattedAddress);
    },
    [origin, getCurrentLocation, findDestination, calculateRoute, openSheet]
  );


  const openSavedPlace = useCallback(async (place: "home" | "work") => {
    const address = place === "home" ? savedHomeAddress : savedWorkAddress;
    if (!address) {
      Alert.alert(
        place === "home" ? "Home Address Not Set" : "Work Address Not Set",
        "Open Add Address and save your location first."
      );
      return;
    }
    await handleVoiceNavigation({ destination: address });
  }, [savedHomeAddress, savedWorkAddress]);

  // ==================================================
  // VOICE NAVIGATION ACTIONS
  // ==================================================

  const pauseNavigation = useCallback(() => {
    if (!navigationStarted) return;
    Speech.stop();
    setNavigationPaused(true);
    console.log("[Navigation] Paused by voice command");
  }, [navigationStarted, navigationPaused]);

  const resumeNavigation = useCallback(() => {
    if (!navigationStarted) return;
    setNavigationPaused(false);
    console.log("[Navigation] Resumed by voice command");

    const step = routeStepsRef.current[currentStepIndexRef.current];
    if (step?.instruction) {
      speakNavigationInstruction(step.instruction);
    }
  }, [navigationStarted]);

  const recalculateAlternativeRoute = useCallback(async () => {
    if (!origin || !destination) return;
    setAvoidTraffic(false);
    autoStartNavigationRef.current = navigationStarted;
    await calculateRoute(origin, destination, { alternative: true, avoidTolls, avoidHighways, avoidFerries });
  }, [origin, destination, navigationStarted, calculateRoute]);

  const recalculateAvoidTrafficRoute = useCallback(async () => {
    if (!origin || !destination) return;
    setAvoidTraffic(true);
    autoStartNavigationRef.current = navigationStarted;
    await calculateRoute(origin, destination, { avoidTraffic: true, avoidTolls, avoidHighways, avoidFerries });
  }, [origin, destination, navigationStarted, calculateRoute]);

  const checkLiveTraffic = useCallback(async () => {
    if (trafficCheckingRef.current) {
      console.log("[Traffic] Already checking, ignoring duplicate request.");
      return;
    }

    if (!origin || !destination) {
      const message =
        "Please set a destination first. I need a route to check live traffic.";
      Speech.stop();
      Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
      Alert.alert("Traffic", message);
      return;
    }

    const routeKey = makeRouteRequestKey(origin, destination, {
      avoidTraffic,
    });
    const cached = trafficCacheRef.current;

    // Most importantly: do NOT call ComputeRoutes again when we already have
    // a recent traffic-aware route. This saves quota on repeated voice commands.
    if (cached && cached.key === routeKey && Date.now() - cached.checkedAt < TRAFFIC_CACHE_MS) {
      console.log("[Traffic] Using cached traffic result. No API request needed.");

      const message =
        cached.delayMinutes === 0
          ? `Traffic is light on your route. Estimated travel time is ${cached.travelMinutes} minutes.`
          : `Traffic is ${cached.trafficLevel} on your route. Estimated travel time is ${cached.travelMinutes} minutes, with approximately ${cached.delayMinutes} minutes of delay.`;

      Speech.stop();
      Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
      Alert.alert("Live Traffic", message);
      return;
    }

    if (trafficCheckingRef.current) return;
    trafficCheckingRef.current = true;

    try {
      assertApiKey(ROUTES_API_KEY, "Google Routes");

      const now = Date.now();
      if (routeQuotaBlockedUntilRef.current > now) {
        const minutes = Math.ceil((routeQuotaBlockedUntilRef.current - now) / 60000);
        const message = `Live traffic is temporarily unavailable because the Google Routes quota was reached. Please try again in about ${minutes} minutes.`;
        Speech.stop();
        Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
        Alert.alert("Traffic Temporarily Unavailable", message);
        return;
      }

      const usageCount = await getRoutesUsageCount();
      if (usageCount >= ROUTES_DAILY_CLIENT_LIMIT) {
        const message = `The app has reached its daily safety limit of ${ROUTES_DAILY_CLIENT_LIMIT} Google Routes requests. This prevents repeated requests from consuming more quota today.`;
        Speech.stop();
        Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
        Alert.alert("Routes API Safety Limit", message);
        return;
      }

      if (Date.now() - lastRouteRequestAtRef.current < ROUTES_MIN_INTERVAL_MS) {
        console.log("[Traffic] Rate guard active. Using existing route instead of another request.");
        const fallback = trafficCacheRef.current;
        if (fallback) {
          const message =
            fallback.delayMinutes === 0
              ? `Traffic is light on your route. Estimated travel time is ${fallback.travelMinutes} minutes.`
              : `Traffic is ${fallback.trafficLevel} on your route. Estimated travel time is ${fallback.travelMinutes} minutes, with approximately ${fallback.delayMinutes} minutes of delay.`;
          Speech.stop();
          Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
          Alert.alert("Live Traffic", message);
        }
        return;
      }

      if (routeRequestInFlightRef.current) {
        console.log("[Traffic] Routes API request already in progress. Skipping.");
        return;
      }

      routeRequestInFlightRef.current = true;
      lastRouteRequestAtRef.current = Date.now();
      console.log("[Traffic] Checking live traffic...");

      const response = await fetch(
        "https://routes.googleapis.com/directions/v2:computeRoutes",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": ROUTES_API_KEY,
            "X-Goog-FieldMask":
              "routes.distanceMeters,routes.duration,routes.staticDuration",
          },
          body: JSON.stringify({
            origin: { location: { latLng: { latitude: origin.latitude, longitude: origin.longitude } } },
            destination: { location: { latLng: { latitude: destination.latitude, longitude: destination.longitude } } },
            travelMode: "DRIVE",
            routingPreference: "TRAFFIC_AWARE",
            departureTime: new Date(Date.now() + 60 * 1000).toISOString(),
            computeAlternativeRoutes: false,
            languageCode: navigationLanguage,
            units: "METRIC",
          }),
        }
      );

      await incrementRoutesUsage();
      lastRouteRequestAtRef.current = Date.now();

      const data = await response.json();
      if (!response.ok) {
        const apiMessage = data?.error?.message || `Routes API HTTP ${response.status}`;
        if (/quota exceeded|daily quota|rate limit|resource exhausted/i.test(apiMessage)) {
          routeQuotaBlockedUntilRef.current = Date.now() + 60 * 60 * 1000;
        }
        throw new Error(apiMessage);
      }

      const route = data?.routes?.[0];
      if (!route) throw new Error("No traffic route found.");

      const trafficDurationSeconds = Number(String(route.duration || "0").replace("s", ""));
      const normalDurationSeconds = Number(String(route.staticDuration || route.duration || "0").replace("s", ""));
      const delayMinutes = Math.max(0, Math.round((trafficDurationSeconds - normalDurationSeconds) / 60));
      const travelMinutes = Math.round(trafficDurationSeconds / 60);
      const normalMinutes = Math.round(normalDurationSeconds / 60);
      const trafficLevel = delayMinutes > 15 ? "heavy" : delayMinutes > 5 ? "moderate" : "light";

      trafficCacheRef.current = {
        key: routeKey,
        checkedAt: Date.now(),
        travelMinutes,
        normalMinutes,
        delayMinutes,
        trafficLevel,
      };

      console.log("[Traffic] Result:", { delayMinutes, trafficLevel, travelMinutes, normalMinutes });

      const message =
        delayMinutes === 0
          ? `Traffic is light on your route. Estimated travel time is ${travelMinutes} minutes.`
          : `Traffic is ${trafficLevel} on your route. Estimated travel time is ${travelMinutes} minutes, with approximately ${delayMinutes} minutes of delay.`;

      Speech.stop();
      Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
      Alert.alert("Live Traffic", message);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error("[Traffic] API error:", errorMessage);

      const message = /quota exceeded|daily quota|rate limit|resource exhausted/i.test(errorMessage)
        ? "Google Routes traffic quota has been reached. The app has stopped retrying automatically to protect your quota."
        : "I could not get live traffic information right now.";

      Speech.stop();
      Speech.speak(message, { language: navigationLanguage, rate: voiceSpeed });
      Alert.alert("Traffic", message);
    } finally {
      trafficCheckingRef.current = false;
      routeRequestInFlightRef.current = false;
    }
  }, [
    origin,
    destination,
    avoidTraffic,
    navigationLanguage,
    voiceSpeed,
    makeRouteRequestKey,
    getRoutesUsageCount,
    incrementRoutesUsage,
  ]);

  const handleNavigationAction = useCallback(
    async (action: string) => {
      const value = String(action || "").toLowerCase().trim();

      if (value === "pause") {
        pauseNavigation();
        return;
      }

      if (value === "resume") {
        resumeNavigation();
        return;
      }

      if (value === "alternative_route" || value === "alternative") {
        await recalculateAlternativeRoute();
        return;
      }

      if (value === "traffic") {
        await checkLiveTraffic();
        return;
      }

      if (value === "avoid_traffic" || value === "traffic_avoid") {
        await recalculateAvoidTrafficRoute();
        return;
      }

      if (value === "reroute") {
        if (origin && destination) {
          autoStartNavigationRef.current = navigationStarted;
          await calculateRoute(origin, destination, { avoidTraffic, avoidTolls, avoidHighways, avoidFerries });
        }
      }
    },
    [
      pauseNavigation,
      resumeNavigation,
      recalculateAlternativeRoute,
      recalculateAvoidTrafficRoute,
      checkLiveTraffic,
      origin,
      destination,
      navigationStarted,
      avoidTraffic,
      avoidTolls,
      avoidHighways,
      avoidFerries,
      calculateRoute,
    ]
  );

  // ==================================================
  // AUTO START FROM VOICE PAGE
  // ==================================================

  useEffect(() => {
    const destinationFromVoice = params.destination?.trim();
    const autoStart = params.autoStart === "true";
    if (!destinationFromVoice || !autoStart) return;

    const navigationKey = `${destinationFromVoice}|${params.autoStart}`;
    if (autoNavigationKeyRef.current === navigationKey) return;

    autoNavigationKeyRef.current = navigationKey;
    autoStartNavigationRef.current = true;
    console.log("[Map] Auto starting navigation:", destinationFromVoice);
    void handleVoiceNavigation({ destination: destinationFromVoice });
  }, [params.destination, params.autoStart, handleVoiceNavigation]);


  // Execute voice route controls sent from VoiceTab.
  useEffect(() => {
    const action = params.navigationAction?.trim();
    if (!action) return;

    // Router params can stay mounted while the Map screen re-renders.
    // Do not execute the same voice action again on every render.
    if (lastNavigationActionRef.current === action) return;

    lastNavigationActionRef.current = action;
    void handleNavigationAction(action);
  }, [params.navigationAction, handleNavigationAction]);

  // ==================================================
  // KEEP LATEST HANDLER IN REF
  // ==================================================

  useEffect(() => {
    navigationHandlerRef.current = handleVoiceNavigation;
  }, [handleVoiceNavigation]);


  // ==================================================
  // LISTEN FOR VOICE COMMANDS
  // ==================================================

 
useEffect(() => {
  const unsubscribe = setNavigationListener((payload: NavigationRequest) => {
    if (payload.type === "navigate") {
      void navigationHandlerRef.current?.({
        destination: payload.destination,
      });
      return;
    }

    if (payload.type === "nearby") {
      void handleCategorySearch(payload.category);
    }
  });

  return unsubscribe;
}, [handleCategorySearch]);


  // ==================================================
  // LIVE GPS WHILE DRIVING
  // ==================================================

  const startLiveNavigation = useCallback(async () => {
    try {
      if (locationSubscriptionRef.current) return;

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location Required", "Please allow location permission to start driving.");
        return;
      }

      locationSubscriptionRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Highest, timeInterval: 1000, distanceInterval: 2 },
        (location) => {
          const coords: Coordinates = {
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
          };

          setOrigin(coords);

          if (navigationStarted && !navigationPaused && destination) {
            // 1) Arrival detection.
            const destinationDistance = distanceBetween(coords, destination);
            if (destinationDistance <= 35 && !arrivalHandledRef.current) {
              arrivalHandledRef.current = true;
              Speech.stop();
              Speech.speak("You have arrived at your destination.", {
                language: "en-US",
                rate: voiceSpeed,
              });
              Alert.alert("Arrived", `You have reached ${destinationName || "your destination"}.`);
              setNavigationStarted(false);
              return;
            }

            // 2) Off-route detection. Require 3 consecutive samples before rerouting
            // to avoid false positives from GPS jitter.
            if (routeCoordinates.length > 1 && !reroutingRef.current) {
              const routeDistance = distanceToRouteMeters(coords, routeCoordinates);

              if (routeDistance > 70) {
                offRouteCountRef.current += 1;
              } else {
                offRouteCountRef.current = 0;
              }

              if (offRouteCountRef.current >= 3) {
                offRouteCountRef.current = 0;
                reroutingRef.current = true;
                Speech.stop();
                Speech.speak("You are off route. Recalculating.", {
                  language: "en-US",
                  rate: voiceSpeed,
                });

                void calculateRoute(coords, destination, {
                  avoidTraffic,
                }).finally(() => {
                  reroutingRef.current = false;
                });
              }
            }

            // 3) Turn-by-turn step progression.
            if (routeStepsRef.current.length > 0) {
              const step = routeStepsRef.current[currentStepIndexRef.current];
              if (step?.endLocation) {
                const remaining = distanceBetween(coords, step.endLocation);
                if (remaining < 45 && currentStepIndexRef.current < routeStepsRef.current.length - 1) {
                  currentStepIndexRef.current += 1;
                  setCurrentStepIndex(currentStepIndexRef.current);
                  const nextStep = routeStepsRef.current[currentStepIndexRef.current];
                  if (nextStep?.instruction) {
                    speakNavigationInstruction(nextStep.instruction);
                  }
                }
              }
            }
          }

          if (typeof location.coords.speed === "number") {
            setCurrentSpeed(Math.max(0, location.coords.speed * 3.6));
          }

          if (navigationStarted) {
            mapRef.current?.animateCamera(
              {
                center: coords,
                zoom: 17,
                heading:
                  typeof location.coords.heading === "number" && location.coords.heading >= 0
                    ? location.coords.heading
                    : 0,
                pitch: 45,
              },
              { duration: 700 }
            );
          }
        }
      );

      console.log("[Navigation] Live GPS started");
    } catch (error) {
      console.warn("[Navigation] Live GPS error:", error);
    }
  }, [navigationStarted, navigationPaused, destination, destinationName, routeCoordinates, avoidTraffic, calculateRoute]);

  const stopLiveNavigation = useCallback(() => {
    locationSubscriptionRef.current?.remove();
    locationSubscriptionRef.current = null;
    setCurrentSpeed(0);
    console.log("[Navigation] Live GPS stopped");
  }, []);

  useEffect(() => {
    if (navigationStarted) void startLiveNavigation();
    else stopLiveNavigation();
    return () => stopLiveNavigation();
  }, [navigationStarted, startLiveNavigation, stopLiveNavigation]);


  // ==================================================
  // INITIAL LOCATION ON MOUNT
  // ==================================================

  useEffect(() => {
    getCurrentLocation();
  }, [getCurrentLocation]);


  // ==================================================
  // CATEGORY SEARCH
  // ==================================================

  const handleCategorySearch = useCallback(
    async (category: string) => {
      const searchOrigin = origin || (await getCurrentLocation());
      if (!searchOrigin) {
        Alert.alert("Location Required", "Please allow location permission to search nearby places.");
        return;
      }
      await handleVoiceNavigation({ destination: `${category} near me` });
    },
    [origin, getCurrentLocation, handleVoiceNavigation]
  );


  // ==================================================
  // MAP SEARCH
  // ==================================================

  const searchPlacesRequest = useCallback(
    async (query: string) => {
      const value = query.trim();

      if (value.length < 2) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }

      // Avoid sending the exact same query repeatedly.
      if (value.toLowerCase() === lastSearchQueryRef.current.toLowerCase()) {
        return;
      }

      lastSearchQueryRef.current = value;
      const requestId = ++searchRequestIdRef.current;

      try {
        assertApiKey(PLACES_API_KEY, "Google Places");
        setSearchLoading(true);

        const response = await fetch(
          "https://places.googleapis.com/v1/places:searchText",
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Goog-Api-Key": PLACES_API_KEY,
              "X-Goog-FieldMask":
                "places.id,places.displayName,places.formattedAddress,places.location",
            },
            body: JSON.stringify({
              textQuery: value,
              languageCode: "en",
              maxResultCount: 5,
              ...(origin
                ? {
                    locationBias: {
                      circle: {
                        center: {
                          latitude: origin.latitude,
                          longitude: origin.longitude,
                        },
                        radius: 50000,
                      },
                    },
                  }
                : {}),
            }),
          }
        );

        const data = await response.json();

        // Ignore an older response if the user has typed something newer.
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        if (!response.ok) {
          throw new Error(
            data?.error?.message ||
              `Places API HTTP ${response.status}`
          );
        }

        setSearchResults(
          Array.isArray(data?.places)
            ? data.places
            : []
        );
      } catch (error) {
        if (requestId !== searchRequestIdRef.current) {
          return;
        }

        const message =
          error instanceof Error
            ? error.message
            : String(error);

        console.warn(
          "[Map] Places search error:",
          message
        );

        setSearchResults([]);

        // Keep the popup useful without spamming alerts during typing.
        if (message.toLowerCase().includes("quota exceeded")) {
          Alert.alert(
            "Search Quota Exceeded",
            "Google Places daily search quota has been reached. Please try again later or increase the Places API quota."
          );
        } else {
          Alert.alert("Search Error", message);
        }
      } finally {
        if (requestId === searchRequestIdRef.current) {
          setSearchLoading(false);
        }
      }
    },
    []
  );

  const searchPlaces = useCallback(
    (query: string) => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }

      const value = query.trim();

      if (value.length < 2) {
        setSearchResults([]);
        setSearchLoading(false);
        return;
      }

      setSearchLoading(true);

      searchDebounceRef.current = setTimeout(() => {
        void searchPlacesRequest(value);
      }, 650);
    },
    [searchPlacesRequest]
  );

  useEffect(() => {
    return () => {
      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
      }
    };
  }, []);

  const selectSearchPlace = useCallback(
    async (place: any) => {
      const location = place?.location;
      if (!location) return;

      const dest: Coordinates = {
        latitude: Number(location.latitude),
        longitude: Number(location.longitude),
      };

      const displayName = place?.displayName?.text || place?.formattedAddress || searchText || "Destination";
      const address = place?.formattedAddress || displayName;

      if (searchDebounceRef.current) {
        clearTimeout(searchDebounceRef.current);
        searchDebounceRef.current = null;
      }

      setSearchText(displayName);
      setSearchResults([]);
      setSearchActive(false);
      setSearchLoading(false);
      lastSearchQueryRef.current = displayName;
      searchRequestIdRef.current += 1;
      Keyboard.dismiss();

      setDestination(dest);
      setDestinationName(address);
      setRouteReady(false);
      setNavigationStarted(false);
      setTravelInfo(null);
      setRouteCoordinates([]);

      const searchOrigin = origin || (await getCurrentLocation());
      if (!searchOrigin) {
        Alert.alert("Location Required", "Please allow location permission to calculate the route.");
        return;
      }

      await calculateRoute(searchOrigin, dest);

      mapRef.current?.animateToRegion(
        { ...dest, latitudeDelta: 0.05, longitudeDelta: 0.05 },
        1000
      );

      openSheet();
      console.log("[Map] Search destination selected:", address);
    },
    [origin, getCurrentLocation, searchText, calculateRoute, openSheet]
  );

  const openMapSearch = useCallback(() => {
    if (navigationStarted) return;
    setSearchActive(true);
  }, [navigationStarted]);

  const closeMapSearch = useCallback(() => {
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
      searchDebounceRef.current = null;
    }

    lastSearchQueryRef.current = "";
    searchRequestIdRef.current += 1;

    setSearchActive(false);
    setSearchResults([]);
    setSearchLoading(false);
    Keyboard.dismiss();
  }, []);

  const handleSearchMic = useCallback(() => {
    Alert.alert("Voice Search", "Use the Voice tab to speak a destination.");
  }, []);


  // ==================================================
  // START NAVIGATION
  // ==================================================

  const startNavigation = useCallback(() => {
    if (!routeReady || !destination) {
      console.warn("[Navigation] Cannot start: route is not ready.");
      return;
    }

    setNavigationPaused(false);
    setNavigationStarted(true);
    const currentCenter = origin || destination;

    mapRef.current?.animateCamera(
      { center: currentCenter, zoom: 17, pitch: 50, heading: 0 },
      { duration: 700 }
    );

    setCurrentStepIndex(0);
    currentStepIndexRef.current = 0;
    console.log("[Navigation] Started manually");
  }, [routeReady, destination, origin]);


  // ==================================================
  // CLEAR ROUTE
  // ==================================================

  const clearRoute = useCallback(() => {
    setDestination(null);
    setDestinationName("");
    setRouteReady(false);
    setNavigationStarted(false);
    setNavigationPaused(false);
    setAvoidTraffic(false);
    setTravelInfo(null);
    setRouteCoordinates([]);
    setRouteSteps([]);
    routeStepsRef.current = [];
    setCurrentStepIndex(0);
    currentStepIndexRef.current = 0;
    offRouteCountRef.current = 0;
    reroutingRef.current = false;
    arrivalHandledRef.current = false;

    Speech.stop();
    stopLiveNavigation();
    clearNavigation();
    openSheet();

    if (origin) {
      mapRef.current?.animateToRegion(
        { ...origin, latitudeDelta: 0.02, longitudeDelta: 0.02 },
        800
      );
    }
  }, [origin, stopLiveNavigation, openSheet]);


  // ==================================================
  // DERIVED NAVIGATION VALUES
  // ==================================================

  const currentStep = routeSteps[currentStepIndex] || null;

  const currentStepDistance =
    currentStep && origin && currentStep.endLocation
      ? distanceBetween(origin, currentStep.endLocation)
      : currentStep?.distanceMeters || 0;

  const remainingDistanceMeters =
    routeSteps.length > 0
      ? routeSteps.slice(currentStepIndex).reduce((sum, step, index) =>
          sum + (index === 0 && currentStep
            ? Math.min(step.distanceMeters, currentStepDistance)
            : step.distanceMeters),
          0
        )
      : (travelInfo?.distance || 0) * 1000;

  const remainingDistanceKm = remainingDistanceMeters / 1000;

  const remainingDurationMinutes =
    travelInfo?.distance && travelInfo.duration
      ? Math.max(1, Math.round(travelInfo.duration * (remainingDistanceKm / travelInfo.distance)))
      : Math.round(travelInfo?.duration || 0);

  const etaLabel = (() => {
    const eta = new Date(Date.now() + remainingDurationMinutes * 60 * 1000);
    return eta.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  })();

  const maneuverIcon = (maneuver?: string) => {
    const value = String(maneuver || "").toUpperCase();
    if (value.includes("LEFT")) return "arrow-up-left";
    if (value.includes("RIGHT")) return "arrow-up-right";
    if (value.includes("U_TURN")) return "return-up-back";
    if (value.includes("MERGE")) return "git-merge";
    if (value.includes("ROUNDABOUT")) return "refresh";
    return "arrow-up";
  };

  const formatMeters = (meters: number) => {
    if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m`;
    return `${(meters / 1000).toFixed(1)} km`;
  };


  // ==================================================
  // RENDER
  // ==================================================

  return (
    <View style={styles.container}>

      {/* MAP */}
      <MapView
        provider={PROVIDER_GOOGLE}
        ref={mapRef}
        style={StyleSheet.absoluteFill}
        initialRegion={region}
        showsUserLocation
        followsUserLocation={navigationStarted}
        loadingEnabled
        showsCompass
        showsBuildings
        showsTraffic={false}
        showsMyLocationButton={false}
        customMapStyle={navigationStarted ? NAVIGATION_MAP_STYLE : undefined}
        onMapReady={() => {
          console.log("[Map] Google Map ready");
          getCurrentLocation();
        }}
        onUserLocationChange={(event) => {
          if (!navigationStarted) return;
          const coordinate = event.nativeEvent.coordinate;
          if (!coordinate) return;
          const coords: Coordinates = {
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
          };
          setOrigin(coords);
          mapRef.current?.animateCamera(
            { center: coords, zoom: 17, pitch: 45 },
            { duration: 500 }
          );
        }}
      >
        {/* CURRENT LOCATION MARKER */}
        {origin && (
          <Marker
            coordinate={origin}
            title="Your Location"
            description="Current location"
            anchor={{ x: 0.5, y: 0.5 }}
            flat={navigationStarted}
            rotation={0}
          >
            {navigationStarted ? (
              <View style={styles.navigationUserMarker}>
                <View style={styles.navigationUserMarkerInner}>
                  <Ionicons name="navigate" size={30} color="#1D4ED8" />
                </View>
              </View>
            ) : (
              <View style={styles.normalUserMarker}>
                <View style={styles.normalUserMarkerDot} />
              </View>
            )}
          </Marker>
        )}

        {/* DESTINATION MARKER */}
        {destination && !navigationStarted && (
          <Marker
            coordinate={destination}
            title="Destination"
            description={destinationName}
            pinColor="#EF4444"
          />
        )}

        {/* ROUTE POLYLINE */}
        {routeCoordinates.length > 1 && (
          <Polyline
            coordinates={routeCoordinates}
            strokeWidth={navigationStarted ? 8 : 6}
            strokeColor="#2F6BFF"
          />
        )}
      </MapView>


      {/* ACTIVE NAVIGATION UI */}
      {navigationStarted && (
        <>
          {/* TURN CARD */}
          <View style={styles.turnCard} pointerEvents="box-none">
            <View style={styles.turnIconCircle}>
              <Ionicons name={maneuverIcon(currentStep?.maneuver) as any} size={38} color="#FFFFFF" />
            </View>

            <View style={styles.turnTextBlock}>
              <Text style={styles.turnDistance}>
                {navigationPaused ? "PAUSED" : formatMeters(currentStepDistance)}
              </Text>
              <Text style={styles.turnInstruction} numberOfLines={1}>
                {navigationPaused
                  ? "Navigation paused"
                  : currentStep?.instruction || "Continue straight"}
              </Text>
              <View style={styles.turnDestinationRow}>
                <Ionicons name="flag" size={16} color="#E7F5EA" />
                <Text style={styles.turnDestination} numberOfLines={1}>
                  {destinationName || "Destination"}
                </Text>
              </View>
            </View>

            <TouchableOpacity style={styles.turnCloseButton} onPress={clearRoute} activeOpacity={0.8}>
              <Ionicons name="close" size={24} color="#FFFFFF" />
            </TouchableOpacity>
          </View>

          {/* BOTTOM NAVIGATION PANEL */}
          <View style={styles.navigationBottomPanel}>
            <View style={styles.navigationMainInfo}>
              <View>
                <Text style={styles.navigationEta}>{remainingDurationMinutes} min</Text>
                <Text style={styles.navigationDistance}>
                  {remainingDistanceKm.toFixed(1)} km • {etaLabel}
                </Text>
              </View>

              <TouchableOpacity style={styles.endNavigationButton} onPress={clearRoute} activeOpacity={0.85}>
                <Text style={styles.endNavigationText}>End</Text>
              </TouchableOpacity>
            </View>

            <View style={styles.navigationControls}>
              <TouchableOpacity
                style={styles.navigationControlButton}
                onPress={() => {
                  const step = routeStepsRef.current[currentStepIndexRef.current];
                  if (step?.instruction) {
                    Speech.stop();
                    Speech.speak(step.instruction, {
                      language: "en-US",
                      rate: voiceSpeed,
                    });
                  }
                }}
              >
                <Ionicons name="volume-high" size={22} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.navigationControlButton}
                onPress={() =>
                  navigationPaused ? resumeNavigation() : pauseNavigation()
                }
              >
                <Ionicons
                  name={navigationPaused ? "play" : "pause"}
                  size={22}
                  color="#FFFFFF"
                />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.navigationControlButton}
                onPress={() => void recalculateAlternativeRoute()}
              >
                <Ionicons name="git-compare" size={22} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.navigationControlButton}
                onPress={() => void recalculateAvoidTrafficRoute()}
              >
                <Ionicons name="car" size={22} color="#FFFFFF" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.navigationControlButton}
                onPress={() =>
                  mapRef.current?.animateCamera(
                    { center: origin || destination!, zoom: 17, pitch: 50, heading: 0 },
                    { duration: 600 }
                  )
                }
              >
                <Ionicons name="locate" size={22} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
          </View>
        </>
      )}


      {/* TOP UI (hidden when navigating) */}
      {!navigationStarted && (
        <SafeAreaView style={styles.overlayContainer} pointerEvents="box-none">

          {/* SEARCH BAR */}
          <View style={styles.searchWrapper}>
            {!searchActive ? (
              <TouchableOpacity style={styles.searchBar} activeOpacity={0.85} onPress={openMapSearch}>
                <Ionicons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
                <Text style={styles.searchPlaceholder}>{searchText || "Search destination..."}</Text>
                <TouchableOpacity style={styles.micBtn} onPress={handleSearchMic} activeOpacity={0.8}>
                  <Ionicons name="mic" size={18} color="#FFFFFF" />
                </TouchableOpacity>
              </TouchableOpacity>
            ) : (
              <>
                <View style={styles.searchBar}>
                  <Ionicons name="search" size={20} color="#9CA3AF" style={styles.searchIcon} />
                  <TextInput
                    autoFocus
                    value={searchText}
                    onChangeText={(value) => {
                      setSearchText(value);
                      searchPlaces(value);
                    }}
                    placeholder="Search destination..."
                    placeholderTextColor="#9CA3AF"
                    returnKeyType="search"
                    style={styles.searchInput}
                  />
                  {searchLoading ? (
                    <View style={styles.searchLoadingDot}>
                      <View style={styles.searchLoadingInner} />
                    </View>
                  ) : (
                    <TouchableOpacity style={styles.searchCloseBtn} onPress={closeMapSearch} activeOpacity={0.8}>
                      <Ionicons name="close" size={20} color="#6B7280" />
                    </TouchableOpacity>
                  )}
                </View>

                {searchResults.length > 0 && (
                  <View style={styles.searchResults}>
                    {searchResults.map((place, index) => (
                      <TouchableOpacity
                        key={place?.id || `${place?.displayName?.text}-${index}`}
                        style={styles.searchResultItem}
                        onPress={() => void selectSearchPlace(place)}
                        activeOpacity={0.8}
                      >
                        <View style={styles.searchResultIcon}>
                          <Ionicons name="location-outline" size={20} color="#2563EB" />
                        </View>
                        <View style={styles.searchResultText}>
                          <Text style={styles.searchResultTitle} numberOfLines={1}>
                            {place?.displayName?.text || "Place"}
                          </Text>
                          <Text style={styles.searchResultAddress} numberOfLines={2}>
                            {place?.formattedAddress || ""}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                )}
              </>
            )}
          </View>

          {/* CATEGORY CHIPS */}
          <View style={styles.categoryContainer}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              {categories.map((item) => (
                <TouchableOpacity
                  key={item}
                  style={[styles.chip, selected === item && styles.activeChip]}
                  onPress={() => {
                    setSelected(item);
                    if (item !== "All") void handleCategorySearch(item);
                  }}
                >
                  <Text style={[styles.chipText, selected === item && styles.activeChipText]}>
                    {item}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        </SafeAreaView>
      )}


      <Modal
        visible={sosPickerVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setSosPickerVisible(false)}
      >
        <View style={styles.sosModalBackdrop}>
          <View style={styles.sosModalCard}>
            <View style={styles.sosModalHeader}>
              <View>
                <Text style={styles.sosModalTitle}>Emergency SOS</Text>
                <Text style={styles.sosModalSubtitle}>Select who should receive the alert</Text>
              </View>
              <TouchableOpacity onPress={() => setSosPickerVisible(false)}>
                <Ionicons name="close" size={25} color="#111827" />
              </TouchableOpacity>
            </View>

            {sosContacts.map((contact) => {
              const selected = selectedSosIds.includes(contact.id);
              return (
                <TouchableOpacity
                  key={contact.id}
                  style={[styles.sosContactRow, selected && styles.sosContactRowSelected]}
                  onPress={() => {
                    setSelectedSosIds((current) =>
                      current.includes(contact.id)
                        ? current.filter((id) => id !== contact.id)
                        : [...current, contact.id]
                    );
                  }}
                >
                  <View style={styles.sosContactIcon}>
                    <Ionicons name="person" size={19} color="#EF4444" />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.sosContactName}>{contact.name}</Text>
                    <Text style={styles.sosContactMeta}>{contact.relation} • {contact.phone}</Text>
                  </View>
                  <Ionicons
                    name={selected ? "checkbox" : "square-outline"}
                    size={25}
                    color={selected ? "#EF4444" : "#9CA3AF"}
                  />
                </TouchableOpacity>
              );
            })}

            <Text style={styles.sosLocationHint}>
              GPS location will be requested before the SMS/call options are shown.
            </Text>

            <TouchableOpacity
              style={styles.sosConfirmButton}
              onPress={() => void confirmSelectedSos()}
              disabled={sosLoading}
            >
              {sosLoading ? (
                <Text style={styles.sosConfirmText}>Preparing SOS...</Text>
              ) : (
                <>
                  <Ionicons name="warning" size={21} color="#FFFFFF" />
                  <Text style={styles.sosConfirmText}>Continue with SOS</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* FLOATING BUTTONS */}
      <View style={styles.floatingButtons} pointerEvents="box-none">
        <TouchableOpacity
          style={styles.sosFloatBtn}
          onPress={() => void triggerEmergencySOS()}
          disabled={sosLoading}
          activeOpacity={0.85}
          accessibilityLabel="Emergency SOS"
        >
          <Ionicons
            name="warning"
            size={24}
            color="#FFFFFF"
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.floatBtn} onPress={getCurrentLocation}>
          <Ionicons name="location" size={24} color="#2563EB" />
        </TouchableOpacity>

        {destination && (
          <TouchableOpacity style={[styles.floatBtn, { marginTop: 15 }]} onPress={clearRoute}>
            <Ionicons name="close" size={25} color="#EF4444" />
          </TouchableOpacity>
        )}
      </View>


      {/* BOTTOM SHEET */}
      {!navigationStarted && (
        <Animated.View
          style={[styles.bottomSheet, { transform: [{ translateY: sheetTranslateY }] }]}
        >
          {/* DRAG HANDLE */}
          <View {...panResponder.panHandlers} style={styles.dragHandleArea}>
            <View style={styles.dragBar} />
          </View>

          {destination ? (
            <>
              <Text style={styles.bottomTitle}>Navigation</Text>

              {/* DESTINATION CARD */}
              <View style={styles.navigationCard}>
                <View style={styles.navigationIcon}>
                  <Ionicons name="navigate" size={24} color="#2563EB" />
                </View>
                <View style={styles.navigationInfo}>
                  <Text style={styles.destinationTitle} numberOfLines={2}>
                    {destinationName || "Destination"}
                  </Text>
                  {travelInfo && (
                    <Text style={styles.routeInfo}>
                      {travelInfo.distance.toFixed(1)} km • {Math.round(travelInfo.duration)} min
                    </Text>
                  )}
                </View>
              </View>

              {/* START BUTTON */}
              {routeReady && !navigationStarted && (
                <TouchableOpacity style={styles.startNavigationButton} onPress={startNavigation} activeOpacity={0.85}>
                  <Ionicons name="navigate" size={20} color="#FFFFFF" />
                  <Text style={styles.startNavigationButtonText}>START NAVIGATION</Text>
                </TouchableOpacity>
              )}

              {/* ACTIVE STATUS */}
              {routeReady && navigationStarted && (
                <View style={styles.navigationStatus}>
                  <View style={styles.statusDot} />
                  <View style={styles.statusTextContainer}>
                    <Text style={styles.navigationStatusText}>
                      {navigationPaused ? "Navigation paused" : "Navigation active"}
                    </Text>
                    <Text style={styles.navigationSubText}>
                      {avoidTraffic ? "Traffic-aware route" : "Following route"} to {destinationName || "destination"}
                    </Text>
                  </View>
                  <Ionicons name="navigate" size={24} color="#2563EB" />
                </View>
              )}

              {/* LOADING */}
              {!routeReady && (
                <View style={styles.loadingRoute}>
                  <View style={styles.loadingDot} />
                  <Text style={styles.loadingRouteText}>Calculating route...</Text>
                </View>
              )}

              {/* CANCEL */}
              <TouchableOpacity style={styles.cancelButton} onPress={clearRoute}>
                <Text style={styles.cancelButtonText}>Cancel Route</Text>
              </TouchableOpacity>
            </>
          ) : (
            <>
              <Text style={styles.bottomTitle}>Where to?</Text>

              <TouchableOpacity style={styles.chooseCard} activeOpacity={0.8}>
                <Text style={styles.chooseText}>Choose on map</Text>
                <Ionicons name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>

              {/* HOME */}
              <TouchableOpacity
                style={styles.placeCard}
                activeOpacity={0.8}
                onPress={() => void openSavedPlace("home")}
              >
                <View style={styles.placeLeft}>
                  <View style={styles.placeIcon}>
                    <Ionicons name="home" size={22} color="#2563EB" />
                  </View>
                  <View style={styles.placeTextBlock}>
                    <Text style={styles.placeTitle}>Home</Text>
                    <Text style={styles.placeSubtitle} numberOfLines={2}>
                      {savedHomeAddress || (savedPlacesLoading ? "Loading saved address..." : "Add Home address")}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>

              {/* WORK */}
              <TouchableOpacity
                style={styles.placeCard}
                activeOpacity={0.8}
                onPress={() => void openSavedPlace("work")}
              >
                <View style={styles.placeLeft}>
                  <View style={styles.placeIcon}>
                    <Ionicons name="briefcase" size={22} color="#2563EB" />
                  </View>
                  <View style={styles.placeTextBlock}>
                    <Text style={styles.placeTitle}>Work</Text>
                    <Text style={styles.placeSubtitle} numberOfLines={2}>
                      {savedWorkAddress || (savedPlacesLoading ? "Loading saved address..." : "Add Work address")}
                    </Text>
                  </View>
                </View>
                <Ionicons name="chevron-forward" size={20} color="#999" />
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      )}
    </View>
  );
}


// ==================================================
// STYLES
// ==================================================

const styles = StyleSheet.create({

  container: {
    flex: 1,
    backgroundColor: "#F4F7FB",
  },

  overlayContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
  },

  // SEARCH
  searchWrapper: {
    marginTop: 10,
    marginHorizontal: 20,
    zIndex: 10,
  },

  searchBar: {
    height: 56,
    borderRadius: 18,
    backgroundColor: "#FFFFFF",
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.10,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
  },

  searchIcon: {
    marginRight: 10,
  },

  searchPlaceholder: {
    flex: 1,
    fontSize: 15,
    color: "#6B7280",
  },

  searchInput: {
    flex: 1,
    height: 56,
    fontSize: 15,
    color: "#111827",
    paddingVertical: 0,
  },

  micBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
  },

  searchCloseBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },

  searchLoadingDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#F3F4F6",
    justifyContent: "center",
    alignItems: "center",
  },

  searchLoadingInner: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#2563EB",
  },

  searchResults: {
    marginTop: 8,
    backgroundColor: "#FFFFFF",
    borderRadius: 16,
    overflow: "hidden",
    elevation: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },

  searchResultItem: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
    borderBottomWidth: 1,
    borderBottomColor: "#EEF1F4",
  },

  searchResultIcon: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: "#EEF4FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 11,
  },

  searchResultText: {
    flex: 1,
  },

  searchResultTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: "#111827",
  },

  searchResultAddress: {
    marginTop: 3,
    fontSize: 12,
    color: "#6B7280",
  },

  // CATEGORY
  categoryContainer: {
    marginTop: 15,
    paddingLeft: 20,
    zIndex: 5,
  },

  chip: {
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 22,
    marginRight: 10,
    elevation: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.10,
    shadowRadius: 3,
  },

  activeChip: {
    backgroundColor: "#2563EB",
  },

  chipText: {
    color: "#333333",
    fontSize: 15,
    fontWeight: "600",
  },

  activeChipText: {
    color: "#FFFFFF",
  },

  // FLOATING BUTTONS
  sosFloatBtn: {
    width: 54,
    height: 54,
    borderRadius: 27,
    backgroundColor: "#DC2626",
    alignItems: "center",
    justifyContent: "center",
    elevation: 7,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 7,
    shadowOffset: { width: 0, height: 3 },
    marginBottom: 12,
  },

  sosModalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  sosModalCard: {
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 28,
  },
  sosModalHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  sosModalTitle: { fontSize: 21, fontWeight: "800", color: "#111827" },
  sosModalSubtitle: { marginTop: 3, color: "#6B7280", fontSize: 13 },
  sosContactRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 13,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "#E5E7EB",
    marginBottom: 9,
  },
  sosContactRowSelected: { borderColor: "#FCA5A5", backgroundColor: "#FFF7F7" },
  sosContactIcon: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: "#FEE2E2",
    alignItems: "center", justifyContent: "center", marginRight: 11,
  },
  sosContactName: { fontSize: 15, fontWeight: "700", color: "#111827" },
  sosContactMeta: { fontSize: 12, color: "#6B7280", marginTop: 3 },
  sosLocationHint: { fontSize: 12, color: "#6B7280", lineHeight: 18, marginVertical: 12 },
  sosConfirmButton: {
    minHeight: 52, borderRadius: 14, backgroundColor: "#DC2626",
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
  },
  sosConfirmText: { color: "#FFFFFF", fontSize: 16, fontWeight: "800" },
  floatingButtons: {
    position: "absolute",
    right: 20,
    bottom: 350,
    zIndex: 10,
  },

  floatBtn: {
    width: 55,
    height: 55,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
    elevation: 6,
    shadowColor: "#000000",
    shadowOpacity: 0.10,
    shadowRadius: 5,
  },

  // BOTTOM SHEET
  bottomSheet: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "#FFFFFF",
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 22,
    paddingTop: 0,
    paddingBottom: 40,
    elevation: 15,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 10,
    minHeight: 300,
  },

  dragHandleArea: {
    width: "100%",
    height: 45,
    alignItems: "center",
    justifyContent: "center",
  },

  dragBar: {
    width: 55,
    height: 5,
    borderRadius: 5,
    backgroundColor: "#D1D5DB",
  },

  bottomTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#111827",
    marginBottom: 18,
  },

  chooseCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 25,
  },

  chooseText: {
    fontSize: 17,
    color: "#6B7280",
  },

  placeCard: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 18,
    padding: 18,
    marginBottom: 15,
    elevation: 3,
    shadowColor: "#000000",
    shadowOpacity: 0.05,
    shadowRadius: 5,
  },

  placeLeft: {
    flexDirection: "row",
    alignItems: "center",
  },

  placeIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#EEF4FF",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 15,
  },

  placeTextBlock: {
    flex: 1,
    maxWidth: 260,
  },

  placeTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#111827",
  },

  placeSubtitle: {
    marginTop: 5,
    color: "#6B7280",
    fontSize: 14,
  },

  // NAVIGATION CARD
  navigationCard: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#F5F8FF",
    borderRadius: 18,
    padding: 15,
    marginBottom: 15,
  },

  navigationIcon: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#E8F0FE",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  navigationInfo: {
    flex: 1,
  },

  destinationTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111827",
  },

  routeInfo: {
    marginTop: 5,
    fontSize: 14,
    color: "#6B7280",
  },

  // NAVIGATION STATUS
  navigationStatus: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 15,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#EEF6FF",
  },

  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: "#22C55E",
    marginRight: 10,
  },

  statusTextContainer: {
    flex: 1,
  },

  navigationStatusText: {
    color: "#2563EB",
    fontSize: 15,
    fontWeight: "700",
  },

  navigationSubText: {
    marginTop: 3,
    color: "#6B7280",
    fontSize: 12,
  },

  // LOADING
  loadingRoute: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    borderRadius: 16,
    backgroundColor: "#F9FAFB",
    marginBottom: 15,
  },

  loadingDot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: "#2563EB",
    marginRight: 10,
  },

  loadingRouteText: {
    color: "#6B7280",
    fontSize: 14,
  },

  // MARKERS
  normalUserMarker: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#2563EB",
    justifyContent: "center",
    alignItems: "center",
    borderWidth: 3,
    borderColor: "#FFFFFF",
  },

  normalUserMarkerDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#FFFFFF",
  },

  navigationUserMarker: {
    width: 64,
    height: 64,
    borderRadius: 32,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.72)",
    borderWidth: 2,
    borderColor: "rgba(37,99,235,0.25)",
    elevation: 8,
    shadowColor: "#000000",
    shadowOpacity: 0.18,
    shadowRadius: 8,
  },

  navigationUserMarkerInner: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#FFFFFF",
    justifyContent: "center",
    alignItems: "center",
  },

  // ACTIVE NAVIGATION UI
  turnCard: {
    position: "absolute",
    top: 18,
    left: 14,
    right: 14,
    minHeight: 138,
    backgroundColor: "#0C7A2E",
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 15,
    flexDirection: "row",
    alignItems: "center",
    elevation: 12,
    shadowColor: "#000000",
    shadowOpacity: 0.3,
    shadowRadius: 12,
    zIndex: 50,
  },

  turnIconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: "rgba(255,255,255,0.14)",
    justifyContent: "center",
    alignItems: "center",
    marginRight: 14,
  },

  turnTextBlock: {
    flex: 1,
  },

  turnDistance: {
    color: "#FFFFFF",
    fontSize: 21,
    fontWeight: "800",
  },

  turnInstruction: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    marginTop: 2,
  },

  turnDestinationRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 9,
  },

  turnDestination: {
    color: "#E7F5EA",
    fontSize: 13,
    marginLeft: 6,
  },

  turnCloseButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    justifyContent: "center",
    alignItems: "center",
  },

  navigationBottomPanel: {
    position: "absolute",
    left: 10,
    right: 10,
    bottom: 10,
    backgroundColor: "#10151E",
    borderRadius: 28,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
    elevation: 18,
    shadowColor: "#000000",
    shadowOpacity: 0.4,
    shadowRadius: 14,
    zIndex: 50,
  },

  navigationMainInfo: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },

  navigationEta: {
    color: "#FFFFFF",
    fontSize: 31,
    fontWeight: "800",
  },

  navigationDistance: {
    color: "#D5DAE2",
    fontSize: 15,
    marginTop: 4,
  },

  endNavigationButton: {
    minWidth: 92,
    paddingVertical: 13,
    paddingHorizontal: 20,
    borderRadius: 17,
    backgroundColor: "#EF4444",
    alignItems: "center",
  },

  endNavigationText: {
    color: "#FFFFFF",
    fontSize: 16,
    fontWeight: "800",
  },

  navigationControls: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 16,
    paddingHorizontal: 2,
  },

  navigationControlButton: {
    width: 52,
    height: 44,
    borderRadius: 22,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },

  // START BUTTON
  startNavigationButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#2563EB",
    borderRadius: 16,
    paddingVertical: 15,
    marginBottom: 12,
    elevation: 5,
    shadowColor: "#000000",
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },

  startNavigationButtonText: {
    color: "#FFFFFF",
    fontSize: 15,
    fontWeight: "800",
    marginLeft: 8,
    letterSpacing: 0.4,
  },

  // CANCEL BUTTON
  cancelButton: {
    alignItems: "center",
    paddingVertical: 10,
  },

  cancelButtonText: {
    color: "#EF4444",
    fontSize: 15,
    fontWeight: "600",
  },
});