import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getRelationalGraphFromDatabase } from "@/lib/services/publish-service";

export async function GET() {
  try {
    if (prisma) {
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      });

      if (draftRecord && draftRecord.snapshot) {
        return NextResponse.json({ draft: draftRecord.snapshot });
      }

      // Fallback: Check relational DB tables (building, floor, node, edge, destination) if active-draft record does not exist yet
      const relational = await getRelationalGraphFromDatabase();
      if (relational) {
        return NextResponse.json({ draft: relational });
      }
    }
    // No draft in DB — return empty graph structure
    return NextResponse.json({
      draft: {
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
      },
    });
  } catch (err: unknown) {
    console.warn("Notice: GET /api/admin/campus-graph/draft database offline:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      draft: null,
      offline: true,
      message: "Database temporary connection issue, using client store",
    });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json();
    const snapshot = body.snapshot || body.draft;
    const isExplicitReset = Boolean(body.isExplicitReset || snapshot?.isExplicitReset);

    if (snapshot && prisma) {
      const incomingBuildingsCount = Array.isArray(snapshot.buildings) ? snapshot.buildings.length : 0;
      const incomingNodesCount = Array.isArray(snapshot.nodes) ? snapshot.nodes.length : 0;
      const incomingFloorsCount = Array.isArray(snapshot.floors) ? snapshot.floors.length : 0;
      const isIncomingEmpty = incomingBuildingsCount === 0 && incomingNodesCount === 0 && incomingFloorsCount === 0;

      // Protection Guard: If incoming snapshot is empty, do NOT overwrite an existing DB draft containing entities unless explicitly confirmed
      if (isIncomingEmpty && !isExplicitReset) {
        const existingDraft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
        const existingSnapshot = existingDraft?.snapshot as any;
        const existingBuildingsCount = existingSnapshot && Array.isArray(existingSnapshot.buildings)
          ? existingSnapshot.buildings.length
          : 0;
        const existingNodesCount = existingSnapshot && Array.isArray(existingSnapshot.nodes)
          ? existingSnapshot.nodes.length
          : 0;

        if (existingBuildingsCount > 0 || existingNodesCount > 0) {
          console.warn(`[PUT /api/admin/campus-graph/draft] Prevented accidental empty snapshot overwrite. Existing draft has ${existingBuildingsCount} buildings and ${existingNodesCount} nodes.`);
          return NextResponse.json({ success: false, protected: true, message: "Prevented accidental empty draft overwrite." });
        }
      }

      // Save the full working draft snapshot JSON to DraftGraph table (used strictly by CAD Editor / Admin)
      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: snapshot as any },
        create: { id: "active-draft", snapshot: snapshot as any },
      });
    }
    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    console.warn("Notice: PUT /api/admin/campus-graph/draft database offline:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, offline: true, message: "Draft stored in local memory" });
  }
}

