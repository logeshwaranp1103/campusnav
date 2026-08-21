import { describe, it, expect, beforeEach } from "vitest";
import { campusStore } from "../shared/lib/campus-store";
import { findContextAwareNearestNodes } from "../lib/geo/haversine";
import { shortestPath } from "../features/navigation/services/graph";
import type { Building, Floor, Node, Edge, Destination } from "../shared/data/campus";

describe("Live GPS Auto-Connecting Routing Engine", () => {
  beforeEach(() => {
    campusStore.clearAllData();
  });

  it("prioritizes same-floor nodes for indoor GPS context", () => {
    const building: Building = {
      id: "bld-rp",
      campusId: "c1",
      name: "RP Block",
      x: 100,
      y: 100,
      width: 200,
      height: 200,
    };
    campusStore.addBuilding(building);

    const floor1: Floor = { id: "f-rp-1", buildingId: "bld-rp", name: "Floor 1", ordinal: 1 };
    const floor2: Floor = { id: "f-rp-2", buildingId: "bld-rp", name: "Floor 2", ordinal: 2 };
    campusStore.addFloor(floor1);
    campusStore.addFloor(floor2);

    const nodeF1: Node = { id: "n-f1", type: "ROOM", floorId: "f-rp-1", x: 100, y: 100, lat: 11.0001, lng: 77.0001 };
    const nodeF2: Node = { id: "n-f2", type: "ROOM", floorId: "f-rp-2", x: 100, y: 100, lat: 11.0001, lng: 77.0001 };
    campusStore.addNode(nodeF1);
    campusStore.addNode(nodeF2);

    // User is physically at lat=11.0001, lng=77.0001 on Floor 2
    const candidates = findContextAwareNearestNodes(11.0001, 77.0001, [nodeF1, nodeF2], {
      isInside: true,
      buildingId: "bld-rp",
      floorId: "f-rp-2",
      floors: [floor1, floor2],
    });

    expect(candidates.length).toBe(2);
    expect(candidates[0].id).toBe("n-f2");
  });

  it("falls back to the next nearest connected node if the geographically closest node is disconnected", () => {
    // Disconnected closest node (0 edges)
    const nCloseDisconnected: Node = { id: "n-close-disc", type: "CORRIDOR", floorId: "f-out", x: 10, y: 10, lat: 11.0, lng: 77.0 };
    // Connected node slightly further
    const nFarConnected1: Node = { id: "n-far-conn-1", type: "OUTDOOR_PATH", floorId: "f-out", x: 50, y: 50, lat: 11.0005, lng: 77.0005 };
    const nFarConnected2: Node = { id: "n-far-conn-2", type: "OUTDOOR_PATH", floorId: "f-out", x: 100, y: 100, lat: 11.001, lng: 77.001 };

    campusStore.addNode(nCloseDisconnected);
    campusStore.addNode(nFarConnected1);
    campusStore.addNode(nFarConnected2);

    campusStore.addEdge({ id: "e-conn", from: "n-far-conn-1", to: "n-far-conn-2", type: "WALK", distance: 50, bidirectional: true });

    const dest: Destination = {
      id: "dest-sf",
      nodeId: "n-far-conn-2",
      name: "SF",
      category: "Classroom",
      aliases: ["SF"],
      floorId: "f-out",
      x: 100,
      y: 100,
    };
    campusStore.addDestination(dest);

    // Candidate ranking
    const candidates = findContextAwareNearestNodes(11.0, 77.0, campusStore.getWorkingData().nodes, {
      isInside: false,
    });

    expect(candidates[0].id).toBe("n-close-disc");

    // Route evaluation iterates candidates until a connected path is found
    let segRoute = null;
    for (const c of candidates) {
      const r = shortestPath(c.id, "dest-sf");
      if (r) {
        segRoute = r;
        break;
      }
    }

    expect(segRoute).not.toBeNull();
    expect(segRoute?.nodes.map((n) => n.id)).toContain("n-far-conn-2");
  });

  it("allows nodes with visibleToUser = false to be used for internal routing", () => {
    const hiddenNode: Node = {
      id: "n-hidden",
      type: "CORRIDOR",
      name: "Internal Service Passageway",
      floorId: "f-out",
      x: 0,
      y: 0,
      visibleToUser: false,
    };
    const destNode: Node = {
      id: "n-dest",
      type: "ROOM",
      name: "SF Room",
      floorId: "f-out",
      x: 100,
      y: 0,
      visibleToUser: true,
    };

    campusStore.addNode(hiddenNode);
    campusStore.addNode(destNode);
    campusStore.addEdge({ id: "e-hidden-dest", from: "n-hidden", to: "n-dest", type: "WALK", distance: 100, bidirectional: true });

    const dest: Destination = {
      id: "dest-sf-hidden",
      nodeId: "n-dest",
      name: "SF",
      category: "Classroom",
      aliases: ["SF"],
      floorId: "f-out",
      x: 100,
      y: 0,
    };
    campusStore.addDestination(dest);

    const route = shortestPath("n-hidden", "dest-sf-hidden");

    expect(route).not.toBeNull();
    expect(route?.nodes.map((n) => n.id)).toEqual(["n-hidden", "n-dest"]);
  });

  it("does not create database edge records when processing live GPS location updates", () => {
    const initialEdgeCount = campusStore.getWorkingData().edges.length;

    const node: Node = { id: "n-gps-1", type: "OUTDOOR_PATH", floorId: "f-out", x: 0, y: 0, lat: 11.0, lng: 77.0 };
    campusStore.addNode(node);

    // Simulate GPS updates calling nearest node matching
    findContextAwareNearestNodes(11.0001, 77.0001, campusStore.getWorkingData().nodes, { isInside: false });
    findContextAwareNearestNodes(11.0002, 77.0002, campusStore.getWorkingData().nodes, { isInside: false });

    const finalEdgeCount = campusStore.getWorkingData().edges.length;
    expect(finalEdgeCount).toBe(initialEdgeCount);
  });
});
