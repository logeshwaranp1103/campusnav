import { NextResponse } from "next/server";
import { getActivePublishedGraph, publishDraftGraph, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

export async function GET(req: Request) {
  try {
    const publishedServiceData = await getActivePublishedGraph(false);

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

    // 304 Not Modified check
    const ifNoneMatch = req.headers.get("if-none-match");
    if (ifNoneMatch && ifNoneMatch === etag) {
      return new NextResponse(null, {
        status: 304,
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=10, s-maxage=60, stale-while-revalidate=86400",
        },
      });
    }

    return NextResponse.json(
      {
        publishedAt,
        version,
        graph: data,
      },
      {
        headers: {
          ETag: etag,
          "Cache-Control": "public, max-age=10, s-maxage=60, stale-while-revalidate=86400",
        },
      }
    );
  } catch (err: unknown) {
    console.warn("Notice: GET /api/published-graph database error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({
      publishedAt: new Date(),
      version: 1,
      graph: { buildings: [], floors: [], nodes: [], edges: [], destinations: [], obstacles: [] },
      offline: true,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const snapshot = body.snapshot;

    const result = await publishDraftGraph(snapshot, "admin-user", body.notes);

    if (!result.success) {
      return NextResponse.json({ error: result.error, validationReport: result.validationReport }, { status: 422 });
    }

    return NextResponse.json({
      success: true,
      version: result.version,
      publishedAt: result.publishedAt,
      graph: snapshot,
    });
  } catch (err: unknown) {
    console.warn("Notice: POST /api/published-graph database warning:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ success: false, offline: true, error: err instanceof Error ? err.message : String(err) }, { status: 200 });
  }
}
