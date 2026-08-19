import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getActivePublishedGraph } from "@/lib/services/publish-service";
import fs from "fs";
import path from "path";

const PHOTOS_DIR = path.join(process.cwd(), ".data", "node-photos");

function ensurePhotosDir() {
  if (!fs.existsSync(PHOTOS_DIR)) {
    fs.mkdirSync(PHOTOS_DIR, { recursive: true });
  }
}

function getPhotoFilePath(nodeId: string): string {
  ensurePhotosDir();
  // Sanitize nodeId for filename safety
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(PHOTOS_DIR, `${safeId}.dat`);
}

function getPhotoMetaPath(nodeId: string): string {
  ensurePhotosDir();
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return path.join(PHOTOS_DIR, `${safeId}.json`);
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const filePath = getPhotoFilePath(id);
    const metaPath = getPhotoMetaPath(id);

    // 1. Check if photo binary file exists on local disk storage (Fast path for local dev)
    if (fs.existsSync(filePath)) {
      try {
        const buffer = await fs.promises.readFile(filePath);
        let mimeType = "image/jpeg";
        if (fs.existsSync(metaPath)) {
          try {
            const meta = JSON.parse(await fs.promises.readFile(metaPath, "utf-8"));
            if (meta.mimeType) mimeType = meta.mimeType;
          } catch {}
        }

        return new NextResponse(buffer, {
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            "Content-Length": String(buffer.length),
          },
        });
      } catch {}
    }

    let photoDataUrl: string | null | undefined = null;

    // 2. Try fetching from Node table metadata in database
    if (prisma) {
      const node = await prisma.node
        .findUnique({
          where: { id },
          select: { metadata: true },
        })
        .catch(() => null);

      if (node?.metadata && typeof node.metadata === "object") {
        const meta = node.metadata as Record<string, any>;
        if (typeof meta.photoData === "string" && meta.photoData.startsWith("data:")) {
          photoDataUrl = meta.photoData;
        } else if (typeof meta.photoUrl === "string" && meta.photoUrl.startsWith("data:")) {
          photoDataUrl = meta.photoUrl;
        }
      }
    }

    // 3. Fallback to active draft graph snapshot
    if (!photoDataUrl && prisma) {
      const draftRecord = await prisma.draftGraph
        .findUnique({ where: { id: "active-draft" } })
        .catch(() => null);
      if (draftRecord?.snapshot && typeof draftRecord.snapshot === "object") {
        const nodeInDraft = (draftRecord.snapshot as any)?.nodes?.find((n: any) => n.id === id);
        if (nodeInDraft?.photoUrl && typeof nodeInDraft.photoUrl === "string" && nodeInDraft.photoUrl.startsWith("data:")) {
          photoDataUrl = nodeInDraft.photoUrl;
        } else if (nodeInDraft?.photoData && typeof nodeInDraft.photoData === "string" && nodeInDraft.photoData.startsWith("data:")) {
          photoDataUrl = nodeInDraft.photoData;
        }
      }
    }

    // 4. Fallback to active published graph snapshot
    if (!photoDataUrl) {
      const activePub = await getActivePublishedGraph();
      const nodeInSnapshot = activePub?.snapshot?.nodes?.find((n) => n.id === id);
      if (nodeInSnapshot?.photoUrl && typeof nodeInSnapshot.photoUrl === "string" && nodeInSnapshot.photoUrl.startsWith("data:")) {
        photoDataUrl = nodeInSnapshot.photoUrl;
      }
    }

    // If base64 data URI was found, parse, optionally cache to disk, and stream
    if (photoDataUrl && photoDataUrl.startsWith("data:")) {
      const matches = photoDataUrl.match(/^data:([A-Za-z-+/0-9]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        const mimeType = matches[1];
        const buffer = Buffer.from(matches[2], "base64");

        // Write to disk cache if filesystem is writable
        try {
          await fs.promises.writeFile(filePath, buffer);
          await fs.promises.writeFile(metaPath, JSON.stringify({ mimeType, updatedAt: new Date().toISOString() }));
        } catch {}

        return new NextResponse(buffer, {
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "public, max-age=86400, stale-while-revalidate=604800",
            "Content-Length": String(buffer.length),
          },
        });
      }
    }

    // If external URL (http/https) and not pointing back to self, redirect
    if (photoDataUrl && (photoDataUrl.startsWith("http://") || photoDataUrl.startsWith("https://")) && !photoDataUrl.includes(`/api/nodes/${id}/photo`)) {
      return NextResponse.redirect(photoDataUrl);
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
    let photoDataUri = "";
    let mimeType = "image/jpeg";
    let rawBuffer: Buffer | null = null;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "No image file provided in form data" }, { status: 400 });
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
      photoDataUri = `data:${file.type};base64,${rawBuffer.toString("base64")}`;
    } else {
      const body = await req.json().catch(() => ({}));
      photoDataUri = body.photoData || body.photoUrl || "";

      if (!photoDataUri || !photoDataUri.startsWith("data:image/")) {
        return NextResponse.json({ error: "Invalid image payload format." }, { status: 400 });
      }

      const matches = photoDataUri.match(/^data:([A-Za-z-+/0-9]+);base64,(.+)$/);
      if (matches && matches.length === 3) {
        mimeType = matches[1];
        rawBuffer = Buffer.from(matches[2], "base64");
      }
    }

    if (rawBuffer) {
      // 1. Try saving raw binary file to disk if available
      try {
        const filePath = getPhotoFilePath(id);
        const metaPath = getPhotoMetaPath(id);
        await fs.promises.writeFile(filePath, rawBuffer);
        await fs.promises.writeFile(metaPath, JSON.stringify({ mimeType, updatedAt: new Date().toISOString() }));
      } catch {}
    }

    const stableUrl = `/api/nodes/${id}/photo`;

    // 2. Persist to Postgres database reliably with await for Serverless compatibility
    if (prisma) {
      try {
        const existingNode = await prisma.node.findUnique({
          where: { id },
          select: { metadata: true },
        }).catch(() => null);

        const existingMeta = (existingNode?.metadata && typeof existingNode?.metadata === "object") ? existingNode.metadata : {};
        const updatedMeta = {
          ...existingMeta,
          photoData: photoDataUri,
          photoUrl: stableUrl,
          photoUploadedAt: new Date().toISOString(),
        };

        if (existingNode) {
          await prisma.node.update({
            where: { id },
            data: {
              metadata: updatedMeta,
            },
          }).catch((e) => console.warn(`Notice: Node ${id} metadata update:`, e?.message));
        } else {
          await prisma.node.upsert({
            where: { id },
            update: { metadata: updatedMeta },
            create: {
              id,
              campusId: "c1",
              type: "HALLWAY",
              metadata: updatedMeta,
            },
          }).catch(() => {});
        }

        // Also synchronize active draft & published snapshots if present
        const [draftRec, pubRec] = await Promise.all([
          prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null),
          prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null),
        ]);

        if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
          const snap = draftRec.snapshot as any;
          if (Array.isArray(snap.nodes)) {
            const nd = snap.nodes.find((n: any) => n.id === id);
            if (nd) {
              nd.photoUrl = stableUrl;
              nd.photoData = photoDataUri;
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
              nd.photoUrl = stableUrl;
              await prisma.publishedGraph.update({
                where: { id: "active-published" },
                data: { snapshot: snap },
              }).catch(() => {});
            }
          }
        }
      } catch (dbErr) {
        console.warn("Notice: Database photo persistence:", dbErr);
      }
    }

    return NextResponse.json({
      success: true,
      nodeId: id,
      photoUrl: stableUrl,
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
    const filePath = getPhotoFilePath(id);
    const metaPath = getPhotoMetaPath(id);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath).catch(() => {});
    }
    if (fs.existsSync(metaPath)) {
      await fs.promises.unlink(metaPath).catch(() => {});
    }

    if (prisma) {
      const existingNode = await prisma.node.findUnique({
        where: { id },
        select: { metadata: true },
      }).catch(() => null);

      if (existingNode?.metadata && typeof existingNode.metadata === "object") {
        const meta = { ...(existingNode.metadata as any) };
        delete meta.photoData;
        delete meta.photoUrl;
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
