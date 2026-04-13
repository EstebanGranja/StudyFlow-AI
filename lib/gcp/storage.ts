import { Storage } from "@google-cloud/storage";

const DEFAULT_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;
const MAX_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 7;

type RequiredStorageEnv =
  | "GOOGLE_APPLICATION_CREDENTIALS"
  | "GOOGLE_CLOUD_PROJECT"
  | "GCP_BUCKET_NAME";

type GcsObjectReference = {
  bucketName: string;
  objectPath: string;
};

export type UploadPdfToGcsInput = {
  userId: string;
  studyPlanId: string;
  fileName: string;
  pdfBuffer: Buffer;
};

export type UploadAvatarToGcsInput = {
  userId: string;
  fileName: string;
  imageBuffer: Buffer;
  contentType: "image/jpeg" | "image/png" | "image/webp";
};

export type UploadPdfToGcsResult = {
  bucketName: string;
  objectPath: string;
  fileUrl: string;
};

export type UploadAvatarToGcsResult = {
  bucketName: string;
  objectPath: string;
  fileUrl: string;
};

export type DeletePdfFromGcsUrlResult = {
  deleted: boolean;
  skipped: boolean;
};

let storageClient: Storage | null = null;

function getRequiredEnv(name: RequiredStorageEnv): string {
  const value = process.env[name];

  if (!value) {
    throw new Error(`Missing environment variable: ${name}`);
  }

  return value;
}

function getStorageClient(): Storage {
  if (storageClient) {
    return storageClient;
  }

  // Force explicit ADC usage for local/server environments.
  getRequiredEnv("GOOGLE_APPLICATION_CREDENTIALS");

  storageClient = new Storage({
    projectId: getRequiredEnv("GOOGLE_CLOUD_PROJECT"),
  });

  return storageClient;
}

function sanitizeFileName(fileName: string): string {
  const trimmed = fileName.trim();

  if (!trimmed) {
    return "documento.pdf";
  }

  const normalized = trimmed
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");

  if (!normalized) {
    return "documento.pdf";
  }

  if (normalized.toLowerCase().endsWith(".pdf")) {
    return normalized;
  }

  return `${normalized}.pdf`;
}

function getSignedUrlTtlSeconds(): number {
  const raw = process.env.GCP_SIGNED_URL_TTL_SECONDS;

  if (!raw) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }

  const parsed = Number(raw);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_SIGNED_URL_TTL_SECONDS;
  }

  return Math.min(Math.floor(parsed), MAX_SIGNED_URL_TTL_SECONDS);
}

function getUploadUrlMode(): "signed" | "public" {
  const raw = (process.env.GCP_UPLOAD_URL_MODE ?? "public").toLowerCase();

  if (raw === "public") {
    return "public";
  }

  return "signed";
}

function encodeObjectPathForUrl(objectPath: string): string {
  return objectPath
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildPublicUrl(bucketName: string, objectPath: string): string {
  return `https://storage.googleapis.com/${bucketName}/${encodeObjectPathForUrl(objectPath)}`;
}

function buildObjectPath(input: UploadPdfToGcsInput): string {
  const safeFileName = sanitizeFileName(input.fileName);
  const objectId = `${Date.now()}-${crypto.randomUUID()}`;

  return `study-plans/${input.userId}/${input.studyPlanId}/${objectId}-${safeFileName}`;
}

function getAvatarFileExtension(contentType: UploadAvatarToGcsInput["contentType"]): string {
  if (contentType === "image/jpeg") {
    return "jpg";
  }

  if (contentType === "image/png") {
    return "png";
  }

  return "webp";
}

function buildAvatarObjectPath(input: UploadAvatarToGcsInput): string {
  const extension = getAvatarFileExtension(input.contentType);
  const objectId = `${Date.now()}-${crypto.randomUUID()}`;

  return `avatars/${input.userId}/${objectId}.${extension}`;
}

function parseGcsReference(fileUrl: string): GcsObjectReference | null {
  if (fileUrl.startsWith("gs://")) {
    const gsPath = fileUrl.slice("gs://".length);
    const slashIndex = gsPath.indexOf("/");

    if (slashIndex <= 0) {
      return null;
    }

    const bucketName = gsPath.slice(0, slashIndex);
    const objectPath = gsPath.slice(slashIndex + 1);

    if (!bucketName || !objectPath) {
      return null;
    }

    return {
      bucketName,
      objectPath,
    };
  }

  let url: URL;

  try {
    url = new URL(fileUrl);
  } catch {
    return null;
  }

  if (url.protocol !== "https:") {
    return null;
  }

  if (url.hostname === "storage.googleapis.com") {
    const parts = url.pathname.split("/").filter((part) => part.length > 0);

    if (parts.length < 2) {
      return null;
    }

    const [bucketName, ...objectParts] = parts;

    return {
      bucketName,
      objectPath: objectParts.map((part) => decodeURIComponent(part)).join("/"),
    };
  }

  const storageDomainSuffix = ".storage.googleapis.com";
  if (url.hostname.endsWith(storageDomainSuffix)) {
    const bucketName = url.hostname.slice(0, -storageDomainSuffix.length);
    const objectPath = url.pathname.replace(/^\/+/, "");

    if (!bucketName || !objectPath) {
      return null;
    }

    return {
      bucketName,
      objectPath: objectPath
        .split("/")
        .filter((part) => part.length > 0)
        .map((part) => decodeURIComponent(part))
        .join("/"),
    };
  }

  return null;
}

export async function uploadPdfToGCS(input: UploadPdfToGcsInput): Promise<UploadPdfToGcsResult> {
  if (!input.pdfBuffer || input.pdfBuffer.length === 0) {
    throw new Error("PDF buffer is empty");
  }

  const storage = getStorageClient();
  const bucketName = getRequiredEnv("GCP_BUCKET_NAME");
  const objectPath = buildObjectPath(input);
  const file = storage.bucket(bucketName).file(objectPath);

  await file.save(input.pdfBuffer, {
    resumable: false,
    contentType: "application/pdf",
    metadata: {
      contentType: "application/pdf",
      metadata: {
        original_file_name: sanitizeFileName(input.fileName),
        study_plan_id: input.studyPlanId,
        user_id: input.userId,
      },
    },
  });

  const mode = getUploadUrlMode();

  if (mode === "public") {
    return {
      bucketName,
      objectPath,
      fileUrl: buildPublicUrl(bucketName, objectPath),
    };
  }

  const [fileUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + getSignedUrlTtlSeconds() * 1000,
  });

  return {
    bucketName,
    objectPath,
    fileUrl,
  };
}

export async function uploadAvatarToGCS(input: UploadAvatarToGcsInput): Promise<UploadAvatarToGcsResult> {
  if (!input.imageBuffer || input.imageBuffer.length === 0) {
    throw new Error("Avatar buffer is empty");
  }

  const storage = getStorageClient();
  const bucketName = getRequiredEnv("GCP_BUCKET_NAME");
  const objectPath = buildAvatarObjectPath(input);
  const file = storage.bucket(bucketName).file(objectPath);

  await file.save(input.imageBuffer, {
    resumable: false,
    contentType: input.contentType,
    metadata: {
      contentType: input.contentType,
      metadata: {
        original_file_name: sanitizeFileName(input.fileName),
        user_id: input.userId,
      },
    },
  });

  const mode = getUploadUrlMode();

  if (mode === "public") {
    return {
      bucketName,
      objectPath,
      fileUrl: buildPublicUrl(bucketName, objectPath),
    };
  }

  const [fileUrl] = await file.getSignedUrl({
    version: "v4",
    action: "read",
    expires: Date.now() + getSignedUrlTtlSeconds() * 1000,
  });

  return {
    bucketName,
    objectPath,
    fileUrl,
  };
}

export async function downloadPdfFromGCSUrl(fileUrl: string): Promise<Buffer | null> {
  const reference = parseGcsReference(fileUrl);

  if (!reference) {
    return null;
  }

  const storage = getStorageClient();
  const [buffer] = await storage.bucket(reference.bucketName).file(reference.objectPath).download();

  return buffer;
}

async function deleteObjectFromGCSUrl(fileUrl: string): Promise<DeletePdfFromGcsUrlResult> {
  const reference = parseGcsReference(fileUrl);

  if (!reference) {
    return {
      deleted: false,
      skipped: true,
    };
  }

  const storage = getStorageClient();
  await storage
    .bucket(reference.bucketName)
    .file(reference.objectPath)
    .delete({ ignoreNotFound: true });

  return {
    deleted: true,
    skipped: false,
  };
}

export async function deletePdfFromGCSUrl(fileUrl: string): Promise<DeletePdfFromGcsUrlResult> {
  return deleteObjectFromGCSUrl(fileUrl);
}

export async function deleteAvatarFromGCSUrl(fileUrl: string): Promise<DeletePdfFromGcsUrlResult> {
  return deleteObjectFromGCSUrl(fileUrl);
}