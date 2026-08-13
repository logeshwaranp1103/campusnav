import { NextResponse } from "next/server";
import { getActivePublishedGraph, publishDraftGraph } from "@/lib/services/publish-service";

export async function GET() {
  try {
    const publishedServiceData = await getActivePublishedGraph();

    const data = publishedServiceData?.snapshot ?? {
      buildings: [],
      floors: [],
      nodes: [],
      edges: [],
      destinations: [],
      obstacles: [],
    };

    return NextResponse.json(
      {
        publishedAt: publishedServiceData?.publishedAt ?? new Date(),
        version: publishedServiceData?.version ?? 1,
        graph: data,
      },
      {
        headers: {
          "Cache-Control": "no-store, max-age=0",
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
