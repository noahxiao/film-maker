// Gateway keeps provider-specific names behind AI SDK fields. These values
// mirror Seedance 2.0's current upstream ranges while preserving that SDK shape.
export const seedanceModelOptions = [
  { value: "bytedance/seedance-2.0", label: "Standard" },
  { value: "bytedance/seedance-2.0-fast", label: "Fast" },
] as const;

export const seedanceAspectRatioOptions = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1", label: "1:1" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9" },
  { value: "adaptive", label: "Auto" },
] as const;

export const seedanceResolutionOptions = [
  { value: "480p", label: "480" },
  { value: "720p", label: "720" },
  { value: "1080p", label: "1080" },
] as const;

const seedanceFastResolutionOptions = seedanceResolutionOptions.filter(
  (option) => option.value !== "1080p",
);

export const seedanceDuration = {
  min: 4,
  max: 15,
  default: 10,
  smart: -1,
} as const;

export type SeedanceModel = (typeof seedanceModelOptions)[number]["value"];
export type SeedanceAspectRatio =
  (typeof seedanceAspectRatioOptions)[number]["value"];
export type SeedanceResolution =
  (typeof seedanceResolutionOptions)[number]["value"];

export type VideoSettings = {
  model: SeedanceModel;
  aspectRatio: SeedanceAspectRatio;
  resolution: SeedanceResolution;
  duration: number;
  generateAudio: boolean;
};

export const defaultVideoSettings: VideoSettings = {
  model: "bytedance/seedance-2.0",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: seedanceDuration.default,
  generateAudio: true,
};

const allowedModels = new Set<SeedanceModel>(
  seedanceModelOptions.map((option) => option.value),
);
const allowedAspectRatios = new Set<SeedanceAspectRatio>(
  seedanceAspectRatioOptions.map((option) => option.value),
);
const allowedResolutions = new Set<SeedanceResolution>(
  seedanceResolutionOptions.map((option) => option.value),
);

export function getSeedanceResolutionOptions(model: SeedanceModel) {
  return model === "bytedance/seedance-2.0-fast"
    ? seedanceFastResolutionOptions
    : seedanceResolutionOptions;
}

function sanitizeDuration(value: unknown) {
  const duration = Number(value);
  if (!Number.isFinite(duration)) return defaultVideoSettings.duration;
  if (duration === seedanceDuration.smart) return seedanceDuration.smart;

  return Math.min(
    seedanceDuration.max,
    Math.max(seedanceDuration.min, Math.round(duration)),
  );
}

export function formatSeedanceDuration(duration: number) {
  return duration === seedanceDuration.smart ? "Auto" : `${duration}s`;
}

export function formatSeedanceAspectRatio(aspectRatio: SeedanceAspectRatio) {
  return aspectRatio === "adaptive" ? "Auto" : aspectRatio;
}

export function sanitizeVideoSettings(value: unknown): VideoSettings {
  if (!value || typeof value !== "object") return { ...defaultVideoSettings };
  const parsed = value as Partial<VideoSettings>;
  const model =
    parsed.model && allowedModels.has(parsed.model)
      ? parsed.model
      : defaultVideoSettings.model;
  const modelResolutionOptions = new Set(
    getSeedanceResolutionOptions(model).map((option) => option.value),
  );

  return {
    model,
    aspectRatio:
      parsed.aspectRatio && allowedAspectRatios.has(parsed.aspectRatio)
        ? parsed.aspectRatio
        : defaultVideoSettings.aspectRatio,
    resolution:
      parsed.resolution &&
      allowedResolutions.has(parsed.resolution) &&
      modelResolutionOptions.has(parsed.resolution)
        ? parsed.resolution
        : defaultVideoSettings.resolution,
    duration: sanitizeDuration(parsed.duration),
    generateAudio:
      typeof parsed.generateAudio === "boolean"
        ? parsed.generateAudio
        : defaultVideoSettings.generateAudio,
  };
}
