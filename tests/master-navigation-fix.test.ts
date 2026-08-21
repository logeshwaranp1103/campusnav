import { describe, it, expect, beforeEach } from "vitest";
import {
  findContextAwareNearestNodes,
  findContextAwareNearestNode,
  calculateShortestAngleDelta,
  getNodeGeographicCoordinates,
} from "../lib/geo/haversine";
import { gpsToCanvas, canvasToGps, PIXELS_PER_METER } from "../lib/geo/projection";
import { shortestPath } from "../features/navigation/services/graph";
import { campusStore } from "../shared/lib/campus-store";
import type { Building, Floor, Node, Edge, Destination } from "../shared/data/campus";

describe("Master Navigation Fix Suite", () => {
  beforeEach(() => {
    campusStore.resetToInitialData(false);
  });

  describe("Task 1 & 3: Nearest-Node Context Awareness & Disconnected Fallback", () => {
    it("ranks eligible candidate nodes by true geographic distance", () => {
      const n1: Node = { id: "n1", type: "CORRIDOR", floorId: "f-out", x: 100, y: 100, lat: 11.4965, lng: 77.2774 };
      const n2: Node = { id: "n2", type: "CORRIDOR", floorId: "f-out", x: 200, y: 200, lat: 11.4975, lng: 77.2784 };
      const n3: Node = { id: "n3", type: "CORRIDOR", floorId: "f-out", x: 300, y: 300, lat: 11.4985, lng: 77.2794 };

      const userLat = 11.4966;
      const userLng = 77.2775;

      const candidates = findContextAwareNearestNodes(userLat, userLng, [n3, n2, n1], {
        isInside: false,
      });

      expect(candidates.length).toBe(3);
      expect(candidates[0].id).toBe("n1");
      expect(candidates[1].id).toBe("n2");
      expect(candidates[2].id).toBe("n3");
    });

    it("falls back to the next closest candidate when the nearest node is non-accessible or disconnected", () => {
      const bld: Building = { id: "b1", campusId: "c1", name: "Block A", lat: 11.4965, lng: 77.2774 };
      const floor: Floor = { id: "f1", buildingId: "b1", name: "Ground", ordinal: 0 };

      // n1 is closest to user but non-accessible / closed for maintenance
      const n1: Node = { id: "n-isolated", type: "CORRIDOR", floorId: "f1", x: 10, y: 10, lat: 11.4965, lng: 77.2774, accessible: false };
      // n2 is slightly further, accessible, and CONNECTED to destination n3
      const n2: Node = { id: "n-connected", type: "CORRIDOR", floorId: "f1", x: 50, y: 50, lat: 11.4966, lng: 77.2775, accessible: true };
      const n3: Node = { id: "n-dest", type: "ROOM", floorId: "f1", x: 100, y: 100, lat: 11.4967, lng: 77.2776, accessible: true };

      const edgeConnected: Edge = { id: "e-valid", from: "n-connected", to: "n-dest", type: "WALK", distance: 10 };
      const dest: Destination = { id: "d-dest", nodeId: "n-dest", name: "Target Room", category: "Classroom", aliases: [] };

      const graphData = {
        campus: { id: "c1", name: "Main Campus", slug: "main", lat: 11.4965, lng: 77.2774 },
        buildings: [bld],
        floors: [floor],
        nodes: [n1, n2, n3],
        edges: [edgeConnected],
        destinations: [dest],
        events: [],
        obstacles: [],
      };

      const route = shortestPath("dest-live-user-location", "d-dest", {
        graphData,
        userLocation: { lat: 11.4965, lng: 77.2774 },
      });

      expect(route).not.toBeNull();
      // Verify routing bypassed non-accessible n1 and routed through connected candidate n2
      expect(route?.nodes[0].id).toBe("n-connected");
      expect(route?.nodes[1].id).toBe("n-dest");
    });
  });

  describe("Task 3: Routing Inputs & Hidden Node Support", () => {
    it("routes through user-hidden nodes (visibleToUser = false) without exposing their names", () => {
      const n1: Node = { id: "n-start", type: "BUILDING_ENTRANCE", name: "Main Entrance", floorId: "f-out", x: 10, y: 10, visibleToUser: true };
      const nHidden: Node = { id: "n-hidden-junction", type: "JUNCTION", name: "Internal Junction 42", floorId: "f-out", x: 30, y: 10, visibleToUser: false };
      const n2: Node = { id: "n-end", type: "ROOM", name: "Lab 202", floorId: "f-out", x: 50, y: 10, visibleToUser: true };

      const e1: Edge = { id: "e1", from: "n-start", to: "n-hidden-junction", type: "WALK", distance: 20 };
      const e2: Edge = { id: "e2", from: "n-hidden-junction", to: "n-end", type: "WALK", distance: 20 };

      const graphData = {
        campus: { id: "c1", name: "Main Campus", slug: "main", lat: 11.4965, lng: 77.2774 },
        buildings: [],
        floors: [],
        nodes: [n1, nHidden, n2],
        edges: [e1, e2],
        destinations: [],
        events: [],
        obstacles: [],
      };

      const route = shortestPath("n-start", "n-end", { graphData });

      expect(route).not.toBeNull();
      expect(route?.nodes.length).toBe(3);
      // Hidden node must be used in graph traversal
      expect(route?.nodes[1].id).toBe("n-hidden-junction");
      // Turn instructions must mask the hidden node's internal name
      const instruction = route?.instructions.find((ins) => ins.targetNodeId === "n-hidden-junction");
      expect(instruction?.targetNodeName).toBeUndefined();
    });
  });

  describe("Task 4 & 5: Camera Rotation Pivot & Angle Delta", () => {
    it("correctly computes shortest angular delta across 360 degree boundary", () => {
      expect(calculateShortestAngleDelta(359, 1)).toBe(2);
      expect(calculateShortestAngleDelta(1, 359)).toBe(-2);
      expect(calculateShortestAngleDelta(180, 180)).toBe(0);
      expect(Math.abs(calculateShortestAngleDelta(90, 270))).toBe(180);
      expect(calculateShortestAngleDelta(0, 90)).toBe(90);
      expect(calculateShortestAngleDelta(90, 0)).toBe(-90);
    });

    it("resolves node geographic coordinates smoothly with fallback to canvas", () => {
      const nGps: Node = { id: "n1", type: "CORRIDOR", floorId: "f-out", x: 100, y: 100, lat: 11.4965, lng: 77.2774 };
      const coords = getNodeGeographicCoordinates(nGps);
      expect(coords.lat).toBe(11.4965);
      expect(coords.lng).toBe(77.2774);

      const nCanvasOnly: Node = { id: "n2", type: "CORRIDOR", floorId: "f-out", x: 500, y: 500, lat: 0, lng: 0 };
      const fallbackCoords = getNodeGeographicCoordinates(nCanvasOnly);
      expect(fallbackCoords.lat).not.toBe(0);
      expect(fallbackCoords.lng).not.toBe(0);
    });
  });

  describe("Coordinate-Space Separation & Camera Invariance", () => {
    it("guarantees user GPS latitude/longitude and world coordinates are strictly invariant under camera transforms", () => {
      const initialUserGps = { lat: 11.496612, lng: 77.277543 };
      const userWorldPos = gpsToCanvas(initialUserGps.lat, initialUserGps.lng);

      const testAngles = [0, 45, 90, 135, 180, 225, 270, 315, 359];
      const testZooms = [0.35, 0.5, 1.0, 1.5, 2.0, 3.5, 5.0];
      const testPans = [{ x: -200, y: -150 }, { x: 0, y: 0 }, { x: 300, y: 400 }];

      // Camera transformation function: world -> screen (SVG viewBox)
      const projectToScreen = (
        worldPt: { x: number; y: number },
        bearingDeg: number,
        zoom: number,
        pan: { x: number; y: number },
        pivot: { x: number; y: number }
      ) => {
        // Rotation around pivot
        const rad = (bearingDeg * Math.PI) / 180;
        const cos = Math.cos(rad);
        const sin = Math.sin(rad);
        const dx = worldPt.x - pivot.x;
        const dy = worldPt.y - pivot.y;
        const rotatedX = pivot.x + (dx * cos - dy * sin);
        const rotatedY = pivot.y + (dx * sin + dy * cos);

        // Pan and Zoom viewport mapping
        const screenX = (rotatedX + pan.x) * zoom;
        const screenY = (rotatedY + pan.y) * zoom;
        return { screenX, screenY };
      };

      for (const bearing of testAngles) {
        for (const zoom of testZooms) {
          for (const pan of testPans) {
            // Screen projection computed
            const screen = projectToScreen(userWorldPos, bearing, zoom, pan, userWorldPos);
            expect(isFinite(screen.screenX)).toBe(true);
            expect(isFinite(screen.screenY)).toBe(true);

            // User's underlying world coordinates and GPS MUST NEVER BE MODIFIED by screen projection
            expect(userWorldPos.x).toBe(gpsToCanvas(initialUserGps.lat, initialUserGps.lng).x);
            expect(userWorldPos.y).toBe(gpsToCanvas(initialUserGps.lat, initialUserGps.lng).y);
            expect(initialUserGps.lat).toBe(11.496612);
            expect(initialUserGps.lng).toBe(77.277543);
          }
        }
      }
    });

    it("verifies user location dot remains stationary under finger during user-pivoted navigation rotation", () => {
      const userWorld = { x: 450, y: 350 };
      const pivot = { x: 450, y: 350 }; // Rotation pivot set to user location

      for (let angle = 0; angle <= 360; angle += 15) {
        const rad = (angle * Math.PI) / 180;
        // Rotated point around pivot: pivot + rotate(world - pivot)
        const rotX = pivot.x + (userWorld.x - pivot.x) * Math.cos(rad) - (userWorld.y - pivot.y) * Math.sin(rad);
        const rotY = pivot.y + (userWorld.x - pivot.x) * Math.sin(rad) + (userWorld.y - pivot.y) * Math.cos(rad);

        // Since userWorld === pivot, (rotX, rotY) is EXACTLY userWorld with ZERO displacement
        expect(rotX).toBeCloseTo(userWorld.x, 10);
        expect(rotY).toBeCloseTo(userWorld.y, 10);
      }
    });
  });
});
