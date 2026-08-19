import type { Node } from "@/shared/data/campus";
import type { AdjacencyEdge } from "./graph";

export type DirectionIcon =
  | "straight"
  | "slight-left"
  | "left"
  | "sharp-left"
  | "slight-right"
  | "right"
  | "sharp-right"
  | "u-turn"
  | "stairs-up"
  | "stairs-down"
  | "lift"
  | "arrive";

export interface DirectionStep {
  text: string;
  distanceMeters: number;
  icon: DirectionIcon;
  bearingDelta?: number;
  floorChange?: { from: string; to: string };
  targetNodeId: string;
}

export function getNodeVector(n1: Node, n2: Node): { dx: number; dy: number } {
  if (
    n1.x !== undefined &&
    n1.y !== undefined &&
    n2.x !== undefined &&
    n2.y !== undefined &&
    (n1.x !== n2.x || n1.y !== n2.y)
  ) {
    return { dx: n2.x - n1.x, dy: n2.y - n1.y };
  }
  if (
    n1.lat !== undefined &&
    n1.lng !== undefined &&
    n2.lat !== undefined &&
    n2.lng !== undefined &&
    (n1.lat !== n2.lat || n1.lng !== n2.lng)
  ) {
    const latRad = (n1.lat * Math.PI) / 180;
    const metersPerDegLat = 111132.92 - 559.82 * Math.cos(2 * latRad) + 1.175 * Math.cos(4 * latRad);
    const metersPerDegLng = 111412.84 * Math.cos(latRad) - 93.5 * Math.cos(3 * latRad);
    const dx = (n2.lng - n1.lng) * metersPerDegLng;
    const dy = -(n2.lat - n1.lat) * metersPerDegLat; // Negative because North is -Y in screen coordinates
    return { dx, dy };
  }
  return { dx: 0, dy: 0 };
}

export function calculateTurnAngle(
  v1: { dx: number; dy: number },
  v2: { dx: number; dy: number }
): number {
  const len1 = Math.hypot(v1.dx, v1.dy);
  const len2 = Math.hypot(v2.dx, v2.dy);
  if (len1 === 0 || len2 === 0) return 0;

  // In Screen/Canvas Coordinates (+X East, +Y South):
  // Cross product (v1.dx * v2.dy - v1.dy * v2.dx):
  // > 0 indicates turning CLOCKWISE (RIGHT turn in user's travel direction)
  // < 0 indicates turning COUNTER-CLOCKWISE (LEFT turn in user's travel direction)
  const cross = v1.dx * v2.dy - v1.dy * v2.dx;
  const dot = v1.dx * v2.dx + v1.dy * v2.dy;

  const angleRad = Math.atan2(cross, dot);
  return (angleRad * 180) / Math.PI;
}

export function turnIconFromAngle(angleDeg: number): DirectionIcon {
  let norm = ((angleDeg % 360) + 360) % 360;
  if (norm > 180) norm -= 360;

  if (Math.abs(norm) <= 25) return "straight";
  if (norm > 25 && norm <= 45) return "slight-right";
  if (norm > 45 && norm <= 135) return "right";
  if (norm > 135 && norm < 155) return "sharp-right";
  if (norm < -25 && norm >= -45) return "slight-left";
  if (norm < -45 && norm >= -135) return "left";
  if (norm < -135 && norm > -155) return "sharp-left";
  return "u-turn";
}

export function cleanLandmarkName(name?: string): string | null {
  if (!name) return null;
  const trimmed = name.trim();
  if (!trimmed) return null;
  if (/^(n\d+|node[_\-\s]*\d+|wp[_\-\s]*\d+|point[_\-\s]*\d+|corridor[_\-\s]*\d+|junction[_\-\s]*\d+|stair[_\-\s]*\d+|lift[_\-\s]*\d+)$/i.test(trimmed)) {
    return null;
  }
  return trimmed;
}

export function formatInstructionText(
  icon: DirectionIcon,
  targetName?: string,
  floorChange?: { from: string; to: string; toFloorName?: string },
  isEntrance?: boolean,
  bldName?: string
): string {
  const landmark = cleanLandmarkName(targetName);

  if (icon === "lift") {
    return floorChange?.toFloorName ? `Take lift to ${floorChange.toFloorName}` : "Take the lift";
  }
  if (icon === "stairs-up" || icon === "stairs-down") {
    return floorChange?.toFloorName ? `Take stairs to ${floorChange.toFloorName}` : "Take the stairs";
  }
  if (isEntrance) {
    return bldName ? `Enter ${bldName}` : "Enter building";
  }

  switch (icon) {
    case "straight":
      return landmark ? `Go straight to ${landmark}` : "Go straight";
    case "slight-left":
      return landmark ? `Keep left at ${landmark}` : "Keep left";
    case "left":
    case "sharp-left":
      return landmark ? `Turn left at ${landmark}` : "Turn left";
    case "slight-right":
      return landmark ? `Keep right at ${landmark}` : "Keep right";
    case "right":
    case "sharp-right":
      return landmark ? `Turn right at ${landmark}` : "Turn right";
    case "u-turn":
      return landmark ? `U-turn at ${landmark}` : "U-turn";
    case "arrive":
      return landmark ? `Arrived at ${landmark}` : "Arrived";
    default:
      return "Go straight";
  }
}

export function generateDirections(
  nodes: Node[],
  edges: AdjacencyEdge[],
  floorNames: Map<string, string> = new Map()
): DirectionStep[] {
  if (nodes.length < 2 || edges.length === 0) {
    if (nodes.length === 1) {
      const landmark = cleanLandmarkName(nodes[0].name);
      return [
        {
          text: landmark ? `Arrived at ${landmark}` : "Arrived",
          distanceMeters: 0,
          icon: "arrive",
          targetNodeId: nodes[0].id,
        },
      ];
    }
    return [];
  }

  const steps: DirectionStep[] = [];
  let prevVector: { dx: number; dy: number } | null = null;

  for (let i = 0; i < edges.length; i++) {
    const edge = edges[i];
    const fromNode = nodes[i];
    const toNode = nodes[i + 1];
    if (!toNode) continue;

    const fromFloor = fromNode.floorId;
    const toFloor = toNode.floorId;
    const isFloorTransition = fromFloor !== toFloor;

    const toFloorName = floorNames.get(toFloor) ?? toFloor;

    if (edge.type === "LIFT") {
      steps.push({
        text: `Take lift to ${toFloorName}`,
        distanceMeters: edge.distance,
        icon: "lift",
        floorChange: { from: fromFloor, to: toFloor },
        targetNodeId: toNode.id,
      });
      prevVector = null;
      continue;
    }

    if (edge.type === "STAIRS") {
      const getFloorRank = (fId?: string, fName?: string, nName?: string): number => {
        const combined = `${fId || ""} ${fName || ""} ${nName || ""}`.toLowerCase();
        if (combined.includes("ground") || combined.includes("gnd") || combined.endsWith("-g") || combined.endsWith("-0")) return 0;
        if (combined.includes("base") || combined.includes("b-") || combined.includes("-1")) return -1;
        const match = combined.match(/(?:floor|fl|level|lvl|f)\s*(\d+)/i);
        if (match) return parseInt(match[1], 10);
        return 0;
      };

      const fromRank = getFloorRank(fromFloor, floorNames.get(fromFloor), fromNode.name);
      const toRank = getFloorRank(toFloor, toFloorName, toNode.name);
      const isUp = toRank >= fromRank;

      steps.push({
        text: `Take stairs to ${toFloorName}`,
        distanceMeters: edge.distance,
        icon: isUp ? "stairs-up" : "stairs-down",
        floorChange: isFloorTransition ? { from: fromFloor, to: toFloor } : undefined,
        targetNodeId: toNode.id,
      });
      prevVector = null;
      continue;
    }

    const currentVector = getNodeVector(fromNode, toNode);
    let icon: DirectionIcon = "straight";
    let delta = 0;

    if (prevVector !== null && !isFloorTransition) {
      delta = calculateTurnAngle(prevVector, currentVector);
      icon = turnIconFromAngle(delta);
    }
    prevVector = currentVector;

    const isEntrance = toNode.type === "ENTRANCE" || toNode.type === "BUILDING_ENTRANCE" || toNode.isEntranceNode;
    const text = formatInstructionText(
      icon,
      toNode.name,
      isFloorTransition ? { from: fromFloor, to: toFloor, toFloorName } : undefined,
      isEntrance && isFloorTransition
    );

    steps.push({
      text,
      distanceMeters: edge.distance,
      icon,
      bearingDelta: delta,
      floorChange: isFloorTransition ? { from: fromFloor, to: toFloor } : undefined,
      targetNodeId: toNode.id,
    });
  }

  const lastNode = nodes[nodes.length - 1];
  const lastLandmark = cleanLandmarkName(lastNode.name);
  steps.push({
    text: lastLandmark ? `Arrived at ${lastLandmark}` : "Arrived",
    distanceMeters: 0,
    icon: "arrive",
    targetNodeId: lastNode.id,
  });

  return steps;
}
