import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph, publishDraftGraph, sanitizeSnapshotForPayload } from "@/lib/services/publish-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export async function GET() {
  try {
    const publishedServiceData = await getActivePublishedGraph(true);

    if (publishedServiceData && publishedServiceData.snapshot) {
      const data = sanitizeSnapshotForPayload(publishedServiceData.snapshot);
      const version = publishedServiceData.version ?? 1;
      const publishedAt = publishedServiceData.publishedAt ?? new Date();

      console.log(`[PublishedGraph:GET] Read published map from database: version v${version}, ${(data.buildings || []).length} buildings, ${(data.nodes || []).length} nodes, ${(data.edges || []).length} edges, ${(data.floors || []).length} floors, ${(data.destinations || []).length} destinations`);

      return NextResponse.json(
        {
          published: true,
          publishedAt,
          version,
          graph: data,
        },
        {
          headers: {
            "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0, proxy-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
          },
        }
      );
    }

    console.log("[PublishedGraph:GET] No published map found in database.");
    return NextResponse.json(
      {
        published: false,
        publishedAt: null,
        version: 0,
        graph: null,
        message: "No published map found in database.",
      },
      {
        status: 200,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[PublishedGraph:GET] Database error:", errorMsg);
    return NextResponse.json(
      {
        error: "Failed to load published map from database",
        details: errorMsg,
        graph: null,
      },
      {
        status: 500,
        headers: {
          "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
        },
      }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    let snapshot = body.snapshot || body.draft;

    if (!snapshot || typeof snapshot !== "object" || Object.keys(snapshot).length === 0) {
      if (prisma) {
        const dbDraft = await prisma.draftGraph.findUnique({
          where: { id: "active-draft" },
        }).catch(() => null);
        if (dbDraft && dbDraft.snapshot && typeof dbDraft.snapshot === "object") {
          snapshot = dbDraft.snapshot;
        }
      }
    }

    if (!snapshot || typeof snapshot !== "object") {
      return NextResponse.json({ error: "No snapshot available to publish." }, { status: 400 });
    }

    console.log(`[PublishedGraph:POST] Publishing map snapshot with ${(snapshot.buildings || []).length} buildings, ${(snapshot.nodes || []).length} nodes`);

    const result = await publishDraftGraph(snapshot, "admin-user", body.notes);

    if (!result.success) {
      console.error("[PublishedGraph:POST] Publishing failed:", result.error);
      return NextResponse.json({ error: result.error, validationReport: result.validationReport }, { status: 422 });
    }

    console.log(`[PublishedGraph:POST] Successfully published map v${result.version} to database at ${result.publishedAt}`);

    return NextResponse.json({
      success: true,
      version: result.version,
      publishedAt: result.publishedAt,
      graph: snapshot,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error("[PublishedGraph:POST] Database error during publish:", errorMsg);
    return NextResponse.json({ success: false, error: errorMsg }, { status: 500 });
  }
}
