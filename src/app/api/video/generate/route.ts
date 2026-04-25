import {
  experimental_generateVideo as generateVideo,
  gateway,
  type JSONValue,
} from "ai";
import { NextResponse } from "next/server";
import {
  createStorageKey,
  getMissingR2Env,
  uploadObjectToR2,
} from "@/lib/storage/r2";
import { sanitizeVideoSettings } from "@/lib/video-options";

export const runtime = "nodejs";
export const maxDuration = 600;

type AssetKind = "image" | "video" | "audio";

type ReferenceInput = {
  handle: string;
  kind: AssetKind;
  url: string;
  key?: string;
};

type ProviderJsonObject = Record<string, JSONValue | undefined>;

const allowedKinds = new Set<AssetKind>(["image", "video", "audio"]);

function setupNeeded(message: string) {
  return NextResponse.json({ status: "setup-needed", message });
}

function failed(message: string, status = 400) {
  return NextResponse.json({ status: "failed", message }, { status });
}

function extensionForMediaType(mediaType: string | undefined) {
  const normalized = mediaType?.toLowerCase() ?? "";
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("quicktime")) return "mov";
  if (normalized.includes("x-matroska")) return "mkv";
  if (normalized.includes("mp4") || normalized.includes("mpeg4")) return "mp4";
  return "mp4";
}

function sanitizeReferences(value: unknown): ReferenceInput[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ReferenceInput[] => {
    if (!entry || typeof entry !== "object") return [];
    const { handle, kind, url, key } = entry as Partial<ReferenceInput>;
    if (
      typeof handle !== "string" ||
      typeof url !== "string" ||
      typeof kind !== "string" ||
      !allowedKinds.has(kind as AssetKind)
    ) {
      return [];
    }
    return [{ handle, kind: kind as AssetKind, url, key }];
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function referenceLabel(reference: ReferenceInput, counters: Record<AssetKind, number>) {
  counters[reference.kind] += 1;
  return reference.kind === "image"
    ? `[Image ${counters.image}]`
    : reference.kind === "video"
      ? `[Video ${counters.video}]`
      : `[Audio ${counters.audio}]`;
}

function normalizePrompt(prompt: string, references: ReferenceInput[]) {
  const counters: Record<AssetKind, number> = { image: 0, video: 0, audio: 0 };
  let insertedReference = false;
  const normalized = references.reduce((current, reference) => {
    const label = referenceLabel(reference, counters);
    const pattern = new RegExp(`@${escapeRegExp(reference.handle)}\\b`, "gi");
    if (pattern.test(current)) insertedReference = true;
    return current.replace(pattern, label);
  }, prompt);

  if (insertedReference || references.length === 0) return normalized;

  const fallbackCounters: Record<AssetKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
  };
  const labels = references.map((reference) =>
    referenceLabel(reference, fallbackCounters),
  );
  return `${normalized}\n\nUse ${labels.join(", ")} as reference material.`;
}

function hasGatewayAuth() {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL === "1",
  );
}

export async function POST(request: Request) {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return failed("Expected JSON body.");
  }

  if (!payload || typeof payload !== "object") {
    return failed("Invalid request body.");
  }

  const body = payload as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const settings = sanitizeVideoSettings(body.settings);
  const references = sanitizeReferences(body.references);
  const scope = {
    tenantId:
      typeof body.tenantId === "string" && body.tenantId.trim()
        ? body.tenantId.trim()
        : "demo-tenant",
    userId:
      typeof body.userId === "string" && body.userId.trim()
        ? body.userId.trim()
        : "demo-user",
    folder:
      typeof body.folder === "string" && body.folder.trim()
        ? body.folder.trim()
        : "default",
  };

  if (prompt.length === 0) {
    return failed("Prompt is required.");
  }

  const imageReferences = references.filter((r) => r.kind === "image");
  const videoReferences = references.filter((r) => r.kind === "video");
  const sourceImage = imageReferences[0];

  if (!hasGatewayAuth()) {
    return setupNeeded(
      "Connect Vercel AI Gateway first. Add AI_GATEWAY_API_KEY locally, or deploy on Vercel with OIDC enabled.",
    );
  }

  const missingR2 = getMissingR2Env();
  if (missingR2.length > 0) {
    return setupNeeded(
      `Connect Cloudflare R2 first. Missing: ${missingR2.join(", ")}.`,
    );
  }

  try {
    const normalizedPrompt = normalizePrompt(prompt, references);
    const bytedanceOptions: ProviderJsonObject = {
      generateAudio: settings.generateAudio,
      pollTimeoutMs: 600000,
    };

    if (imageReferences.length > 0) {
      bytedanceOptions.referenceImages = imageReferences.map((r) => r.url);
    }
    if (videoReferences.length > 0) {
      bytedanceOptions.referenceVideos = videoReferences.map((r) => r.url);
    }

    const providerOptions: Record<string, ProviderJsonObject> = {
      gateway: {
        user: "film-maker",
        tags: ["film-maker", "video", "seedance-2.0"],
      },
      bytedance: bytedanceOptions,
    };

    const aspectRatio =
      !sourceImage && settings.aspectRatio === "adaptive"
        ? "16:9"
        : settings.aspectRatio;

    const result = await generateVideo({
      model: gateway.video(settings.model),
      // Seedance 2.0 image prompt objects currently hit a Gateway/provider
      // content-role validation path. Reference inputs use the documented
      // string prompt + providerOptions shape and support image/video refs.
      prompt: normalizedPrompt,
      // Seedance 2.0 accepts p-style quality values and adaptive aspect ratio
      // upstream. ai@6.0.168 types are narrower, but forwards strings unchanged.
      aspectRatio: aspectRatio as unknown as `${number}:${number}`,
      resolution: settings.resolution as unknown as `${number}x${number}`,
      duration: settings.duration,
      providerOptions,
      abortSignal: AbortSignal.timeout(600000),
    });
    const video = result.videos[0] ?? result.video;
    if (!video) {
      return failed("The model did not return a video.", 502);
    }

    const mediaType = video.mediaType || "video/mp4";
    const extension = extensionForMediaType(mediaType);
    const output = await uploadObjectToR2({
      key: createStorageKey({
        ...scope,
        area: "outputs",
        filename: `seedance-output.${extension}`,
      }),
      body: Buffer.from(video.uint8Array),
      contentType: mediaType,
    });

    return NextResponse.json({
      status: "ready",
      model: settings.model,
      videoUrl: output.url,
      downloadUrl: output.downloadUrl,
      mediaType,
      storageKey: output.key,
      sourceImageUrl: sourceImage?.url,
    });
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Video generation failed.",
      500,
    );
  }
}
