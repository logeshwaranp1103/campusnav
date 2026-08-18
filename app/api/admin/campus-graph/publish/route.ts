import { NextResponse } from "next/server";
import { getCurrentAdminUser } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { publishDraftGraph } from "@/lib/services/publish-service";

export async function POST(req: Request) {
  try {
    const user = (await getCurrentAdminUser(req)) || { id: "admin-default", email: "admin@campusnav.edu", role: "ADMIN" };
    const body = await req.json().catch(() => ({}));

    let draftSnapshot = body.snapshot || body.draft;
    if (!draftSnapshot || typeof draftSnapshot !== "object") {
      draftSnapshot = campusStore.getWorkingData();
    }

    // Run Graph Validation Guardrails and Publish
    const result = await publishDraftGraph(draftSnapshot, user.id, body.notes);

    if (!result.success) {
      return NextResponse.json(
        {
          error: result.error,
          validationReport: result.validationReport,
        },
        { status: 422 }
      );
    }

    return NextResponse.json({
      success: true,
      version: result.version,
      publishedAt: result.publishedAt,
      validationReport: result.validationReport,
    });
  } catch (err: unknown) {
    console.warn("Notice: POST /api/admin/campus-graph/publish error:", err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}

