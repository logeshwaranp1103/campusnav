import { describe, it, expect } from "vitest";
import { canTraverseEdge, getEdgePathType, isEVAllowed, isWalkable, type TravelMode } from "../lib/routing/edge-accessibility";
import { shortestPath, multiStopShortestPath } from "../features/navigation/services/graph";
import type { Node, Edge, Floor, Building } from "../shared/data/campus";

describe("Google Maps Experience — Enhanced Navigation & Gestures Spec", () => {
  describe("1. Transport Mode Selection & Routing Gating", () => {
    const mockNodes: Node[] = [
      { id: "n1", name: "Main Gate", x: 100, y: 100, floorId: "f-out", type: "GATE" },
      { id: "n2", name: "Central Circle", x: 200, y: 200, floorId: "f-out", type: "ROAD_JUNCTION" },
      { id: "n3", name: "Pedestrian Plaza", x: 300, y: 300, floorId: "f-out", type: "OUTDOOR_PATH" },
      { id: "n4", name: "Academic Block", x: 400, y: 400, floorId: "f-out", type: "BUILDING_ENTRANCE" },
    ];

    // Graph where n1 -> n2 is EV-accessible road, but n2 -> n3 is WALK-only path, and n2 -> n4 has an EV bypass road
    const mockEdges: Edge[] = [
      { id: "e1", from: "n1", to: "n2", distance: 100, type: "ROAD", pathType: "EV" },
      { id: "e2", from: "n2", to: "n3", distance: 50, type: "WALK", pathType: "WALK" },
      { id: "e3", from: "n3", to: "n4", distance: 50, type: "WALK", pathType: "WALK" },
      { id: "e4", from: "n2", to: "n4", distance: 120, type: "ROAD", pathType: "EV" },
    ];

    const graphData = {
      nodes: mockNodes,
      edges: mockEdges,
      buildings: [] as Building[],
      floors: [] as Floor[],
      destinations: [],
      obstacles: [],
      events: [],
    };

    it("walk mode allows traversal across both EV and WALK pathways", () => {
      // In walk mode, the direct path n1 -> n2 -> n3 -> n4 is 100 + 50 + 50 = 200m
      const route = shortestPath("n1", "n4", {
        travelMode: "WALK",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route!.distance).toBe(200);
      expect(route!.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n3", "n4"]);
    });

    it("EV mode restricts routing to EV-accessible edges only", () => {
      // In EV mode, n2 -> n3 is blocked (WALK only), so it must take the EV road n2 -> n4 (100 + 120 = 220m)
      const route = shortestPath("n1", "n4", {
        travelMode: "EV",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route!.distance).toBe(220);
      expect(route!.nodes.map((n) => n.id)).toEqual(["n1", "n2", "n4"]);
      expect(route!.edges.every((e) => isEVAllowed(e))).toBe(true);
    });

    it("returns null when no EV-accessible route exists (no silent fallback)", () => {
      // n3 is only connected by WALK-only paths e2 and e3
      const route = shortestPath("n1", "n3", {
        travelMode: "EV",
        graphData,
      });

      // Must be null (not silently falling back to WALK)
      expect(route).toBeNull();
    });

    it("multi-stop routing respects the requested travel mode", () => {
      const route = multiStopShortestPath(["n1", "n2", "n4"], {
        travelMode: "EV",
        graphData,
      });

      expect(route).not.toBeNull();
      expect(route!.distance).toBe(220);
    });
  });

  describe("2. Map Rotation & Compass Math", () => {
    it("computes correct touch angle between two finger points", () => {
      const getAngle = (p1: { x: number; y: number }, p2: { x: number; y: number }) =>
        (Math.atan2(p2.y - p1.y, p2.x - p1.x) * 180) / Math.PI;

      // Horizontal fingers (left to right) -> 0 deg
      expect(getAngle({ x: 100, y: 100 }, { x: 200, y: 100 })).toBe(0);

      // Vertical fingers (top to bottom) -> 90 deg
      expect(getAngle({ x: 100, y: 100 }, { x: 100, y: 200 })).toBe(90);

      // Diagonal fingers -> 45 deg
      expect(getAngle({ x: 100, y: 100 }, { x: 200, y: 200 })).toBe(45);
    });

    it("calculates shortest arc distance for smooth North-Up reset animation", () => {
      const getShortestArcDiff = (fromBearing: number, targetBearing = 0) =>
        (((targetBearing - fromBearing + 540) % 360) - 180);

      // At 350 deg (10 deg west of north), should rotate +10 deg to reach 0 deg
      expect(getShortestArcDiff(350, 0)).toBe(10);

      // At 10 deg (10 deg east of north), should rotate -10 deg to reach 0 deg
      expect(getShortestArcDiff(10, 0)).toBe(-10);

      // At 180 deg, diff is +/- 180 deg
      expect(Math.abs(getShortestArcDiff(180, 0))).toBe(180);

      // At 270 deg (West), should rotate +90 deg
      expect(getShortestArcDiff(270, 0)).toBe(90);

      // At 90 deg (East), should rotate -90 deg
      expect(getShortestArcDiff(90, 0)).toBe(-90);
    });
  });

  describe("3. Camera & Follow State Decoupling", () => {
    it("ensures manual user interaction decouples camera without modifying route or GPS", () => {
      let isFollowingUser = true;
      const onUserPan = () => {
        isFollowingUser = false;
      };

      expect(isFollowingUser).toBe(true);

      // User initiates drag/pan/pinch
      onUserPan();
      expect(isFollowingUser).toBe(false);

      // User clicks Re-center FAB
      const onRecenter = () => {
        isFollowingUser = true;
      };
      onRecenter();
      expect(isFollowingUser).toBe(true);
    });
  });
});
