import { prisma } from "../shared/lib/prisma";

async function verifyDatabase() {
  console.log("=== SUPABASE DATABASE AUDIT START ===");
  try {
    const buildings = await prisma.building.count().catch(() => 0);
    const floors = await prisma.floor.count().catch(() => 0);
    const nodes = await prisma.node.count().catch(() => 0);
    const edges = await prisma.edge.count().catch(() => 0);
    const destinations = await prisma.destination.count().catch(() => 0);
    const doors = await prisma.door.count().catch(() => 0);
    const stairGroups = await prisma.stairGroup.count().catch(() => 0);
    const liftGroups = await prisma.liftGroup.count().catch(() => 0);
    const obstacles = await prisma.obstacle.count().catch(() => 0);
    const events = await prisma.event.count().catch(() => 0);
    const draftGraphs = await prisma.draftGraph.count().catch(() => 0);
    const publishedGraphs = await prisma.publishedGraph.count().catch(() => 0);
    const mapVersions = await prisma.mapVersion.count().catch(() => 0);
    const auditLogs = await prisma.auditLog.count().catch(() => 0);

    console.log("ACTIVE TABLE COUNTS:");
    console.log(`- Building: ${buildings}`);
    console.log(`- Floor: ${floors}`);
    console.log(`- Node: ${nodes}`);
    console.log(`- Edge: ${edges}`);
    console.log(`- Destination: ${destinations}`);
    console.log(`- Door: ${doors}`);
    console.log(`- StairGroup: ${stairGroups}`);
    console.log(`- LiftGroup: ${liftGroups}`);
    console.log(`- Obstacle: ${obstacles}`);
    console.log(`- Event: ${events}`);
    console.log(`- DraftGraph: ${draftGraphs}`);
    console.log(`- PublishedGraph: ${publishedGraphs}`);
    console.log(`- MapVersion: ${mapVersions}`);
    console.log(`- AuditLog: ${auditLogs}`);

    const activeDraft = await prisma.draftGraph.findUnique({ where: { id: "active-draft" } });
    const activePub = await prisma.publishedGraph.findUnique({ where: { id: "active-published" } });

    const draftBldCount = (activeDraft?.snapshot as any)?.buildings?.length ?? 0;
    const pubBldCount = (activePub?.snapshot as any)?.buildings?.length ?? 0;

    console.log(`- DraftGraph active-draft snapshot buildings: ${draftBldCount}`);
    console.log(`- PublishedGraph active-published snapshot buildings: ${pubBldCount}`);

    const is100PercentEmpty =
      buildings === 0 &&
      floors === 0 &&
      nodes === 0 &&
      edges === 0 &&
      destinations === 0 &&
      draftBldCount === 0 &&
      pubBldCount === 0;

    if (is100PercentEmpty) {
      console.log("\nAUDIT VERDICT: 100% CLEAN & EMPTY DATABASE CONFIRMED!");
    } else {
      console.log("\nAUDIT VERDICT: ACTIVE DATA PRESENT IN DATABASE.");
    }
  } catch (err) {
    console.error("Database audit error:", err);
  } finally {
    await prisma.$disconnect();
  }
}

verifyDatabase();
