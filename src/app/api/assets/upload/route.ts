import { NextResponse } from "next/server";
import sharp from "sharp";
import {
  createStorageKey,
  getMissingR2Env,
  uploadObjectToR2,
} from "@/lib/storage/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

type AssetKind = "image" | "video" | "audio";

const maxFileSize = 50 * 1024 * 1024;
const maxImageDimension = 2048;
const jpegQuality = 82;

type UploadBody = {
  body: Buffer;
  contentType: string;
  filename: string;
  size: number;
  originalSize: number;
  optimized: boolean;
};

function getKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function sanitize(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "asset"
  );
}

function replaceExtension(filename: string, extension: string) {
  return `${filename.replace(/\.[^/.]+$/, "") || "image"}.${extension}`;
}

function getString(formData: FormData, key: string, fallback: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim();
}

function canOptimizeImage(contentType: string) {
  const normalized = contentType.toLowerCase().split(";")[0];
  return (
    normalized.startsWith("image/") &&
    !["image/gif", "image/svg+xml"].includes(normalized)
  );
}

async function prepareUploadBody(
  file: File,
  kind: AssetKind,
): Promise<UploadBody> {
  const original = Buffer.from(await file.arrayBuffer());
  const originalContentType = file.type || "application/octet-stream";
  const originalUpload = {
    body: original,
    contentType: originalContentType,
    filename: sanitize(file.name),
    size: original.length,
    originalSize: file.size,
    optimized: false,
  };

  if (kind !== "image" || !canOptimizeImage(originalContentType)) {
    return originalUpload;
  }

  try {
    const metadata = await sharp(original, {
      animated: false,
      limitInputPixels: 80_000_000,
    }).metadata();
    const exceedsPixelTarget =
      (metadata.width ?? 0) > maxImageDimension ||
      (metadata.height ?? 0) > maxImageDimension;

    const optimized = await sharp(original, {
      animated: false,
      limitInputPixels: 80_000_000,
    })
      .rotate()
      .resize({
        width: maxImageDimension,
        height: maxImageDimension,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: jpegQuality, mozjpeg: true })
      .toBuffer();

    if (!exceedsPixelTarget && optimized.length >= original.length) {
      return originalUpload;
    }

    return {
      body: optimized,
      contentType: "image/jpeg",
      filename: replaceExtension(sanitize(file.name), "jpg"),
      size: optimized.length,
      originalSize: file.size,
      optimized: true,
    };
  } catch {
    return originalUpload;
  }
}

export async function POST(request: Request) {
  const missing = getMissingR2Env();
  if (missing.length > 0) {
    return NextResponse.json(
      {
        status: "setup-needed",
        message: `Connect Cloudflare R2 first. Missing: ${missing.join(", ")}.`,
      },
      { status: 503 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { status: "failed", message: "Expected multipart form data." },
      { status: 400 },
    );
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json(
      { status: "failed", message: "No file provided." },
      { status: 400 },
    );
  }

  const kind = getKind(file);
  if (!kind) {
    return NextResponse.json(
      {
        status: "failed",
        message: `${file.name} is not an image, video, or audio file.`,
      },
      { status: 400 },
    );
  }

  if (file.size > maxFileSize) {
    return NextResponse.json(
      {
        status: "failed",
        message: `${file.name} exceeds the 50 MB limit.`,
      },
      { status: 413 },
    );
  }

  const scope = {
    tenantId: getString(formData, "tenantId", "demo-tenant"),
    userId: getString(formData, "userId", "demo-user"),
    folder: getString(formData, "folder", "default"),
  };

  try {
    const upload = await prepareUploadBody(file, kind);
    const key = createStorageKey({
      ...scope,
      area: "references",
      filename: upload.filename,
    });
    const object = await uploadObjectToR2({
      key,
      body: upload.body,
      contentType: upload.contentType,
    });

    return NextResponse.json({
      status: "ready",
      kind,
      key: object.key,
      url: object.url,
      name: file.name,
      size: upload.size,
      originalSize: upload.originalSize,
      optimized: upload.optimized,
      contentType: object.contentType,
    });
  } catch (error) {
    return NextResponse.json(
      {
        status: "failed",
        message: error instanceof Error ? error.message : "Upload failed.",
      },
      { status: 500 },
    );
  }
}
