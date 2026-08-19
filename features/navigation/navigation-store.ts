import { create } from "zustand";
import type { Destination, Node as CampusNode, Edge } from "../../shared/data/campus";
import type { Route, RouteInstruction } from "./services/graph";
import { calculateGeographicDistance } from "../../lib/geo/haversine";
import { checkRouteDeviation } from "../../lib/routing/deviation";

export type NavigationStatus =
  | "IDLE"
  | "ROUTE_READY"
  | "NAVIGATING"
  | "OFF_ROUTE"
  | "REROUTING"
  | "ARRIVED"
  | "GPS_SIGNAL_LOST"
  | "ROUTE_ERROR"
  | "DESTINATION_UNREACHABLE"
  | "NAVIGATION_CANCELLED";

export type NavigationMode =
  | "OUTDOOR"
  | "APPROACHING_ENTRANCE"
  | "INDOOR"
  | "FLOOR_TRANSITION"
  | "POSITION_UNKNOWN"
  | "ARRIVED"
  | "ERROR";

export type IndoorPositionSource =
  | "OUTDOOR_GPS"
  | "BUILDING_ENTRANCE"
  | "MANUAL_FLOOR_SELECTION"
  | "INDOOR_GRAPH_CONTEXT"
  | "UNKNOWN";

export type PositionConfidence = "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";

export interface NavigationSessionState {
  status: NavigationStatus;
  navigationMode: NavigationMode;
  origin: Destination | null;
  destination: Destination | null;
  activeRoute: Route | null;
  currentSegmentIndex: number;
  matchedNodeId: string | null;
  distanceRemaining: number;
  etaSeconds: number;
  currentInstruction: RouteInstruction | null;
  nextInstruction: RouteInstruction | null;
  
  // Phase 3 Indoor Navigation State
  currentBuildingId: string | null;
  currentFloorId: string;
  indoorPositionSource: IndoorPositionSource;
  positionConfidence: PositionConfidence;

  // Reroute & Off-route protection
  consecutiveOffRouteCount: number;
  lastRerouteTimestamp: number;
  offRouteThresholdMeters: number;
  rerouteCooldownMs: number;
  arrivalThresholdMeters: number;
  activeRequestId: number;
  errorMessage: string | null;

  // Actions
  startNavigationSession: (
    origin: Destination,
    destination: Destination,
    route: Route
  ) => void;
  updateGpsProgress: (
    gpsLat: number,
    gpsLng: number,
    matchedNode: CampusNode | null,
    publishedNodes: CampusNode[],
    recalculateRouteFn: (fromNodeId: string, toNodeId: string) => Route | null
  ) => void;
  setCurrentFloor: (floorId: string) => void;
  setIndoorContext: (
    buildingId: string | null,
    floorId: string,
    source: IndoorPositionSource,
    confidence: PositionConfidence
  ) => void;
  cancelNavigationSession: () => void;
  advanceToNextStep: () => void;
  advanceToPrevStep: () => void;
  setGpsSignalLost: () => void;
  setNavigationStatus: (status: NavigationStatus, errorMessage?: string) => void;
}

const OFF_ROUTE_THRESHOLD_METERS = 25.0; // Outdoor off-route threshold in meters
const OFF_ROUTE_CONSECUTIVE_LIMIT = 3;   // Requires 3 consecutive updates to confirm off-route (hysteresis)
const REROUTE_COOLDOWN_MS = 5000;        // 5-second cooldown to prevent infinite rerouting loops
const ARRIVAL_THRESHOLD_METERS = 12.0;   // 12 meters arrival proximity threshold
const AVERAGE_WALKING_SPEED_MPS = 1.25;  // ~1.25 meters/second walking speed

export const useNavigationStore = create<NavigationSessionState>((set, get) => ({
  status: "IDLE",
  navigationMode: "OUTDOOR",
  origin: null,
  destination: null,
  activeRoute: null,
  currentSegmentIndex: 0,
  matchedNodeId: null,
  distanceRemaining: 0,
  etaSeconds: 0,
  currentInstruction: null,
  nextInstruction: null,

  currentBuildingId: null,
  currentFloorId: "f-out",
  indoorPositionSource: "UNKNOWN",
  positionConfidence: "UNKNOWN",

  consecutiveOffRouteCount: 0,
  lastRerouteTimestamp: 0,
  offRouteThresholdMeters: OFF_ROUTE_THRESHOLD_METERS,
  rerouteCooldownMs: REROUTE_COOLDOWN_MS,
  arrivalThresholdMeters: ARRIVAL_THRESHOLD_METERS,
  activeRequestId: 0,
  errorMessage: null,

  setNavigationStatus: (status, errorMessage) =>
    set({ status, ...(errorMessage !== undefined ? { errorMessage } : {}) }),

  setCurrentFloor: (floorId) => set({ currentFloorId: floorId }),

  setIndoorContext: (buildingId, floorId, source, confidence) =>
    set({
      currentBuildingId: buildingId,
      currentFloorId: floorId,
      indoorPositionSource: source,
      positionConfidence: confidence,
      navigationMode: floorId === "f-out" ? "OUTDOOR" : "INDOOR",
    }),

  startNavigationSession: (origin, destination, route) => {
    const instructions = route.instructions || [];
    const firstNode = route.nodes[0];
    const initialFloorId = firstNode?.floorId || "f-out";
    const initialMode: NavigationMode = initialFloorId === "f-out" ? "OUTDOOR" : "INDOOR";

    set((state) => ({
      status: "NAVIGATING",
      navigationMode: initialMode,
      origin,
      destination,
      activeRoute: route,
      currentSegmentIndex: 0,
      matchedNodeId: origin.nodeId,
      currentFloorId: initialFloorId,
      currentBuildingId: (firstNode as any)?.buildingId ?? null,
      indoorPositionSource: initialFloorId === "f-out" ? "OUTDOOR_GPS" : "BUILDING_ENTRANCE",
      positionConfidence: "HIGH",
      distanceRemaining: Math.round(route.distance),
      etaSeconds: Math.round(route.durationSec || route.distance / AVERAGE_WALKING_SPEED_MPS),
      currentInstruction: instructions[0] ?? null,
      nextInstruction: instructions[1] ?? null,
      consecutiveOffRouteCount: 0,
      lastRerouteTimestamp: Date.now(),
      activeRequestId: state.activeRequestId + 1,
      errorMessage: null,
    }));
  },

  updateGpsProgress: (gpsLat, gpsLng, matchedNode, publishedNodes, recalculateRouteFn) => {
    const state = get();
    const { status, activeRoute, destination, lastRerouteTimestamp, consecutiveOffRouteCount, activeRequestId } = state;

    // Do not process progress if idle, completed, cancelled, or rerouting
    if (status !== "NAVIGATING" && status !== "OFF_ROUTE" && status !== "GPS_SIGNAL_LOST") {
      return;
    }

    if (!activeRoute || activeRoute.nodes.length === 0 || !destination) {
      return;
    }

    // Resume navigation if recovering from GPS signal loss
    if (status === "GPS_SIGNAL_LOST") {
      set({ status: "NAVIGATING" });
    }

    const destNode = publishedNodes.find((n) => n.id === destination.nodeId);
    const destLat = destNode?.lat ?? destination.x;
    const destLng = destNode?.lng ?? destination.y;

    // 1. ARRIVAL DETECTION
    const distToDest = (destLat && destLng)
      ? calculateGeographicDistance(gpsLat, gpsLng, destLat, destLng)
      : Math.hypot((matchedNode?.x ?? 0) - (destNode?.x ?? 0), (matchedNode?.y ?? 0) - (destNode?.y ?? 0));

    if (distToDest <= ARRIVAL_THRESHOLD_METERS || (matchedNode && matchedNode.id === destination.nodeId)) {
      set({
        status: "ARRIVED",
        navigationMode: "ARRIVED",
        distanceRemaining: 0,
        etaSeconds: 0,
        consecutiveOffRouteCount: 0,
        currentInstruction: { text: `🎉 Arrived at ${destination.name}`, distance: 0, transition: "arrive" },
        nextInstruction: null,
      });
      return;
    }

    // 2. ROUTE PROGRESS & SEGMENT MATCHING
    const userPos = {
      x: matchedNode?.x ?? activeRoute.nodes[0].x,
      y: matchedNode?.y ?? activeRoute.nodes[0].y,
      floorId: matchedNode?.floorId ?? state.currentFloorId,
    };

    const deviationResult = checkRouteDeviation(userPos, activeRoute.nodes, {
      outdoorThresholdMeters: OFF_ROUTE_THRESHOLD_METERS,
      indoorThresholdMeters: 10.0,
    });

    // 3. OFF-ROUTE DETECTION & REROUTING WITH HYSTERESIS & LOOP PROTECTION
    if (deviationResult.isDeviated && userPos.floorId === "f-out") {
      const newOffRouteCount = consecutiveOffRouteCount + 1;
      const now = Date.now();
      const canReroute = now - lastRerouteTimestamp > REROUTE_COOLDOWN_MS;

      if (newOffRouteCount >= OFF_ROUTE_CONSECUTIVE_LIMIT && canReroute && matchedNode) {
        // Transition to REROUTING
        set({
          status: "REROUTING",
          consecutiveOffRouteCount: newOffRouteCount,
          lastRerouteTimestamp: now,
        });

        const currentReqId = activeRequestId;
        const targetNodeId = destination.nodeId || destination.id;

        // Perform rerouting starting from current matched outdoor node
        const newRoute = targetNodeId ? recalculateRouteFn(matchedNode.id, targetNodeId) : null;

        // Guard against race conditions / stale route requests
        if (get().activeRequestId !== currentReqId) return;

        if (newRoute && newRoute.nodes.length > 0) {
          const instructions = newRoute.instructions || [];
          set({
            status: "NAVIGATING",
            activeRoute: newRoute,
            currentSegmentIndex: 0,
            matchedNodeId: matchedNode.id,
            distanceRemaining: Math.round(newRoute.distance),
            etaSeconds: Math.round(newRoute.durationSec || newRoute.distance / AVERAGE_WALKING_SPEED_MPS),
            currentInstruction: instructions[0] ?? null,
            nextInstruction: instructions[1] ?? null,
            consecutiveOffRouteCount: 0,
            lastRerouteTimestamp: Date.now(),
            errorMessage: null,
          });
        } else {
          set({
            status: "DESTINATION_UNREACHABLE",
            errorMessage: `No path available from current position to ${destination.name}.`,
          });
        }
      } else {
        set({
          status: newOffRouteCount >= 2 ? "OFF_ROUTE" : "NAVIGATING",
          consecutiveOffRouteCount: newOffRouteCount,
        });
      }
      return;
    }

    // 4. ON-ROUTE UPDATE: Progress along segment & Phase 3 Indoor Mode / Floor Detection
    const segmentIndex = Math.max(state.currentSegmentIndex, deviationResult.nearestSegmentIndex);
    const currentNode = matchedNode ?? activeRoute.nodes[segmentIndex] ?? activeRoute.nodes[0];

    // Determine Phase 3 Navigation Mode & Floor Context
    let nextMode: NavigationMode = "OUTDOOR";
    let nextSource: IndoorPositionSource = "OUTDOOR_GPS";
    let nextConfidence: PositionConfidence = "HIGH";

    if (currentNode.floorId === "f-out") {
      nextMode = (currentNode.type === "BUILDING_ENTRANCE" || currentNode.isEntranceNode)
        ? "APPROACHING_ENTRANCE"
        : "OUTDOOR";
      nextSource = "OUTDOOR_GPS";
      nextConfidence = "HIGH";
    } else {
      nextMode = (currentNode.type === "STAIR" || currentNode.type === "LIFT")
        ? "FLOOR_TRANSITION"
        : "INDOOR";
      nextSource = "INDOOR_GRAPH_CONTEXT";
      nextConfidence = "MEDIUM";
    }

    // Calculate remaining distance along active route from current segment to end
    let remainingDistance = 0;
    for (let i = segmentIndex; i < activeRoute.nodes.length - 1; i++) {
      const n1 = activeRoute.nodes[i];
      const n2 = activeRoute.nodes[i + 1];
      if (n1.lat && n1.lng && n2.lat && n2.lng) {
        remainingDistance += calculateGeographicDistance(n1.lat, n1.lng, n2.lat, n2.lng);
      } else {
        remainingDistance += Math.hypot(n2.x - n1.x, n2.y - n1.y);
      }
    }

    const etaSeconds = Math.max(1, Math.round(remainingDistance / AVERAGE_WALKING_SPEED_MPS));
    const instructions = activeRoute.instructions || [];
    const currentInstIndex = Math.min(segmentIndex, instructions.length - 1);
    const currentInstruction = instructions[currentInstIndex] ?? null;
    const nextInstruction = instructions[currentInstIndex + 1] ?? null;

    set({
      status: "NAVIGATING",
      navigationMode: nextMode,
      currentFloorId: currentNode.floorId ?? state.currentFloorId,
      currentBuildingId: (currentNode as any)?.buildingId ?? state.currentBuildingId,
      indoorPositionSource: nextSource,
      positionConfidence: nextConfidence,
      currentSegmentIndex: segmentIndex,
      matchedNodeId: currentNode.id ?? state.matchedNodeId,
      distanceRemaining: Math.round(remainingDistance),
      etaSeconds,
      currentInstruction,
      nextInstruction,
      consecutiveOffRouteCount: 0,
    });
  },

  setGpsSignalLost: () => {
    const state = get();
    if (state.status === "NAVIGATING" || state.status === "OFF_ROUTE") {
      set({
        status: "GPS_SIGNAL_LOST",
        navigationMode: state.currentFloorId === "f-out" ? "OUTDOOR" : "POSITION_UNKNOWN",
        positionConfidence: "LOW",
      });
    }
  },

  advanceToNextStep: () => {
    const state = get();
    const { activeRoute, currentSegmentIndex, destination } = state;
    if (!activeRoute) return;

    const instructions = activeRoute.instructions || [];
    const nextIndex = currentSegmentIndex + 1;

    if (nextIndex >= instructions.length) {
      set({
        status: "ARRIVED",
        navigationMode: "ARRIVED",
        currentSegmentIndex: Math.max(0, instructions.length - 1),
        distanceRemaining: 0,
        etaSeconds: 0,
        currentInstruction: { text: `🎉 Arrived at ${destination?.name ?? "destination"}`, distance: 0, transition: "arrive" },
        nextInstruction: null,
      });
      return;
    }

    const currentInstruction = instructions[nextIndex] ?? null;
    const nextInstruction = instructions[nextIndex + 1] ?? null;
    const matchedNode = activeRoute.nodes[nextIndex] ?? activeRoute.nodes[activeRoute.nodes.length - 1];

    let remainingDistance = 0;
    for (let i = nextIndex; i < activeRoute.nodes.length - 1; i++) {
      const n1 = activeRoute.nodes[i];
      const n2 = activeRoute.nodes[i + 1];
      if (n1 && n2) {
        remainingDistance += Math.hypot(n2.x - n1.x, n2.y - n1.y);
      }
    }

    set({
      status: "NAVIGATING",
      currentSegmentIndex: nextIndex,
      matchedNodeId: matchedNode?.id ?? state.matchedNodeId,
      currentFloorId: matchedNode?.floorId ?? state.currentFloorId,
      distanceRemaining: Math.round(remainingDistance),
      etaSeconds: Math.max(1, Math.round(remainingDistance / AVERAGE_WALKING_SPEED_MPS)),
      currentInstruction,
      nextInstruction,
    });
  },
  advanceToPrevStep: () => {
    const state = get();
    const { activeRoute, currentSegmentIndex } = state;
    if (!activeRoute || currentSegmentIndex <= 0) return;

    const instructions = activeRoute.instructions || [];
    const prevIndex = currentSegmentIndex - 1;

    const currentInstruction = instructions[prevIndex] ?? null;
    const nextInstruction = instructions[prevIndex + 1] ?? null;
    const matchedNode = activeRoute.nodes[prevIndex] ?? activeRoute.nodes[0];

    let remainingDistance = 0;
    for (let i = prevIndex; i < activeRoute.nodes.length - 1; i++) {
      const n1 = activeRoute.nodes[i];
      const n2 = activeRoute.nodes[i + 1];
      if (n1 && n2) {
        remainingDistance += Math.hypot(n2.x - n1.x, n2.y - n1.y);
      }
    }

    set({
      status: "NAVIGATING",
      currentSegmentIndex: prevIndex,
      matchedNodeId: matchedNode?.id ?? state.matchedNodeId,
      currentFloorId: matchedNode?.floorId ?? state.currentFloorId,
      distanceRemaining: Math.round(remainingDistance),
      etaSeconds: Math.max(1, Math.round(remainingDistance / AVERAGE_WALKING_SPEED_MPS)),
      currentInstruction,
      nextInstruction,
    });
  },

  cancelNavigationSession: () =>
    set({
      status: "NAVIGATION_CANCELLED",
      navigationMode: "OUTDOOR",
      origin: null,
      destination: null,
      activeRoute: null,
      currentSegmentIndex: 0,
      matchedNodeId: null,
      currentFloorId: "f-out",
      currentBuildingId: null,
      indoorPositionSource: "UNKNOWN",
      positionConfidence: "UNKNOWN",
      distanceRemaining: 0,
      etaSeconds: 0,
      currentInstruction: null,
      nextInstruction: null,
      consecutiveOffRouteCount: 0,
      errorMessage: null,
    }),
}));
