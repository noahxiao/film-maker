"use client";

import { Button, Card, Chip } from "@heroui/react";
import {
  Download,
  ExternalLink,
  FileAudio,
  FileImage,
  FileVideo,
  Loader2,
  Play,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import {
  ChangeEvent,
  KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

type AssetKind = "image" | "video" | "audio";
type JobStatus = "idle" | "generating" | "ready" | "setup-needed" | "failed";
type SeedanceModel = "bytedance/seedance-2.0" | "bytedance/seedance-2.0-fast";
type AspectRatio = "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
type Resolution = "480p" | "720p" | "1080p";

type Asset = {
  id: string;
  name: string;
  handle: string;
  kind: AssetKind;
  mimeType: string;
  size: number;
  file: File;
  previewUrl: string;
};

type GenerationResponse = {
  status: "ready" | "setup-needed" | "failed";
  message?: string;
  videoUrl?: string;
  downloadUrl?: string;
  sourceImageUrl?: string;
  model?: string;
  uploadedReferences?: UploadedReference[];
};

type UploadedReference = {
  handle: string;
  kind: AssetKind;
  url: string;
};

type Settings = {
  model: SeedanceModel;
  aspectRatio: AspectRatio;
  resolution: Resolution;
  duration: number;
  generateAudio: boolean;
  cameraFixed: boolean;
};

const defaultSettings: Settings = {
  model: "bytedance/seedance-2.0",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 8,
  generateAudio: true,
  cameraFixed: false,
};

const kindMeta = {
  image: {
    label: "Image",
    Icon: FileImage,
    accept: "image/png,image/jpeg,image/webp",
  },
  video: {
    label: "Video",
    Icon: FileVideo,
    accept: "video/mp4,video/quicktime,video/webm",
  },
  audio: {
    label: "Audio",
    Icon: FileAudio,
    accept: "audio/mpeg,audio/wav,audio/mp4,audio/aac,audio/ogg",
  },
} satisfies Record<
  AssetKind,
  { label: string; Icon: typeof FileImage; accept: string }
>;

function getAssetKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function formatBytes(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function baseName(name: string) {
  return name.replace(/\.[^/.]+$/, "");
}

function createHandle(name: string, index: number) {
  const clean = baseName(name)
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 28);

  return clean || `Asset${index + 1}`;
}

function uniqueHandle(handle: string, assets: Asset[], incoming: string[]) {
  const taken = new Set([
    ...assets.map((asset) => asset.handle.toLowerCase()),
    ...incoming.map((value) => value.toLowerCase()),
  ]);

  if (!taken.has(handle.toLowerCase())) return handle;

  let count = 2;
  while (taken.has(`${handle}${count}`.toLowerCase())) {
    count += 1;
  }

  return `${handle}${count}`;
}

function parseMentionHandles(prompt: string) {
  return new Set(
    Array.from(prompt.matchAll(/@([a-zA-Z0-9_-]+)/g)).map((match) =>
      match[1].toLowerCase(),
    ),
  );
}

function getMentionQuery(prompt: string, caretPosition: number) {
  const beforeCursor = prompt.slice(0, caretPosition);
  const match = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
  return match?.[1] ?? null;
}

export function VideoCreator() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [explicitReferences, setExplicitReferences] = useState<Set<string>>(
    () => new Set(),
  );
  const [prompt, setPrompt] = useState("");
  const [settings, setSettings] = useState<Settings>(defaultSettings);
  const [status, setStatus] = useState<JobStatus>("idle");
  const [message, setMessage] = useState("");
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [sourceImageUrl, setSourceImageUrl] = useState<string | null>(null);
  const [uploadedReferences, setUploadedReferences] = useState<
    UploadedReference[]
  >([]);
  const [caretPosition, setCaretPosition] = useState(prompt.length);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const assetsRef = useRef<Asset[]>([]);

  useEffect(() => {
    assetsRef.current = assets;
  }, [assets]);

  useEffect(() => {
    return () => {
      assetsRef.current.forEach((asset) => URL.revokeObjectURL(asset.previewUrl));
    };
  }, []);

  const mentionHandles = useMemo(() => parseMentionHandles(prompt), [prompt]);

  const referencedAssets = useMemo(
    () =>
      assets.filter(
        (asset) =>
          explicitReferences.has(asset.id) ||
          mentionHandles.has(asset.handle.toLowerCase()),
      ),
    [assets, explicitReferences, mentionHandles],
  );

  const imageReferences = referencedAssets.filter(
    (asset) => asset.kind === "image",
  );

  const mentionQuery = getMentionQuery(prompt, caretPosition);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];

    return assets
      .filter((asset) =>
        asset.handle.toLowerCase().includes(mentionQuery.toLowerCase()),
      )
      .slice(0, 6);
  }, [assets, mentionQuery]);

  const selectedSource =
    imageReferences[0] ?? assets.find((asset) => asset.kind === "image");
  const canGenerate =
    prompt.trim().length > 0 && !!selectedSource && status !== "generating";

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function syncCaret() {
    setCaretPosition(promptRef.current?.selectionStart ?? prompt.length);
  }

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    const handles: string[] = [];
    const incomingAssets = files.flatMap((file, index) => {
      const kind = getAssetKind(file);
      if (!kind) return [];

      const proposedHandle = createHandle(file.name, assets.length + index);
      const handle = uniqueHandle(proposedHandle, assets, handles);
      handles.push(handle);

      return {
        id: crypto.randomUUID(),
        name: file.name,
        handle,
        kind,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        file,
        previewUrl: URL.createObjectURL(file),
      };
    });

    if (incomingAssets.length === 0) {
      event.target.value = "";
      return;
    }

    setAssets((current) => [...current, ...incomingAssets]);

    const firstIncomingImage = incomingAssets.find(
      (asset) => asset.kind === "image",
    );
    if (firstIncomingImage && imageReferences.length === 0) {
      setExplicitReferences((current) => {
        const next = new Set(current);
        next.add(firstIncomingImage.id);
        return next;
      });

      if (!parseMentionHandles(prompt).has(firstIncomingImage.handle.toLowerCase())) {
        setPrompt((current) =>
          current.trim().length === 0
            ? `@${firstIncomingImage.handle} `
            : current.replace("@Image1", `@${firstIncomingImage.handle}`),
        );
      }
    }

    event.target.value = "";
  }

  function removeAsset(asset: Asset) {
    URL.revokeObjectURL(asset.previewUrl);
    setAssets((current) => current.filter((item) => item.id !== asset.id));
    setExplicitReferences((current) => {
      const next = new Set(current);
      next.delete(asset.id);
      return next;
    });
  }

  function toggleReference(asset: Asset) {
    setExplicitReferences((current) => {
      const next = new Set(current);
      if (next.has(asset.id)) {
        next.delete(asset.id);
      } else {
        next.add(asset.id);
      }
      return next;
    });
  }

  function insertReference(asset: Asset) {
    const textarea = promptRef.current;
    const currentCaret = textarea?.selectionStart ?? prompt.length;
    const query = getMentionQuery(prompt, currentCaret);
    const before = prompt.slice(0, currentCaret);
    const after = prompt.slice(currentCaret);
    const replaceStart =
      query === null ? currentCaret : before.lastIndexOf("@");
    const nextPrompt = `${prompt.slice(0, replaceStart)}@${asset.handle} ${after}`;

    setPrompt(nextPrompt);
    setExplicitReferences((current) => {
      const next = new Set(current);
      next.add(asset.id);
      return next;
    });

    requestAnimationFrame(() => {
      const nextCaret = replaceStart + asset.handle.length + 2;
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(nextCaret, nextCaret);
      setCaretPosition(nextCaret);
    });
  }

  function handlePromptKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (
      event.key === "Enter" &&
      (event.metaKey || event.ctrlKey) &&
      canGenerate
    ) {
      event.preventDefault();
      void generateVideo();
    }
  }

  async function generateVideo() {
    const references =
      referencedAssets.length > 0
        ? referencedAssets
        : selectedSource
          ? [selectedSource]
          : [];
    const sourceImage = references.find((asset) => asset.kind === "image");

    if (!sourceImage) {
      setStatus("failed");
      setMessage("Upload or reference at least one image before generating.");
      return;
    }

    setStatus("generating");
    setMessage("Generating with Seedance 2.0.");
    setVideoUrl(null);
    setDownloadUrl(null);
    setSourceImageUrl(null);
    setUploadedReferences([]);

    try {
      const formData = new FormData();
      formData.set("prompt", prompt);
      formData.set("settings", JSON.stringify(settings));

      references.forEach((asset) => {
        formData.append("files", asset.file, asset.name);
        formData.append("handles", asset.handle);
      });

      const response = await fetch("/api/video/generate", {
        method: "POST",
        body: formData,
      });
      const data = (await response.json()) as GenerationResponse;

      if (!response.ok || data.status === "failed") {
        setStatus("failed");
        setMessage(data.message ?? "Video generation failed.");
        return;
      }

      if (data.status === "setup-needed") {
        setStatus("setup-needed");
        setMessage(data.message ?? "Connect AI Gateway and Vercel Blob.");
        return;
      }

      setStatus("ready");
      setMessage(`Generated with ${data.model ?? settings.model}.`);
      setVideoUrl(data.videoUrl ?? null);
      setDownloadUrl(data.downloadUrl ?? data.videoUrl ?? null);
      setSourceImageUrl(data.sourceImageUrl ?? null);
      setUploadedReferences(data.uploadedReferences ?? []);
    } catch (error) {
      setStatus("failed");
      setMessage(
        error instanceof Error ? error.message : "Video generation failed.",
      );
    }
  }

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        accept={Object.values(kindMeta)
          .map((entry) => entry.accept)
          .join(",")}
        multiple
        onChange={handleFiles}
      />

      <header className="border-b border-black/10 bg-white/80 px-5 py-4 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-md bg-black text-white">
              <Wand2 size={19} aria-hidden="true" />
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/45">
                Film Maker
              </p>
              <h1 className="text-xl font-semibold tracking-normal">
                Seedance 2.0 Creator
              </h1>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Chip color="accent" variant="soft">
              AI Gateway
            </Chip>
            <Chip color="success" variant="soft">
              Vercel Blob
            </Chip>
          </div>
        </div>
      </header>

      <section className="mx-auto grid w-full max-w-7xl flex-1 gap-4 px-4 py-4 lg:grid-cols-[260px_minmax(0,1fr)_340px]">
        <aside className="flex min-h-[560px] flex-col rounded-lg border border-black/10 bg-white">
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/50">
                Assets
              </p>
              <p className="text-sm text-black/55">{assets.length} uploaded</p>
            </div>
            <Button
              isIconOnly
              size="sm"
              variant="primary"
              onPress={openFilePicker}
              aria-label="Upload assets"
            >
              <Plus size={16} aria-hidden="true" />
            </Button>
          </div>

          <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
            {assets.length === 0 ? (
              <button
                type="button"
                className="flex min-h-64 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-black/20 bg-[#f3f5f6] p-5 text-center text-sm text-black/55 transition hover:border-black/35 hover:text-black"
                onClick={openFilePicker}
              >
                <Upload size={20} aria-hidden="true" />
                <span>Upload image, video, or audio assets</span>
              </button>
            ) : (
              assets.map((asset) => {
                const Icon = kindMeta[asset.kind].Icon;
                const isReferenced = referencedAssets.some(
                  (item) => item.id === asset.id,
                );

                return (
                  <div
                    key={asset.id}
                    className={`group rounded-md border p-2 transition ${
                      isReferenced
                        ? "border-[#5b7cfa] bg-[#eef2ff]"
                        : "border-black/10 bg-white hover:border-black/25"
                    }`}
                  >
                    <button
                      type="button"
                      className="flex w-full items-center gap-3 text-left"
                      onClick={() => toggleReference(asset)}
                    >
                      <div className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-[#e8ecef] text-black/55">
                        {asset.kind === "image" ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={asset.previewUrl}
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : asset.kind === "video" ? (
                          <video
                            src={asset.previewUrl}
                            className="h-full w-full object-cover"
                            muted
                          />
                        ) : (
                          <Icon size={19} aria-hidden="true" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <Icon
                            size={14}
                            className="shrink-0 text-black/45"
                            aria-hidden="true"
                          />
                          <p className="truncate text-sm font-medium">
                            {asset.name}
                          </p>
                        </div>
                        <p className="truncate font-mono text-xs text-[#4a62d8]">
                          @{asset.handle}
                        </p>
                        <p className="text-xs text-black/45">
                          {kindMeta[asset.kind].label} - {formatBytes(asset.size)}
                        </p>
                      </div>
                    </button>
                    <div className="mt-2 flex items-center justify-between gap-2">
                      <button
                        type="button"
                        className="rounded px-2 py-1 text-xs font-medium text-black/55 hover:bg-black/5 hover:text-black"
                        onClick={() => insertReference(asset)}
                      >
                        Insert
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-black/35 hover:bg-[#fff0ef] hover:text-[#b42318]"
                        onClick={() => removeAsset(asset)}
                        aria-label={`Remove ${asset.name}`}
                      >
                        <Trash2 size={15} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </aside>

        <section className="flex min-h-[560px] flex-col gap-4">
          <Card
            className="!rounded-lg border-black/10 bg-white shadow-sm"
            variant="default"
          >
            <Card.Header className="flex items-start justify-between gap-4">
              <div>
                <Card.Title>Prompt</Card.Title>
                <Card.Description>
                  {referencedAssets.length} references selected
                </Card.Description>
              </div>
              <Chip color={status === "ready" ? "success" : "accent"} variant="soft">
                {settings.model.endsWith("fast") ? "Fast" : "Standard"}
              </Chip>
            </Card.Header>
            <Card.Content className="space-y-4">
              <div className="relative">
                <textarea
                  ref={promptRef}
                  value={prompt}
                  rows={7}
                  onChange={(event) => {
                    setPrompt(event.target.value);
                    setCaretPosition(event.target.selectionStart);
                  }}
                  onClick={syncCaret}
                  onKeyUp={syncCaret}
                  onSelect={syncCaret}
                  onKeyDown={handlePromptKeyDown}
                  className="min-h-44 w-full resize-none rounded-lg border border-black/10 bg-[#fbfcfc] px-4 py-4 text-lg leading-8 outline-none transition placeholder:text-black/30 focus:border-[#5b7cfa] focus:bg-white focus:ring-4 focus:ring-[#5b7cfa]/10"
                  placeholder="A cinematic shot begins from the first frame, then..."
                />

                {mentionMatches.length > 0 ? (
                  <div className="absolute left-4 top-[calc(100%-0.5rem)] z-20 w-72 overflow-hidden rounded-md border border-black/10 bg-white shadow-xl">
                    {mentionMatches.map((asset) => {
                      const Icon = kindMeta[asset.kind].Icon;

                      return (
                        <button
                          key={asset.id}
                          type="button"
                          className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[#eef2ff]"
                          onClick={() => insertReference(asset)}
                        >
                          <Icon size={16} aria-hidden="true" />
                          <span className="min-w-0 flex-1 truncate text-sm font-medium">
                            @{asset.handle}
                          </span>
                          <span className="text-xs text-black/45">
                            {kindMeta[asset.kind].label}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                ) : null}
              </div>

              <div className="flex flex-wrap gap-2">
                {referencedAssets.length === 0 ? (
                  <span className="rounded-full border border-dashed border-black/15 px-3 py-1 text-sm text-black/45">
                    No references
                  </span>
                ) : (
                  referencedAssets.map((asset) => (
                    <button
                      key={asset.id}
                      type="button"
                      className="rounded-full border border-[#5b7cfa]/25 bg-[#eef2ff] px-3 py-1 font-mono text-sm text-[#3447ad]"
                      onClick={() => insertReference(asset)}
                    >
                      @{asset.handle}
                    </button>
                  ))
                )}
              </div>
            </Card.Content>
          </Card>

          <div className="grid gap-4 md:grid-cols-[1fr_280px]">
            <Card
              className="!rounded-lg border-black/10 bg-white shadow-sm"
              variant="default"
            >
              <Card.Header>
                <Card.Title>Generation</Card.Title>
                <Card.Description>Seedance 2.0 image-to-video</Card.Description>
              </Card.Header>
              <Card.Content className="grid gap-3 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                    Model
                  </span>
                  <select
                    value={settings.model}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        model: event.target.value as SeedanceModel,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#5b7cfa]"
                  >
                    <option value="bytedance/seedance-2.0">Standard</option>
                    <option value="bytedance/seedance-2.0-fast">Fast</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                    Aspect
                  </span>
                  <select
                    value={settings.aspectRatio}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        aspectRatio: event.target.value as AspectRatio,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#5b7cfa]"
                  >
                    <option value="16:9">16:9</option>
                    <option value="9:16">9:16</option>
                    <option value="1:1">1:1</option>
                    <option value="4:3">4:3</option>
                    <option value="3:4">3:4</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                    Resolution
                  </span>
                  <select
                    value={settings.resolution}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        resolution: event.target.value as Resolution,
                      }))
                    }
                    className="h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#5b7cfa]"
                  >
                    <option value="480p">480p</option>
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                  </select>
                </label>

                <label className="space-y-1">
                  <span className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                    Duration
                  </span>
                  <input
                    type="number"
                    min={4}
                    max={12}
                    value={settings.duration}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        duration: Number(event.target.value),
                      }))
                    }
                    className="h-10 w-full rounded-md border border-black/10 bg-white px-3 text-sm outline-none focus:border-[#5b7cfa]"
                  />
                </label>

                <label className="flex items-center gap-3 rounded-md border border-black/10 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.generateAudio}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        generateAudio: event.target.checked,
                      }))
                    }
                  />
                  Audio
                </label>

                <label className="flex items-center gap-3 rounded-md border border-black/10 px-3 py-2 text-sm">
                  <input
                    type="checkbox"
                    checked={settings.cameraFixed}
                    onChange={(event) =>
                      setSettings((current) => ({
                        ...current,
                        cameraFixed: event.target.checked,
                      }))
                    }
                  />
                  Fixed camera
                </label>
              </Card.Content>
            </Card>

            <div className="flex flex-col justify-end gap-3 rounded-lg border border-black/10 bg-[#101216] p-4 text-white">
              <div className="space-y-2">
                <div className="flex items-center gap-2 text-sm text-white/55">
                  <Sparkles size={15} aria-hidden="true" />
                  <span>Output job</span>
                </div>
                <p className="text-2xl font-semibold">
                  {status === "generating"
                    ? "Generating"
                    : status === "ready"
                      ? "Ready"
                      : status === "failed"
                        ? "Failed"
                        : status === "setup-needed"
                          ? "Setup"
                          : "Idle"}
                </p>
                <p className="min-h-10 text-sm leading-5 text-white/60">
                  {message ||
                    "Upload a source image, reference it, then run the job."}
                </p>
              </div>

              <Button
                fullWidth
                variant="primary"
                isDisabled={!canGenerate}
                onPress={() => void generateVideo()}
                className="bg-white text-black hover:bg-white/90"
              >
                {status === "generating" ? (
                  <Loader2 className="animate-spin" size={17} aria-hidden="true" />
                ) : (
                  <Send size={17} aria-hidden="true" />
                )}
                Generate
              </Button>
            </div>
          </div>
        </section>

        <aside className="flex min-h-[560px] flex-col rounded-lg border border-black/10 bg-white">
          <div className="flex items-center justify-between border-b border-black/10 px-4 py-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.22em] text-black/50">
                Preview
              </p>
              <p className="text-sm text-black/55">MP4 output</p>
            </div>
            {videoUrl ? (
              <Chip color="success" variant="soft">
                Ready
              </Chip>
            ) : null}
          </div>

          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex aspect-video items-center justify-center overflow-hidden rounded-lg border border-black/10 bg-[#12161d]">
              {status === "generating" ? (
                <div className="flex flex-col items-center gap-3 text-white/70">
                  <Loader2 className="animate-spin" size={28} aria-hidden="true" />
                  <span className="text-sm">Rendering video</span>
                </div>
              ) : videoUrl ? (
                <video
                  key={videoUrl}
                  src={videoUrl}
                  controls
                  className="h-full w-full object-contain"
                />
              ) : sourceImageUrl || selectedSource ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={sourceImageUrl ?? selectedSource?.previewUrl}
                  alt=""
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex flex-col items-center gap-3 text-white/55">
                  <Play size={28} aria-hidden="true" />
                  <span className="text-sm">No preview</span>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                isDisabled={!videoUrl}
                onPress={() => {
                  if (videoUrl) window.open(videoUrl, "_blank", "noopener");
                }}
              >
                <ExternalLink size={16} aria-hidden="true" />
                Open
              </Button>
              <Button
                variant="outline"
                isDisabled={!downloadUrl}
                onPress={() => {
                  if (!downloadUrl) return;
                  const anchor = document.createElement("a");
                  anchor.href = downloadUrl;
                  anchor.download = "seedance-output.mp4";
                  anchor.click();
                }}
              >
                <Download size={16} aria-hidden="true" />
                Download
              </Button>
            </div>

            {uploadedReferences.length > 0 ? (
              <div className="space-y-2 rounded-md border border-black/10 bg-[#f7f8f9] p-3">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-black/45">
                  Uploaded
                </p>
                <div className="space-y-1">
                  {uploadedReferences.map((reference) => (
                    <a
                      key={`${reference.kind}-${reference.handle}-${reference.url}`}
                      href={reference.url}
                      target="_blank"
                      rel="noreferrer"
                      className="block truncate font-mono text-xs text-[#4a62d8] hover:underline"
                    >
                      @{reference.handle}
                    </a>
                  ))}
                </div>
              </div>
            ) : null}

            {status === "setup-needed" ? (
              <div className="rounded-md border border-[#f2b84b]/35 bg-[#fff7e8] p-3 text-sm leading-6 text-[#744600]">
                {message}
              </div>
            ) : null}
          </div>
        </aside>
      </section>
    </main>
  );
}
