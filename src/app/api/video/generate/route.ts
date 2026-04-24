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

export const runtime = "nodejs";
export const maxDuration = 600;

type AssetKind = "image" | "video" | "audio";
type SeedanceModel = "bytedance/seedance-2.0" | "bytedance/seedance-2.0-fast";
type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type Resolution = "480p" | "720p" | "1080p";

type Settings = {
  model: SeedanceModel;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  duration: number;
  generateAudio: boolean;
  cameraFixed: boolean;
};

type ReferenceInput = {
  handle: string;
  kind: AssetKind;
  url: string;
  key?: string;
};

type ProviderJsonObject = Record<string, JSONValue | undefined>;

const defaultSettings: Settings = {
  model: "bytedance/seedance-2.0",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 8,
  generateAudio: true,
  cameraFixed: false,
};

const allowedModels = new Set<SeedanceModel>([
  "bytedance/seedance-2.0",
  "bytedance/seedance-2.0-fast",
]);
const allowedAspectRatios = new Set<AspectRatio>([
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
]);
const allowedResolutions = new Set<Resolution>(["480p", "720p", "1080p"]);
const allowedKinds = new Set<AssetKind>(["image", "video", "audio"]);

function setupNeeded(message: string) {
  return NextResponse.json({ status: "setup-needed", message });
}

function failed(message: string, status = 400) {
  return NextResponse.json({ status: "failed", message }, { status });
}

function sanitizeSettings(value: unknown): Settings {
  if (!value || typeof value !== "object") return defaultSettings;
  const parsed = value as Partial<Settings>;
  const duration = Number(parsed.duration);

  return {
    model:
      parsed.model && allowedModels.has(parsed.model)
        ? parsed.model
        : defaultSettings.model,
    aspectRatio:
      parsed.aspectRatio && allowedAspectRatios.has(parsed.aspectRatio)
        ? parsed.aspectRatio
        : defaultSettings.aspectRatio,
    resolution:
      parsed.resolution && allowedResolutions.has(parsed.resolution)
        ? parsed.resolution
        : defaultSettings.resolution,
    duration: Number.isFinite(duration)
      ? Math.min(12, Math.max(4, duration))
      : defaultSettings.duration,
    generateAudio: parsed.generateAudio ?? defaultSettings.generateAudio,
    cameraFixed: parsed.cameraFixed ?? defaultSettings.cameraFixed,
  };
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

function normalizePrompt(prompt: string, references: ReferenceInput[]) {
  const counters: Record<AssetKind, number> = { image: 0, video: 0, audio: 0 };
  return references.reduce((current, reference) => {
    counters[reference.kind] += 1;
    const label =
      reference.kind === "image"
        ? `[Image ${counters.image}]`
        : reference.kind === "video"
          ? `[Video ${counters.video}]`
          : `[Audio ${counters.audio}]`;
    const pattern = new RegExp(`@${escapeRegExp(reference.handle)}\\b`, "gi");
    return current.replace(pattern, label);
  }, prompt);
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
  const settings = sanitizeSettings(body.settings);
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

  if (!sourceImage) {
    return failed("At least one image reference is required.");
  }

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
      cameraFixed: settings.cameraFixed,
      watermark: false,
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

    const result = await generateVideo({
      model: gateway.video(settings.model),
      prompt: {
        image: sourceImage.url,
        text: normalizedPrompt,
      },
      aspectRatio: settings.aspectRatio,
      resolution: settings.resolution as `${number}x${number}`,
      duration: settings.duration,
      providerOptions,
      abortSignal: AbortSignal.timeout(600000),
    });
    const video = result.videos[0] ?? result.video;
    if (!video) {
      return failed("The model did not return a video.", 502);
    }

    const extension = video.mediaType.includes("webm") ? "webm" : "mp4";
    const output = await uploadObjectToR2({
      key: createStorageKey({
        ...scope,
        area: "outputs",
        filename: `seedance-output.${extension}`,
      }),
      body: Buffer.from(video.uint8Array),
      contentType: video.mediaType || "video/mp4",
    });

    return NextResponse.json({
      status: "ready",
      model: settings.model,
      videoUrl: output.url,
      downloadUrl: output.downloadUrl,
      storageKey: output.key,
      sourceImageUrl: sourceImage.url,
    });
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Video generation failed.",
      500,
    );
  }
}
