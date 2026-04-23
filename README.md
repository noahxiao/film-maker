# Film Maker

A Bun-powered Next.js creator workspace for asset-referenced AI video generation with Vercel AI Gateway, Seedance 2.0, Tailwind CSS v4, and HeroUI v3.

## Features

- Upload image, video, and audio assets into the left rail.
- Reference assets in the prompt with `@AssetName`.
- Generate Seedance 2.0 image-to-video jobs through `/api/video/generate`.
- Store uploaded references and generated MP4 files with Vercel Blob.
- Preview, open, and download generated videos.

## Setup

Install dependencies:

```bash
bun install
```

Create local environment variables:

```bash
cp .env.example .env.local
```

Set one AI Gateway auth option and the Blob token:

```bash
AI_GATEWAY_API_KEY=...
BLOB_READ_WRITE_TOKEN=...
```

On Vercel, you can use AI Gateway OIDC instead of `AI_GATEWAY_API_KEY`. Vercel Blob still needs `BLOB_READ_WRITE_TOKEN`.

Run the development server:

```bash
bun run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Scripts

- `bun run dev` starts the local dev server.
- `bun run build` creates a production build.
- `bun run start` starts the production server.
- `bun run lint` runs ESLint.

## Stack

- [Next.js](https://nextjs.org/docs) App Router
- [Bun](https://bun.com/docs/guides/ecosystem/nextjs)
- [Tailwind CSS](https://tailwindcss.com/docs/installation/framework-guides/nextjs)
- [HeroUI](https://heroui.com/docs/react/getting-started/quick-start)
- [Vercel AI Gateway](https://vercel.com/docs/ai-gateway)
- [Vercel Blob](https://vercel.com/docs/vercel-blob)

## Notes

Seedance image-to-video requires hosted image URLs, so local files are uploaded to Vercel Blob before the AI Gateway call. The API route returns `setup-needed` when credentials are missing, which keeps the UI usable before production secrets are connected.
