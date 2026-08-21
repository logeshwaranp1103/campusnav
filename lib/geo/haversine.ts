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

  // 1. INDOOR CASE: User is inside a detected building and has a selected floor
  if (context.isInside && context.buildingId && context.floorId && context.floorId !== "f-out") {
    const targetFloorId = context.floorId;

    // Filter nodes belonging strictly to this floor
    const indoorFloorNodes = nodes.filter((n) => n.floorId === targetFloorId);

    if (indoorFloorNodes.length === 0) {
      const isKnownFloor = context.floors?.some((f) => f.id === targetFloorId && f.buildingId === context.buildingId);
      if (!isKnownFloor) {
        return {
          node: null,
          distanceMeters: Infinity,
          floorId: targetFloorId,
          buildingId: context.buildingId,
          isIndoor: true,
          error: "No navigation nodes are available on this floor.",
        };
      }

      // Prioritize Building Entrance Nodes for this building
      const buildingEntranceNodes = nodes.filter((n) => {
        const isEnt = Boolean(n.isEntranceNode || n.type === "BUILDING_ENTRANCE" || (n.name && n.name.toLowerCase().includes("entrance")));
        if (!isEnt) return false;
        if (!context.buildingId) return true;
        if ((n as unknown as { buildingId?: string }).buildingId === context.buildingId) return true;
        const nodeFloor = context.floors?.find((f) => f.id === n.floorId);
        return nodeFloor?.buildingId === context.buildingId;
      });

      if (buildingEntranceNodes.length > 0) {
        let nearestEntNode: Node | null = null;
        let minEntDist = Infinity;
        buildingEntranceNodes.forEach((n) => {
          let nLat = n.lat;
          let nLng = n.lng;
          if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
            if (typeof n.x === "number" && typeof n.y === "number") {
              const gps = canvasToGps(n.x, n.y);
              nLat = gps.lat;
              nLng = gps.lng;
            }
          }
          if (typeof nLat === "number" && typeof nLng === "number" && !isNaN(nLat) && !isNaN(nLng)) {
            const dist = calculateGeographicDistance(lat, lng, nLat, nLng);
            if (dist < minEntDist) {
              minEntDist = dist;
              nearestEntNode = n;
            }
          }
        });
        if (nearestEntNode) {
          return {
            node: nearestEntNode,
            distanceMeters: minEntDist,
            floorId: (nearestEntNode as Node).floorId || targetFloorId,
            buildingId: context.buildingId,
            isIndoor: true,
          };
        }
      }

      // 2. Fallback to any node belonging to the building
      const buildingNodes = nodes.filter((n) => {
        if (!context.buildingId) return false;
        if ((n as unknown as { buildingId?: string }).buildingId === context.buildingId) return true;
        const nodeFloor = context.floors?.find((f) => f.id === n.floorId);
        return nodeFloor?.buildingId === context.buildingId;
      });

      if (buildingNodes.length > 0) {
        let nearestBldNode: Node | null = null;
        let minBldDist = Infinity;
        buildingNodes.forEach((n) => {
          let nLat = n.lat;
          let nLng = n.lng;
          if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
            if (typeof n.x === "number" && typeof n.y === "number") {
              const gps = canvasToGps(n.x, n.y);
              nLat = gps.lat;
              nLng = gps.lng;
            }
          }
          if (typeof nLat === "number" && typeof nLng === "number" && !isNaN(nLat) && !isNaN(nLng)) {
            const dist = calculateGeographicDistance(lat, lng, nLat, nLng);
            if (dist < minBldDist) {
              minBldDist = dist;
              nearestBldNode = n;
            }
          }
        });
        if (nearestBldNode) {
          return {
            node: nearestBldNode,
            distanceMeters: minBldDist,
            floorId: (nearestBldNode as Node).floorId || targetFloorId,
            buildingId: context.buildingId,
            isIndoor: true,
          };
        }
      }

      // 3. Fallback: If building has no indoor/entrance nodes mapped, find the nearest node geographically
      const fallbackNodes = nodes.filter((n) =>
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
      const candidates = fallbackNodes.length > 0 ? fallbackNodes : nodes;
      let nearestCandidate: Node | null = null;
      let minCandidateDist = Infinity;
      candidates.forEach((n) => {
        let nLat = n.lat ?? (n.x !== undefined && n.y !== undefined ? canvasToGps(n.x, n.y).lat : NaN);
        let nLng = n.lng ?? (n.x !== undefined && n.y !== undefined ? canvasToGps(n.x, n.y).lng : NaN);
        if (!isNaN(nLat) && !isNaN(nLng)) {
          const dist = calculateGeographicDistance(lat, lng, nLat, nLng);
          if (dist < minCandidateDist) {
            minCandidateDist = dist;
            nearestCandidate = n;
          }
        }
      });
      if (nearestCandidate) {
        return {
          node: nearestCandidate,
          distanceMeters: minCandidateDist,
          floorId: (nearestCandidate as Node).floorId || targetFloorId,
          buildingId: context.buildingId,
          isIndoor: true,
        };
      }

      return {
        node: nodes[0] ?? null,
        distanceMeters: 15,
        floorId: targetFloorId,
        buildingId: context.buildingId,
        isIndoor: true,
      };
    }

    let nearestNode: Node | null = null;
    let minDistance = Infinity;

    indoorFloorNodes.forEach((n) => {
      let nLat = n.lat;
      let nLng = n.lng;
      if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
        if (typeof n.x === "number" && typeof n.y === "number") {
          const gps = canvasToGps(n.x, n.y);
          nLat = gps.lat;
          nLng = gps.lng;
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

    if (!nearestNode && indoorFloorNodes.length > 0) {
      nearestNode = indoorFloorNodes[0];
      minDistance = 10;
    }

    return {
      node: nearestNode,
      distanceMeters: minDistance,
      floorId: targetFloorId,
      buildingId: context.buildingId,
      isIndoor: true,
    };
  }

  // 2. OUTDOOR CASE: User is outside all buildings (or floor is outdoor)
  const outdoorNodes = nodes.filter((n) => {
    return (
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
  });

  const searchPool = outdoorNodes.length > 0 ? outdoorNodes : nodes.filter((n) => n.floorId === "f-out");

  if (searchPool.length === 0) {
    return {
      node: nodes[0] ?? null,
      distanceMeters: 10,
      floorId: "f-out",
      buildingId: null,
      isIndoor: false,
    };
  }

  let nearestNode: Node | null = null;
  let minDistance = Infinity;

  searchPool.forEach((n) => {
    let nLat = n.lat;
    let nLng = n.lng;
    if (typeof nLat !== "number" || typeof nLng !== "number" || isNaN(nLat) || isNaN(nLng)) {
      if (typeof n.x === "number" && typeof n.y === "number") {
        const gps = canvasToGps(n.x, n.y);
        nLat = gps.lat;
        nLng = gps.lng;
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
    node: nearestNode || searchPool[0] || null,
    distanceMeters: minDistance === Infinity ? 10 : minDistance,
    floorId: "f-out",
    buildingId: null,
    isIndoor: false,
  };
}
