import { NextResponse } from "next/server";
import {
  createStorageKey,
  getMissingR2Env,
  uploadObjectToR2,
} from "@/lib/storage/r2";

export const runtime = "nodejs";
export const maxDuration = 60;

type AssetKind = "image" | "video" | "audio";

const maxFileSize = 50 * 1024 * 1024;

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

function getString(formData: FormData, key: string, fallback: string) {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim();
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
    const key = createStorageKey({
      ...scope,
      area: "references",
      filename: sanitize(file.name),
    });
    const object = await uploadObjectToR2({
      key,
      body: Buffer.from(await file.arrayBuffer()),
      contentType: file.type || "application/octet-stream",
    });

    return NextResponse.json({
      status: "ready",
      kind,
      key: object.key,
      url: object.url,
      name: file.name,
      size: file.size,
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
