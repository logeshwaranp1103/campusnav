import { describe, it, expect, beforeEach } from "vitest";
import { hashPassword, verifyPassword } from "../lib/auth/auth";
import { logAuditEvent, getAuditLogs } from "../lib/services/audit-service";
import { publishDraftGraph } from "../lib/services/publish-service";
import { getMapVersions, restoreMapVersion } from "../lib/services/version-service";
import { campusStore } from "../shared/lib/campus-store";
import type { Building, Floor, Node, Edge } from "../shared/data/campus";
import { prisma } from "../lib/db";

describe("Production Backend & API Services", () => {
  const testBuildingIds = ["b-clean", "b-new-tech"];
  const testFloorIds = ["f-clean-1"];
  const testNodeIds = ["n-ent-clean", "n-stair-bad", "n-corr-2"];
  const testEdgeIds = ["e-test-1"];
  const testObstacleIds = ["obs-test-1"];

  const cleanupTestData = async () => {
    if (prisma) {
      try {
        // Clean only the test relational rows created by tests - never wipe global tables
        await prisma.edge.deleteMany({ where: { id: { in: testEdgeIds } } });
        await prisma.obstacle.deleteMany({ where: { id: { in: testObstacleIds } } });
        await prisma.node.deleteMany({ where: { id: { in: testNodeIds } } });
        await prisma.floor.deleteMany({ where: { id: { in: testFloorIds } } });
        await prisma.building.deleteMany({ where: { id: { in: testBuildingIds } } });
      } catch (e) {}
    }
  };

  beforeEach(async () => {
    campusStore.clearAllData();
    await cleanupTestData();
  });

  it("hashes and verifies admin passwords securely", () => {
    const password = "admin_secure_password_2026";
    const hash = hashPassword(password);

    expect(hash).toContain(":");
    expect(verifyPassword(password, hash)).toBe(true);
    expect(verifyPassword("wrong_password", hash)).toBe(false);
  });

  it("records and retrieves system audit log events", async () => {
    const event = await logAuditEvent({
      userId: "admin-1",
      action: "ROOM_UPDATED",
      resource: "room",
      resourceId: "r-101",
      before: { name: "Old Room Name" },
      after: { name: "New Lab 101" },
    });

    expect(event.action).toBe("ROOM_UPDATED");
    const logs = await getAuditLogs();
    expect(logs.some((l: any) => l.action === "ROOM_UPDATED")).toBe(true);
  });

  it("blocks publishing when Graph Validation Engine finds critical errors", async () => {
    // Unlinked staircase node without a StairGroup produces a CRITICAL graph validation error
    const draftSnapshot = {
      buildings: [],
      floors: [],
      nodes: [{ id: "n-stair-bad", type: "STAIR" as const, name: "Broken Stair", floorId: "f-1", x: 10, y: 10 }],
      edges: [],
      destinations: [],
      obstacles: [],
    };

    const result = await publishDraftGraph(draftSnapshot, "admin-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("Publishing blocked");
    expect(result.validationReport.issues.length).toBeGreaterThan(0);
  });

  it("successfully publishes clean draft graph and generates map version", async () => {
    const bld: Building = {
      id: "b-clean",
      campusId: "c1",
      name: "Clean Block",
      shortCode: "CB",
      color: "#10b981",
      lat: 11.4965,
      lng: 77.2774,
      floorsCount: 1,
    };
    const fl: Floor = { id: "f-clean-1", buildingId: "b-clean", name: "Ground Floor", ordinal: 0, code: "G" };
    const entNode: Node = { id: "n-ent-clean", type: "BUILDING_ENTRANCE", name: "Main Entrance", floorId: fl.id, x: 50, y: 50 };

    const draftSnapshot = {
      buildings: [bld],
      floors: [fl],
      nodes: [entNode],
      edges: [],
      destinations: [],
      obstacles: [],
    };

    const result = await publishDraftGraph(draftSnapshot, "admin-1", "Version 2 Release");

    expect(result.success).toBe(true);
    expect(result.version).toBeGreaterThan(0);
    expect(result.validationReport.healthScore).toBeGreaterThanOrEqual(70);
  });

  it("allows publishing a newly created building before nodes are placed and stores building in database", async () => {
    const bld: Building = {
      id: "b-new-tech",
      campusId: "c1",
      name: "Technology Innovation Tower",
      shortCode: "TIT",
      color: "#6366f1",
      lat: 11.4965,
      lng: 77.2774,
      floorsCount: 3,
    };

    const draftSnapshot = {
      buildings: [bld],
      floors: [],
      nodes: [],
      edges: [],
      destinations: [],
      obstacles: [],
    };

    const result = await publishDraftGraph(draftSnapshot, "admin-1", "Added Tech Tower");

    expect(result.success).toBe(true);
    expect(result.version).toBeGreaterThan(0);
  });

  it("lists map versions and supports version restoration", async () => {
    const versions = await getMapVersions();
    expect(versions.length).toBeGreaterThan(0);

    const restored = await restoreMapVersion(versions[0].id, "admin-1");
    expect(restored.version).toBe(versions[0].version);

    await cleanupTestData();
  });

  it("successfully persists edges and obstacles to relational database tables and retrieves them", async () => {
    const bld: Building = {
      id: "b-clean",
      campusId: "c1",
      name: "Clean Block",
      shortCode: "CB",
      color: "#10b981",
      lat: 11.4965,
      lng: 77.2774,
      floorsCount: 1,
    };
    const fl: Floor = { id: "f-clean-1", buildingId: "b-clean", name: "Ground Floor", ordinal: 0, code: "G" };
    const n1: Node = { id: "n-ent-clean", type: "BUILDING_ENTRANCE", name: "Main Entrance", floorId: fl.id, x: 10, y: 10 };
    const n2: Node = { id: "n-corr-2", type: "CORRIDOR", name: "Main Hallway", floorId: fl.id, x: 30, y: 10 };
    const edge: Edge = {
      id: "e-test-1",
      from: n1.id,
      to: n2.id,
      fromNodeId: n1.id,
      toNodeId: n2.id,
      type: "WALK",
      pathType: "EV",
      distance: 20,
      bidirectional: true,
    };
    const obstacle = {
      id: "obs-test-1",
      campusId: "c1",
      floorId: fl.id,
      x: 50,
      y: 50,
      radius: 10,
      edgeIds: [],
      reason: "Maintenance",
    };

    const draftSnapshot = {
      buildings: [bld],
      floors: [fl],
      nodes: [n1, n2],
      edges: [edge],
      destinations: [],
      obstacles: [obstacle],
    };

    const result = await publishDraftGraph(draftSnapshot, "admin-1", "Edge and Obstacle Sync Test");
    expect(result.success).toBe(true);

    if (prisma) {
      const dbEdge = await prisma.edge.findUnique({ where: { id: edge.id } });
      expect(dbEdge).not.toBeNull();
      expect(dbEdge?.fromNodeId).toBe(n1.id);
      expect(dbEdge?.toNodeId).toBe(n2.id);

      const dbObstacle = await prisma.obstacle.findUnique({ where: { id: obstacle.id } });
      expect(dbObstacle).not.toBeNull();
      expect(dbObstacle?.reason).toBe("Maintenance");
    }
  });
});
