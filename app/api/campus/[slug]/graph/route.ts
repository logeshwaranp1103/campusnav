import { NextResponse } from "next/server";
import { getActivePublishedGraph } from "@/lib/services/publish-service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const publishedServiceData = await getActivePublishedGraph();
  const data = publishedServiceData?.snapshot ?? {
    buildings: [],
    floors: [],
    nodes: [],
    edges: [],
    destinations: [],
    obstacles: [],
  };

  return NextResponse.json({
    slug,
    version: publishedServiceData?.version ?? 1,
    data,
  });
}

