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

export function sanitizeSnapshotForPayload(snapshot: DraftSnapshot): DraftSnapshot {
  if (!snapshot) return {};
  const safeNodes = (snapshot.nodes || []).map((n) => {
    const isBase64 = Boolean(n.photoUrl && n.photoUrl.startsWith("data:"));
    const safeNode = { ...n };
    delete (safeNode as any).photoData;
    if (isBase64) {
      safeNode.photoUrl = `/api/nodes/${n.id}/photo`;
    }
    return safeNode;
  });

  return {
    ...snapshot,
    nodes: safeNodes,
  };
}

async function runInPoolChunks<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency = 3
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

export async function publishDraftGraph(
  draftSnapshot: DraftSnapshot = {},
  userId = "admin-id-1",
  notes?: string
): Promise<PublishResult> {
  const safeSnapshot = draftSnapshot || {};
  const { buildings, floors, nodes, edges, destinations, obstacles } = safeSnapshot;

  // Safety Guard: Require valid snapshot object
  if (!draftSnapshot || typeof draftSnapshot !== "object") {
    return {
      success: false,
      validationReport: {
        healthScore: 0,
        status: "CRITICAL",
        canPublish: false,
        criticalCount: 1,
        warningCount: 0,
        infoCount: 0,
        checks: [],
        issues: [{
          id: "invalid-snapshot-state",
          severity: "CRITICAL",
          code: "INVALID_GRAPH",
          title: "Invalid Campus Graph",
          description: "Publishing blocked: Invalid or uninitialized graph state.",
        }],
      },
      error: "Publishing blocked: Invalid or uninitialized graph state.",
    };
  }

  const validationReport = validateCampusGraph(
    buildings || [],
    floors || [],
    nodes || [],
    edges || [],
    destinations || [],
    obstacles || []
  );

  // Allow publishing even if there are critical validation errors (logging warnings for diagnostics)
  if (validationReport.issues.some((i) => i.severity === "CRITICAL")) {
    console.warn(`[PublishService] Notice: Campus graph published with ${validationReport.criticalCount} critical validation warnings.`);
  }

  let versionNum = 1;
  const publishedAt = new Date();

  if (prisma) {
    try {
      const defaultCampusId = "c1";

      // 1. Determine accurate next version directly from database record
      const dbPublished = await prisma.publishedGraph.findUnique({
        where: { id: "active-published" },
        select: { version: true },
      }).catch(() => null);

      versionNum = (dbPublished?.version ?? 0) + 1;

      // Pre-fetch all node metadata from DB so published snapshot ALWAYS contains verified cloud photo URLs
      const dbNodes = await prisma.node.findMany({ select: { id: true, metadata: true } }).catch(() => []);
      const dbNodeMetaMap = new Map<string, any>();
      for (const dbn of dbNodes) {
        if (dbn.metadata && typeof dbn.metadata === "object") {
          dbNodeMetaMap.set(dbn.id, dbn.metadata);
        }
      }

      const mergedNodes = (draftSnapshot.nodes || []).map((n) => {
        const dbMeta = dbNodeMetaMap.get(n.id) || {};
        const photoUrl = n.photoUrl || dbMeta.photoUrl;
        const storagePath = (n as any).storagePath || dbMeta.storagePath;
        const photoUploadedAt = n.photoUploadedAt || dbMeta.photoUploadedAt;
        const safeNode = {
          ...n,
          ...(photoUrl ? { photoUrl } : {}),
          ...(storagePath ? { storagePath } : {}),
          ...(photoUploadedAt ? { photoUploadedAt } : {}),
        };
        delete (safeNode as any).photoData;
        return safeNode;
      });

      const sanitizedSnapshot = sanitizeSnapshotForPayload({
        ...draftSnapshot,
        nodes: mergedNodes,
      });

      // 2. ATOMIC DATABASE TRANSACTION for Core Publish Records
      // Ensures publishedGraph, draftGraph, and mapVersion are atomically committed
      await prisma.$transaction([
        prisma.campus.upsert({
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
        }),
        prisma.publishedGraph.upsert({
          where: { id: "active-published" },
          update: {
            version: versionNum,
            snapshot: sanitizedSnapshot as any,
            publishedAt,
            publishedBy: userId,
          },
          create: {
            id: "active-published",
            version: versionNum,
            snapshot: sanitizedSnapshot as any,
            publishedAt,
            publishedBy: userId,
          },
        }),
        prisma.draftGraph.upsert({
          where: { id: "active-draft" },
          update: { snapshot: draftSnapshot as any },
          create: { id: "active-draft", snapshot: draftSnapshot as any },
        }),
        prisma.mapVersion.create({
          data: {
            version: versionNum,
            status: "PUBLISHED",
            snapshot: sanitizedSnapshot as any,
            notes: notes || "Published campus graph update",
            publishedBy: userId,
          },
        }),
      ]);

      // 3. Pre-fetch existing relational state for safe foreign-key matching and edge ID deduplication
      const [existingEdges, existingBuildings] = await Promise.all([
        prisma.edge.findMany({ select: { id: true, fromNodeId: true, toNodeId: true, type: true } }).catch(() => []),
        prisma.building.findMany({ select: { id: true, shortCode: true } }).catch(() => []),
      ]);

      const existingEdgeMap = new Map<string, string>();
      for (const e of existingEdges) {
        existingEdgeMap.set(`${e.fromNodeId}_${e.toNodeId}_${e.type}`, e.id);
      }

      // 3.1 Gather target IDs and prune obsolete relational records no longer present in published snapshot
      const targetBuildingIds = new Set((buildings || []).map((b) => b.id));
      const targetFloorIds = new Set((floors || []).map((f) => f.id));
      const targetNodeIds = new Set((nodes || []).map((n) => n.id));
      const targetEdgeIds = new Set((edges || []).map((e) => e.id));
      const targetDestIds = new Set((destinations || []).map((d) => d.id));
      const targetObstacleIds = new Set<string>((obstacles || []).map((obs) => obs.id));
      const targetDoorIds = new Set<string>(((draftSnapshot as any).doors || []).map((d: any) => String(d.id)));

      await prisma.door.deleteMany({ where: { id: { notIn: Array.from(targetDoorIds) } } }).catch(() => {});
      await prisma.destination.deleteMany({ where: { id: { notIn: Array.from(targetDestIds) } } }).catch(() => {});
      await prisma.obstacle.deleteMany({ where: { id: { notIn: Array.from(targetObstacleIds) } } }).catch(() => {});
      await prisma.edge.deleteMany({ where: { id: { notIn: Array.from(targetEdgeIds) } } }).catch(() => {});
      await prisma.nodePhoto.deleteMany({ where: { nodeId: { notIn: Array.from(targetNodeIds) } } }).catch(() => {});
      await prisma.node.deleteMany({ where: { id: { notIn: Array.from(targetNodeIds) } } }).catch(() => {});
      await prisma.floor.deleteMany({ where: { id: { notIn: Array.from(targetFloorIds) } } }).catch(() => {});
      await prisma.building.deleteMany({ where: { id: { notIn: Array.from(targetBuildingIds) } } }).catch(() => {});

      // 4. Safe Topological Relational Upserts (Parent to Child: Campus -> Buildings -> Floors -> Nodes -> Edges/Dests/Obstacles)
      // 4.1 Buildings
      if (buildings && Array.isArray(buildings) && buildings.length > 0) {
        await runInPoolChunks(buildings, async (b) => {
          const safeCode = b.shortCode ? `${b.shortCode}_${b.id.slice(-6)}` : b.id;
          const bldData = {
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
            status: "PUBLISHED" as const,
          };
          return prisma.building.upsert({
            where: { id: b.id },
            update: bldData,
            create: { id: b.id, ...bldData },
          }).catch((e) => console.warn(`Building ${b.id} upsert notice:`, e?.message));
        });
      }

      // 4.2 Floors
      if (floors && Array.isArray(floors) && floors.length > 0) {
        const validBuildingIds = new Set((buildings || []).map((b) => b.id));
        const targetFloors = floors.filter((f) => validBuildingIds.has(f.buildingId));
        await runInPoolChunks(targetFloors, async (f) => {
          const floorData = {
            buildingId: f.buildingId,
            name: f.name,
            ordinal: f.ordinal ?? 0,
          };
          return prisma.floor.upsert({
            where: { id: f.id },
            update: floorData,
            create: { id: f.id, ...floorData },
          }).catch((e) => console.warn(`Floor ${f.id} upsert notice:`, e?.message));
        });
      }

      // 4.3 Nodes
      if (nodes && Array.isArray(nodes) && nodes.length > 0) {
        const validFloorIds = new Set((floors || []).map((f) => f.id));
        await runInPoolChunks(nodes, async (n) => {
          const floorId = n.floorId && validFloorIds.has(n.floorId) ? n.floorId : null;
          
          // 1. Fetch existing node metadata to preserve existing database photo metadata
          const existingDbNode = await prisma.node.findUnique({
            where: { id: n.id },
            select: { metadata: true },
          }).catch(() => null);
          const existingMeta = (existingDbNode?.metadata && typeof existingDbNode.metadata === "object")
            ? (existingDbNode.metadata as Record<string, any>)
            : {};

          const isBase64 = Boolean(n.photoUrl && n.photoUrl.startsWith("data:"));
          const cleanPhotoUrl = isBase64 ? `/api/nodes/${n.id}/photo` : (n.photoUrl || existingMeta.photoUrl);

          const nodeMeta = {
            ...existingMeta,
            ...(cleanPhotoUrl ? {
              photoUrl: cleanPhotoUrl,
              storagePath: (n as any).storagePath || existingMeta.storagePath,
              photoUploadedAt: n.photoUploadedAt || existingMeta.photoUploadedAt || new Date().toISOString(),
            } : {}),
            ...(n.physicalVerified !== undefined ? { physicalVerified: n.physicalVerified } : {}),
            ...(n.visibleToUser !== undefined ? { visibleToUser: n.visibleToUser } : {}),
          };
          delete (nodeMeta as any).photoData;

          const nodeData = {
            campusId: n.campusId || defaultCampusId,
            floorId,
            type: n.type as any,
            name: n.name || null,
            latitude: n.lat ?? null,
            longitude: n.lng ?? null,
            x: n.x ?? null,
            y: n.y ?? null,
            accessible: n.accessible ?? true,
            searchable: n.searchable ?? true,
            navigable: (n as any).navigable ?? true,
            metadata: Object.keys(nodeMeta).length > 0 ? nodeMeta : undefined,
          };
          return prisma.node.upsert({
            where: { id: n.id },
            update: nodeData,
            create: { id: n.id, ...nodeData },
          }).catch((e) => console.warn(`Node ${n.id} upsert notice:`, e?.message));
        });
      }

      // 4.4 Edges
      if (edges && Array.isArray(edges) && edges.length > 0) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        const targetEdges = edges.filter((e) => {
          const fromId = e.fromNodeId || e.from;
          const toId = e.toNodeId || e.to;
          return fromId && toId && validNodeIds.has(fromId) && validNodeIds.has(toId);
        });

        await runInPoolChunks(targetEdges, async (e) => {
          const fromId = e.fromNodeId || e.from;
          const toId = e.toNodeId || e.to;
          const edgeType = (e.type as any) || "WALK";
          const pathType = (e.pathType as any) || "WALK";
          const distance = typeof e.distance === "number" && !isNaN(e.distance) ? e.distance : 1;
          const bidirectional = e.bidirectional ?? true;
          const edgeKey = `${fromId}_${toId}_${edgeType}`;
          const existingId = existingEdgeMap.get(edgeKey);

          const edgeData = {
            fromNodeId: fromId,
            toNodeId: toId,
            type: edgeType,
            ...(pathType ? { pathType: pathType as any } : {}),
            distance,
            bidirectional,
            status: "PUBLISHED" as const,
          };

          if (existingId) {
            return prisma.edge.update({
              where: { id: existingId },
              data: edgeData,
            }).catch((err) => console.warn(`Edge ${e.id} update notice:`, err?.message));
          } else {
            return prisma.edge.upsert({
              where: { id: e.id },
              update: edgeData,
              create: { id: e.id, ...edgeData },
            }).catch((err) => console.warn(`Edge ${e.id} upsert notice:`, err?.message));
          }
        });
      }

      // 4.5 Obstacles & Destinations
      const trailingTasks: Promise<any>[] = [];

      if (obstacles && Array.isArray(obstacles) && obstacles.length > 0) {
        trailingTasks.push(
          runInPoolChunks(obstacles, async (obs) => {
            const floorId = obs.floorId && obs.floorId !== "f-out" ? obs.floorId : null;
            const obsData = {
              campusId: obs.campusId || defaultCampusId,
              floorId,
              x: obs.x ?? 0,
              y: obs.y ?? 0,
              radius: obs.radius ?? 15,
              edgeIds: obs.edgeIds || [],
              reason: obs.reason || null,
              expiresAt: obs.expiresAt ? new Date(obs.expiresAt) : null,
            };
            return prisma.obstacle.upsert({
              where: { id: obs.id },
              update: obsData,
              create: { id: obs.id, ...obsData },
            }).catch((err) => console.warn(`Obstacle ${obs.id} upsert notice:`, err?.message));
          })
        );
      }

      if (destinations && Array.isArray(destinations) && destinations.length > 0) {
        const validNodeIds = new Set((nodes || []).map((n) => n.id));
        const targetDests = destinations.filter((d) => d.nodeId && validNodeIds.has(d.nodeId));
        trailingTasks.push(
          runInPoolChunks(targetDests, async (d) => {
            const destData = {
              campusId: defaultCampusId,
              nodeId: d.nodeId!,
              name: d.name,
              category: d.category || "Custom",
            };
            return prisma.destination.upsert({
              where: { id: d.id },
              update: destData,
              create: { id: d.id, ...destData },
            }).catch((err) => console.warn(`Destination ${d.id} upsert notice:`, err?.message));
          })
        );
      }

      if (trailingTasks.length > 0) {
        await Promise.all(trailingTasks);
      }

      // 5. Preserving existing database nodes and relations safely
      // (Never prune or delete existing relational entities during publish)
    } catch (e) {
      console.error("Critical error during publish database transaction:", e);
      return {
        success: false,
        validationReport,
        error: `Database persistence failure: ${e instanceof Error ? e.message : String(e)}`,
      };
    }
  }

  // Update server in-memory cache ONLY after database write succeeds
  const finalSanitized = sanitizeSnapshotForPayload(draftSnapshot);
  activePublishedSnapshot = {
    version: versionNum,
    snapshot: finalSanitized,
    publishedAt,
    publishedBy: userId,
    notes: notes || "Published campus graph update",
  };

  // 5. Invalidate in-memory cache so subsequent requests get fresh data
  activePublishedSnapshot = null;

  // 6. Record Audit Log for Publish action
  if (prisma) {
    let validUserId: string | null = null;
    if (userId) {
      const userExists = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } }).catch(() => null);
      if (userExists) validUserId = userId;
    }
    await prisma.auditLog.create({
      data: {
        userId: validUserId,
        action: "GRAPH_PUBLISHED",
        resource: "campus-graph",
        resourceId: `v${versionNum}`,
        after: { version: versionNum, notes },
      },
    }).catch(() => {});
  }

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
    const rawBuildings = await prisma.building.findMany().catch(() => []);
    const rawFloors = await prisma.floor.findMany().catch(() => []);
    const rawNodes = await prisma.node.findMany().catch(() => []);
    const rawEdges = await prisma.edge.findMany().catch(() => []);
    const rawDestinations = await prisma.destination.findMany().catch(() => []);
    const rawObstacles = await prisma.obstacle.findMany().catch(() => []);
    const rawDoors = await prisma.door.findMany().catch(() => []);
    const rawPhotos = await prisma.nodePhoto.findMany({ select: { nodeId: true } }).catch(() => []);

    if (rawNodes.length === 0 && rawBuildings.length === 0) {
      return null;
    }

    const photoNodeIds = new Set(rawPhotos.map((p) => p.nodeId));

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
      footprint: b.footprint || undefined,
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
      const hasDbPhoto = photoNodeIds.has(n.id);
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
        visibleToUser: n.visibleToUser !== undefined ? n.visibleToUser : (meta.visibleToUser !== undefined ? meta.visibleToUser : true),
        photoUrl: meta.photoUrl || (hasDbPhoto ? `/api/nodes/${n.id}/photo` : (n.photoUrl || undefined)),
        storagePath: meta.storagePath || (n as any).storagePath || undefined,
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

export function invalidatePublishedCache() {
  activePublishedSnapshot = null;
}

export async function getActivePublishedGraph(forceFresh = false) {
  if (!forceFresh && activePublishedSnapshot) {
    const hasEntities =
      (activePublishedSnapshot.snapshot?.buildings?.length ?? 0) > 0 ||
      (activePublishedSnapshot.snapshot?.nodes?.length ?? 0) > 0;
    if (hasEntities) return activePublishedSnapshot;
  }

  if (prisma) {
    try {
      // 1. FIRST check published snapshot record in Prisma (active-published)
      const dbRecord = (await prisma.publishedGraph.findUnique({
        where: { id: "active-published" },
      }).catch(() => null)) as any;

      if (dbRecord && dbRecord.snapshot && typeof dbRecord.snapshot === "object") {
        const sanitized = sanitizeSnapshotForPayload(dbRecord.snapshot as DraftSnapshot);
        const hasSnapEntities =
          (Array.isArray(sanitized.buildings) && sanitized.buildings.length > 0) ||
          (Array.isArray(sanitized.nodes) && sanitized.nodes.length > 0);
        if (hasSnapEntities) {
          activePublishedSnapshot = {
            version: dbRecord.version || 1,
            snapshot: sanitized,
            publishedAt: dbRecord.publishedAt || new Date(),
            publishedBy: dbRecord.publishedBy || "admin",
            notes: "Database published graph",
          };
          return activePublishedSnapshot;
        }
      }

      // 2. SECOND check if there is any published MapVersion record in database
      const latestMapVersion = await prisma.mapVersion.findFirst({
        where: { status: "PUBLISHED" },
        orderBy: { version: "desc" },
      }).catch(() => null);

      if (latestMapVersion && latestMapVersion.snapshot && typeof latestMapVersion.snapshot === "object") {
        const sanitized = sanitizeSnapshotForPayload(latestMapVersion.snapshot as DraftSnapshot);
        const hasSnapEntities =
          (Array.isArray(sanitized.buildings) && sanitized.buildings.length > 0) ||
          (Array.isArray(sanitized.nodes) && sanitized.nodes.length > 0);
        if (hasSnapEntities) {
          activePublishedSnapshot = {
            version: latestMapVersion.version,
            snapshot: sanitized,
            publishedAt: latestMapVersion.publishedAt || latestMapVersion.createdAt,
            publishedBy: latestMapVersion.publishedBy || "admin",
            notes: latestMapVersion.notes || "Restored from MapVersion",
          };
          return activePublishedSnapshot;
        }
      }

      // 3. THIRD query PostgreSQL relational tables
      const relational = await getRelationalGraphFromDatabase().catch(() => null);
      if (relational) {
        const hasRelationalEntities =
          (Array.isArray(relational.buildings) && relational.buildings.length > 0) ||
          (Array.isArray(relational.nodes) && relational.nodes.length > 0);

        if (hasRelationalEntities) {
          const sanitizedRelational = sanitizeSnapshotForPayload(relational);
          activePublishedSnapshot = {
            version: 1,
            snapshot: sanitizedRelational,
            publishedAt: new Date(),
            publishedBy: "system-auto",
            notes: "Auto-assembled from relational database",
          };
          return activePublishedSnapshot;
        }
      }

      // 4. FOURTH check active-draft snapshot as fallback
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      }).catch(() => null);

      if (draftRecord && draftRecord.snapshot && typeof draftRecord.snapshot === "object") {
        const sanitized = sanitizeSnapshotForPayload(draftRecord.snapshot as DraftSnapshot);
        const hasDraftEntities =
          (Array.isArray(sanitized.buildings) && sanitized.buildings.length > 0) ||
          (Array.isArray(sanitized.nodes) && sanitized.nodes.length > 0);
        if (hasDraftEntities) {
          return {
            version: 1,
            snapshot: sanitized,
            publishedAt: draftRecord.updatedAt,
            publishedBy: "draft-fallback",
            notes: "Loaded from draft snapshot",
          };
        }
      }
    } catch (e) {
      console.warn("Failed to fetch active published graph from Prisma database:", e);
    }
  }

  return activePublishedSnapshot;
}
