import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph } from "@/lib/services/publish-service";
import {
  uploadNodePhotoToSupabase,
  deleteNodePhotoFromSupabase,
  extractStoragePathFromUrl,
} from "@/lib/storage/supabase-storage";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    let photoUrl: string | null | undefined = null;
    let photoData: string | null | undefined = null;

    // 1. Fetch from Node metadata in database
    if (prisma) {
      const node = await prisma.node
        .findUnique({
          where: { id },
          select: { metadata: true },
        })
        .catch(() => null);

      if (node?.metadata && typeof node.metadata === "object") {
        const meta = node.metadata as Record<string, any>;
        if (typeof meta.photoUrl === "string" && meta.photoUrl.startsWith("http")) {
          photoUrl = meta.photoUrl;
        } else if (typeof meta.photoData === "string" && meta.photoData.startsWith("data:")) {
          photoData = meta.photoData;
        }
      }
    }

    // 2. Fallback to active published graph snapshot
    if (!photoUrl && !photoData) {
      const activePub = await getActivePublishedGraph();
      const nodeInSnapshot = activePub?.snapshot?.nodes?.find((n) => n.id === id);
      if (nodeInSnapshot?.photoUrl && typeof nodeInSnapshot.photoUrl === "string" && nodeInSnapshot.photoUrl.startsWith("http")) {
        photoUrl = nodeInSnapshot.photoUrl;
      }
    }

    // 3. Fallback to active draft graph snapshot
    if (!photoUrl && !photoData && prisma) {
      const draftRecord = await prisma.draftGraph
        .findUnique({ where: { id: "active-draft" } })
        .catch(() => null);
      if (draftRecord?.snapshot && typeof draftRecord.snapshot === "object") {
        const nodeInDraft = (draftRecord.snapshot as any)?.nodes?.find((n: any) => n.id === id);
        if (nodeInDraft?.photoUrl && typeof nodeInDraft.photoUrl === "string" && nodeInDraft.photoUrl.startsWith("http")) {
          photoUrl = nodeInDraft.photoUrl;
        }
      }
    }

    // If a persistent cloud URL exists, redirect directly to Supabase CDN with strong caching
    if (photoUrl && (photoUrl.startsWith("http://") || photoUrl.startsWith("https://")) && !photoUrl.includes(`/api/nodes/${id}/photo`)) {
      return NextResponse.redirect(photoUrl, {
        headers: {
          "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
        },
      });
    }

    // If legacy base64 data was found in database, migrate to Supabase Storage in background & stream
    if (photoData && photoData.startsWith("data:")) {
      const matches = photoData.match(/^data:([A-Za-z-+/0-9]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");

        // Upload to Supabase Storage asynchronously and update database
        uploadNodePhotoToSupabase(id, buffer, mimeType).then(async (res) => {
          if (res.success && res.publicUrl && prisma) {
            const existingNode = await prisma.node.findUnique({ where: { id }, select: { metadata: true } }).catch(() => null);
            const meta = (existingNode?.metadata && typeof existingNode.metadata === "object") ? existingNode.metadata : {};
            const cleanMeta = { ...meta, photoUrl: res.publicUrl, storagePath: res.storagePath, photoUploadedAt: new Date().toISOString() };
            delete (cleanMeta as any).photoData;
            await prisma.node.update({ where: { id }, data: { metadata: cleanMeta } }).catch(() => {});
          }
        }).catch(() => {});

        return new NextResponse(buffer, {
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            "Content-Length": String(buffer.length),
          },
        });
      }
    }

    return new NextResponse(null, { status: 404 });
  } catch (err: unknown) {
    console.warn("Error serving node photo:", err instanceof Error ? err.message : String(err));
    return new NextResponse(null, { status: 500 });
  }
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    let rawBuffer: Buffer | null = null;
    let mimeType = "image/jpeg";
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No image file provided in form data." }, { status: 400 });
      }

      const validMimes = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/svg+xml"];
      if (!validMimes.includes(file.type)) {
        return NextResponse.json({ error: "Invalid image format. Allowed: JPG, PNG, WebP, GIF, SVG." }, { status: 415 });
      }

      if (file.size > 5 * 1024 * 1024) {
        return NextResponse.json({ error: "File size exceeds 5MB limit." }, { status: 413 });
      }

      mimeType = file.type;
      const bytes = await file.arrayBuffer();
      rawBuffer = Buffer.from(bytes);
    } else {
      const body = await req.json().catch(() => ({}));
      const photoDataUri = body.photoData || body.photoUrl || "";

      if (!photoDataUri || !photoDataUri.startsWith("data:image/")) {
        return NextResponse.json({ error: "Invalid image payload format." }, { status: 400 });
      }

      const matches = photoDataUri.match(/^data:([A-Za-z-+/0-9]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        rawBuffer = Buffer.from(matches[2], "base64");
      }
    }

    if (!rawBuffer) {
      return NextResponse.json({ error: "Could not process image binary." }, { status: 400 });
    }

    // 1. Upload to Supabase Storage Bucket (reference-photos/nodes/{nodeId}/...)
    const uploadResult = await uploadNodePhotoToSupabase(id, rawBuffer, mimeType);
    if (!uploadResult.success || !uploadResult.publicUrl) {
      return NextResponse.json(
        { error: uploadResult.error || "Failed to upload image to Supabase Storage." },
        { status: 502 }
      );
    }

    const publicPhotoUrl = uploadResult.publicUrl;
    const storagePath = uploadResult.storagePath;

    // 2. Persist ONLY lightweight URL and metadata in PostgreSQL (ZERO base64 data)
    if (prisma) {
      try {
        const existingNode = await prisma.node.findUnique({
          where: { id },
          select: { metadata: true },
        }).catch(() => null);

        const existingMeta = (existingNode?.metadata && typeof existingNode?.metadata === "object")
          ? (existingNode.metadata as Record<string, any>)
          : {};

        // Safely clean up old storage object if replaced
        if (existingMeta.storagePath && existingMeta.storagePath !== storagePath) {
          deleteNodePhotoFromSupabase(existingMeta.storagePath).catch(() => {});
        }

        const updatedMeta: Record<string, any> = {
          ...existingMeta,
          photoUrl: publicPhotoUrl,
          storagePath,
          photoUploadedAt: new Date().toISOString(),
        };
        // Ensure no legacy base64 data is retained
        delete updatedMeta.photoData;

        if (existingNode) {
          await prisma.node.update({
            where: { id },
            data: { metadata: updatedMeta },
          }).catch((e) => console.warn(`Notice: Node ${id} metadata update:`, e?.message));
        } else {
          await prisma.node.upsert({
            where: { id },
            update: { metadata: updatedMeta },
            create: {
              id,
              campusId: "c1",
              type: "CORRIDOR",
              metadata: updatedMeta,
            },
          }).catch(() => {});
        }

        // 3. Synchronize active draft and published graph snapshots with cloud URL
        const [draftRec, pubRec] = await Promise.all([
          prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null),
          prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null),
        ]);

        if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
          const snap = draftRec.snapshot as any;
          if (Array.isArray(snap.nodes)) {
            const nd = snap.nodes.find((n: any) => n.id === id);
            if (nd) {
              nd.photoUrl = publicPhotoUrl;
              delete nd.photoData;
              await prisma.draftGraph.update({
                where: { id: "active-draft" },
                data: { snapshot: snap },
              }).catch(() => {});
            }
          }
        }

        if (pubRec?.snapshot && typeof pubRec.snapshot === "object") {
          const snap = pubRec.snapshot as any;
          if (Array.isArray(snap.nodes)) {
            const nd = snap.nodes.find((n: any) => n.id === id);
            if (nd) {
              nd.photoUrl = publicPhotoUrl;
              delete nd.photoData;
              await prisma.publishedGraph.update({
                where: { id: "active-published" },
                data: { snapshot: snap },
              }).catch(() => {});
            }
          }
        }
      } catch (dbErr) {
        console.warn("Notice: Database photo metadata persistence:", dbErr);
      }
    }

    // 4. Strict Database Verification Step (Requirement 4)
    if (prisma) {
      const verifiedNode = await prisma.node.findUnique({
        where: { id },
        select: { id: true, metadata: true },
      });

      const verifiedMeta = (verifiedNode?.metadata && typeof verifiedNode?.metadata === "object")
        ? (verifiedNode.metadata as Record<string, any>)
        : {};

      if (!verifiedNode || !verifiedMeta.photoUrl) {
        console.error(`[DATABASE_VERIFICATION_FAILED] Node ${id} metadata missing after write.`);
        return NextResponse.json(
          { error: "Database verification failed: Photo reference could not be verified in PostgreSQL." },
          { status: 500 }
        );
      }
      console.log(`[DATABASE_VERIFICATION_SUCCESS] Node ${id} verified photoUrl: ${verifiedMeta.photoUrl}`);
    }

    return NextResponse.json({
      success: true,
      nodeId: id,
      photoUrl: publicPhotoUrl,
      storagePath,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    console.error(`Error uploading photo for node ${id}:`, err);
    return NextResponse.json({ error: "Failed to upload reference photo." }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    if (prisma) {
      const existingNode = await prisma.node.findUnique({
        where: { id },
        select: { metadata: true },
      }).catch(() => null);

      if (existingNode?.metadata && typeof existingNode.metadata === "object") {
        const meta = { ...(existingNode.metadata as Record<string, any>) };
        const storagePath = meta.storagePath || extractStoragePathFromUrl(meta.photoUrl);
        if (storagePath) {
          await deleteNodePhotoFromSupabase(storagePath).catch(() => {});
        }

        delete meta.photoData;
        delete meta.photoUrl;
        delete meta.storagePath;
        delete meta.photoUploadedAt;

        await prisma.node.update({
          where: { id },
          data: { metadata: Object.keys(meta).length > 0 ? meta : undefined },
        }).catch(() => {});
      }
    }

    return NextResponse.json({ success: true, nodeId: id });
  } catch (err: unknown) {
    console.error(`Error deleting photo for node ${id}:`, err);
    return NextResponse.json({ error: "Failed to remove reference photo." }, { status: 500 });
  }
}
