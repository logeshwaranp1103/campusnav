import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph } from "@/lib/services/publish-service";

export async function GET() {
  let draftData: {
    buildings?: unknown[];
    floors?: unknown[];
    nodes?: unknown[];
    edges?: unknown[];
    destinations?: unknown[];
  } = { buildings: [], floors: [], nodes: [], edges: [], destinations: [] };
  let pendingCount = 0;

  if (prisma) {
    try {
      const draftRecord = await prisma.draftGraph.findUnique({
        where: { id: "active-draft" },
      }).catch(() => null);
      if (draftRecord?.snapshot && typeof draftRecord.snapshot === "object") {
        draftData = draftRecord.snapshot as any;
        pendingCount = Array.isArray((draftRecord.snapshot as any).pendingChanges)
          ? (draftRecord.snapshot as any).pendingChanges.length
          : 0;
      }
    } catch (e) {
      console.warn("Stats route notice:", e);
    }
  }

  const published = await getActivePublishedGraph();
  const publishedVersion = published?.version ? `v${published.version}.0` : "v1.0";

  return NextResponse.json({
    campuses: 1,
    buildings: draftData.buildings?.length ?? 0,
    floors: draftData.floors?.length ?? 0,
    nodes: draftData.nodes?.length ?? 0,
    edges: draftData.edges?.length ?? 0,
    destinations: draftData.destinations?.length ?? 0,
    published: published ? 1 : 0,
    draft: pendingCount,
    version: publishedVersion,
  });
}

