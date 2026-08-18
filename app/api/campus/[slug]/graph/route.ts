import { NextResponse } from "next/server";
import { getActivePublishedGraph, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;

  const publishedServiceData = await getActivePublishedGraph(true);
  const rawData = publishedServiceData?.snapshot ?? {
    buildings: [],
    floors: [],
    nodes: [],
    edges: [],
    destinations: [],
    obstacles: [],
  };

  const data = sanitizeSnapshotForPayload(rawData);
  const version = publishedServiceData?.version ?? 1;
  const publishedAt = publishedServiceData?.publishedAt ?? new Date();
  const etag = `W/"v${version}-${new Date(publishedAt).getTime()}"`;

  const ifNoneMatch = req.headers.get("if-none-match");
  if (ifNoneMatch && ifNoneMatch === etag) {
    return new NextResponse(null, {
      status: 304,
      headers: {
        ETag: etag,
        "Cache-Control": "no-cache, must-revalidate",
      },
    });
  }

  return NextResponse.json(
    {
      slug,
      version,
      data,
    },
    {
      headers: {
        ETag: etag,
        "Cache-Control": "no-cache, must-revalidate",
      },
    }
  );
}

