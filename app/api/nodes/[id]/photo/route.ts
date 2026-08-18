import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph } from "@/lib/services/publish-service";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    let photoDataUrl: string | null | undefined = null;

    // 1. Try fetching from Node table in database
    if (prisma) {
      const node = await prisma.node
        .findUnique({
          where: { id },
          select: { metadata: true },
        })
        .catch(() => null);

      if (node?.metadata && typeof node.metadata === "object") {
        photoDataUrl = (node.metadata as any).photoUrl;
      }
    }

    // 2. Fallback to active published graph snapshot
    if (!photoDataUrl) {
      const activePub = await getActivePublishedGraph();
      const nodeInSnapshot = activePub?.snapshot?.nodes?.find((n) => n.id === id);
      if (nodeInSnapshot?.photoUrl) {
        photoDataUrl = nodeInSnapshot.photoUrl;
      }
    }

    // 3. Fallback to draft graph snapshot if in draft mode
    if (!photoDataUrl && prisma) {
      const draftRecord = await prisma.draftGraph
        .findUnique({ where: { id: "active-draft" } })
        .catch(() => null);
      if (draftRecord?.snapshot && typeof draftRecord.snapshot === "object") {
        const nodeInDraft = (draftRecord.snapshot as any)?.nodes?.find((n: any) => n.id === id);
        if (nodeInDraft?.photoUrl) {
          photoDataUrl = nodeInDraft.photoUrl;
        }
      }
    }

    if (!photoDataUrl) {
      return new NextResponse(null, { status: 404 });
    }

    // If it's a base64 data URI (e.g. data:image/jpeg;base64,...), stream raw binary image
    if (photoDataUrl.startsWith("data:")) {
      const matches = photoDataUrl.match(/^data:([A-Za-z-+/]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const contentType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");
        return new NextResponse(buffer, {
          headers: {
            "Content-Type": contentType,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            "Content-Length": String(buffer.length),
          },
        });
      }
    }

    // If it's an external or static URL, redirect
    return NextResponse.redirect(photoDataUrl);
  } catch (err: unknown) {
    console.warn("Error serving node photo:", err instanceof Error ? err.message : String(err));
    return new NextResponse(null, { status: 500 });
  }
}
