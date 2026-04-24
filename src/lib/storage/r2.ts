import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

type StorageArea = "references" | "outputs";

type StorageKeyInput = {
  area: StorageArea;
  filename: string;
  tenantId?: string;
  userId?: string;
  folder?: string;
};

type UploadObjectInput = {
  key: string;
  body: Buffer | Uint8Array;
  contentType: string;
};

export type UploadedObject = {
  key: string;
  url: string;
  downloadUrl: string;
  contentType: string;
};

const requiredEnv = [
  "R2_ACCOUNT_ID",
  "R2_ACCESS_KEY_ID",
  "R2_SECRET_ACCESS_KEY",
  "R2_BUCKET_NAME",
  "R2_PUBLIC_BASE_URL",
] as const;

let client: S3Client | null = null;

export function getMissingR2Env() {
  return requiredEnv.filter((key) => !process.env[key]);
}

function getR2Client() {
  if (client) return client;

  const endpoint =
    process.env.R2_ENDPOINT ||
    `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;

  client = new S3Client({
    region: "auto",
    endpoint,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
    },
  });

  return client;
}

function sanitizeSegment(value: string, fallback: string) {
  return (
    value
      .trim()
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 96) || fallback
  );
}

function sanitizeFilename(value: string) {
  return sanitizeSegment(value, "file");
}

function projectPrefixSegments() {
  const prefix = process.env.R2_PROJECT_PREFIX || "projects/film-maker";

  return prefix
    .split("/")
    .map((segment) => sanitizeSegment(segment, "project"))
    .filter(Boolean);
}

function storageEnvironment() {
  return sanitizeSegment(
    process.env.R2_ENVIRONMENT ||
      process.env.VERCEL_ENV ||
      process.env.NODE_ENV ||
      "development",
    "development",
  );
}

function dateSegments(date = new Date()) {
  return [
    String(date.getUTCFullYear()),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ];
}

function publicUrlForKey(key: string) {
  const baseUrl = process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, "");
  if (!baseUrl) {
    throw new Error("R2_PUBLIC_BASE_URL is required.");
  }

  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${baseUrl}/${encodedKey}`;
}

export function createStorageKey({
  area,
  filename,
  tenantId = "demo-tenant",
  userId = "demo-user",
  folder = "default",
}: StorageKeyInput) {
  const segments = [
    ...projectPrefixSegments(),
    "env",
    storageEnvironment(),
    "tenants",
    sanitizeSegment(tenantId, "demo-tenant"),
    "users",
    sanitizeSegment(userId, "demo-user"),
    "folders",
    sanitizeSegment(folder, "default"),
    area,
    ...dateSegments(),
    `${crypto.randomUUID()}-${sanitizeFilename(filename)}`,
  ];

  return segments.join("/");
}

export async function uploadObjectToR2({
  key,
  body,
  contentType,
}: UploadObjectInput): Promise<UploadedObject> {
  await getR2Client().send(
    new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );

  const url = publicUrlForKey(key);

  return {
    key,
    url,
    downloadUrl: url,
    contentType,
  };
}
