import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import fs from "fs";
import path from "path";

const OBJECT_STORAGE_ROOT = path.join(process.cwd(), "public", "uploads", "reference-photos", "nodes");

function ensureStorageDir(nodeId: string): string {
  const safeId = nodeId.replace(/[^a-zA-Z0-9_-]/g, "_");
  const dir = path.join(OBJECT_STORAGE_ROOT, safeId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const safeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const nodeDir = path.join(OBJECT_STORAGE_ROOT, safeId);

    // 1. Primary: Check Node metadata in PostgreSQL for exact registered photoUrl / storagePath
    if (prisma) {
      const node = await prisma.node
        .findUnique({
          where: { id },
          select: { metadata: true },
        })
        .catch(() => null);

      if (node?.metadata && typeof node.metadata === "object") {
        const meta = node.metadata as Record<string, any>;
        if (typeof meta.photoUrl === "string") {
          // If relative upload path: e.g. /uploads/reference-photos/nodes/...
          if (meta.photoUrl.startsWith("/uploads/")) {
            const relPath = meta.photoUrl.replace(/^\//, "");
            const specificFile = path.join(process.cwd(), "public", relPath);
            if (fs.existsSync(specificFile)) {
              const fileBuffer = fs.readFileSync(specificFile);
              const ext = path.extname(specificFile).toLowerCase().replace(".", "");
              const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";
              return new NextResponse(fileBuffer, {
                status: 200,
                headers: {
                  "Content-Type": mimeType,
                  "Cache-Control": "public, max-age=31536000, immutable",
                  "Content-Length": String(fileBuffer.length),
                  "Access-Control-Allow-Origin": "*",
                },
              });
            }
          } else if (meta.photoUrl.startsWith("http") && !meta.photoUrl.includes(`/api/nodes/${id}/photo`)) {
            return NextResponse.redirect(meta.photoUrl, {
              headers: {
                "Cache-Control": "public, max-age=31536000, immutable",
                "Access-Control-Allow-Origin": "*",
              },
            });
          }
        }
      }
    }

    // 2. Secondary: Serve physical image file from Object Storage directory
    if (fs.existsSync(nodeDir)) {
      const files = fs.readdirSync(nodeDir).filter((f) => !f.endsWith(".json"));
      if (files.length > 0) {
        const newestFile = files.sort((a, b) => {
          const statA = fs.statSync(path.join(nodeDir, a)).mtimeMs;
          const statB = fs.statSync(path.join(nodeDir, b)).mtimeMs;
          return statB - statA;
        })[0];

        const filePath = path.join(nodeDir, newestFile);
        const fileBuffer = fs.readFileSync(filePath);
        const ext = path.extname(newestFile).toLowerCase().replace(".", "");
        const mimeType = ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg";

        return new NextResponse(fileBuffer, {
          status: 200,
          headers: {
            "Content-Type": mimeType,
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": String(fileBuffer.length),
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    // 3. Fallback: Legacy migration from NodePhoto table if present
    if (prisma && (prisma as any).nodePhoto) {
      const dbPhoto = await (prisma as any).nodePhoto.findUnique({ where: { nodeId: id } }).catch(() => null);
      if (dbPhoto?.data) {
        const buffer = Buffer.from(dbPhoto.data);
        const ext = (dbPhoto.mimeType || "image/jpeg").split("/")[1] || "jpg";
        const dir = ensureStorageDir(id);
        const uniqueToken = Math.random().toString(36).substring(2, 9);
        const filename = `ref_${Date.now()}_${uniqueToken}.${ext}`;
        const filePath = path.join(dir, filename);
        fs.writeFileSync(filePath, buffer);

        return new NextResponse(buffer, {
          status: 200,
          headers: {
            "Content-Type": dbPhoto.mimeType || "image/jpeg",
            "Cache-Control": "public, max-age=31536000, immutable",
            "Content-Length": String(buffer.length),
            "Access-Control-Allow-Origin": "*",
          },
        });
      }
    }

    return new NextResponse(
      JSON.stringify({ error: "Photo not found in object storage", nodeId: id }),
      {
        status: 404,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
  } catch (err: unknown) {
    console.error(`[PHOTO-STORAGE] Error serving photo for node ${id}:`, err instanceof Error ? err.message : String(err));
    return new NextResponse(
      JSON.stringify({ error: "Internal server error serving photo", nodeId: id }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          "Access-Control-Allow-Origin": "*",
        },
      }
    );
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
    let ext = "jpg";
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

      if (file.size > 15 * 1024 * 1024) {
        return NextResponse.json({ error: "File size exceeds 15MB limit." }, { status: 413 });
      }

      mimeType = file.type;
      ext = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "jpg";
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
        ext = mimeType.split("/")[1]?.replace("svg+xml", "svg") || "jpg";
        rawBuffer = Buffer.from(matches[2], "base64");
      }
    }

    if (!rawBuffer) {
      return NextResponse.json({ error: "Could not process image binary." }, { status: 400 });
    }

    // 1. Write Real Image File into Persistent Object Storage
    const safeNodeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const nodeDir = ensureStorageDir(id);

    // Clean up old physical files in node directory before saving new one
    try {
      const oldFiles = fs.readdirSync(nodeDir);
      for (const oldFile of oldFiles) {
        fs.unlinkSync(path.join(nodeDir, oldFile));
      }
    } catch {}

    const uniqueToken = Math.random().toString(36).substring(2, 9);
    const uniqueFilename = `ref_${Date.now()}_${uniqueToken}.${ext}`;
    const targetFilePath = path.join(nodeDir, uniqueFilename);

    // Save actual image file to disk
    fs.writeFileSync(targetFilePath, rawBuffer);

    const persistentUrl = `/uploads/reference-photos/nodes/${safeNodeId}/${uniqueFilename}`;
    const storagePath = `nodes/${safeNodeId}/${uniqueFilename}`;
    const uploadedAt = new Date().toISOString();

    console.log(`[OBJECT-STORAGE] Real File Saved: ${targetFilePath} (${rawBuffer.length} bytes, ${mimeType})`);
    console.log(`[OBJECT-STORAGE] Persistent URL: ${persistentUrl}`);

    // Verify storage file exists and is readable
    if (!fs.existsSync(targetFilePath) || fs.statSync(targetFilePath).size === 0) {
      return NextResponse.json({ error: "Failed to persist image file to object storage." }, { status: 500 });
    }

    // 2. Persist ONLY the lightweight URL and path in PostgreSQL database (ZERO base64, ZERO binary)
    if (prisma) {
      try {
        const updatedMeta: Record<string, any> = {
          photoUrl: persistentUrl,
          storagePath,
          photoUploadedAt: uploadedAt,
          physicalVerified: true,
        };

        const existingNode = await prisma.node.findUnique({
          where: { id },
          select: { metadata: true, campusId: true },
        }).catch(() => null);

        const existingMeta = (existingNode?.metadata && typeof existingNode?.metadata === "object")
          ? (existingNode.metadata as Record<string, any>)
          : {};

        const mergedMeta = { ...existingMeta, ...updatedMeta };
        delete (mergedMeta as any).photoData;

        if (existingNode) {
          await prisma.node.update({
            where: { id },
            data: { metadata: mergedMeta },
          }).catch((e) => console.warn(`[OBJECT-STORAGE] Node update notice:`, e?.message));
        } else {
          const defaultCampus = await prisma.campus.findFirst({ select: { id: true } }).catch(() => null);
          const campusId = existingNode?.campusId || defaultCampus?.id || "c1";

          await prisma.node.upsert({
            where: { id },
            update: { metadata: mergedMeta },
            create: {
              id,
              campusId,
              type: "CORRIDOR",
              metadata: mergedMeta,
            },
          }).catch((e) => console.warn(`[OBJECT-STORAGE] Node upsert notice:`, e?.message));
        }

        // 3. Update Draft and Published Snapshots in background
        setTimeout(async () => {
          if (!prisma) return;
          try {
            const [draftRec, pubRec] = await Promise.all([
              prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null),
              prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null),
            ]);

            if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
              const snap = draftRec.snapshot as any;
              if (Array.isArray(snap.nodes)) {
                const nd = snap.nodes.find((n: any) => n.id === id);
                if (nd) {
                  nd.photoUrl = persistentUrl;
                  nd.photoUploadedAt = uploadedAt;
                  nd.physicalVerified = true;
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
                  nd.photoUrl = persistentUrl;
                  nd.photoUploadedAt = uploadedAt;
                  nd.physicalVerified = true;
                  delete nd.photoData;
                  await prisma.publishedGraph.update({
                    where: { id: "active-published" },
                    data: { snapshot: snap },
                  }).catch(() => {});
                }
              }
            }
          } catch {}
        }, 0);
      } catch (dbErr: any) {
        console.warn(`[OBJECT-STORAGE] Database metadata update warning for ${id}:`, dbErr?.message);
      }
    }

    return NextResponse.json({
      success: true,
      nodeId: id,
      photoUrl: persistentUrl,
      storagePath,
      uploadedAt,
    });
  } catch (err: unknown) {
    console.error(`[OBJECT-STORAGE] Error uploading photo for node ${id}:`, err);
    return NextResponse.json({
      error: err instanceof Error ? err.message : "Failed to upload reference photo."
    }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    // 1. Remove physical file from object storage
    const safeNodeId = id.replace(/[^a-zA-Z0-9_-]/g, "_");
    const nodeDir = path.join(OBJECT_STORAGE_ROOT, safeNodeId);
    if (fs.existsSync(nodeDir)) {
      const files = fs.readdirSync(nodeDir);
      for (const file of files) {
        fs.unlinkSync(path.join(nodeDir, file));
      }
      try {
        fs.rmdirSync(nodeDir);
      } catch {}
    }

    // 2. Remove photo metadata from database
    if (prisma) {
      const existingNode = await prisma.node.findUnique({
        where: { id },
        select: { metadata: true },
      }).catch(() => null);

      if (existingNode?.metadata && typeof existingNode.metadata === "object") {
        const meta = { ...(existingNode.metadata as Record<string, any>) };
        delete meta.photoData;
        delete meta.photoUrl;
        delete meta.storagePath;
        delete meta.photoUploadedAt;
        delete meta.physicalVerified;

        await prisma.node.update({
          where: { id },
          data: { metadata: meta },
        }).catch(() => {});
      }

      // Also clean up any legacy row in NodePhoto
      await (prisma as any).nodePhoto?.deleteMany({ where: { nodeId: id } }).catch(() => {});

      // 3. Remove photoUrl from snapshots
      const [draftRec, pubRec] = await Promise.all([
        prisma.draftGraph.findUnique({ where: { id: "active-draft" } }).catch(() => null),
        prisma.publishedGraph.findUnique({ where: { id: "active-published" } }).catch(() => null),
      ]);

      if (draftRec?.snapshot && typeof draftRec.snapshot === "object") {
        const snap = draftRec.snapshot as any;
        if (Array.isArray(snap.nodes)) {
          const nd = snap.nodes.find((n: any) => n.id === id);
          if (nd) {
            delete nd.photoUrl;
            delete nd.photoData;
            delete nd.photoUploadedAt;
            delete nd.physicalVerified;
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
            delete nd.photoUrl;
            delete nd.photoData;
            delete nd.photoUploadedAt;
            delete nd.physicalVerified;
            await prisma.publishedGraph.update({
              where: { id: "active-published" },
              data: { snapshot: snap },
            }).catch(() => {});
          }
        }
      }
    }

    return NextResponse.json({ success: true, nodeId: id });
  } catch (err: unknown) {
    console.error(`[OBJECT-STORAGE] Error deleting photo for node ${id}:`, err);
    return NextResponse.json({ error: "Failed to remove reference photo." }, { status: 500 });
  }
}
