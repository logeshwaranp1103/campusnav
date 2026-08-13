import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { publishDraftGraph } from "@/lib/services/publish-service";

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json().catch(() => ({}));

    const draftSnapshot = campusStore.getWorkingData();

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

    // Update published snapshot in store
    campusStore.publish();

    return NextResponse.json({
      success: true,
      version: result.version,
      publishedAt: result.publishedAt,
      validationReport: result.validationReport,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
