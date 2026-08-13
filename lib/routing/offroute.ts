import type { Node } from "../../shared/data/campus";
import type { PathResult } from "./dijkstra";
import { calculateGeographicDistance } from "../geo/haversine";
import { canvasToGps } from "../geo/projection";

export interface OffRouteCheckResult {
  isOffRoute: boolean;
  distanceFromRoute: number;
  closestNodeId?: string;
}

export function checkOffRoute(
  userPos: { x: number; y: number; lat?: number; lng?: number; floorId: string },
  currentRoute: PathResult | null,
  thresholdMeters = 20
): OffRouteCheckResult {
  if (!currentRoute || currentRoute.nodes.length === 0) {
    return { isOffRoute: false, distanceFromRoute: 0 };
  }

  // Filter nodes matching current floor or floor transition
  const floorNodes = currentRoute.nodes.filter((n) => n.floorId === userPos.floorId);
  if (floorNodes.length === 0) {
    // Visitor is on a different floor than current route segment
    return { isOffRoute: true, distanceFromRoute: 100 };
  }

  let minDistance = Infinity;
  let closestNodeId: string | undefined = undefined;

  const userGps = userPos.lat && userPos.lng ? { lat: userPos.lat, lng: userPos.lng } : canvasToGps(userPos.x, userPos.y);

  floorNodes.forEach((node) => {
    const nodeGps = node.lat && node.lng ? { lat: node.lat, lng: node.lng } : canvasToGps(node.x, node.y);
    const dist = calculateGeographicDistance(userGps.lat, userGps.lng, nodeGps.lat, nodeGps.lng);
    if (dist < minDistance) {
      minDistance = dist;
      closestNodeId = node.id;
    }
  });

  return {
    isOffRoute: minDistance > thresholdMeters,
    distanceFromRoute: Math.round(minDistance),
    closestNodeId,
  };
}

export function detectEntranceTransition(
  userPos: { x: number; y: number; lat?: number; lng?: number; floorId: string },
  nodes: Node[],
  thresholdMeters = 30
): { transition: "ENTER_BUILDING" | "EXIT_BUILDING" | null; entranceNode?: Node } {
  const userGps = userPos.lat && userPos.lng ? { lat: userPos.lat, lng: userPos.lng } : canvasToGps(userPos.x, userPos.y);

  const nearbyEntrance = nodes.find((n) => {
    if (!n.type || (n.type !== "BUILDING_ENTRANCE" && n.type !== "ENTRANCE" && !n.isEntranceNode)) return false;
    const nGps = n.lat && n.lng ? { lat: n.lat, lng: n.lng } : canvasToGps(n.x, n.y);
    return calculateGeographicDistance(userGps.lat, userGps.lng, nGps.lat, nGps.lng) <= thresholdMeters;
  });

  if (!nearbyEntrance) return { transition: null };

  if (userPos.floorId === "f-out" && nearbyEntrance.floorId !== "f-out") {
    return { transition: "ENTER_BUILDING", entranceNode: nearbyEntrance };
  }

  if (userPos.floorId !== "f-out" && nearbyEntrance.floorId === "f-out") {
    return { transition: "EXIT_BUILDING", entranceNode: nearbyEntrance };
  }

  return { transition: null, entranceNode: nearbyEntrance };
}
