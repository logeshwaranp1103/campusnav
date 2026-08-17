import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph, getRelationalGraphFromDatabase } from "@/lib/services/publish-service";

export async function GET() {
  try {
    if (prisma) {
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      });

      if (draftRecord && draftRecord.snapshot) {
        return NextResponse.json({ draft: draftRecord.snapshot });
      }

      // Fallback 1: Check relational DB tables (building, floor, node, edge, destination, door)
      const relational = await getRelationalGraphFromDatabase();
      if (relational) {
        return NextResponse.json({ draft: relational });
      }

      // Fallback 2: Check published graph in PostgreSQL DB
      const published = await getActivePublishedGraph();
      if (published) {
        return NextResponse.json({ draft: published });
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

    if (snapshot && prisma) {
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

