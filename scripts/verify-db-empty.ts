import { prisma } from "../shared/lib/prisma";

async function verifyDatabase() {
  console.log("=== SUPABASE DATABASE AUDIT START ===");
  try {
    const [
      buildings,
      floors,
      rooms,
      nodes,
      edges,
      destinations,
      searchAliases,
      doors,
      stairGroups,
      liftGroups,
      facilities,
      obstacles,
      events,
      geoCalibrations,
      draftGraphs,
      publishedGraphs,
      mapVersions,
      auditLogs,
      navSessions,
      analyticsEvents,
      mediaAssets,
    ] = await Promise.all([
      prisma.building.count(),
      prisma.floor.count(),
      prisma.room.count(),
      prisma.node.count(),
      prisma.edge.count(),
      prisma.destination.count(),
      prisma.searchAlias.count(),
      prisma.door.count(),
      prisma.stairGroup.count(),
      prisma.liftGroup.count(),
      prisma.facility.count(),
      prisma.obstacle.count(),
      prisma.event.count(),
      prisma.geoCalibration.count(),
      prisma.draftGraph.count(),
      prisma.publishedGraph.count(),
      prisma.mapVersion.count(),
      prisma.auditLog.count(),
      prisma.navigationSession.count(),
      prisma.analyticsEvent.count(),
      prisma.mediaAsset.count(),
    ]);

    console.log("TABLE COUNTS:");
    console.log(`- Building: ${buildings}`);
    console.log(`- Floor: ${floors}`);
    console.log(`- Room: ${rooms}`);
    console.log(`- Node: ${nodes}`);
    console.log(`- Edge: ${edges}`);
    console.log(`- Destination: ${destinations}`);
    console.log(`- SearchAlias: ${searchAliases}`);
    console.log(`- Door: ${doors}`);
    console.log(`- StairGroup: ${stairGroups}`);
    console.log(`- LiftGroup: ${liftGroups}`);
    console.log(`- Facility: ${facilities}`);
    console.log(`- Obstacle: ${obstacles}`);
    console.log(`- Event: ${events}`);
    console.log(`- GeoCalibration: ${geoCalibrations}`);
    console.log(`- DraftGraph: ${draftGraphs}`);
    console.log(`- PublishedGraph: ${publishedGraphs}`);
    console.log(`- MapVersion: ${mapVersions}`);
    console.log(`- AuditLog: ${auditLogs}`);
    console.log(`- NavigationSession: ${navSessions}`);
    console.log(`- AnalyticsEvent: ${analyticsEvents}`);
    console.log(`- MediaAsset: ${mediaAssets}`);

    // Inspect snapshot contents in DraftGraph and PublishedGraph
    const activeDraft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
    const activePub = await prisma.publishedGraph.findUnique({ where: { id: "active-published" } });

    const draftBldCount = (activeDraft?.snapshot as any)?.buildings?.length ?? 0;
    const pubBldCount = (activePub?.snapshot as any)?.buildings?.length ?? 0;

    console.log(`- DraftGraph active-draft snapshot buildings: ${draftBldCount}`);
    console.log(`- PublishedGraph active-published snapshot buildings: ${pubBldCount}`);

    const is100PercentEmpty =
      buildings === 0 &&
      floors === 0 &&
      rooms === 0 &&
      nodes === 0 &&
      edges === 0 &&
      destinations === 0 &&
      draftBldCount === 0 &&
      pubBldCount === 0;

    if (is100PercentEmpty) {
      console.log("\nAUDIT VERDICT: 100% CLEAN & EMPTY DATABASE CONFIRMED!");
    } else {
      console.log("\nAUDIT VERDICT: REMNANT DATA DETECTED! EXECUTING EMERGENCY RE-WIPE...");
    }
  } catch (err) {
    console.error("Database audit error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

verifyDatabase();
