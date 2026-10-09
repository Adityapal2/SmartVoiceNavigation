
import * as Location from "expo-location";

// ==================================================
// TYPES
// ==================================================

export type NavigationRequest =
  | {
      type: "navigate";
      destination: string;
    }
  | {
      type: "nearby";
      category: string;
    };

type NavigationListener = (request: NavigationRequest) => void;

// ==================================================
// STATE
// ==================================================

let navigationListener: NavigationListener | null = null;
let currentNavigation: NavigationRequest | null = null;
let pendingRequests: NavigationRequest[] = [];

// Prevent a broken listener from losing queued requests.
const MAX_PENDING_REQUESTS = 10;

function dispatchRequest(request: NavigationRequest): boolean {
  if (!navigationListener) {
    if (pendingRequests.length >= MAX_PENDING_REQUESTS) {
      pendingRequests.shift();
    }

    pendingRequests.push(request);
    console.log("[Navigation] Request queued:", request.type);
    return true;
  }

  try {
    navigationListener(request);
    return true;
  } catch (error) {
    console.error("[Navigation] Listener error:", error);
    return false;
  }
}

// ==================================================
// REGISTER MAP LISTENER
// ==================================================

export function setNavigationListener(
  listener: NavigationListener
): () => void {
  navigationListener = listener;

  console.log("[Navigation] Map listener registered");

  // Process queued requests in order.
  const queued = pendingRequests.splice(0);

  for (const request of queued) {
    try {
      listener(request);
    } catch (error) {
      console.error("[Navigation] Queued request failed:", error);
    }
  }

  return () => {
    if (navigationListener === listener) {
      navigationListener = null;
      console.log("[Navigation] Map listener removed");
    }
  };
}

// ==================================================
// START NAVIGATION
// ==================================================

export function startNavigation(
  destination: string
): boolean {
  const trimmed = destination?.trim();

  if (!trimmed) {
    console.warn("[Navigation] Empty destination");
    return false;
  }

  const request: NavigationRequest = {
    type: "navigate",
    destination: trimmed,
  };

  currentNavigation = request;

  console.log("[Navigation] Navigate:", trimmed);

  return dispatchRequest(request);
}

// ==================================================
// SEARCH NEARBY
// ==================================================

export function searchNearby(category: string): boolean {
  const trimmed = category?.trim();

  if (!trimmed) {
    console.warn("[Navigation] Empty nearby category");
    return false;
  }

  console.log("[Navigation] Nearby search:", trimmed);

  return dispatchRequest({
    type: "nearby",
    category: trimmed,
  });
}

// ==================================================
// CURRENT NAVIGATION
// ==================================================

export function getCurrentNavigation(): NavigationRequest | null {
  return currentNavigation;
}

// ==================================================
// CLEAR / STOP
// ==================================================

export function clearNavigation(): void {
  currentNavigation = null;
  console.log("[Navigation] State cleared");
}

export function stopNavigation(): void {
  currentNavigation = null;
  console.log("[Navigation] State stopped");
}

// ==================================================
// CURRENT LOCATION
// ==================================================

export async function getNavigationLocation(): Promise<{
  latitude: number;
  longitude: number;
} | null> {
  try {
    const { status } =
      await Location.requestForegroundPermissionsAsync();

    if (status !== "granted") {
      console.warn("[Navigation] Location permission denied");
      return null;
    }

    const location = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.High,
    });

    return {
      latitude: location.coords.latitude,
      longitude: location.coords.longitude,
    };
  } catch (error) {
    console.error("[Navigation] Location error:", error);
    return null;
  }
}
