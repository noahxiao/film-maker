"use client";

import {
  ArrowUp,
  AtSign,
  Clapperboard,
  Download,
  Film,
  Image as ImageIcon,
  Loader2,
  Music,
  Paperclip,
  Plus,
  Settings2,
  Sparkles,
  Trash2,
  Video as VideoIcon,
  X,
} from "lucide-react";
import {
  type ChangeEvent,
  type DragEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  type AssetKind,
  type Generation,
  type Project,
  type ProjectAsset,
  type Settings,
  useProjects,
} from "@/lib/projects";

type UploadItem = {
  id: string;
  name: string;
  progress: number;
  error?: string;
};

type MentionMatch = ProjectAsset & { score: number };

const kindIcon: Record<AssetKind, typeof ImageIcon> = {
  image: ImageIcon,
  video: VideoIcon,
  audio: Music,
};

const kindLabel: Record<AssetKind, string> = {
  image: "Image",
  video: "Video",
  audio: "Audio",
};

function getKind(file: File): AssetKind | null {
  if (file.type.startsWith("image/")) return "image";
  if (file.type.startsWith("video/")) return "video";
  if (file.type.startsWith("audio/")) return "audio";
  return null;
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function baseName(name: string) {
  return name.replace(/\.[^/.]+$/, "");
}

function suggestHandle(name: string, kind: AssetKind, existing: Set<string>) {
  const prefix =
    kind === "image" ? "Image" : kind === "video" ? "Video" : "Audio";
  const clean = baseName(name)
    .replace(/[^a-zA-Z0-9]+/g, "")
    .slice(0, 20);
  const candidate = clean.length > 0 ? clean : prefix;
  if (!existing.has(candidate.toLowerCase())) return candidate;
  let n = 2;
  while (existing.has(`${candidate}${n}`.toLowerCase())) n += 1;
  return `${candidate}${n}`;
}

function parseMentions(prompt: string): Set<string> {
  return new Set(
    Array.from(prompt.matchAll(/@([a-zA-Z0-9_-]+)/g)).map((m) =>
      m[1].toLowerCase(),
    ),
  );
}

function getMentionQuery(prompt: string, caret: number) {
  const before = prompt.slice(0, caret);
  const m = before.match(/(?:^|\s)@([a-zA-Z0-9_-]*)$/);
  return m?.[1] ?? null;
}

function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatDateShort(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function VideoCreator() {
  const projectApi = useProjects();
  const { activeProject, updateActive } = projectApi;

  if (!projectApi.hydrated || !activeProject) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[var(--paper)]">
        <div className="shimmer h-2 w-48 rounded-full" />
      </main>
    );
  }

  return (
    <Workspace
      key={activeProject.id}
      project={activeProject}
      projectApi={projectApi}
      updateActive={updateActive}
    />
  );
}

function Workspace({
  project,
  projectApi,
  updateActive,
}: {
  project: Project;
  projectApi: ReturnType<typeof useProjects>;
  updateActive: ReturnType<typeof useProjects>["updateActive"];
}) {
  const [prompt, setPrompt] = useState("");
  const [caret, setCaret] = useState(0);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [deleting, setDeleting] = useState<Set<string>>(() => new Set());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [banner, setBanner] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const promptRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const settingsRef = useRef<HTMLDivElement>(null);
  const dragCounter = useRef(0);

  const { assets, generations, settings } = project;

  useEffect(() => {
    if (conversationRef.current) {
      conversationRef.current.scrollTo({
        top: conversationRef.current.scrollHeight,
        behavior: "smooth",
      });
    }
  }, [generations.length]);

  useEffect(() => {
    if (!settingsOpen) return;
    const onClick = (e: MouseEvent) => {
      if (
        settingsRef.current &&
        !settingsRef.current.contains(e.target as Node)
      ) {
        setSettingsOpen(false);
      }
    };
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [settingsOpen]);

  const mentionSet = useMemo(() => parseMentions(prompt), [prompt]);

  const referencedAssets = useMemo(
    () =>
      assets.filter((asset) => mentionSet.has(asset.handle.toLowerCase())),
    [assets, mentionSet],
  );

  const activeAssetKeys = useMemo(
    () => new Set(assets.map((a) => a.key ?? a.url)),
    [assets],
  );

  const mentionQuery = getMentionQuery(prompt, caret);
  const mentionMatches: MentionMatch[] = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return assets
      .map((asset) => {
        const handle = asset.handle.toLowerCase();
        if (q.length === 0) return { ...asset, score: 1 };
        if (handle.startsWith(q)) return { ...asset, score: 3 };
        if (handle.includes(q)) return { ...asset, score: 2 };
        return { ...asset, score: 0 };
      })
      .filter((m) => m.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6);
  }, [assets, mentionQuery]);

  const canGenerate =
    prompt.trim().length > 0 &&
    referencedAssets.some((a) => a.kind === "image") &&
    !generating;

  const hintNeedsImage =
    prompt.trim().length > 0 &&
    !generating &&
    !referencedAssets.some((a) => a.kind === "image") &&
    assets.some((a) => a.kind === "image");

  const startUpload = useCallback(
    async (files: File[]) => {
      const existing = new Set(assets.map((a) => a.handle.toLowerCase()));
      for (const file of files) {
        const kind = getKind(file);
        if (!kind) continue;
        const id = crypto.randomUUID();
        const handle = suggestHandle(file.name, kind, existing);
        existing.add(handle.toLowerCase());

        setUploads((current) => [
          ...current,
          { id, name: file.name, progress: 0 },
        ]);

        try {
          const formData = new FormData();
          formData.set("file", file);

          const response = await uploadWithProgress(
            "/api/assets/upload",
            formData,
            (progress) =>
              setUploads((current) =>
                current.map((u) =>
                  u.id === id ? { ...u, progress } : u,
                ),
              ),
          );

          if (!response.ok) {
            const msg =
              typeof response.data?.message === "string"
                ? response.data.message
                : "Upload failed.";
            setUploads((current) =>
              current.map((u) =>
                u.id === id ? { ...u, error: msg, progress: 1 } : u,
              ),
            );
            setBanner(msg);
            setTimeout(() => {
              setUploads((current) => current.filter((u) => u.id !== id));
            }, 3500);
            continue;
          }

          const data = response.data as {
            kind: AssetKind;
            key: string;
            url: string;
            name: string;
            size: number;
            contentType: string;
          };

          const asset: ProjectAsset = {
            id: crypto.randomUUID(),
            handle,
            kind: data.kind,
            url: data.url,
            key: data.key,
            name: data.name,
            size: data.size,
            contentType: data.contentType,
            createdAt: Date.now(),
          };

          updateActive((p) => ({ ...p, assets: [...p.assets, asset] }));
          setUploads((current) => current.filter((u) => u.id !== id));
          setBanner(null);
        } catch (error) {
          const msg =
            error instanceof Error ? error.message : "Upload failed.";
          setUploads((current) =>
            current.map((u) =>
              u.id === id ? { ...u, error: msg, progress: 1 } : u,
            ),
          );
          setBanner(msg);
          setTimeout(
            () =>
              setUploads((current) => current.filter((u) => u.id !== id)),
            3500,
          );
        }
      }
    },
    [assets, updateActive],
  );

  const handleFileInput = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (files.length > 0) void startUpload(files);
  };

  const handleDragEnter = (event: DragEvent) => {
    event.preventDefault();
    dragCounter.current += 1;
    if (event.dataTransfer?.types?.includes("Files")) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (event: DragEvent) => {
    event.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) {
      dragCounter.current = 0;
      setIsDragging(false);
    }
  };

  const handleDragOver = (event: DragEvent) => {
    event.preventDefault();
  };

  const handleDrop = (event: DragEvent) => {
    event.preventDefault();
    dragCounter.current = 0;
    setIsDragging(false);
    const files = Array.from(event.dataTransfer?.files ?? []);
    if (files.length > 0) void startUpload(files);
  };

  const hardDeleteAsset = async (asset: ProjectAsset) => {
    const dedupeKey = asset.key ?? asset.url;
    if (deleting.has(dedupeKey)) return;

    setDeleting((current) => {
      const next = new Set(current);
      next.add(dedupeKey);
      return next;
    });

    try {
      if (asset.key) {
        const response = await fetch("/api/assets", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ key: asset.key }),
        });
        if (!response.ok) {
          const data = (await response.json().catch(() => null)) as
            | { message?: string }
            | null;
          setBanner(data?.message ?? "Could not delete from storage.");
          return;
        }
      }

      projectApi.purgeAssetByKey(dedupeKey);

      const handlePattern = new RegExp(
        `\\s?@${asset.handle.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`,
        "gi",
      );
      setPrompt((current) => current.replace(handlePattern, ""));
    } catch (error) {
      setBanner(
        error instanceof Error ? error.message : "Could not delete asset.",
      );
    } finally {
      setDeleting((current) => {
        const next = new Set(current);
        next.delete(dedupeKey);
        return next;
      });
    }
  };

  const attachFromLibrary = (asset: ProjectAsset) => {
    const dedupeKey = asset.key ?? asset.url;
    const existing = assets.find((a) => (a.key ?? a.url) === dedupeKey);
    if (existing) {
      insertMention(existing);
      return;
    }
    projectApi.attachAssetToActive(asset);
    // After state commits, insert the mention using the handle. We can't
    // access the newly-assigned handle synchronously, so use the original
    // handle — attachAssetToActive only renames on collision, which is rare.
    requestAnimationFrame(() => {
      const justAdded = projectApi.activeProject?.assets.find(
        (a) => (a.key ?? a.url) === dedupeKey,
      );
      if (justAdded) insertMention(justAdded);
    });
  };

  const insertMention = (asset: ProjectAsset) => {
    const textarea = promptRef.current;
    const currentCaret = textarea?.selectionStart ?? prompt.length;
    const q = getMentionQuery(prompt, currentCaret);
    const before = prompt.slice(0, currentCaret);
    const after = prompt.slice(currentCaret);
    const replaceStart = q === null ? currentCaret : before.lastIndexOf("@");
    const next = `${prompt.slice(0, replaceStart)}@${asset.handle} ${after}`;
    setPrompt(next);
    requestAnimationFrame(() => {
      const pos = replaceStart + asset.handle.length + 2;
      promptRef.current?.focus();
      promptRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
    });
  };

  const onPromptKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Escape") {
      setSettingsOpen(false);
      return;
    }
    if (event.key === "Enter" && !event.shiftKey && canGenerate) {
      event.preventDefault();
      void generate();
    }
  };

  const updateSettings = (partial: Partial<Settings>) => {
    updateActive((p) => ({ ...p, settings: { ...p.settings, ...partial } }));
  };

  const generate = async () => {
    if (!canGenerate) return;
    const id = crypto.randomUUID();
    const captured = prompt.trim();
    const refs = referencedAssets;
    const generation: Generation = {
      id,
      prompt: captured,
      referenceIds: refs.map((r) => r.id),
      status: "generating",
      createdAt: Date.now(),
    };

    updateActive((p) => ({
      ...p,
      generations: [...p.generations, generation],
    }));
    setPrompt("");
    setGenerating(true);

    try {
      const response = await fetch("/api/video/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: captured,
          settings,
          references: refs.map((r) => ({
            handle: r.handle,
            kind: r.kind,
            url: r.url,
            key: r.key,
          })),
          tenantId: "demo-tenant",
          userId: "demo-user",
          folder: project.id,
        }),
      });
      const data = await response.json();

      if (data.status === "ready") {
        updateActive((p) => ({
          ...p,
          generations: p.generations.map((g) =>
            g.id === id
              ? {
                  ...g,
                  status: "ready",
                  videoUrl: data.videoUrl,
                  downloadUrl: data.downloadUrl,
                  sourceImageUrl: data.sourceImageUrl,
                  model: data.model,
                }
              : g,
          ),
        }));
      } else {
        updateActive((p) => ({
          ...p,
          generations: p.generations.map((g) =>
            g.id === id
              ? {
                  ...g,
                  status: data.status === "setup-needed" ? "setup-needed" : "failed",
                  message: data.message,
                }
              : g,
          ),
        }));
      }
    } catch (error) {
      updateActive((p) => ({
        ...p,
        generations: p.generations.map((g) =>
          g.id === id
            ? {
                ...g,
                status: "failed",
                message:
                  error instanceof Error ? error.message : "Generation failed.",
              }
            : g,
        ),
      }));
    } finally {
      setGenerating(false);
    }
  };

  const showEmptyState = generations.length === 0;

  return (
    <main
      className="grain relative flex min-h-screen flex-col overflow-hidden"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,video/*,audio/*"
        className="hidden"
        onChange={handleFileInput}
      />

      {isDragging ? <DropOverlay /> : null}

      <div className="relative flex flex-1 min-h-0">
        <Sidebar
          open={sidebarOpen}
          onToggle={() => setSidebarOpen((v) => !v)}
          projectApi={projectApi}
          activeAssetKeys={activeAssetKeys}
          onAttachFromLibrary={attachFromLibrary}
          onDeleteFromLibrary={hardDeleteAsset}
          deletingKeys={deleting}
        />

        <div className="relative flex flex-1 min-w-0 flex-col">
          <TopBar
            project={project}
            onRename={(name) => projectApi.renameProject(project.id, name)}
            onNewProject={projectApi.newProject}
            onToggleSidebar={() => setSidebarOpen((v) => !v)}
            sidebarOpen={sidebarOpen}
          />

          <div
            ref={conversationRef}
            className="flex-1 overflow-y-auto px-6 pb-48 pt-10 sm:px-10"
          >
            <div className="mx-auto w-full max-w-[760px]">
              {showEmptyState ? (
                <EmptyState
                  onUpload={() => fileInputRef.current?.click()}
                  projectName={project.name}
                />
              ) : (
                <div className="space-y-14">
                  {generations.map((generation) => (
                    <GenerationItem
                      key={generation.id}
                      generation={generation}
                      assets={assets}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>

          <Composer
            prompt={prompt}
            onPromptChange={(next, nextCaret) => {
              setPrompt(next);
              setCaret(nextCaret);
            }}
            onCaretChange={setCaret}
            onKeyDown={onPromptKeyDown}
            promptRef={promptRef}
            assets={assets}
            uploads={uploads}
            referencedAssets={referencedAssets}
            onOpenFilePicker={() => fileInputRef.current?.click()}
            onRemoveAsset={hardDeleteAsset}
            deletingKeys={deleting}
            onInsertMention={insertMention}
            mentionMatches={mentionMatches}
            mentionQuery={mentionQuery}
            settings={settings}
            onUpdateSettings={updateSettings}
            settingsOpen={settingsOpen}
            setSettingsOpen={setSettingsOpen}
            settingsRef={settingsRef}
            canGenerate={canGenerate}
            generating={generating}
            hintNeedsImage={hintNeedsImage}
            onGenerate={generate}
            banner={banner}
            onDismissBanner={() => setBanner(null)}
          />
        </div>
      </div>
    </main>
  );
}

function TopBar(props: {
  project: Project;
  onRename: (name: string) => void;
  onNewProject: () => Project;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  return <TopBarInner key={props.project.id} {...props} />;
}

function TopBarInner({
  project,
  onRename,
  onNewProject,
  onToggleSidebar,
  sidebarOpen,
}: {
  project: Project;
  onRename: (name: string) => void;
  onNewProject: () => Project;
  onToggleSidebar: () => void;
  sidebarOpen: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(project.name);

  return (
    <header className="relative z-10 flex items-center justify-between px-6 py-5 sm:px-10">
      <div className="flex items-center gap-4">
        {!sidebarOpen ? (
          <button
            type="button"
            onClick={onToggleSidebar}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[var(--ink-muted)] hover:bg-[var(--paper-soft)] hover:text-[var(--ink)]"
            aria-label="Open sidebar"
          >
            <Film size={16} />
          </button>
        ) : null}
        <div className="flex items-baseline gap-3">
          <span className="micro-caps">Film Maker</span>
          <span className="text-[var(--ink-faint)]">·</span>
          {editing ? (
            <input
              autoFocus
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                onRename(draft);
                setEditing(false);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  onRename(draft);
                  setEditing(false);
                }
                if (e.key === "Escape") {
                  setDraft(project.name);
                  setEditing(false);
                }
              }}
              className="serif-display bg-transparent text-2xl font-medium text-[var(--ink)] outline-none"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="serif-display text-2xl font-medium text-[var(--ink)] hover:text-[var(--accent-ink)]"
            >
              {project.name}
            </button>
          )}
        </div>
      </div>

      <button
        type="button"
        onClick={() => onNewProject()}
        className="group flex items-center gap-2 rounded-full border border-[var(--rule)] bg-[var(--paper)] px-4 py-2 text-sm text-[var(--ink-soft)] transition hover:border-[var(--rule-strong)] hover:text-[var(--ink)]"
      >
        <Plus size={15} className="transition group-hover:rotate-90" />
        New project
      </button>
    </header>
  );
}

function Sidebar({
  open,
  onToggle,
  projectApi,
  activeAssetKeys,
  onAttachFromLibrary,
  onDeleteFromLibrary,
  deletingKeys,
}: {
  open: boolean;
  onToggle: () => void;
  projectApi: ReturnType<typeof useProjects>;
  activeAssetKeys: Set<string>;
  onAttachFromLibrary: (asset: ProjectAsset) => void;
  onDeleteFromLibrary: (asset: ProjectAsset) => void;
  deletingKeys: Set<string>;
}) {
  if (!open) return null;
  const {
    projects,
    activeId,
    selectProject,
    newProject,
    deleteProject,
    libraryAssets,
  } = projectApi;

  return (
    <aside className="relative flex w-[260px] shrink-0 flex-col border-r border-[var(--rule)] bg-[var(--paper-soft)]/60 backdrop-blur-sm">
      <div className="flex items-center justify-between px-5 py-5">
        <div className="flex items-center gap-2">
          <div className="flex h-7 w-7 items-center justify-center rounded-md bg-[var(--ink)] text-[var(--paper)]">
            <Clapperboard size={14} />
          </div>
          <span className="serif-display text-lg font-medium">Studio</span>
        </div>
        <button
          type="button"
          onClick={onToggle}
          className="flex h-7 w-7 items-center justify-center rounded-md text-[var(--ink-muted)] hover:bg-[var(--paper-deep)] hover:text-[var(--ink)]"
          aria-label="Collapse sidebar"
        >
          <X size={14} />
        </button>
      </div>

      <div className="px-3">
        <button
          type="button"
          onClick={() => newProject()}
          className="flex w-full items-center gap-2 rounded-md border border-dashed border-[var(--rule-strong)] px-3 py-2 text-sm text-[var(--ink-soft)] transition hover:border-[var(--accent)] hover:bg-[var(--paper)] hover:text-[var(--ink)]"
        >
          <Plus size={14} />
          New project
        </button>
      </div>

      <div className="mt-6 flex-1 min-h-0 overflow-y-auto px-3 pb-6">
        <p className="micro-caps mb-2 px-2">Projects</p>
        <ul className="space-y-0.5">
          {projects.map((p) => (
            <li key={p.id} className="group relative">
              <button
                type="button"
                onClick={() => selectProject(p.id)}
                className={`flex w-full items-start gap-2 rounded-md px-3 py-2 text-left text-sm transition ${
                  p.id === activeId
                    ? "bg-[var(--paper)] text-[var(--ink)] shadow-[0_1px_0_0_var(--rule)]"
                    : "text-[var(--ink-soft)] hover:bg-[var(--paper)]/70 hover:text-[var(--ink)]"
                }`}
              >
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-[var(--accent)] opacity-0 transition group-hover:opacity-60 data-[active=true]:opacity-100" data-active={p.id === activeId} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  <span className="mt-0.5 block text-xs text-[var(--ink-faint)]">
                    {p.generations.length > 0
                      ? `${p.generations.length} take${p.generations.length === 1 ? "" : "s"} · ${formatDateShort(p.updatedAt)}`
                      : formatDateShort(p.updatedAt)}
                  </span>
                </span>
              </button>
              {projects.length > 1 ? (
                <button
                  type="button"
                  onClick={() => deleteProject(p.id)}
                  className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded opacity-0 transition hover:bg-[var(--paper-deep)] group-hover:opacity-100"
                  aria-label={`Delete ${p.name}`}
                >
                  <Trash2 size={12} className="text-[var(--ink-muted)]" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>

        <LibrarySection
          assets={libraryAssets}
          activeAssetKeys={activeAssetKeys}
          onAttach={onAttachFromLibrary}
          onDelete={onDeleteFromLibrary}
          deletingKeys={deletingKeys}
        />
      </div>

      <div className="border-t border-[var(--rule)] px-5 py-4">
        <p className="micro-caps">Seedance 2.0</p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Image-to-video, via AI Gateway.
        </p>
      </div>
    </aside>
  );
}

function LibrarySection({
  assets,
  activeAssetKeys,
  onAttach,
  onDelete,
  deletingKeys,
}: {
  assets: ProjectAsset[];
  activeAssetKeys: Set<string>;
  onAttach: (asset: ProjectAsset) => void;
  onDelete: (asset: ProjectAsset) => void;
  deletingKeys: Set<string>;
}) {
  if (assets.length === 0) return null;

  return (
    <div className="mt-7">
      <div className="mb-2 flex items-baseline justify-between px-2">
        <p className="micro-caps">Library</p>
        <span className="text-[10px] text-[var(--ink-faint)]">
          {assets.length}
        </span>
      </div>
      <ul className="grid grid-cols-3 gap-1.5">
        {assets.map((asset) => {
          const dedupeKey = asset.key ?? asset.url;
          const attached = activeAssetKeys.has(dedupeKey);
          const isDeleting = deletingKeys.has(dedupeKey);
          const Icon = kindIcon[asset.kind];

          return (
            <li key={dedupeKey} className="group relative">
              <button
                type="button"
                onClick={() => !isDeleting && onAttach(asset)}
                disabled={isDeleting}
                title={`@${asset.handle} · ${kindLabel[asset.kind]}${attached ? " · in this project" : ""}`}
                className={`relative block aspect-square w-full overflow-hidden rounded-md border transition ${
                  attached
                    ? "border-[var(--accent)]"
                    : "border-[var(--rule)] hover:border-[var(--rule-strong)]"
                } ${isDeleting ? "opacity-50" : ""}`}
              >
                {asset.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : asset.kind === "video" ? (
                  <video
                    src={asset.url}
                    muted
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center bg-[var(--paper-deep)]">
                    <Icon size={16} className="text-[var(--ink-muted)]" />
                  </div>
                )}
                <span className="absolute inset-x-0 bottom-0 truncate bg-gradient-to-t from-black/60 to-transparent px-1.5 pb-0.5 pt-3 text-left font-mono text-[9.5px] text-white/95">
                  @{asset.handle}
                </span>
                {attached ? (
                  <span
                    className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]"
                    aria-label="In this project"
                  />
                ) : null}
                {isDeleting ? (
                  <span className="absolute inset-0 flex items-center justify-center bg-[var(--paper)]/70">
                    <Loader2 size={14} className="animate-spin text-[var(--ink-muted)]" />
                  </span>
                ) : null}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onDelete(asset);
                }}
                disabled={isDeleting}
                className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-[var(--paper)]/95 text-[var(--ink-muted)] opacity-0 shadow-sm transition hover:text-[var(--ink)] group-hover:opacity-100"
                aria-label={`Delete ${asset.handle}`}
              >
                <Trash2 size={10} />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EmptyState({
  onUpload,
  projectName,
}: {
  onUpload: () => void;
  projectName: string;
}) {
  return (
    <div className="slide-up flex flex-col items-start gap-6 pt-6">
      <div className="flex items-center gap-2">
        <span className="h-px w-10 bg-[var(--rule-strong)]" />
        <span className="micro-caps">Scene 01 · {projectName}</span>
      </div>
      <h2 className="serif-display text-5xl leading-[1.05] tracking-[-0.025em] sm:text-6xl">
        Begin with an image.
        <br />
        <span className="italic text-[var(--ink-muted)]">Describe the motion.</span>
      </h2>
      <p className="max-w-[52ch] text-[15px] leading-relaxed text-[var(--ink-soft)]">
        Drop a photograph anywhere on this page — still or video — then use{" "}
        <span className="font-mono text-[13px]">@</span> in the composer below to
        weave it into your prompt. Seedance will breathe motion into the frame.
      </p>
      <button
        type="button"
        onClick={onUpload}
        className="group mt-2 inline-flex items-center gap-3 text-sm text-[var(--ink)] underline decoration-[var(--accent)] decoration-2 underline-offset-[6px] hover:decoration-[var(--ink)]"
      >
        <Paperclip size={14} />
        Upload an image to start
      </button>
    </div>
  );
}

function GenerationItem({
  generation,
  assets,
}: {
  generation: Generation;
  assets: ProjectAsset[];
}) {
  const refs = generation.referenceIds
    .map((id) => assets.find((a) => a.id === id))
    .filter((a): a is ProjectAsset => Boolean(a));

  return (
    <article className="slide-up">
      <header className="mb-3 flex items-baseline gap-3">
        <span className="micro-caps">Take · {formatTime(generation.createdAt)}</span>
        <span className="h-px flex-1 bg-[var(--rule)]" />
      </header>

      <div className="mb-4">
        <p className="serif-display text-xl leading-[1.45] text-[var(--ink)] sm:text-2xl">
          {renderPromptWithMentions(generation.prompt)}
        </p>
        {refs.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {refs.map((r) => (
              <AssetChip key={r.id} asset={r} small />
            ))}
          </div>
        ) : null}
      </div>

      <div className="relative overflow-hidden rounded-[18px] border border-[var(--rule)] bg-[var(--ink)] shadow-[0_20px_60px_-30px_rgba(0,0,0,0.45)]">
        {generation.status === "generating" ? (
          <GeneratingFilm />
        ) : generation.status === "ready" && generation.videoUrl ? (
          <VideoPreview
            videoUrl={generation.videoUrl}
            downloadUrl={generation.downloadUrl}
          />
        ) : (
          <ErrorState
            kind={generation.status === "setup-needed" ? "setup-needed" : "failed"}
            message={
              generation.message ??
              "Something went wrong. Try again with a different prompt."
            }
          />
        )}
      </div>
    </article>
  );
}

function renderPromptWithMentions(text: string) {
  const parts = text.split(/(@[a-zA-Z0-9_-]+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <span
        key={i}
        className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-sans text-[0.85em] font-medium text-[var(--accent-ink)]"
      >
        {part}
      </span>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function GeneratingFilm() {
  return (
    <div className="flex aspect-video items-center justify-center">
      <div className="flex flex-col items-center gap-4 text-[var(--paper)]/80">
        <div className="relative">
          <div className="h-10 w-10 rounded-full border-2 border-[var(--paper)]/20" />
          <div className="absolute inset-0 h-10 w-10 animate-spin rounded-full border-2 border-t-[var(--accent)] border-transparent" />
        </div>
        <span className="serif-display text-sm italic tracking-wide">
          rendering motion…
        </span>
      </div>
    </div>
  );
}

function VideoPreview({
  videoUrl,
  downloadUrl,
}: {
  videoUrl: string;
  downloadUrl?: string;
}) {
  return (
    <div className="group relative">
      <video
        src={videoUrl}
        controls
        className="aspect-video w-full"
      />
      <div className="absolute right-3 top-3 flex items-center gap-1 opacity-0 transition group-hover:opacity-100">
        <a
          href={downloadUrl ?? videoUrl}
          download="seedance-output.mp4"
          className="flex h-8 items-center gap-1.5 rounded-full bg-[var(--paper)]/95 px-3 text-xs font-medium text-[var(--ink)] shadow-lg hover:bg-[var(--paper)]"
        >
          <Download size={13} />
          Download
        </a>
      </div>
    </div>
  );
}

function ErrorState({
  kind,
  message,
}: {
  kind: "failed" | "setup-needed";
  message: string;
}) {
  const isSetup = kind === "setup-needed";
  return (
    <div className="flex aspect-video flex-col items-start justify-center gap-3 p-8 text-[var(--paper)]/90">
      <span
        className="rounded-full px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.18em]"
        style={{
          background: isSetup
            ? "rgba(184, 145, 91, 0.2)"
            : "rgba(255, 120, 100, 0.2)",
          color: isSetup ? "#e9d9bd" : "#ffc9c0",
        }}
      >
        {isSetup ? "Setup required" : "Render failed"}
      </span>
      <p className="serif-display max-w-[50ch] text-lg italic leading-snug">
        {message}
      </p>
    </div>
  );
}

function AssetChip({
  asset,
  small,
}: {
  asset: ProjectAsset;
  small?: boolean;
}) {
  const Icon = kindIcon[asset.kind];
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--rule)] bg-[var(--paper)] font-mono ${
        small ? "px-2 py-0.5 text-[11px]" : "px-2.5 py-1 text-xs"
      } text-[var(--ink-soft)]`}
    >
      <Icon size={small ? 10 : 11} className="text-[var(--accent-ink)]" />
      @{asset.handle}
    </span>
  );
}

function Composer({
  prompt,
  onPromptChange,
  onCaretChange,
  onKeyDown,
  promptRef,
  assets,
  uploads,
  referencedAssets,
  onOpenFilePicker,
  onRemoveAsset,
  deletingKeys,
  onInsertMention,
  mentionMatches,
  mentionQuery,
  settings,
  onUpdateSettings,
  settingsOpen,
  setSettingsOpen,
  settingsRef,
  canGenerate,
  generating,
  hintNeedsImage,
  onGenerate,
  banner,
  onDismissBanner,
}: {
  prompt: string;
  onPromptChange: (next: string, caret: number) => void;
  onCaretChange: (caret: number) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  promptRef: React.RefObject<HTMLTextAreaElement | null>;
  assets: ProjectAsset[];
  uploads: UploadItem[];
  referencedAssets: ProjectAsset[];
  onOpenFilePicker: () => void;
  onRemoveAsset: (asset: ProjectAsset) => void;
  deletingKeys: Set<string>;
  onInsertMention: (asset: ProjectAsset) => void;
  mentionMatches: MentionMatch[];
  mentionQuery: string | null;
  settings: Settings;
  onUpdateSettings: (partial: Partial<Settings>) => void;
  settingsOpen: boolean;
  setSettingsOpen: (value: boolean) => void;
  settingsRef: React.RefObject<HTMLDivElement | null>;
  canGenerate: boolean;
  generating: boolean;
  hintNeedsImage: boolean;
  onGenerate: () => void;
  banner: string | null;
  onDismissBanner: () => void;
}) {
  const hasAssets = assets.length > 0 || uploads.length > 0;

  const syncCaret = () => {
    onCaretChange(promptRef.current?.selectionStart ?? prompt.length);
  };

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-6 sm:px-10">
      <div className="pointer-events-auto mx-auto w-full max-w-[760px]">
        {banner ? (
          <div className="mb-3 flex items-center justify-between gap-3 rounded-full border border-[var(--rule)] bg-[var(--paper)] px-4 py-2 text-xs text-[var(--ink-soft)] shadow-sm slide-up">
            <span>{banner}</span>
            <button
              type="button"
              onClick={onDismissBanner}
              className="text-[var(--ink-faint)] hover:text-[var(--ink)]"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        ) : null}

        <div className="relative rounded-[26px] border border-[var(--rule-strong)] bg-[var(--paper)] shadow-[0_20px_48px_-24px_rgba(0,0,0,0.18),0_2px_6px_-2px_rgba(0,0,0,0.06)] backdrop-blur">
          {/* Asset rail */}
          {hasAssets ? (
            <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--rule)] px-4 pb-2 pt-3">
              {assets.map((asset) => {
                const referenced = referencedAssets.some(
                  (r) => r.id === asset.id,
                );
                return (
                  <AssetPill
                    key={asset.id}
                    asset={asset}
                    referenced={referenced}
                    deleting={deletingKeys.has(asset.key ?? asset.url)}
                    onInsert={() => onInsertMention(asset)}
                    onRemove={() => onRemoveAsset(asset)}
                  />
                );
              })}
              {uploads.map((upload) => (
                <UploadPill key={upload.id} upload={upload} />
              ))}
            </div>
          ) : null}

          {/* Prompt area */}
          <div className="relative">
            <textarea
              ref={promptRef}
              value={prompt}
              onChange={(e) => onPromptChange(e.target.value, e.target.selectionStart)}
              onClick={syncCaret}
              onKeyUp={syncCaret}
              onSelect={syncCaret}
              onKeyDown={onKeyDown}
              rows={1}
              placeholder="Describe the motion… use @ to reference an asset."
              className="max-h-56 min-h-[60px] w-full resize-none bg-transparent px-5 pb-2 pt-4 text-[15.5px] leading-relaxed text-[var(--ink)] outline-none placeholder:text-[var(--ink-faint)]"
              style={{
                height: Math.min(
                  224,
                  Math.max(60, 24 + prompt.split("\n").length * 22),
                ),
              }}
            />

            {mentionMatches.length > 0 && mentionQuery !== null ? (
              <MentionMenu
                matches={mentionMatches}
                onPick={onInsertMention}
              />
            ) : null}
          </div>

          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2 border-t border-[var(--rule)] px-3 py-2.5">
            <div className="flex items-center gap-1">
              <ToolbarButton
                onClick={onOpenFilePicker}
                icon={<Paperclip size={14} />}
                label="Attach"
              />
              <div ref={settingsRef} className="relative">
                <ToolbarButton
                  onClick={() => setSettingsOpen(!settingsOpen)}
                  icon={<Settings2 size={14} />}
                  label={`${settings.model.endsWith("fast") ? "Fast" : "Standard"} · ${settings.aspectRatio} · ${settings.resolution} · ${settings.duration}s`}
                  active={settingsOpen}
                />
                {settingsOpen ? (
                  <SettingsPopover
                    settings={settings}
                    onUpdate={onUpdateSettings}
                  />
                ) : null}
              </div>
              {hintNeedsImage ? (
                <span className="ml-1 hidden items-center gap-1 text-[11px] italic text-[var(--ink-muted)] sm:flex">
                  <AtSign size={11} /> reference an image to generate
                </span>
              ) : null}
            </div>

            <button
              type="button"
              onClick={onGenerate}
              disabled={!canGenerate}
              className={`group flex h-9 items-center gap-1.5 rounded-full px-4 text-sm font-medium transition ${
                canGenerate
                  ? "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-ink)]"
                  : "bg-[var(--paper-deep)] text-[var(--ink-faint)]"
              }`}
              aria-label="Generate"
            >
              {generating ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Sparkles
                  size={13}
                  className="text-[var(--accent-soft)] transition group-hover:scale-110 group-disabled:text-[var(--ink-faint)]"
                />
              )}
              <span className="hidden sm:inline">
                {generating ? "Rendering" : "Render"}
              </span>
              <ArrowUp size={14} className="sm:hidden" />
            </button>
          </div>
        </div>
        <p className="mt-2 text-center text-[11px] text-[var(--ink-faint)]">
          Drop files anywhere · <span className="font-mono">↵</span> to render ·{" "}
          <span className="font-mono">shift+↵</span> for new line
        </p>
      </div>
    </div>
  );
}

function ToolbarButton({
  onClick,
  icon,
  label,
  active,
}: {
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-8 items-center gap-1.5 rounded-full px-3 text-[12.5px] transition ${
        active
          ? "bg-[var(--paper-deep)] text-[var(--ink)]"
          : "text-[var(--ink-muted)] hover:bg-[var(--paper-soft)] hover:text-[var(--ink)]"
      }`}
    >
      {icon}
      <span className="max-w-[260px] truncate">{label}</span>
    </button>
  );
}

function AssetPill({
  asset,
  referenced,
  deleting,
  onInsert,
  onRemove,
}: {
  asset: ProjectAsset;
  referenced: boolean;
  deleting: boolean;
  onInsert: () => void;
  onRemove: () => void;
}) {
  const Icon = kindIcon[asset.kind];
  return (
    <span
      className={`group relative inline-flex items-center gap-1.5 rounded-full border pl-1 pr-2 text-xs transition ${
        deleting
          ? "border-[var(--rule)] bg-[var(--paper-soft)] text-[var(--ink-faint)] opacity-60"
          : referenced
            ? "border-[var(--accent)] bg-[var(--accent-soft)]/40 text-[var(--accent-ink)]"
            : "border-[var(--rule)] bg-[var(--paper-soft)] text-[var(--ink-soft)] hover:border-[var(--rule-strong)]"
      }`}
    >
      {asset.kind === "image" ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={asset.url}
          alt=""
          className="h-5 w-5 rounded-full object-cover"
        />
      ) : (
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--paper)]">
          <Icon size={10} className="text-[var(--accent-ink)]" />
        </span>
      )}
      <button
        type="button"
        onClick={onInsert}
        disabled={deleting}
        className="font-mono text-[11.5px]"
        title={`${kindLabel[asset.kind]} · ${formatBytes(asset.size)}`}
      >
        @{asset.handle}
      </button>
      <button
        type="button"
        onClick={onRemove}
        disabled={deleting}
        className="ml-0.5 flex h-3.5 w-3.5 items-center justify-center text-[var(--ink-faint)] opacity-0 transition hover:text-[var(--ink)] group-hover:opacity-100 disabled:opacity-100"
        aria-label={deleting ? `Deleting ${asset.handle}` : `Delete ${asset.handle}`}
      >
        {deleting ? (
          <Loader2 size={10} className="animate-spin opacity-100" />
        ) : (
          <X size={10} />
        )}
      </button>
    </span>
  );
}

function UploadPill({ upload }: { upload: UploadItem }) {
  const pct = Math.round(upload.progress * 100);
  const failed = Boolean(upload.error);
  return (
    <span
      className={`relative inline-flex items-center gap-1.5 overflow-hidden rounded-full border px-2 py-1 text-xs ${
        failed
          ? "border-red-300 bg-red-50 text-red-700"
          : "border-[var(--rule)] bg-[var(--paper-soft)] text-[var(--ink-muted)]"
      }`}
    >
      {!failed ? (
        <span
          className="absolute inset-y-0 left-0 bg-[var(--accent-soft)]/60 transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      ) : null}
      <span className="relative flex items-center gap-1.5">
        {failed ? (
          <X size={10} />
        ) : (
          <Loader2 size={10} className="animate-spin" />
        )}
        <span className="max-w-[140px] truncate font-mono text-[11px]">
          {upload.name}
        </span>
        {!failed ? <span className="text-[10px]">{pct}%</span> : null}
      </span>
    </span>
  );
}

function MentionMenu({
  matches,
  onPick,
}: {
  matches: MentionMatch[];
  onPick: (asset: ProjectAsset) => void;
}) {
  return (
    <div className="absolute bottom-full left-4 z-30 mb-2 w-[320px] overflow-hidden rounded-[14px] border border-[var(--rule)] bg-[var(--paper)] shadow-[0_16px_40px_-16px_rgba(0,0,0,0.25)]">
      <div className="border-b border-[var(--rule)] px-3 py-2">
        <p className="micro-caps">Reference an asset</p>
      </div>
      <ul className="max-h-[260px] overflow-y-auto py-1">
        {matches.map((asset) => {
          const Icon = kindIcon[asset.kind];
          return (
            <li key={asset.id}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => onPick(asset)}
                className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-[var(--paper-soft)]"
              >
                {asset.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={asset.url}
                    alt=""
                    className="h-9 w-9 rounded-md object-cover"
                  />
                ) : (
                  <div className="flex h-9 w-9 items-center justify-center rounded-md bg-[var(--paper-soft)] text-[var(--ink-muted)]">
                    <Icon size={15} />
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate font-mono text-[13px] text-[var(--ink)]">
                    @{asset.handle}
                  </p>
                  <p className="truncate text-[11px] text-[var(--ink-muted)]">
                    {kindLabel[asset.kind]} · {formatBytes(asset.size)}
                  </p>
                </div>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SettingsPopover({
  settings,
  onUpdate,
}: {
  settings: Settings;
  onUpdate: (partial: Partial<Settings>) => void;
}) {
  return (
    <div className="absolute bottom-full left-0 z-30 mb-2 w-[340px] overflow-hidden rounded-[14px] border border-[var(--rule)] bg-[var(--paper)] shadow-[0_20px_50px_-20px_rgba(0,0,0,0.3)] slide-up">
      <div className="border-b border-[var(--rule)] px-4 py-3">
        <p className="serif-display text-[15px] font-medium">Render settings</p>
      </div>
      <div className="space-y-3 p-4">
        <SegmentedRow
          label="Model"
          value={settings.model}
          onChange={(v) => onUpdate({ model: v as Settings["model"] })}
          options={[
            { value: "bytedance/seedance-2.0", label: "Standard" },
            { value: "bytedance/seedance-2.0-fast", label: "Fast" },
          ]}
        />
        <SegmentedRow
          label="Aspect"
          value={settings.aspectRatio}
          onChange={(v) =>
            onUpdate({ aspectRatio: v as Settings["aspectRatio"] })
          }
          options={[
            { value: "16:9", label: "16:9" },
            { value: "9:16", label: "9:16" },
            { value: "1:1", label: "1:1" },
            { value: "4:3", label: "4:3" },
            { value: "3:4", label: "3:4" },
          ]}
        />
        <SegmentedRow
          label="Resolution"
          value={settings.resolution}
          onChange={(v) =>
            onUpdate({ resolution: v as Settings["resolution"] })
          }
          options={[
            { value: "480p", label: "480" },
            { value: "720p", label: "720" },
            { value: "1080p", label: "1080" },
          ]}
        />
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs text-[var(--ink-muted)]">Duration</span>
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={4}
              max={12}
              value={settings.duration}
              onChange={(e) => onUpdate({ duration: Number(e.target.value) })}
              className="h-1 w-[140px] appearance-none rounded-full bg-[var(--paper-deep)] accent-[var(--accent-ink)]"
            />
            <span className="w-8 text-right font-mono text-[11.5px] text-[var(--ink)]">
              {settings.duration}s
            </span>
          </div>
        </div>
        <div className="mt-1 flex items-center justify-between border-t border-[var(--rule)] pt-3">
          <Toggle
            label="Audio"
            checked={settings.generateAudio}
            onChange={(v) => onUpdate({ generateAudio: v })}
          />
          <Toggle
            label="Fixed camera"
            checked={settings.cameraFixed}
            onChange={(v) => onUpdate({ cameraFixed: v })}
          />
        </div>
      </div>
    </div>
  );
}

function SegmentedRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-xs text-[var(--ink-muted)]">{label}</span>
      <div className="inline-flex overflow-hidden rounded-full border border-[var(--rule)] bg-[var(--paper-soft)] p-0.5">
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={`px-2.5 py-1 text-[11.5px] font-medium transition ${
              value === opt.value
                ? "rounded-full bg-[var(--paper)] text-[var(--ink)] shadow-[0_1px_2px_rgba(0,0,0,0.06)]"
                : "text-[var(--ink-muted)] hover:text-[var(--ink)]"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-xs text-[var(--ink-soft)]"
    >
      <span
        className={`relative flex h-[18px] w-[30px] items-center rounded-full transition ${
          checked ? "bg-[var(--accent-ink)]" : "bg-[var(--paper-deep)]"
        }`}
      >
        <span
          className={`absolute h-3.5 w-3.5 rounded-full bg-[var(--paper)] transition-all ${
            checked ? "left-[13px]" : "left-[2px]"
          }`}
        />
      </span>
      {label}
    </button>
  );
}

function DropOverlay() {
  return (
    <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center bg-[var(--paper)]/80 backdrop-blur-[2px] fade-in">
      <div className="rounded-[20px] border-2 border-dashed border-[var(--accent)] bg-[var(--paper)] p-10 text-center">
        <div className="mb-3 flex justify-center">
          <Paperclip size={22} className="text-[var(--accent-ink)]" />
        </div>
        <p className="serif-display text-2xl italic text-[var(--ink)]">
          Release to upload
        </p>
        <p className="mt-1 text-xs text-[var(--ink-muted)]">
          Images, videos, or audio
        </p>
      </div>
    </div>
  );
}

type ProgressResponse = { ok: boolean; data: Record<string, unknown> };

function uploadWithProgress(
  url: string,
  data: FormData,
  onProgress: (p: number) => void,
): Promise<ProgressResponse> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      try {
        const parsed = JSON.parse(xhr.responseText);
        resolve({ ok: xhr.status >= 200 && xhr.status < 300, data: parsed });
      } catch {
        resolve({ ok: false, data: { message: "Invalid server response." } });
      }
    };
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(data);
  });
}
