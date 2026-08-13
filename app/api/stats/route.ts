import { NextResponse } from "next/server";
import { campusStore } from "@/shared/lib/campus-store";

export async function GET() {
  const { buildings, floors, nodes, edges, destinations } = campusStore.getWorkingData();
  const pendingCount = campusStore.getPendingChanges().length;

  return NextResponse.json({
    campuses: 1,
    buildings: buildings.length,
    floors: floors.length,
    nodes: nodes.length,
    edges: edges.length,
    destinations: destinations.length,
    published: 1,
    draft: pendingCount,
    version: campusStore.getPublishedVersion(),
  });
}

