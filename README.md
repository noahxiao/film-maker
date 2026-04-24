# Film Maker

A Bun-powered Next.js creator workspace for asset-referenced AI video generation with Vercel AI Gateway, Seedance 2.0, Cloudflare R2, Tailwind CSS v4, and HeroUI v3.

## Features

- Upload image, video, and audio assets into the left rail.
- Reference assets in the prompt with `@AssetName`.
- Generate Seedance 2.0 image-to-video jobs through `/api/video/generate`.
- Store uploaded references and generated MP4 files in Cloudflare R2.
- Separate stored files by project, environment, tenant, user, folder, and object type.
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

Set one AI Gateway auth option:

```bash
AI_GATEWAY_API_KEY=...
```

On Vercel, you can use AI Gateway OIDC instead of `AI_GATEWAY_API_KEY`.

## Cloudflare R2

R2 is Cloudflare's S3-compatible object storage. Use a bucket as the broad storage container, then use object-key prefixes for project, tenant, user, and folder hierarchy.

Create R2 storage:

1. In Cloudflare, open **R2 object storage**.
2. Create a bucket, for example `creator-media`.
3. Open the bucket settings and enable either a custom domain or the public `r2.dev` development URL.
4. Copy that public URL into `R2_PUBLIC_BASE_URL`.
5. Go to **Manage R2 API Tokens** and create an Object Read & Write token scoped to this bucket.
6. Copy the Access Key ID and Secret Access Key into `.env.local`.

Required env:

```bash
R2_ACCOUNT_ID=your_cloudflare_account_id
R2_ACCESS_KEY_ID=your_r2_access_key_id
R2_SECRET_ACCESS_KEY=your_r2_secret_access_key
R2_BUCKET_NAME=creator-media
R2_PUBLIC_BASE_URL=https://your-public-r2-domain.example.com
```

Optional organization env:

```bash
R2_PROJECT_PREFIX=projects/film-maker
R2_ENVIRONMENT=development
```

Optional endpoint override:

```bash
# Only needed for jurisdiction-specific buckets.
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
```

Generated keys follow this shape:

```text
projects/film-maker/env/development/tenants/demo-tenant/users/demo-user/folders/default/references/2026/04/24/<uuid>-image.png
projects/film-maker/env/development/tenants/demo-tenant/users/demo-user/folders/default/outputs/2026/04/24/<uuid>-seedance-output.mp4
```

The creator UI currently sends `tenantId`, `userId`, and `folder` with every generation request. When real authentication is added, those values should come from the signed-in session instead of editable fields.

## Development

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
- [Cloudflare R2](https://developers.cloudflare.com/r2/)

## Notes

Seedance image-to-video needs hosted media URLs, so local files are uploaded to Cloudflare R2 before the AI Gateway call. The API route returns `setup-needed` when credentials are missing, which keeps the UI usable before production secrets are connected.
