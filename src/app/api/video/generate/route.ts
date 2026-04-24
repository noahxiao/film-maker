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
type Settings = {
  model: SeedanceModel;
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  resolution: "480p" | "720p" | "1080p";
  duration: number;
  generateAudio: boolean;
  cameraFixed: boolean;
};

type UploadedReference = {
  handle: string;
  kind: AssetKind;
  key: string;
  url: string;
  downloadUrl: string;
  contentType: string;
};
type StorageScope = {
  tenantId: string;
  userId: string;
  folder: string;
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
const allowedAspectRatios = new Set<Settings["aspectRatio"]>([
  "16:9",
  "9:16",
  "1:1",
  "4:3",
  "3:4",
]);
const allowedResolutions = new Set<Settings["resolution"]>([
  "480p",
  "720p",
  "1080p",
]);
const maxFileSize = 50 * 1024 * 1024;

function setupNeeded(message: string) {
  return NextResponse.json({
    status: "setup-needed",
    message,
  });
}

function failed(message: string, status = 400) {
  return NextResponse.json({ status: "failed", message }, { status });
}

function parseSettings(value: FormDataEntryValue | null): Settings {
  if (typeof value !== "string") return defaultSettings;

  try {
    const parsed = JSON.parse(value) as Partial<Settings>;
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
  } catch {
    return defaultSettings;
  }
}

function getStringValue(
  formData: FormData,
  key: string,
  fallback: string,
): string {
  const value = formData.get(key);
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return value.trim();
}

function getKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function sanitizePathSegment(value: string) {
  return (
    value
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 90) || "asset"
  );
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizePrompt(prompt: string, references: UploadedReference[]) {
  const counters: Record<AssetKind, number> = {
    image: 0,
    video: 0,
    audio: 0,
  };

  return references.reduce((currentPrompt, reference) => {
    counters[reference.kind] += 1;
    const label =
      reference.kind === "image"
        ? `[Image ${counters.image}]`
        : reference.kind === "video"
          ? `[Video ${counters.video}]`
          : `[Audio ${counters.audio}]`;
    const pattern = new RegExp(`@${escapeRegExp(reference.handle)}\\b`, "gi");
    return currentPrompt.replace(pattern, label);
  }, prompt);
}

function hasGatewayAuth() {
  return Boolean(
    process.env.AI_GATEWAY_API_KEY ||
      process.env.VERCEL_OIDC_TOKEN ||
      process.env.VERCEL === "1",
  );
}

async function uploadReference(
  file: File,
  handle: string,
  index: number,
  scope: StorageScope,
) {
  const kind = getKind(file);
  if (!kind) {
    throw new Error(`${file.name} is not an image, video, or audio file.`);
  }

  if (file.size > maxFileSize) {
    throw new Error(`${file.name} exceeds the 50 MB per-file limit.`);
  }

  const contentType = file.type || "application/octet-stream";
  const key = createStorageKey({
    ...scope,
    area: "references",
    filename: `${index}-${sanitizePathSegment(file.name)}`,
  });
  const object = await uploadObjectToR2({
    key,
    body: Buffer.from(await file.arrayBuffer()),
    contentType,
  });

  return {
    handle,
    kind,
    key: object.key,
    url: object.url,
    downloadUrl: object.downloadUrl,
    contentType: object.contentType,
  } satisfies UploadedReference;
}

export async function POST(request: Request) {
  let formData: FormData;

  try {
    formData = await request.formData();
  } catch {
    return failed("Expected multipart form data.");
  }

  const prompt = String(formData.get("prompt") ?? "").trim();
  const settings = parseSettings(formData.get("settings"));
  const files = formData
    .getAll("files")
    .filter((value): value is File => value instanceof File && value.size > 0);
  const handles = formData
    .getAll("handles")
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const scope = {
    tenantId: getStringValue(formData, "tenantId", "demo-tenant"),
    userId: getStringValue(formData, "userId", "demo-user"),
    folder: getStringValue(formData, "folder", "default"),
  } satisfies StorageScope;

  if (prompt.length === 0) {
    return failed("Prompt is required.");
  }

  if (files.length === 0) {
    return failed("Upload at least one image asset before generating.");
  }

  if (!files.some((file) => getKind(file) === "image")) {
    return failed("Seedance image-to-video needs at least one image reference.");
  }

  if (!hasGatewayAuth()) {
    return setupNeeded(
      "Connect Vercel AI Gateway first. Add AI_GATEWAY_API_KEY locally, or deploy on Vercel with OIDC enabled.",
    );
  }

  const missingR2Env = getMissingR2Env();
  if (missingR2Env.length > 0) {
    return setupNeeded(
      `Connect Cloudflare R2 first. Missing: ${missingR2Env.join(", ")}.`,
    );
  }

  try {
    const uploadedReferences = await Promise.all(
      files.map((file, index) =>
        uploadReference(
          file,
          handles[index] || `Asset${index + 1}`,
          index,
          scope,
        ),
      ),
    );
    const imageReferences = uploadedReferences.filter(
      (reference) => reference.kind === "image",
    );
    const videoReferences = uploadedReferences.filter(
      (reference) => reference.kind === "video",
    );

    const sourceImage = imageReferences[0];
    const normalizedPrompt = normalizePrompt(prompt, uploadedReferences);
    const bytedanceOptions: ProviderJsonObject = {
      generateAudio: settings.generateAudio,
      cameraFixed: settings.cameraFixed,
      watermark: false,
      pollTimeoutMs: 600000,
    };

    if (imageReferences.length > 0) {
      bytedanceOptions.referenceImages = imageReferences.map(
        (reference) => reference.url,
      );
    }

    if (videoReferences.length > 0) {
      bytedanceOptions.referenceVideos = videoReferences.map(
        (reference) => reference.url,
      );
    }

    const providerOptions: Record<string, ProviderJsonObject> = {
      gateway: {
        user: "film-maker-demo",
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
      uploadedReferences: uploadedReferences.map((reference) => ({
        handle: reference.handle,
        kind: reference.kind,
        key: reference.key,
        url: reference.url,
      })),
      warnings: result.warnings,
      providerMetadata: result.providerMetadata,
    });
  } catch (error) {
    return failed(
      error instanceof Error ? error.message : "Video generation failed.",
      500,
    );
  }
}
