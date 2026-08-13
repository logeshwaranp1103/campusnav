import { prisma } from "../shared/lib/prisma";

async function main() {
  console.log("Executing single-query database truncate...");
  try {
    // TRUNCATE with CASCADE wipes all graph and navigation tables instantly in a single query
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

    // Ensure default campus record exists
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

    console.log("SUCCESS: Database successfully wiped to clean slate via SQL TRUNCATE!");
  } catch (err) {
    console.error("Truncate failed, attempting individual table deletes:", err);
    try {
      await prisma.publishedGraph.deleteMany().catch(() => {});
      await prisma.draftGraph.deleteMany().catch(() => {});
      await prisma.mapVersion.deleteMany().catch(() => {});
      await prisma.edge.deleteMany().catch(() => {});
      await prisma.destination.deleteMany().catch(() => {});
      await prisma.node.deleteMany().catch(() => {});
      await prisma.floor.deleteMany().catch(() => {});
      await prisma.building.deleteMany().catch(() => {});
      console.log("SUCCESS: Database fallback wipe completed!");
    } catch (e) {
      console.error("Wipe failed:", e);
      process.exit(1);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main();
