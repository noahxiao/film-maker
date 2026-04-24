import { NextResponse } from "next/server";
import {
  deleteObjectFromR2,
  getMissingR2Env,
} from "@/lib/storage/r2";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
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

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { status: "failed", message: "Expected JSON body." },
      { status: 400 },
    );
  }

  const key =
    body && typeof body === "object" && "key" in body
      ? (body as { key?: unknown }).key
      : undefined;

  if (typeof key !== "string" || key.length === 0) {
    return NextResponse.json(
      { status: "failed", message: "key is required." },
      { status: 400 },
    );
  }

  // Belt and suspenders: only allow deletes under our project prefix.
  const prefix = process.env.R2_PROJECT_PREFIX || "projects/film-maker";
  if (!key.startsWith(prefix)) {
    return NextResponse.json(
      { status: "failed", message: "key is outside the project prefix." },
      { status: 400 },
    );
  }

  try {
    await deleteObjectFromR2(key);
    return NextResponse.json({ status: "ready", key });
  } catch (error) {
    return NextResponse.json(
      {
        status: "failed",
        message: error instanceof Error ? error.message : "Delete failed.",
      },
      { status: 500 },
    );
  }
}
