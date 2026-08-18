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

  if (Math.abs(norm) <= 20) return "straight";
  if (norm > 20 && norm <= 45) return "slight-right";
  if (norm > 45 && norm <= 135) return "right";
  if (norm > 135 && norm < 160) return "sharp-right";
  if (norm < -20 && norm >= -45) return "slight-left";
  if (norm < -45 && norm >= -135) return "left";
  if (norm < -135 && norm > -160) return "sharp-left";
  return "u-turn";
}

export function generateDirections(
  nodes: Node[],
  edges: AdjacencyEdge[],
  floorNames: Map<string, string> = new Map()
): DirectionStep[] {
  if (nodes.length < 2 || edges.length === 0) {
    if (nodes.length === 1) {
      return [
        {
          text: `Arrive at ${nodes[0].name ?? "destination"}`,
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

    const fromFloorName = floorNames.get(fromFloor) ?? fromFloor;
    const toFloorName = floorNames.get(toFloor) ?? toFloor;

    if (edge.type === "LIFT") {
      steps.push({
        text: `Take the lift from ${fromFloorName} to ${toFloorName}`,
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
        if (combined.includes("ground") || combined.includes("gnd") || combined.endsWith("-g") || combined.endsWith("-gnd") || combined.endsWith("-0")) return 0;
        if (combined.includes("base") || combined.includes("b-") || combined.includes("-1")) return -1;
        const match = combined.match(/(?:floor|fl|level|lvl|f)\s*(\d+)/i);
        if (match) return parseInt(match[1], 10);
        return 0;
      };

      const fromRank = getFloorRank(fromFloor, fromFloorName, fromNode.name);
      const toRank = getFloorRank(toFloor, toFloorName, toNode.name);
      const isUp = toRank >= fromRank;
      const dirWord = toRank > fromRank ? "up " : toRank < fromRank ? "down " : "";

      steps.push({
        text: `Take the stairs to ${toFloorName}`,
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

    let text = "";
    if (toNode.name) {
      if (icon === "straight") {
        const straightPhrases = [
          `Continue straight toward ${toNode.name}`,
          `Head straight towards ${toNode.name}`,
          `Proceed straight to ${toNode.name}`,
          `Walk straight to ${toNode.name}`,
          `Make your way to ${toNode.name}`,
          `Follow path to ${toNode.name}`,
        ];
        text = straightPhrases[i % straightPhrases.length];
      } else {
        const turnAction = icon.replace("-", " ");
        if (icon === "slight-left" || icon === "slight-right") {
          const phrases = [`Bear ${turnAction} toward ${toNode.name}`, `Veer ${turnAction.replace("slight ", "")} toward ${toNode.name}`];
          text = phrases[i % phrases.length];
        } else if (icon === "sharp-left" || icon === "sharp-right") {
          text = `Make a sharp ${turnAction.replace("sharp ", "")} turn toward ${toNode.name}`;
        } else if (icon === "u-turn") {
          text = `Make a U-turn toward ${toNode.name}`;
        } else {
          const phrases = [`Turn ${turnAction} toward ${toNode.name}`, `Take a ${turnAction} turn toward ${toNode.name}`, `Head ${turnAction} to ${toNode.name}`];
          text = phrases[i % phrases.length];
        }
      }
    } else {
      if (icon === "straight") {
        const walkPhrases = [
          `Walk ${Math.round(edge.distance)} m straight`,
          `Continue straight for ${Math.round(edge.distance)} m`,
          `Proceed ${Math.round(edge.distance)} m ahead`,
        ];
        text = walkPhrases[i % walkPhrases.length];
      } else {
        text = `Turn ${icon.replace("-", " ")} and walk ${Math.round(edge.distance)} m`;
      }
    }

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
  steps.push({
    text: `Arrive at ${lastNode.name ?? "your destination"}`,
    distanceMeters: 0,
    icon: "arrive",
    targetNodeId: lastNode.id,
  });

  return steps;
}
