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

function calculateBearing(n1: Node, n2: Node): number {
  const dx = n2.x - n1.x;
  const dy = n2.y - n1.y;
  let angleDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
  if (angleDeg < 0) angleDeg += 360;
  return angleDeg;
}

function turnIconFromDelta(delta: number): DirectionIcon {
  let norm = ((delta % 360) + 360) % 360;
  if (norm > 180) norm -= 360;

  if (norm >= -20 && norm <= 20) return "straight";
  if (norm > 20 && norm <= 45) return "slight-right";
  if (norm > 45 && norm <= 120) return "right";
  if (norm > 120 && norm <= 160) return "sharp-right";
  if (norm < -20 && norm >= -45) return "slight-left";
  if (norm < -45 && norm >= -120) return "left";
  if (norm < -120 && norm >= -160) return "sharp-left";
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
  let prevBearing: number | null = null;

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
      prevBearing = null;
      continue;
    }

    if (edge.type === "STAIRS") {
      const isUp = i < edges.length - 1; // Default stair direction
      steps.push({
        text: `Take the stairs to ${toFloorName}`,
        distanceMeters: edge.distance,
        icon: isUp ? "stairs-up" : "stairs-down",
        floorChange: isFloorTransition ? { from: fromFloor, to: toFloor } : undefined,
        targetNodeId: toNode.id,
      });
      prevBearing = null;
      continue;
    }

    const currentBearing = calculateBearing(fromNode, toNode);
    let icon: DirectionIcon = "straight";
    let delta = 0;

    if (prevBearing !== null) {
      delta = currentBearing - prevBearing;
      icon = turnIconFromDelta(delta);
    }
    prevBearing = currentBearing;

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
