import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph, getRelationalGraphFromDatabase, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

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
    if (!prisma) {
      console.warn("[DraftRoute:GET] Prisma client not available.");
      return NextResponse.json({ error: "Database client unavailable" }, { status: 503 });
    }

    // 1. Check if active draft overlay snapshot exists in database
    const draftRecord = await prisma.draftGraph.findUnique({
      where: { id: "active-draft" },
    });

    if (draftRecord && draftRecord.snapshot && typeof draftRecord.snapshot === "object") {
      const snap = draftRecord.snapshot as unknown as import("@/lib/services/publish-service").DraftSnapshot;
      const hasSnapEntities =
        (Array.isArray(snap.buildings) && snap.buildings.length > 0) ||
        (Array.isArray(snap.nodes) && snap.nodes.length > 0);

      if (hasSnapEntities) {
        console.log(`[DraftRoute:GET] Loaded active-draft from DB: ${snap.buildings?.length ?? 0} buildings, ${snap.nodes?.length ?? 0} nodes, ${snap.edges?.length ?? 0} edges, ${snap.floors?.length ?? 0} floors, ${snap.destinations?.length ?? 0} destinations`);
        return NextResponse.json({ draft: sanitizeSnapshotForPayload(snap) });
      }
    }

    // 2. Query PostgreSQL relational database tables
    const relational = await getRelationalGraphFromDatabase().catch(() => null);
    if (relational) {
      const hasRelationalEntities =
        (Array.isArray(relational.buildings) && relational.buildings.length > 0) ||
        (Array.isArray(relational.nodes) && relational.nodes.length > 0);
      if (hasRelationalEntities) {
        console.log(`[DraftRoute:GET] Loaded from relational DB tables: ${relational.buildings?.length ?? 0} buildings, ${relational.nodes?.length ?? 0} nodes`);
        return NextResponse.json({ draft: sanitizeSnapshotForPayload(relational) });
      }
    }

    // 3. Fallback to active published graph if draft is not set
    const published = await getActivePublishedGraph(true).catch(() => null);
    if (published && published.snapshot) {
      const hasPubEntities =
        (Array.isArray(published.snapshot.buildings) && published.snapshot.buildings.length > 0) ||
        (Array.isArray(published.snapshot.nodes) && published.snapshot.nodes.length > 0);
      if (hasPubEntities) {
        console.log(`[DraftRoute:GET] Loaded from published graph: ${published.snapshot.buildings?.length ?? 0} buildings, ${published.snapshot.nodes?.length ?? 0} nodes`);
        return NextResponse.json({ draft: sanitizeSnapshotForPayload(published.snapshot) });
      }
    }

    console.log("[DraftRoute:GET] Database contains empty draft graph.");
    return NextResponse.json({ draft: EMPTY_GRAPH, empty: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[DraftRoute:GET] Database error loading draft:", errorMsg);
    return NextResponse.json(
      {
        error: "Database error while loading draft graph",
        details: errorMsg,
        draft: null,
      },
      { status: 500 }
    );
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const snapshot = body.snapshot || body.draft;
    const isExplicitReset = Boolean(body.isExplicitReset);

    if (!prisma) {
      console.warn("[DraftRoute:PUT] Prisma client not available.");
      return NextResponse.json({ error: "Database client unavailable" }, { status: 503 });
    }

    if (snapshot) {
      // Safety Guard: Never overwrite active draft with an empty snapshot unless explicit administrative reset is confirmed
      const hasEntities =
        (Array.isArray(snapshot.buildings) && snapshot.buildings.length > 0) ||
        (Array.isArray(snapshot.nodes) && snapshot.nodes.length > 0) ||
        (Array.isArray(snapshot.floors) && snapshot.floors.length > 0);

      if (!hasEntities && !isExplicitReset) {
        console.warn("[DraftRoute:PUT] Protected active-draft from accidental empty snapshot overwrite.");
        return NextResponse.json({ success: true, protected: true });
      }

      // Save the full working draft snapshot JSON to DraftGraph table (used strictly by CAD Editor / Admin)
      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue },
        create: { id: "active-draft", snapshot: snapshot as unknown as import("@prisma/client").Prisma.InputJsonValue },
      });

      console.log(`[DraftRoute:PUT] Successfully saved active-draft to database: ${snapshot.buildings?.length ?? 0} buildings, ${snapshot.nodes?.length ?? 0} nodes, ${snapshot.edges?.length ?? 0} edges`);
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[DraftRoute:PUT] Database error saving draft:", errorMsg);
    return NextResponse.json(
      {
        success: false,
        error: "Failed to persist draft to database",
        details: errorMsg,
      },
      { status: 500 }
    );
  }
}

export const POST = PUT;
