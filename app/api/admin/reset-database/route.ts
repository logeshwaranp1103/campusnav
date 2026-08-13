import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function POST() {
  try {
    if (prisma) {
      // Execute single TRUNCATE CASCADE query to safely clear all tables in one connection
      await prisma.$executeRawUnsafe(`
        TRUNCATE TABLE 
          "Edge",
          "SearchAlias",
          "Destination",
          "Room",
          "Node",
          "Door",
          "StairGroup",
          "LiftGroup",
          "Facility",
          "Obstacle",
          "Event",
          "GeoCalibration",
          "Floor",
          "Building",
          "DraftGraph",
          "PublishedGraph",
          "MapVersion",
          "AuditLog",
          "NavigationSession",
          "AnalyticsEvent",
          "MediaAsset"
        RESTART IDENTITY CASCADE;
      `);

      // Ensure default campus row exists
      await prisma.campus.upsert({
        where: { id: "c1" },
        update: { status: "PUBLISHED" },
        create: {
          id: "c1",
          name: "Main Campus",
          slug: "main",
          latitude: 11.4965,
          longitude: 77.2774,
          status: "PUBLISHED",
        },
      });

      // Reset Draft and Published graph entries to clean empty state
      const emptySnapshot = {
        buildings: [],
        floors: [],
        nodes: [],
        edges: [],
        destinations: [],
        obstacles: [],
        events: [],
        stairGroups: [],
        liftGroups: [],
        doors: [],
      };

      await prisma.draftGraph.upsert({
        where: { id: "active-draft" },
        update: { snapshot: emptySnapshot as any },
        create: { id: "active-draft", snapshot: emptySnapshot as any },
      });

      await prisma.publishedGraph.upsert({
        where: { id: "active-published" },
        update: {
          version: 1,
          snapshot: emptySnapshot as any,
          publishedAt: new Date(),
          publishedBy: "admin",
        },
        create: {
          id: "active-published",
          version: 1,
          snapshot: emptySnapshot as any,
          publishedAt: new Date(),
          publishedBy: "admin",
        },
      });
    }

    return NextResponse.json({
      success: true,
      message: "Database tables and graph snapshots completely reset to clean state.",
    });
  } catch (err: unknown) {
    console.error("Error performing database reset:", err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
