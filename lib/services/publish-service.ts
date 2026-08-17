import { prisma } from "../db";
import { validateCampusGraph, type GraphValidationReport } from "../validation/graph-validator";
import { logAuditEvent } from "./audit-service";
import { getFloorCode, type Building, type Floor, type Node, type Edge, type Destination, type Obstacle, type Door } from "../../shared/data/campus";

export interface PublishResult {
  success: boolean;
  version?: number;
  publishedAt?: Date;
  validationReport: GraphValidationReport;
  error?: string;
}

export type DraftSnapshot = {
  buildings?: Building[];
  floors?: Floor[];
  nodes?: Node[];
  edges?: Edge[];
  destinations?: Destination[];
  obstacles?: Obstacle[];
  [key: string]: unknown;
};

let activePublishedSnapshot: { version: number; snapshot: DraftSnapshot; publishedAt: Date; publishedBy: string; notes: string } | null = null;

export async function publishDraftGraph(
  draftSnapshot: DraftSnapshot = {},
  userId = "admin-id-1",
  notes?: string
): Promise<PublishResult> {
  const safeSnapshot = draftSnapshot || {};
  const { buildings, floors, nodes, edges, destinations, obstacles } = safeSnapshot;

  const validationReport = validateCampusGraph(
    buildings || [],
    floors || [],
    nodes || [],
    edges || [],
    destinations || [],
    obstacles || []
  );

  if (validationReport.issues.some((i) => i.severity === "CRITICAL")) {
    return {
      success: false,
      validationReport,
      error: "Publishing blocked: Graph Validation Engine found critical errors. Fix issues before publishing.",
    };
  }

  const currentSnapshot = await getActivePublishedGraph();
  const versionNum = (currentSnapshot?.version ?? 0) + 1;
  const publishedAt = new Date();

  activePublishedSnapshot = {
    version: versionNum,
    snapshot: draftSnapshot,
    publishedAt,
    publishedBy: userId,
    notes: notes || "Published campus graph update",
  };

  if (prisma) {
    try {
      const defaultCampusId = "c1";

      // 1. Core Published Graph & Version Records (Critical)
      await prisma.campus.upsert({
        where: { id: defaultCampusId },
        update: {},
        create: {
          id: defaultCampusId,
          name: "Main Campus",
          slug: "main",
          latitude: 11.4965,
          longitude: 77.2774,
          status: "PUBLISHED",
        },
      }).catch((e) => console.warn("Campus upsert notice:", e?.message));

      await prisma.publishedGraph.upsert({
        where: { id: "active-published" },
        update: {
          version: versionNum,
          snapshot: draftSnapshot as any,
          publishedAt,
          publishedBy: userId,
        },
        create: {
          id: "active-published",
          version: versionNum,
          snapshot: draftSnapshot as any,
          publishedAt,
          publishedBy: userId,
        },
      });

      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: draftSnapshot as any },
        create: { id: "active-draft", snapshot: draftSnapshot as any },
      });

      await prisma.mapVersion.create({
        data: {
          version: versionNum,
          status: "PUBLISHED",
          snapshot: draftSnapshot as any,
          notes: notes || "Published campus graph update",
          publishedBy: userId,
        },
      }).catch((e) => console.warn("MapVersion creation notice:", e?.message));

      // 2. Relational Table Synchronization & Deletion Cleanup
      const validBuildingIds = (buildings || []).map((b) => b.id);
      const validFloorIds = (floors || []).map((f) => f.id);
      const validNodeIds = (nodes || []).map((n) => n.id);
      const validEdgeIds = (edges || []).map((e) => e.id);
      const validDestinationIds = (destinations || []).map((d) => d.id);
      const validObstacleIds = (obstacles || []).map((o) => o.id);
      const validDoorIds = ((draftSnapshot.doors as any[]) || []).map((d) => d.id);

      // Clean up deleted entities from relational database tables (cascading child-to-parent)
      await prisma.searchAlias.deleteMany({ where: { destinationId: { notIn: validDestinationIds } } }).catch(() => {});
      await prisma.room.deleteMany({ where: { OR: [{ id: { notIn: validDestinationIds } }, { floorId: { notIn: validFloorIds } }] } }).catch(() => {});
      await prisma.facility.deleteMany({ where: { floorId: { notIn: validFloorIds } } }).catch(() => {});
      await prisma.destination.deleteMany({ where: { id: { notIn: validDestinationIds } } }).catch(() => {});
      await prisma.obstacle.deleteMany({ where: { id: { notIn: validObstacleIds } } }).catch(() => {});
      await prisma.door.deleteMany({ where: { id: { notIn: validDoorIds } } }).catch(() => {});
      await prisma.edge.deleteMany({ where: { id: { notIn: validEdgeIds } } }).catch(() => {});
      await prisma.node.deleteMany({ where: { id: { notIn: validNodeIds } } }).catch(() => {});
      await prisma.floor.deleteMany({ where: { id: { notIn: validFloorIds } } }).catch(() => {});
      await prisma.building.deleteMany({ where: { id: { notIn: validBuildingIds } } }).catch(() => {});

      if (buildings && Array.isArray(buildings)) {
        for (const b of buildings) {
          const safeCode = b.shortCode ? `${b.shortCode}_${b.id.slice(-6)}` : b.id;
          await prisma.building.upsert({
            where: { id: b.id },
            update: {
              campusId: b.campusId || defaultCampusId,
              name: b.name,
              shortCode: safeCode,
              color: b.color || "#4f46e5",
              description: b.description || null,
              x: b.x ?? null,
              y: b.y ?? null,
              width: b.width ?? null,
              height: b.height ?? null,
              floorsCount: b.floorsCount ?? 0,
              basementsCount: b.basementsCount ?? 0,
              status: "PUBLISHED",
            },
            create: {
              id: b.id,
              campusId: b.campusId || defaultCampusId,
              name: b.name,
              shortCode: safeCode,
              color: b.color || "#4f46e5",
              description: b.description || null,
              x: b.x ?? null,
              y: b.y ?? null,
              width: b.width ?? null,
              height: b.height ?? null,
              floorsCount: b.floorsCount ?? 0,
              basementsCount: b.basementsCount ?? 0,
              status: "PUBLISHED",
            },
          }).catch((e) => console.warn(`Building ${b.id} upsert deferred:`, e?.message));
        }
      }

      if (floors && Array.isArray(floors)) {
        const validBuildingIds = new Set((buildings || []).map((b) => b.id));
        for (const f of floors) {
          if (validBuildingIds.has(f.buildingId)) {
            await prisma.floor.upsert({
              where: { id: f.id },
              update: {
                buildingId: f.buildingId,
                name: f.name,
                ordinal: f.ordinal ?? 0,
              },
              create: {
                id: f.id,
                buildingId: f.buildingId,
                name: f.name,
                ordinal: f.ordinal ?? 0,
              },
            }).catch((e) => console.warn(`Floor ${f.id} upsert deferred:`, e?.message));
          }
        }
      }

      if (nodes && Array.isArray(nodes)) {
        const validFloorIds = new Set((floors || []).map((f) => f.id));
        for (const n of nodes) {
          const floorId = n.floorId && validFloorIds.has(n.floorId) ? n.floorId : null;
          const nodeMeta = {
            ...(n.photoUrl ? { photoUrl: n.photoUrl, photoUploadedAt: n.photoUploadedAt } : {}),
            ...(n.physicalVerified !== undefined ? { physicalVerified: n.physicalVerified } : {}),
          };
          await prisma.node.upsert({
            where: { id: n.id },
            update: {
              campusId: n.campusId || defaultCampusId,
              floorId,
              type: n.type as any,
              name: n.name || null,
              latitude: n.lat ?? null,
              longitude: n.lng ?? null,
              x: n.x ?? null,
              y: n.y ?? null,
              metadata: Object.keys(nodeMeta).length > 0 ? nodeMeta : undefined,
            },
            create: {
              id: n.id,
              campusId: n.campusId || defaultCampusId,
              floorId,
              type: n.type as any,
              name: n.name || null,
              latitude: n.lat ?? null,
              longitude: n.lng ?? null,
              x: n.x ?? null,
              y: n.y ?? null,
              metadata: Object.keys(nodeMeta).length > 0 ? nodeMeta : undefined,
            },
          }).catch((e) => console.warn(`Node ${n.id} upsert deferred:`, e?.message));
        }
      }

      if (edges && Array.isArray(edges)) {
        const dbNodes = await prisma.node.findMany({ select: { id: true } }).catch(() => []);
        const validNodeIds = new Set([
          ...(nodes || []).map((n) => n.id),
          ...dbNodes.map((n) => n.id),
        ]);
        for (const e of edges) {
          const fromId = e.fromNodeId || e.from;
          const toId = e.toNodeId || e.to;
          if (fromId && toId && validNodeIds.has(fromId) && validNodeIds.has(toId)) {
            const edgeType = (e.type as any) || "WALK";
            const pathType = (e.pathType as any) || "WALK";
            const distance = typeof e.distance === "number" && !isNaN(e.distance) ? e.distance : 1;
            const bidirectional = e.bidirectional ?? true;

            try {
              const existingByNodes = await prisma.edge.findUnique({
                where: {
                  fromNodeId_toNodeId_type: {
                    fromNodeId: fromId,
                    toNodeId: toId,
                    type: edgeType,
                  },
                },
              });

              if (existingByNodes) {
                await prisma.edge.update({
                  where: { id: existingByNodes.id },
                  data: {
                    fromNodeId: fromId,
                    toNodeId: toId,
                    type: edgeType,
                    ...(pathType ? { pathType: pathType as any } : {}),
                    distance,
                    bidirectional,
                    status: "PUBLISHED",
                  },
                });
              } else {
                await prisma.edge.upsert({
                  where: { id: e.id },
                  update: {
                    fromNodeId: fromId,
                    toNodeId: toId,
                    type: edgeType,
                    ...(pathType ? { pathType: pathType as any } : {}),
                    distance,
                    bidirectional,
                    status: "PUBLISHED",
                  },
                  create: {
                    id: e.id,
                    fromNodeId: fromId,
                    toNodeId: toId,
                    type: edgeType,
                    ...(pathType ? { pathType: pathType as any } : {}),
                    distance,
                    bidirectional,
                    status: "PUBLISHED",
                  },
                });
              }
            } catch (err: any) {
              console.warn(`Edge ${e.id} upsert notice:`, err?.message);
            }
          }
        }
      }

      if (obstacles && Array.isArray(obstacles)) {
        for (const obs of obstacles) {
          const floorId = obs.floorId && obs.floorId !== "f-out" ? obs.floorId : null;
          await prisma.obstacle.upsert({
            where: { id: obs.id },
            update: {
              campusId: obs.campusId || defaultCampusId,
              floorId,
              x: obs.x ?? 0,
              y: obs.y ?? 0,
              radius: obs.radius ?? 15,
              edgeIds: obs.edgeIds || [],
              reason: obs.reason || null,
              expiresAt: obs.expiresAt ? new Date(obs.expiresAt) : null,
            },
            create: {
              id: obs.id,
              campusId: obs.campusId || defaultCampusId,
              floorId,
              x: obs.x ?? 0,
              y: obs.y ?? 0,
              radius: obs.radius ?? 15,
              edgeIds: obs.edgeIds || [],
              reason: obs.reason || null,
              expiresAt: obs.expiresAt ? new Date(obs.expiresAt) : null,
            },
          }).catch((err) => console.warn(`Obstacle ${obs.id} upsert deferred:`, err?.message));
        }
      }

      if (destinations && Array.isArray(destinations)) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        for (const d of destinations) {
          if (d.nodeId && validNodeIds.has(d.nodeId)) {
            await prisma.destination.upsert({
              where: { id: d.id },
              update: {
                campusId: defaultCampusId,
                nodeId: d.nodeId,
                name: d.name,
                category: d.category || "Custom",
              },
              create: {
                id: d.id,
                campusId: defaultCampusId,
                nodeId: d.nodeId,
                name: d.name,
                category: d.category || "Custom",
              },
            }).catch((err) => console.warn(`Destination ${d.id} upsert deferred:`, err?.message));
          }
        }
      }
    } catch (e) {
      console.warn("Failed to persist published graph to Prisma database:", e);
    }
  }

  await logAuditEvent({
    userId,
    action: "GRAPH_PUBLISHED",
    resource: "campus-graph",
    resourceId: `v${versionNum}`,
    after: { version: versionNum, notes },
  });

  return {
    success: true,
    version: versionNum,
    publishedAt,
    validationReport,
  };
}

export async function getRelationalGraphFromDatabase(): Promise<DraftSnapshot | null> {
  if (!prisma) return null;
  try {
    const [rawBuildings, rawFloors, rawNodes, rawEdges, rawDestinations, rawObstacles, rawDoors] = await Promise.all([
      prisma.building.findMany(),
      prisma.floor.findMany(),
      prisma.node.findMany(),
      prisma.edge.findMany(),
      prisma.destination.findMany(),
      prisma.obstacle.findMany(),
      prisma.door.findMany().catch(() => []),
    ]);

    if (rawNodes.length === 0 && rawBuildings.length === 0) {
      return null;
    }

    const buildings: Building[] = rawBuildings.map((b: any) => ({
      id: b.id,
      campusId: b.campusId,
      name: b.name,
      shortCode: b.shortCode ?? undefined,
      category: b.category ?? b.categoryType ?? undefined,
      description: b.description ?? undefined,
      color: b.color ?? undefined,
      x: b.x ?? undefined,
      y: b.y ?? undefined,
      width: b.width ?? undefined,
      height: b.height ?? undefined,
      lat: b.latitude !== undefined ? b.latitude : (b.lat !== undefined ? b.lat : undefined),
      lng: b.longitude !== undefined ? b.longitude : (b.lng !== undefined ? b.lng : undefined),
      corner1Lat: b.corner1Lat,
      corner1Lng: b.corner1Lng,
      corner2Lat: b.corner2Lat,
      corner2Lng: b.corner2Lng,
      corner3Lat: b.corner3Lat,
      corner3Lng: b.corner3Lng,
      corner4Lat: b.corner4Lat,
      corner4Lng: b.corner4Lng,
      floorsCount: b.floorsCount ?? 0,
      basementsCount: b.basementsCount ?? 0,
    }));

    const floors: Floor[] = rawFloors.map((f) => ({
      id: f.id,
      buildingId: f.buildingId,
      name: f.name,
      ordinal: f.ordinal,
      code: getFloorCode(f.ordinal, f.name),
    }));

    const nodes: Node[] = rawNodes.map((n: any) => {
      const meta = (n.metadata && typeof n.metadata === "object") ? n.metadata : {};
      return {
        id: n.id,
        type: n.type as any,
        name: n.name ?? undefined,
        floorId: n.floorId ?? "",
        x: n.x ?? 0,
        y: n.y ?? 0,
        lat: n.latitude !== undefined ? n.latitude : (n.lat !== undefined ? n.lat : undefined),
        lng: n.longitude !== undefined ? n.longitude : (n.lng !== undefined ? n.lng : undefined),
        searchable: n.searchable ?? true,
        photoUrl: n.photoUrl || meta.photoUrl || undefined,
        photoUploadedAt: n.photoUploadedAt || meta.photoUploadedAt || undefined,
        physicalVerified: n.physicalVerified !== undefined ? n.physicalVerified : meta.physicalVerified,
      };
    });

    const edges: Edge[] = rawEdges.map((e: any) => ({
      id: e.id,
      from: e.fromNodeId,
      to: e.toNodeId,
      fromNodeId: e.fromNodeId,
      toNodeId: e.toNodeId,
      type: e.type as any,
      pathType: (e.pathType as any) || "WALK",
      distance: e.distance,
      bidirectional: e.bidirectional ?? true,
    }));

    const destinations: Destination[] = rawDestinations.map((d: any) => ({
      id: d.id,
      nodeId: d.nodeId,
      name: d.name,
      category: d.category ?? "Custom",
      description: d.description ?? undefined,
      floorId: d.floorId ?? undefined,
      x: d.x ?? undefined,
      y: d.y ?? undefined,
      width: d.width ?? undefined,
      height: d.height ?? undefined,
      aliases: d.aliases || [],
    }));

    const obstacles: Obstacle[] = rawObstacles.map((obs: any) => ({
      id: obs.id,
      campusId: obs.campusId,
      floorId: obs.floorId ?? "f-out",
      x: obs.x,
      y: obs.y,
      radius: obs.radius,
      edgeIds: obs.edgeIds || [],
      reason: obs.reason ?? undefined,
      expiresAt: obs.expiresAt ? (typeof obs.expiresAt === "string" ? obs.expiresAt : obs.expiresAt.toISOString()) : undefined,
    }));

    const doors: Door[] = rawDoors.map((d: any) => ({
      id: d.id,
      floorId: d.floorId,
      type: d.type as any,
      name: d.name ?? undefined,
      x: d.x,
      y: d.y,
      connectedNodeId: d.connectedNodeId ?? undefined,
    }));

    return {
      buildings,
      floors,
      nodes,
      edges,
      destinations,
      obstacles,
      doors,
    };
  } catch (e) {
    console.warn("Error building graph snapshot from relational database:", e);
    return null;
  }
}

export async function getActivePublishedGraph() {
  if (prisma) {
    try {
      const dbRecord = (await prisma.publishedGraph.findUnique({
        where: { id: "active-published" },
      })) as any;

      if (dbRecord && dbRecord.snapshot) {
        activePublishedSnapshot = {
          version: dbRecord.version,
          snapshot: dbRecord.snapshot as DraftSnapshot,
          publishedAt: dbRecord.publishedAt,
          publishedBy: dbRecord.publishedBy || "admin",
          notes: "Database published graph",
        };
        return activePublishedSnapshot;
      }

      // Fallback: Assemble snapshot from PostgreSQL relational tables if active-published record does not exist yet
      const relational = await getRelationalGraphFromDatabase();
      if (relational && ((relational.buildings && relational.buildings.length > 0) || (relational.nodes && relational.nodes.length > 0))) {
        activePublishedSnapshot = {
          version: 1,
          snapshot: relational,
          publishedAt: new Date(),
          publishedBy: "system-auto",
          notes: "Auto-assembled from relational database",
        };

        // Auto-seed active-published row so subsequent calls are fast
        await prisma.publishedGraph.upsert({
          where: { id: "active-published" },
          update: { version: 1, snapshot: relational as any },
          create: { id: "active-published", version: 1, snapshot: relational as any },
        }).catch((e) => console.warn("Notice: Auto-seeding published graph failed:", e?.message));

        return activePublishedSnapshot;
      }
    } catch (e) {
      console.warn("Failed to fetch active published graph from Prisma database:", e);
    }
  }

  return activePublishedSnapshot;
}
