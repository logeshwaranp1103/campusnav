import { NextResponse } from "next/server";
import { requireAdminSession } from "@/lib/auth/auth";
import { campusStore } from "@/shared/lib/campus-store";
import { logAuditEvent } from "@/lib/services/audit-service";
import { prisma } from "@/lib/db";

export async function GET(req: Request) {
  try {
    await requireAdminSession(req);
    const buildings = campusStore.getWorkingData().buildings;
    return NextResponse.json({ buildings });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) ?? "Unauthorized" }, { status: 401 });
  }
}

export async function POST(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const body = await req.json();

    if (!body.name || !body.shortCode) {
      return NextResponse.json({ error: "Building name and shortCode are required." }, { status: 400 });
    }

    const bld = campusStore.addBuilding({
      id: body.id || `b-${Date.now().toString(36)}`,
      campusId: "c1",
      name: body.name,
      shortCode: body.shortCode,
      color: body.color || "#4f46e5",
      floorsCount: typeof body.floorsCount === "number" ? body.floorsCount : 0,
      lat: body.lat || 11.4965,
      lng: body.lng || 77.2774,
    });

    if (prisma) {
      try {
        await prisma.draftGraph.upsert({
          where: { id: "active-draft" },
          update: { snapshot: campusStore.getWorkingData() as any },
          create: { id: "active-draft", snapshot: campusStore.getWorkingData() as any },
        });
      } catch (e) {
        console.warn("Failed to update draft graph in DB on building creation:", e);
      }
    }

    await logAuditEvent({
      userId: user.id,
      action: "BUILDING_CREATED",
      resource: "building",
      resourceId: bld.id,
      after: bld,
    });

    return NextResponse.json({ success: true, building: bld });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}

export async function DELETE(req: Request) {
  try {
    const user = await requireAdminSession(req);
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Building id parameter is required." }, { status: 400 });
    }

    campusStore.deleteBuilding(id);

    await logAuditEvent({
      userId: user.id,
      action: "BUILDING_DELETED",
      resource: "building",
      resourceId: id,
    });

    return NextResponse.json({ success: true, message: `Building ${id} deleted.` });
  } catch (err: unknown) {
    return NextResponse.json({ error: (err instanceof Error ? err.message : String(err)) }, { status: 400 });
  }
}
