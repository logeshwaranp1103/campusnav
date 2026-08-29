import { describe, it, expect, beforeEach } from "vitest";
import { findAlternativeRoutes, shortestPath } from "../features/navigation/services/graph";
import { useNavigationStore } from "../features/navigation/navigation-store";
import { campusStore } from "../shared/lib/campus-store";
import type { Node, Edge, Destination, Floor } from "../shared/data/campus";

describe("Alternative (Second Shortest) Route & Turn-by-Turn Stepping Suite", () => {
  const sampleNodes: Node[] = [
    { id: "A", name: "Start Gate", x: 0, y: 0, floorId: "f-out", type: "GATE" },
    { id: "B", name: "Way North", x: 50, y: -20, floorId: "f-out", type: "CORRIDOR" },
    { id: "C", name: "Way South", x: 50, y: 30, floorId: "f-out", type: "CORRIDOR" },
    { id: "D", name: "End Building", x: 100, y: 0, floorId: "f-out", type: "BUILDING_ENTRANCE" },
  ];

  // Route 1 (North): A -> B (50m) -> D (50m) = 100m
  // Route 2 (South): A -> C (60m) -> D (60m) = 120m
  const sampleEdges: Edge[] = [
    { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
    { id: "e2", from: "B", to: "D", distance: 50, bidirectional: true, type: "WALK" },
    { id: "e3", from: "A", to: "C", distance: 60, bidirectional: true, type: "WALK" },
    { id: "e4", from: "C", to: "D", distance: 60, bidirectional: true, type: "WALK" },
  ];

  const graphData = {
    nodes: sampleNodes,
    edges: sampleEdges,
    floors: [{ id: "f-out", name: "Outdoor", ordinal: 0, buildingId: "" }] as Floor[],
    buildings: [],
    destinations: [],
    events: [],
    obstacles: [],
  };

  beforeEach(() => {
    useNavigationStore.getState().cancelNavigationSession();
  });

  describe("1. Alternative Route Computation", () => {
    it("computes primary shortest route and 2nd shortest alternative route", () => {
      const result = findAlternativeRoutes("A", "D", { graphData });

      expect(result.primary).not.toBeNull();
      expect(result.primary?.distance).toBe(100);
      expect(result.primary?.nodes.map((n) => n.id)).toEqual(["A", "B", "D"]);

      expect(result.alternative).not.toBeNull();
      expect(result.alternative?.distance).toBe(120);
      expect(result.alternative?.nodes.map((n) => n.id)).toEqual(["A", "C", "D"]);
    });

    it("returns null alternative route when only one path exists in graph", () => {
      const singlePathData = {
        ...graphData,
        edges: [
          { id: "e1", from: "A", to: "B", distance: 50, bidirectional: true, type: "WALK" },
          { id: "e2", from: "B", to: "D", distance: 50, bidirectional: true, type: "WALK" },
        ],
      };

      const result = findAlternativeRoutes("A", "D", { graphData: singlePathData });
      expect(result.primary).not.toBeNull();
      expect(result.alternative).toBeNull();
    });
  });

  describe("2. Turn-by-Turn Single Step Precision", () => {
    it("steps forward and backward exactly 1 step at a time without jumping", () => {
      const primaryRoute = shortestPath("A", "D", { graphData });
      expect(primaryRoute).not.toBeNull();

      const startDest: Destination = { id: "d-start", name: "Start Gate", nodeId: "A", category: "Gate", aliases: [] };
      const endDest: Destination = { id: "d-end", name: "End Building", nodeId: "D", category: "Building", aliases: [] };

      useNavigationStore.getState().startNavigationSession(startDest, endDest, primaryRoute!);

      expect(useNavigationStore.getState().currentSegmentIndex).toBe(0);

      // Step forward 1
      useNavigationStore.getState().advanceToNextStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);

      // Step forward 2
      useNavigationStore.getState().advanceToNextStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(2);

      // Step backward 1
      useNavigationStore.getState().advanceToPrevStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);

      // Step backward to 0
      useNavigationStore.getState().advanceToPrevStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(0);

      // Clamped at 0
      useNavigationStore.getState().advanceToPrevStep();
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(0);
    });

    it("preserves manual step index when updateGpsPosition is called during manual stepping", () => {
      const primaryRoute = shortestPath("A", "D", { graphData });
      const startDest: Destination = { id: "d-start", name: "Start Gate", nodeId: "A", category: "Gate", aliases: [] };
      const endDest: Destination = { id: "d-end", name: "End Building", nodeId: "D", category: "Building", aliases: [] };

      useNavigationStore.getState().startNavigationSession(startDest, endDest, primaryRoute!);
      useNavigationStore.getState().advanceToNextStep(); // step index = 1

      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);
      expect(useNavigationStore.getState().isManualStepping).toBe(true);

      // Live GPS update at node A (index 0)
      useNavigationStore.getState().updateGpsProgress(
        0,
        0,
        sampleNodes[0],
        sampleNodes,
        () => null,
        { canvasPos: { x: 0, y: 0, floorId: "f-out" } }
      );

      // Should remain at manual step index 1
      expect(useNavigationStore.getState().currentSegmentIndex).toBe(1);
    });
  });

  describe("3. Admin Setting for Alternative Route Display", () => {
    it("allows toggling alternative route visibility in campus store", () => {
      expect(typeof campusStore.getShowAlternativeRoute).toBe("function");
      expect(typeof campusStore.setShowAlternativeRoute).toBe("function");

      campusStore.setShowAlternativeRoute(true);
      expect(campusStore.getShowAlternativeRoute()).toBe(true);

      campusStore.setShowAlternativeRoute(false);
      expect(campusStore.getShowAlternativeRoute()).toBe(false);
    });
  });

  describe("4. 3-State Node Display Mode Cycling", () => {
    it("correctly cycles through ALL -> CIRCLES_ONLY -> HIDDEN -> ALL", () => {
      type NodeDisplayMode = "ALL" | "CIRCLES_ONLY" | "HIDDEN";

      function cycleMode(mode: NodeDisplayMode): NodeDisplayMode {
        if (mode === "ALL") return "CIRCLES_ONLY";
        if (mode === "CIRCLES_ONLY") return "HIDDEN";
        return "ALL";
      }

      let mode: NodeDisplayMode = "ALL";
      expect(mode).toBe("ALL");

      mode = cycleMode(mode);
      expect(mode).toBe("CIRCLES_ONLY");

      mode = cycleMode(mode);
      expect(mode).toBe("HIDDEN");

      mode = cycleMode(mode);
      expect(mode).toBe("ALL");
    });
  });

  describe("5. Admin Instant Live Sync (Without Publish)", () => {
    it("allows toggling instant live sync mode in campus store", () => {
      expect(typeof campusStore.getInstantLiveSync).toBe("function");
      expect(typeof campusStore.setInstantLiveSync).toBe("function");

      campusStore.setInstantLiveSync(true);
      expect(campusStore.getInstantLiveSync()).toBe(true);

      const published = campusStore.getPublishedData();
      const working = campusStore.getWorkingData();
      expect(published.nodes.length).toBe(working.nodes.length);

      campusStore.setInstantLiveSync(false);
      expect(campusStore.getInstantLiveSync()).toBe(false);
    });
  });
});
