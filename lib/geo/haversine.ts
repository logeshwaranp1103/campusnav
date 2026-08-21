import type { Node, Floor } from "../../shared/data/campus";
import { canvasToGps } from "./projection";

const METERS_PER_DEGREE_LAT = 111320;

/**
 * Calculates the real-world geographic distance in meters between two (latitude, longitude) coordinates
 * using the formula:
 * Distance ≈ √((Δlat × 111320)² + (Δlon × 111320 × cos(averageLatitude))²)
 */
export function calculateGeographicDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) {
    return 10; // Fallback distance
  }

  const dLat = lat2 - lat1;
  const dLon = lng2 - lng1;

  const averageLatitudeRad = (((lat1 + lat2) / 2) * Math.PI) / 180;

  const latDistanceMeters = dLat * METERS_PER_DEGREE_LAT;
  const lonDistanceMeters = dLon * METERS_PER_DEGREE_LAT * Math.cos(averageLatitudeRad);

  const distanceMeters = Math.sqrt(
    latDistanceMeters * latDistanceMeters + lonDistanceMeters * lonDistanceMeters
  );

  return Math.max(1, Math.round(distanceMeters));
}

// Export alias for backwards compatibility across existing imports
export const calculateHaversineDistance = calculateGeographicDistance;

/**
 * Calculates real-world geographic forward bearing in degrees (0..360) from (lat1, lng1) to (lat2, lng2).
 * 0° = North, 90° = East, 180° = South, 270° = West
 */
export function calculateGeographicBearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (isNaN(lat1) || isNaN(lng1) || isNaN(lat2) || isNaN(lng2)) return 0;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lng2 - lng1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);

  const theta = Math.atan2(y, x);
  return ((theta * 180) / Math.PI + 360) % 360;
}

/**
 * Calculates the shortest angular difference in degrees (-180..180) from currentAngle to targetAngle.
 * Correctly handles 359° -> 1° (+2°) and 1° -> 359° (-2°) boundary wrap-arounds.
 */
export function calculateShortestAngleDelta(currentAngle: number, targetAngle: number): number {
  return (((targetAngle - currentAngle + 540) % 360) - 180);
}

/**
 * Finds the nearest navigation node to a given (latitude, longitude) coordinate
 * matching the active floor or outdoor area.
 */
export function findNearestNodeByGps(
  lat: number,
  lng: number,
  nodes: Node[],
  floorId = "f-out",
  maxDistanceMeters = 300
): { node: Node | null; distanceMeters: number } {
  const eligibleNodes = nodes.filter((n) => {
    if (floorId === "f-out") {
      return (
        n.floorId === "f-out" ||
        n.floorId === "outdoor" ||
        n.type === "BUILDING_ENTRANCE" ||
        n.type === "OUTDOOR_PATH" ||
        n.type === "OUTDOOR" ||
        n.type === "GATE" ||
        n.isEntranceNode
      );
    }
    return n.floorId === floorId;
  });

  if (!nodes || nodes.length === 0 || eligibleNodes.length === 0) {
    return { node: null, distanceMeters: Infinity };
  }

  let nearestNode: Node | null = null;
  let minDistance = Infinity;

  eligibleNodes.forEach((n) => {
    let nLat = n.lat;
    let nLng = n.lng;
    if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
      if (typeof n.x === "number" && typeof n.y === "number") {
        const coords = canvasToGps(n.x, n.y);
        nLat = coords.lat;
        nLng = coords.lng;
      }
    }
    if (typeof nLat === "number" && typeof nLng === "number" && !isNaN(nLat) && !isNaN(nLng)) {
      const dist = calculateGeographicDistance(lat, lng, nLat, nLng);
      if (dist < minDistance) {
        minDistance = dist;
        nearestNode = n;
      }
    }
  });

  return {
    node: nearestNode,
    distanceMeters: minDistance <= maxDistanceMeters ? minDistance : minDistance,
  };
}

export interface ContextAwareNearestNodeOptions {
  isInside: boolean;
  buildingId?: string | null;
  floorId?: string | null;
  floors?: Floor[];
}

export interface NearestNodeResult {
  node: Node | null;
  distanceMeters: number;
  floorId: string;
  buildingId: string | null;
  isIndoor: boolean;
  error?: string;
}

/**
 * Context-aware nearest navigation node finder.
 *
 * INDOOR:
 * Filters strictly for nodes on the detected building and selected floor.
 * Excludes nodes from all other buildings and floors.
 *
 * OUTDOOR:
 * Filters for valid outdoor paths, gates, and building entrance nodes.
 */
export function findContextAwareNearestNodes(
  lat: number,
  lng: number,
  nodes: Node[],
  context: ContextAwareNearestNodeOptions
): Node[] {
  if (!lat || !lng || isNaN(lat) || isNaN(lng) || !nodes || nodes.length === 0) {
    return [];
  }

  const getNodeGps = (n: Node) => {
    let nLat = n.lat;
    let nLng = n.lng;
    if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
      if (typeof n.x === "number" && typeof n.y === "number") {
        const gps = canvasToGps(n.x, n.y);
        nLat = gps.lat;
        nLng = gps.lng;
      }
    }
    return { lat: nLat, lng: nLng };
  };

  const getDistance = (n: Node) => {
    const g = getNodeGps(n);
    if (typeof g.lat === "number" && typeof g.lng === "number" && !isNaN(g.lat) && !isNaN(g.lng)) {
      return calculateGeographicDistance(lat, lng, g.lat, g.lng);
    }
    return Infinity;
  };

  const candidatePool: Node[] = [];

  if (context.isInside && context.buildingId && context.floorId && context.floorId !== "f-out") {
    // Priority 1: Same floor nodes
    const sameFloorNodes = nodes.filter((n) => n.floorId === context.floorId);
    if (sameFloorNodes.length > 0) {
      candidatePool.push(...sameFloorNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
    }

    // Priority 2: Same building entrance nodes
    const buildingEntranceNodes = nodes.filter((n) => {
      const isEnt = Boolean(n.isEntranceNode || n.type === "BUILDING_ENTRANCE" || (n.name && n.name.toLowerCase().includes("entrance")));
      if (!isEnt) return false;
      const nodeFloor = context.floors?.find((f) => f.id === n.floorId);
      return nodeFloor?.buildingId === context.buildingId;
    });
    if (buildingEntranceNodes.length > 0) {
      candidatePool.push(...buildingEntranceNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
    }

    // Priority 3: Same building other floor nodes
    const buildingNodes = nodes.filter((n) => {
      const nodeFloor = context.floors?.find((f) => f.id === n.floorId);
      return nodeFloor?.buildingId === context.buildingId;
    });
    if (buildingNodes.length > 0) {
      candidatePool.push(...buildingNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
    }
  }

  // Priority 4: Outdoor / Campus walkway nodes
  const outdoorNodes = nodes.filter((n) =>
    n.floorId === "f-out" ||
    n.floorId === "outdoor" ||
    n.type === "OUTDOOR" ||
    n.type === "OUTDOOR_PATH" ||
    n.type === "ROAD_JUNCTION" ||
    n.type === "BUILDING_ENTRANCE" ||
    n.type === "GATE" ||
    n.type === "CORRIDOR" ||
    n.isEntranceNode
  );
  if (outdoorNodes.length > 0) {
    candidatePool.push(...outdoorNodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));
  }

  // Priority 5: All remaining nodes sorted by geographic distance
  candidatePool.push(...nodes.slice().sort((a, b) => getDistance(a) - getDistance(b)));

  // Deduplicate candidate list preserving priority order
  const uniqueCandidateIds = new Set<string>();
  const result: Node[] = [];
  for (const n of candidatePool) {
    if (!uniqueCandidateIds.has(n.id)) {
      uniqueCandidateIds.add(n.id);
      result.push(n);
    }
  }

  return result;
}

export function findContextAwareNearestNode(
  lat: number,
  lng: number,
  nodes: Node[],
  context: ContextAwareNearestNodeOptions
): NearestNodeResult {
  if (!lat || !lng || isNaN(lat) || isNaN(lng) || !nodes || nodes.length === 0) {
    return {
      node: null,
      distanceMeters: Infinity,
      floorId: context.floorId || "f-out",
      buildingId: context.buildingId || null,
      isIndoor: Boolean(context.isInside),
      error: "Invalid GPS coordinates or empty node graph",
    };
  }

  if (context.isInside && context.buildingId && context.floorId && context.floorId !== "f-out") {
    const targetFloorId = context.floorId;
    const indoorFloorNodes = nodes.filter((n) => n.floorId === targetFloorId);

    if (indoorFloorNodes.length === 0) {
      return {
        node: null,
        distanceMeters: Infinity,
        floorId: targetFloorId,
        buildingId: context.buildingId,
        isIndoor: true,
        error: "No navigation nodes are available on this floor.",
      };
    }
  }

  const candidates = findContextAwareNearestNodes(lat, lng, nodes, context);
  if (candidates.length === 0) {
    return {
      node: null,
      distanceMeters: Infinity,
      floorId: context.floorId || "f-out",
      buildingId: context.buildingId || null,
      isIndoor: Boolean(context.isInside),
      error: "Invalid GPS coordinates or empty node graph",
    };
  }

  const bestNode = candidates[0];
  let nLat = bestNode.lat;
  let nLng = bestNode.lng;
  if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
    if (typeof bestNode.x === "number" && typeof bestNode.y === "number") {
      const gps = canvasToGps(bestNode.x, bestNode.y);
      nLat = gps.lat;
      nLng = gps.lng;
    }
  }

  const distanceMeters = (typeof nLat === "number" && typeof nLng === "number" && !isNaN(nLat) && !isNaN(nLng))
    ? calculateGeographicDistance(lat, lng, nLat, nLng)
    : 10;

  return {
    node: bestNode,
    distanceMeters,
    floorId: bestNode.floorId || context.floorId || "f-out",
    buildingId: context.buildingId || null,
    isIndoor: Boolean(context.isInside),
  };
}
