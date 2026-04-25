import { NextResponse } from "next/server";

function failed(message: string, status = 400) {
  return NextResponse.json({ status: "failed", message }, { status });
}

function isAllowedVideoUrl(url: URL) {
  const publicBase = process.env.R2_PUBLIC_BASE_URL;
  if (!publicBase) return false;

  const allowedBase = new URL(publicBase);
  const allowedPath = allowedBase.pathname.replace(/\/+$/, "");

  return (
    url.origin === allowedBase.origin &&
    (allowedPath.length === 0 ||
      url.pathname === allowedPath ||
      url.pathname.startsWith(`${allowedPath}/`))
  );
}

function filenameFromRequest(value: string | null) {
  const fallback = "seedance-output.mp4";
  if (!value) return fallback;

  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || fallback
  );
}

function contentDisposition(filename: string) {
  return `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(
    filename,
  )}`;
}

async function fetchVideo(request: Request, method: "GET" | "HEAD") {
  const requestUrl = new URL(request.url);
  const rawUrl = requestUrl.searchParams.get("url");
  if (!rawUrl) return failed("Missing video URL.");

  let videoUrl: URL;
  try {
    videoUrl = new URL(rawUrl);
  } catch {
    return failed("Invalid video URL.");
  }

  if (!isAllowedVideoUrl(videoUrl)) {
    return failed("Video URL is not allowed.", 403);
  }

  const upstreamHeaders = new Headers();
  const range = request.headers.get("range");
  if (range) upstreamHeaders.set("range", range);

  const upstream = await fetch(videoUrl, {
    cache: "no-store",
    headers: upstreamHeaders,
    method,
  });
  if (!upstream.ok || (method === "GET" && !upstream.body)) {
    return failed("Video file is not available.", upstream.status || 502);
  }

  const filename = filenameFromRequest(requestUrl.searchParams.get("filename"));
  const headers = new Headers({
    "Accept-Ranges": upstream.headers.get("accept-ranges") ?? "bytes",
    "Content-Disposition": contentDisposition(filename),
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Cache-Control": "private, no-store",
  });

  for (const name of [
    "content-length",
    "content-range",
    "etag",
    "last-modified",
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(method === "HEAD" ? null : upstream.body, {
    headers,
    status: upstream.status,
    statusText: upstream.statusText,
  });
}

export async function GET(request: Request) {
  return fetchVideo(request, "GET");
}

export async function HEAD(request: Request) {
  return fetchVideo(request, "HEAD");
}
