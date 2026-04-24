"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

export type AssetKind = "image" | "video" | "audio";

export type ProjectAsset = {
  id: string;
  handle: string;
  kind: AssetKind;
  url: string;
  key?: string;
  name: string;
  size: number;
  contentType: string;
  createdAt: number;
};

export type Generation = {
  id: string;
  prompt: string;
  referenceIds: string[];
  status: "generating" | "ready" | "failed" | "setup-needed";
  message?: string;
  videoUrl?: string;
  downloadUrl?: string;
  sourceImageUrl?: string;
  model?: string;
  createdAt: number;
};

export type Settings = {
  model: "bytedance/seedance-2.0" | "bytedance/seedance-2.0-fast";
  aspectRatio: "16:9" | "9:16" | "1:1" | "4:3" | "3:4";
  resolution: "480p" | "720p" | "1080p";
  duration: number;
  generateAudio: boolean;
  cameraFixed: boolean;
};

export type Project = {
  id: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  assets: ProjectAsset[];
  generations: Generation[];
  settings: Settings;
};

export const defaultSettings: Settings = {
  model: "bytedance/seedance-2.0",
  aspectRatio: "16:9",
  resolution: "720p",
  duration: 8,
  generateAudio: true,
  cameraFixed: false,
};

const STORAGE_KEY = "film-maker.projects.v1";
const ACTIVE_KEY = "film-maker.active-project.v1";

function newId() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function editorialName() {
  const words = [
    "Halcyon",
    "Ember",
    "Vesper",
    "Lantern",
    "Driftwood",
    "Harbor",
    "Meridian",
    "Quartz",
    "Coral",
    "Kestrel",
    "Lumen",
    "Parchment",
    "Saffron",
    "Tidal",
    "Umber",
  ];
  const suffixes = ["Reel", "Cut", "Take", "Study", "Piece", "Draft", "Frame"];
  const w = words[Math.floor(Math.random() * words.length)];
  const s = suffixes[Math.floor(Math.random() * suffixes.length)];
  return `${w} ${s}`;
}

function createProject(name?: string): Project {
  const now = Date.now();
  return {
    id: newId(),
    name: name ?? editorialName(),
    createdAt: now,
    updatedAt: now,
    assets: [],
    generations: [],
    settings: { ...defaultSettings },
  };
}

function load(): { projects: Project[]; activeId: string | null } {
  if (typeof window === "undefined") return { projects: [], activeId: null };
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const active = window.localStorage.getItem(ACTIVE_KEY);
    if (!raw) return { projects: [], activeId: active };
    const projects = JSON.parse(raw) as Project[];
    return { projects, activeId: active };
  } catch {
    return { projects: [], activeId: null };
  }
}

function persist(projects: Project[], activeId: string | null) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(projects));
  if (activeId) window.localStorage.setItem(ACTIVE_KEY, activeId);
}

function initialState(): {
  projects: Project[];
  activeId: string | null;
} {
  if (typeof window === "undefined") {
    return { projects: [], activeId: null };
  }
  const { projects: loaded, activeId: loadedActive } = load();
  if (loaded.length === 0) {
    const first = createProject("First Cut");
    persist([first], first.id);
    return { projects: [first], activeId: first.id };
  }
  const active =
    loadedActive && loaded.some((p) => p.id === loadedActive)
      ? loadedActive
      : loaded[0].id;
  return { projects: loaded, activeId: active };
}

export function useProjects() {
  const [state, setState] = useState(initialState);
  const [hydrated, setHydrated] = useState(false);
  const { projects, activeId } = state;

  useEffect(() => {
    // Flip once after client mount so SSR output matches initial client render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (hydrated) persist(projects, activeId);
  }, [projects, activeId, hydrated]);

  const activeProject = projects.find((p) => p.id === activeId) ?? null;

  const newProject = useCallback(() => {
    const project = createProject();
    setState((prev) => ({
      projects: [project, ...prev.projects],
      activeId: project.id,
    }));
    return project;
  }, []);

  const selectProject = useCallback((id: string) => {
    setState((prev) => ({ ...prev, activeId: id }));
  }, []);

  const renameProject = useCallback((id: string, name: string) => {
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) =>
        p.id === id
          ? { ...p, name: name.trim() || p.name, updatedAt: Date.now() }
          : p,
      ),
    }));
  }, []);

  const deleteProject = useCallback((id: string) => {
    setState((prev) => {
      const filtered = prev.projects.filter((p) => p.id !== id);
      if (filtered.length === 0) {
        const next = createProject("First Cut");
        return { projects: [next], activeId: next.id };
      }
      return {
        projects: filtered,
        activeId: prev.activeId === id ? filtered[0].id : prev.activeId,
      };
    });
  }, []);

  const updateActive = useCallback(
    (updater: (project: Project) => Project) => {
      setState((prev) => ({
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === prev.activeId ? { ...updater(p), updatedAt: Date.now() } : p,
        ),
      }));
    },
    [],
  );

  const libraryAssets: ProjectAsset[] = useMemo(() => {
    const seen = new Map<string, ProjectAsset>();
    for (const p of projects) {
      for (const asset of p.assets) {
        const dedupeKey = asset.key ?? asset.url;
        const existing = seen.get(dedupeKey);
        if (!existing || asset.createdAt < existing.createdAt) {
          seen.set(dedupeKey, asset);
        }
      }
    }
    return Array.from(seen.values()).sort(
      (a, b) => b.createdAt - a.createdAt,
    );
  }, [projects]);

  const attachAssetToActive = useCallback((asset: ProjectAsset) => {
    setState((prev) => {
      const active = prev.projects.find((p) => p.id === prev.activeId);
      if (!active) return prev;

      const dedupeKey = asset.key ?? asset.url;
      const already = active.assets.find(
        (a) => (a.key ?? a.url) === dedupeKey,
      );
      if (already) return prev;

      const taken = new Set(active.assets.map((a) => a.handle.toLowerCase()));
      let handle = asset.handle;
      if (taken.has(handle.toLowerCase())) {
        let n = 2;
        while (taken.has(`${asset.handle}${n}`.toLowerCase())) n += 1;
        handle = `${asset.handle}${n}`;
      }

      const copy: ProjectAsset = {
        ...asset,
        id: newId(),
        handle,
        createdAt: Date.now(),
      };

      return {
        ...prev,
        projects: prev.projects.map((p) =>
          p.id === prev.activeId
            ? { ...p, assets: [...p.assets, copy], updatedAt: Date.now() }
            : p,
        ),
      };
    });
  }, []);

  const purgeAssetByKey = useCallback((dedupeKey: string) => {
    setState((prev) => ({
      ...prev,
      projects: prev.projects.map((p) => ({
        ...p,
        assets: p.assets.filter((a) => (a.key ?? a.url) !== dedupeKey),
      })),
    }));
  }, []);

  return {
    hydrated,
    projects,
    activeProject,
    activeId,
    newProject,
    selectProject,
    renameProject,
    deleteProject,
    updateActive,
    libraryAssets,
    attachAssetToActive,
    purgeAssetByKey,
  };
}
