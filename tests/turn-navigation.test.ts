import { describe, it, expect } from "vitest";
import {
  generateDirections,
  calculateTurnAngle,
  turnIconFromAngle,
  getNodeVector,
} from "../lib/routing/directions";
import { buildAdjacencyGraph } from "../lib/routing/graph";
import { findShortestPath } from "../lib/routing/dijkstra";
import type { Node } from "../shared/data/campus";
import type { AdjacencyEdge } from "../lib/routing/graph";

describe("Turn Direction Classification & Vector Mathematics", () => {
  // Screen Coordinates (+X = East/Right, +Y = South/Down, -Y = North/Up)
  const northVec = { dx: 0, dy: -10 };
  const southVec = { dx: 0, dy: 10 };
  const eastVec = { dx: 10, dy: 0 };
  const westVec = { dx: -10, dy: 0 };

  it("TEST 1: North -> West results in LEFT turn", () => {
    const angle = calculateTurnAngle(northVec, westVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 2: North -> East results in RIGHT turn", () => {
    const angle = calculateTurnAngle(northVec, eastVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 3: East -> North results in LEFT turn", () => {
    const angle = calculateTurnAngle(eastVec, northVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 4: East -> South results in RIGHT turn", () => {
    const angle = calculateTurnAngle(eastVec, southVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 5: South -> East results in LEFT turn", () => {
    const angle = calculateTurnAngle(southVec, eastVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 6: South -> West results in RIGHT turn", () => {
    const angle = calculateTurnAngle(southVec, westVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 7: West -> South results in LEFT turn", () => {
    const angle = calculateTurnAngle(westVec, southVec);
    expect(angle).toBeCloseTo(-90, 1);
    expect(turnIconFromAngle(angle)).toBe("left");
  });

  it("TEST 8: West -> North results in RIGHT turn", () => {
    const angle = calculateTurnAngle(westVec, northVec);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });

  it("TEST 9: Same direction results in STRAIGHT", () => {
    const angle = calculateTurnAngle(northVec, northVec);
    expect(angle).toBeCloseTo(0, 1);
    expect(turnIconFromAngle(angle)).toBe("straight");
  });

  it("TEST 10: Approximately 180° results in U-TURN", () => {
    const angle = calculateTurnAngle(northVec, southVec);
    expect(Math.abs(angle)).toBeCloseTo(180, 1);
    expect(turnIconFromAngle(angle)).toBe("u-turn");
  });

  it("User problem scenario: approaching intersection heading South and turning West/Left", () => {
    // Node A (100, 0) -> Node B (100, 100) [heading South] -> Node C (50, 100) [turning West]
    const nA: Node = { id: "nA", type: "CORRIDOR", floorId: "f-out", x: 100, y: 0, name: "Start Point" };
    const nB: Node = { id: "nB", type: "JUNCTION", floorId: "f-out", x: 100, y: 100, name: "Intersection" };
    const nC: Node = { id: "nC", type: "CORRIDOR", floorId: "f-out", x: 50, y: 100, name: "Destination" };

    const edges: AdjacencyEdge[] = [
      { edgeId: "e1", from: "nA", to: "nB", distance: 100, type: "WALK", bidirectional: true, weight: 100 },
      { edgeId: "e2", from: "nB", to: "nC", distance: 50, type: "WALK", bidirectional: true, weight: 50 },
    ];

    const steps = generateDirections([nA, nB, nC], edges);
    expect(steps.length).toBe(3);
    // Walking South and turning West is turning to the right of forward travel vector
    expect(steps[1].icon).toBe("right");
    expect(steps[1].text.toLowerCase()).toContain("right");
  });

  it("handles GPS-only coordinate vectors accurately", () => {
    // GPS Latitude: +Lat is North, +Lng is East
    // Point 1: (11.0, 77.0) -> Point 2: (11.001, 77.0) [Heading North]
    // Point 3: (11.001, 77.001) [Turning East]
    const g1: Node = { id: "g1", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, lat: 11.0, lng: 77.0 };
    const g2: Node = { id: "g2", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, lat: 11.001, lng: 77.0 };
    const g3: Node = { id: "g3", type: "OUTDOOR", floorId: "f-out", x: 0, y: 0, lat: 11.001, lng: 77.001 };

    const v1 = getNodeVector(g1, g2);
    const v2 = getNodeVector(g2, g3);

    const angle = calculateTurnAngle(v1, v2);
    expect(angle).toBeCloseTo(90, 1);
    expect(turnIconFromAngle(angle)).toBe("right");
  });
});

describe("Node Visibility Separation from Routing", () => {
  it("allows routing through hidden nodes without breaking shortest path", () => {
    // Route: A (visible) -> B (hidden, visibleToUser: false) -> C (visible)
    const nodeA: Node = { id: "nA", type: "CORRIDOR", floorId: "f-1", x: 0, y: 0, name: "Node A", visibleToUser: true };
    const nodeB: Node = { id: "nB", type: "CORRIDOR", floorId: "f-1", x: 50, y: 0, name: "Hidden Waypoint B", visibleToUser: false };
    const nodeC: Node = { id: "nC", type: "ROOM", floorId: "f-1", x: 100, y: 0, name: "Node C", visibleToUser: true };

    const rawEdges: any[] = [
      { id: "e1", from: "nA", to: "nB", distance: 50, type: "WALK", bidirectional: true },
      { id: "e2", from: "nB", to: "nC", distance: 50, type: "WALK", bidirectional: true },
    ];

    const { graph, nodeMap } = buildAdjacencyGraph([nodeA, nodeB, nodeC], rawEdges);
    const path = findShortestPath(graph, nodeMap, "nA", "nC");

    // Path must successfully route through hidden node B
    expect(path).not.toBeNull();
    expect(path?.nodes.map((n) => n.id)).toEqual(["nA", "nB", "nC"]);
    expect(path?.totalDistance).toBe(100);

    // Visual filter check: user map only visualizes nodes with visibleToUser !== false
    const renderedNodes = [nodeA, nodeB, nodeC].filter((n) => n.visibleToUser === undefined || n.visibleToUser === true);
    expect(renderedNodes.map((n) => n.id)).toEqual(["nA", "nC"]);
    expect(renderedNodes.some((n) => n.id === "nB")).toBe(false);
  });
});
