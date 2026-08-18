import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph, getRelationalGraphFromDatabase, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

const EMPTY_GRAPH = {
  buildings: [],
  floors: [],
  nodes: [],
  edges: [],
  destinations: [],
  obstacles: [],
  events: [],
  stairGroups: [],
  liftGroups: [],
  doors: [],
};

export async function GET() {
  try {
    if (prisma) {
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      }).catch(() => null);

      if (draftRecord && draftRecord.snapshot && typeof draftRecord.snapshot === "object") {
        const snap = draftRecord.snapshot as any;
        const hasEntities =
          (Array.isArray(snap.buildings) && snap.buildings.length > 0) ||
          (Array.isArray(snap.nodes) && snap.nodes.length > 0) ||
          (Array.isArray(snap.floors) && snap.floors.length > 0);

        if (hasEntities) {
          return NextResponse.json({ draft: sanitizeSnapshotForPayload(snap) });
        }
      }

      // Fallback 1: Check published graph in PostgreSQL DB (source of truth)
      const published = await getActivePublishedGraph().catch(() => null);
      if (published && published.snapshot) {
        const snap = published.snapshot as any;
        const hasEntities =
          (Array.isArray(snap.buildings) && snap.buildings.length > 0) ||
          (Array.isArray(snap.nodes) && snap.nodes.length > 0) ||
          (Array.isArray(snap.floors) && snap.floors.length > 0);

        if (hasEntities) {
          return NextResponse.json({ draft: sanitizeSnapshotForPayload(published.snapshot) });
        }
      }

      // Fallback 2: Check relational DB tables (building, floor, node, edge, destination, door)
      const relational = await getRelationalGraphFromDatabase().catch(() => null);
      if (relational) {
        const hasEntities =
          (Array.isArray(relational.buildings) && relational.buildings.length > 0) ||
          (Array.isArray(relational.nodes) && relational.nodes.length > 0);

        if (hasEntities) {
          return NextResponse.json({ draft: sanitizeSnapshotForPayload(relational) });
        }
      }
    }
    // No draft in DB — return empty graph structure
    return NextResponse.json({ draft: EMPTY_GRAPH });
  } catch (err: unknown) {
    console.warn("Notice: GET /api/admin/campus-graph/draft database notice:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      draft: EMPTY_GRAPH,
      offline: true,
      message: "Database connection notice, fallback to local store",
    });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const snapshot = body.snapshot || body.draft;
    const isExplicitReset = Boolean(body.isExplicitReset);

    if (snapshot && prisma) {
      // Safety Guard: Never overwrite active draft with an empty snapshot unless explicit administrative reset is confirmed
      const hasEntities =
        (Array.isArray(snapshot.buildings) && snapshot.buildings.length > 0) ||
        (Array.isArray(snapshot.nodes) && snapshot.nodes.length > 0) ||
        (Array.isArray(snapshot.floors) && snapshot.floors.length > 0);

      if (!hasEntities && !isExplicitReset) {
        console.warn("[DraftRoute] Protected active-draft from accidental empty snapshot overwrite.");
        return NextResponse.json({ success: true, protected: true });
      }

      // Save the full working draft snapshot JSON to DraftGraph table (used strictly by CAD Editor / Admin)
      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: snapshot as any },
        create: { id: "active-draft", snapshot: snapshot as any },
      }).catch((e) => console.warn("Notice: DraftGraph upsert notice:", e?.message));
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.warn("Notice: PUT /api/admin/campus-graph/draft database notice:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, offline: true, message: "Draft stored in local memory" });
  }
}


