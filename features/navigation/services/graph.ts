import { campusStore } from "../../../shared/lib/campus-store";
import type { Edge, Node, Obstacle } from "../../../shared/data/campus";
import { buildAdjacencyGraph } from "../../../lib/routing/graph";
import { findShortestPath } from "../../../lib/routing/dijkstra";
import { calculateTurnAngle, turnIconFromAngle, getNodeVector } from "../../../lib/routing/directions";

export type RouteInstruction = {
  text: string;
  distance: number;
  floor?: string;
  building?: string;
  transition?: "outdoor->indoor" | "floor" | "arrive";
};

export type Route = {
  id: string;
  nodes: Node[];
  edges: Edge[];
  distance: number;
  durationSec: number;
  instructions: RouteInstruction[];
  hasObstacles?: boolean;
  obstacleWarning?: string;
};

const WALK_SPEED = 1.3; // m/s

import { validateCampusGraph } from "../../../shared/lib/graph-validator";
import { type TravelMode } from "../../../lib/routing/edge-accessibility";

export function shortestPath(
  startId: string,
  endId: string,
  options?: { isDraftMode?: boolean; travelMode?: TravelMode; graphData?: any }
): Route | null {
  if (!startId || !endId) return null;

  const travelMode = options?.travelMode ?? "WALK";

  if (options?.graphData) {
    return computeShortestPathForData(options.graphData, startId, endId, travelMode);
  }

  const isDraft = options?.isDraftMode ?? false;
  const work = campusStore.getWorkingData();

  if (isDraft) {
    // Admin Draft Mode: Stay strictly in draft context to display exact error diagnostics
    if (work.nodes.length > 0) {
      return computeShortestPathForData(work, startId, endId, travelMode);
    }
    return null;
  }

  // User Published Mode: Validate graph. If valid, use working data directly
  const healthReport = validateCampusGraph(work);
  if (healthReport.canPublish && work.nodes.length > 0) {
    const workResult = computeShortestPathForData(work, startId, endId, travelMode);
    if (workResult) return workResult;
  }

  // Graceful Fallback: Use last published valid snapshot if draft has critical errors
  const pub = campusStore.getPublishedData();
  if (pub.nodes.length > 0) {
    return computeShortestPathForData(pub, startId, endId, travelMode);
  }

  return null;
}

function computeShortestPathForData(
  data: ReturnType<typeof campusStore.getWorkingData> | ReturnType<typeof campusStore.getPublishedData>,
  startId: string,
  endId: string,
  travelMode: TravelMode = "WALK"
): Route | null {
  if (data.nodes.length === 0) return null;

  const obstacles = data.obstacles || [];

  // Pass 1: Primary strict graph — hard-blocks all obstacle edges to guarantee obstacle avoidance
  const { graph: primaryGraph, nodeMap } = buildAdjacencyGraph(data.nodes, data.edges, {
    obstacles,
    floors: data.floors,
    allowObstaclePenalties: false,
    travelMode,
  });

  // Aggregating helper to collect candidate node IDs for a location query
  const resolveNodeIds = (paramId: string): string[] => {
    if (!paramId) return [];
    const normalized = paramId.trim().toLowerCase();
    const candidateIds = new Set<string>();

    // 1. Direct node ID match
    if (nodeMap.has(paramId)) {
      return [paramId];
    }

    // Live Location query identifier fallback
    if (
      normalized === "dest-live-user-location" ||
      normalized === "n-live-user" ||
      normalized === "your location"
    ) {
      const outdoorNode = data.nodes.find(
        (n) =>
          n.floorId === "f-out" &&
          (n.type === "BUILDING_ENTRANCE" || n.type === "OUTDOOR" || n.type === "OUTDOOR_PATH" || n.isEntranceNode)
      );
      if (outdoorNode) return [outdoorNode.id];
      if (data.nodes.length > 0) return [data.nodes[0].id];
    }

    // 2. Direct exact node name match (Ground / Entrance node priority)
    const exactNameNodes = data.nodes.filter(
      (n) => n.name && n.name.trim().toLowerCase() === normalized
    );
    if (exactNameNodes.length > 0) {
      const groundOrEntrance = exactNameNodes.filter((n) => {
        const floor = data.floors.find((f) => f.id === n.floorId);
        return (floor && floor.ordinal === 0) || n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode;
      });
      if (groundOrEntrance.length > 0) {
        return groundOrEntrance.map((n) => n.id);
      }
      return exactNameNodes.map((n) => n.id);
    }

    // 3. Destination match (by ID, exact name, or alias)
    const exactDest = data.destinations.find(
      (d) => d.id === paramId || d.name.trim().toLowerCase() === normalized
    );
    if (exactDest) {
      const matchingGroundNode = data.nodes.find((n) => {
        const isSameName = n.name && n.name.trim().toLowerCase() === exactDest.name.trim().toLowerCase();
        const floor = data.floors.find((f) => f.id === n.floorId);
        return isSameName && ((floor && floor.ordinal === 0) || n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode);
      });
      if (matchingGroundNode) {
        return [matchingGroundNode.id];
      }
      if (exactDest.nodeId && nodeMap.has(exactDest.nodeId)) {
        return [exactDest.nodeId];
      }
    }

    const matchingDests = data.destinations.filter((d) => {
      const matchName = d.name.trim().toLowerCase() === normalized;
      const matchAlias = d.aliases && d.aliases.some((a) => a.trim().toLowerCase() === normalized);
      return (matchName || matchAlias) && d.nodeId && nodeMap.has(d.nodeId);
    });
    if (matchingDests.length > 0) {
      return matchingDests.map((d) => d.nodeId).filter((id): id is string => Boolean(id));
    }

    // 4. Strict Building match (ONLY for exact building code or exact building name)
    const building = data.buildings.find(
      (b) =>
        b.id === paramId ||
        b.name.trim().toLowerCase() === normalized ||
        (b.shortCode && b.shortCode.trim().toLowerCase() === normalized)
    );

    if (building) {
      const buildingFloorIds = new Set(
        data.floors.filter((f) => f.buildingId === building.id).map((f) => f.id)
      );
      // Prefer entrance nodes or ground floor nodes of the building
      const entranceNodes = data.nodes.filter(
        (n) =>
          buildingFloorIds.has(n.floorId) &&
          (n.type === "ENTRANCE" || n.type === "BUILDING_ENTRANCE" || n.isEntranceNode)
      );
      if (entranceNodes.length > 0) {
        return entranceNodes.map((n) => n.id);
      }

      data.nodes.forEach((n) => {
        if (buildingFloorIds.has(n.floorId)) {
          candidateIds.add(n.id);
        }
      });
      if (candidateIds.size > 0) return Array.from(candidateIds);
    }

    // 5. Fallback: partial name match on nodes
    const partialNodes = data.nodes.filter(
      (n) => n.name && n.name.trim().toLowerCase().includes(normalized)
    );
    if (partialNodes.length > 0) {
      return partialNodes.map((n) => n.id);
    }

    return [];
  };

  const startNodeIds = resolveNodeIds(startId);
  const endNodeIds = resolveNodeIds(endId);

  if (startNodeIds.length === 0 || endNodeIds.length === 0) return null;

  // Primary search: Evaluate all candidate node combinations on obstacle-free graph
  let bestResult: ReturnType<typeof findShortestPath> = null;
  let isObstacleFree = false;

  for (const sId of startNodeIds) {
    for (const eId of endNodeIds) {
      const res = findShortestPath(primaryGraph, nodeMap, sId, eId);
      if (res) {
        // Compare by totalDistance (actual walking distance) to pick the genuinely shortest route,
        // rather than totalWeight which includes artificial stair/lift penalties
        if (!bestResult || res.totalDistance < bestResult.totalDistance) {
          bestResult = res;
          isObstacleFree = true;
        }
      }
    }
  }

  if (!bestResult) {
    const { graph: fallbackGraph } = buildAdjacencyGraph(data.nodes, data.edges, {
      obstacles,
      floors: data.floors,
      allowObstaclePenalties: true,
      travelMode,
    });

    for (const sId of startNodeIds) {
      for (const eId of endNodeIds) {
        const res = findShortestPath(fallbackGraph, nodeMap, sId, eId);
        if (res) {
          if (!bestResult || res.totalDistance < bestResult.totalDistance) {
            bestResult = res;
            isObstacleFree = false;
          }
        }
      }
    }
  }

  if (!bestResult) return null;

  const floorById = (id: string) => data.floors.find((f) => f.id === id);
  const buildingById = (id: string) => data.buildings.find((b) => b.id === id);

  // Preserve exact traversal orientation (adj.from -> adj.to) for path rendering
  const rawEdges: Edge[] = bestResult.edges.map((adj) => {
    const original = data.edges.find(
      (e) => e.id === adj.edgeId || `${e.id}_rev` === adj.edgeId
    );
    return {
      id: original?.id ?? adj.edgeId,
      from: adj.from,
      to: adj.to,
      type: adj.type,
      distance: adj.distance,
      bidirectional: adj.bidirectional,
    };
  });

  const routeEdgeIds = new Set(rawEdges.map((e) => e.id));
  const hasObstacleSegment = !isObstacleFree || obstacles.some((obs) => {
    return obs.edgeIds && obs.edgeIds.some((eId) => routeEdgeIds.has(eId) || routeEdgeIds.has(`${eId}_rev`));
  });

  return {
    id: `${startId}->${endId}`,
    nodes: bestResult.nodes,
    edges: rawEdges,
    distance: bestResult.totalDistance,
    durationSec: Math.round(bestResult.totalDistance / WALK_SPEED),
    hasObstacles: hasObstacleSegment,
    obstacleWarning: hasObstacleSegment
      ? "⚠️ Route passes through active hazard / construction zones. Exercise caution while navigating."
      : undefined,
    instructions: buildInstructions(
      bestResult.nodes,
      rawEdges,
      floorById,
      buildingById
    ),
  };
}

export function multiStopShortestPath(waypointIds: string[]): Route | null {
  const validWaypoints = waypointIds.filter(Boolean);
  if (validWaypoints.length < 2) return null;

  let totalDistance = 0;
  let totalDurationSec = 0;
  let combinedNodes: Node[] = [];
  let combinedEdges: Edge[] = [];
  let combinedInstructions: RouteInstruction[] = [];
  let hasObstacles = false;

  for (let i = 0; i < validWaypoints.length - 1; i++) {
    const segStart = validWaypoints[i];
    const segEnd = validWaypoints[i + 1];
    const segRoute = shortestPath(segStart, segEnd);
    if (!segRoute) return null;

    totalDistance += segRoute.distance;
    totalDurationSec += segRoute.durationSec;
    if (segRoute.hasObstacles) hasObstacles = true;

    if (i === 0) {
      combinedNodes = [...segRoute.nodes];
      combinedEdges = [...segRoute.edges];
    } else {
      combinedNodes = [...combinedNodes, ...segRoute.nodes.slice(1)];
      combinedEdges = [...combinedEdges, ...segRoute.edges];
    }

    if (validWaypoints.length > 2 && i > 0) {
      const stopNodeName = segRoute.nodes[0]?.name || `Stop ${i}`;
      combinedInstructions.push({
        text: `📍 Via ${stopNodeName}`,
        distance: 0,
        transition: "arrive",
      });
    }
    combinedInstructions = combinedInstructions.concat(segRoute.instructions || []);
  }

  return {
    id: `multi-${Date.now()}`,
    nodes: combinedNodes,
    edges: combinedEdges,
    distance: totalDistance,
    durationSec: totalDurationSec,
    instructions: combinedInstructions,
    hasObstacles,
    obstacleWarning: hasObstacles
      ? "⚠️ Route passes through active hazard / construction zones. Exercise caution while navigating."
      : undefined,
  };
}

function buildInstructions(
  ns: Node[],
  es: Edge[],
  floorById: (id: string) => ReturnType<typeof campusStore.getWorkingData>["floors"][0] | undefined,
  buildingById: (id: string) => ReturnType<typeof campusStore.getWorkingData>["buildings"][0] | undefined
): RouteInstruction[] {
  const out: RouteInstruction[] = [];
  let lastFloor = ns[0]?.floorId;
  let prevVector: { dx: number; dy: number } | null = null;

  for (let i = 0; i < es.length; i++) {
    const edge = es[i];
    const fromNode = ns[i];
    const to = ns[i + 1];
    if (!to || !fromNode) continue;

    const floor = floorById(to.floorId);
    const bld = floor ? buildingById(floor.buildingId) : undefined;
    const isFloorTransition = to.floorId !== lastFloor;

    const currentVector = getNodeVector(fromNode, to);
    let turnType: "straight" | "slight-left" | "left" | "sharp-left" | "slight-right" | "right" | "sharp-right" | "u-turn" | null = null;

    if (prevVector !== null && !isFloorTransition && edge.type !== "LIFT" && edge.type !== "STAIRS") {
      const angleDeg = calculateTurnAngle(prevVector, currentVector);
      turnType = turnIconFromAngle(angleDeg) as any;
    }

    let text = "";
    let transitionType: RouteInstruction["transition"] = undefined;

    if (edge.type === "LIFT") {
      const liftPhrases = [
        `Take the lift to ${floor?.name ?? "next floor"}`,
        `Use the elevator to ${floor?.name ?? "next floor"}`,
        `Take the lift up to ${floor?.name ?? "next floor"}`,
      ];
      text = liftPhrases[i % liftPhrases.length];
      transitionType = "floor";
      prevVector = null;
    } else if (edge.type === "STAIRS") {
      const stairPhrases = [
        `Take the stairs to ${floor?.name ?? "next floor"}`,
        `Go via stairs to ${floor?.name ?? "next floor"}`,
        `Climb stairs to ${floor?.name ?? "next floor"}`,
      ];
      text = stairPhrases[i % stairPhrases.length];
      transitionType = "floor";
      prevVector = null;
    } else if (isFloorTransition && edge.type === "RAMP") {
      text = `Take the ramp to ${floor?.name ?? "next floor"}`;
      transitionType = "floor";
      prevVector = currentVector;
    } else if (to.type === "ENTRANCE" && isFloorTransition) {
      const entrancePhrases = [
        `Enter ${bld?.name ?? "the building"}`,
        `Head inside ${bld?.name ?? "the building"}`,
        `Proceed into ${bld?.name ?? "the building"}`,
        `Walk into ${bld?.name ?? "the building"}`,
      ];
      text = entrancePhrases[i % entrancePhrases.length];
      transitionType = "outdoor->indoor";
      prevVector = currentVector;
    } else if (isFloorTransition) {
      text = `Walk outdoor path to ${floor?.name ?? "next floor"}`;
      transitionType = "floor";
      prevVector = currentVector;
    } else if (to.name) {
      if (turnType && turnType !== "straight") {
        switch (turnType) {
          case "slight-left": {
            const phrases = [`Bear slightly left towards ${to.name}`, `Veer left towards ${to.name}`, `Turn slightly left toward ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
          case "left": {
            const phrases = [`Turn left towards ${to.name}`, `Take a left turn toward ${to.name}`, `Head left to ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
          case "sharp-left": {
            const phrases = [`Make a sharp left turn towards ${to.name}`, `Turn sharply left toward ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
          case "slight-right": {
            const phrases = [`Bear slightly right towards ${to.name}`, `Veer right towards ${to.name}`, `Turn slightly right toward ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
          case "right": {
            const phrases = [`Turn right towards ${to.name}`, `Take a right turn toward ${to.name}`, `Head right to ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
          case "sharp-right": {
            const phrases = [`Make a sharp right turn towards ${to.name}`, `Turn sharply right toward ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
          case "u-turn": {
            const phrases = [`Make a U-turn towards ${to.name}`, `Turn around towards ${to.name}`];
            text = phrases[i % phrases.length];
            break;
          }
        }
      } else {
        if (to.type === "ENTRANCE") {
          const phrases = [
            `Head to ${to.name}`,
            `Proceed to ${to.name}`,
            `Make your way to ${to.name}`,
            `Continue to ${to.name}`,
          ];
          text = phrases[i % phrases.length];
        } else if (to.type === "CORRIDOR" || to.type === "JUNCTION") {
          const phrases = [
            `Follow path towards ${to.name}`,
            `Proceed along corridor to ${to.name}`,
            `Head straight past ${to.name}`,
            `Continue through ${to.name}`,
          ];
          text = phrases[i % phrases.length];
        } else if (to.type === "RECEPTION") {
          const phrases = [
            `Proceed to ${to.name}`,
            `Head over to ${to.name}`,
            `Walk straight to ${to.name}`,
            `Continue to ${to.name}`,
          ];
          text = phrases[i % phrases.length];
        } else {
          // Varied general progression action verbs (avoiding repetitive "Continue to")
          const generalPhrases = [
            `Continue to ${to.name}`,
            `Head towards ${to.name}`,
            `Proceed to ${to.name}`,
            `Walk straight to ${to.name}`,
            `Make your way to ${to.name}`,
            `Follow path to ${to.name}`,
            `Head over to ${to.name}`,
            `Advance towards ${to.name}`,
            `Keep going towards ${to.name}`,
          ];
          text = generalPhrases[i % generalPhrases.length];
        }
      }
      prevVector = currentVector;
    } else {
      if (turnType && turnType !== "straight") {
        const action = turnType.replace("-", " ");
        text = `Turn ${action} and walk ${Math.round(edge.distance)} m`;
      } else {
        const walkPhrases = [
          `Walk ${Math.round(edge.distance)} m`,
          `Continue straight for ${Math.round(edge.distance)} m`,
          `Proceed ${Math.round(edge.distance)} m straight`,
          `Walk ahead for ${Math.round(edge.distance)} m`,
        ];
        text = walkPhrases[i % walkPhrases.length];
      }
      prevVector = currentVector;
    }

    out.push({
      text,
      distance: edge.distance,
      floor: floor?.name,
      building: bld?.name,
      transition: transitionType,
    });
    lastFloor = to.floorId;
  }

  const last = ns[ns.length - 1];
  if (last?.name) {
    const arrivalPhrases = [
      `Arrive at ${last.name}`,
      `You have reached ${last.name}`,
      `Arrive at ${last.name}`,
    ];
    out.push({
      text: arrivalPhrases[es.length % arrivalPhrases.length],
      distance: 0,
      transition: "arrive",
    });
  }
  return out;
}
