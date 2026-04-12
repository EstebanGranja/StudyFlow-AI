import { createClient } from "@insforge/sdk";
import { uploadPdfToGCS } from "@/lib/gcp/storage";
import { extractPdfMetadata } from "@/lib/pdf/extract-pdf-metadata";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

type DocumentStatus = "pending" | "processing" | "done" | "error";
type StudyPlanStatus = "processing" | "done" | "error";

type StudyDocument = {
  id: string;
  user_id: string;
  nombre: string;
  file_url: string;
  page_count?: number | null;
  file_size_bytes?: number | null;
  plan_id: string | null;
  status: DocumentStatus;
  created_at?: string;
};

type StudyPlan = {
  id: string;
  user_id: string;
  status: StudyPlanStatus;
};

type ParsedProcessRequest =
  | {
      kind: "document-id";
      documentId: string;
    }
  | {
      kind: "upload";
      studyPlanId: string;
      fileName: string;
      pdfBuffer: Buffer;
    };

type UploadDocumentInput = {
  studyPlanId: string;
  userId: string;
  fileName: string;
  fileUrl: string;
  storagePath: string;
  pageCount: number | null;
  fileSizeBytes: number;
};

class BadRequestError extends Error {}

type DatabaseErrorLike = {
  message?: unknown;
  details?: unknown;
  detail?: unknown;
  hint?: unknown;
  code?: unknown;
  statusText?: unknown;
  error?: unknown;
};

function asNonEmptyString(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function extractDatabaseErrorInfo(error: unknown): { code: string | null; message: string } {
  if (!error || typeof error !== "object") {
    return {
      code: null,
      message: "",
    };
  }

  const dbError = error as DatabaseErrorLike;
  const code = asNonEmptyString(dbError.code);

  const messageParts = [
    dbError.message,
    dbError.details,
    dbError.detail,
    dbError.hint,
    dbError.statusText,
    dbError.error,
  ]
    .map(asNonEmptyString)
    .filter((value): value is string => Boolean(value));

  const uniqueParts = Array.from(new Set(messageParts));

  if (code && !uniqueParts.some((part) => part.includes(code))) {
    uniqueParts.push(`code=${code}`);
  }

  return {
    code: code ? code.toUpperCase() : null,
    message: uniqueParts.join(" | "),
  };
}

function isMissingColumnError(errorCode: string | null, errorMessage: string): boolean {
  if (errorCode === "42703") {
    return true;
  }

  return /column.*does not exist|schema cache|not found/i.test(errorMessage);
}

function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };
  }

  return {
    error,
  };
}

function logProcessInfo(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[process-document][${requestId}] ${message}`, details);
    return;
  }

  console.info(`[process-document][${requestId}] ${message}`);
}

function logProcessWarn(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.warn(`[process-document][${requestId}] ${message}`, details);
    return;
  }

  console.warn(`[process-document][${requestId}] ${message}`);
}

function logProcessError(
  requestId: string,
  message: string,
  error: unknown,
  details?: Record<string, unknown>,
) {
  const payload = {
    ...(details ?? {}),
    error: serializeError(error),
  };

  console.error(`[process-document][${requestId}] ${message}`, payload);
}

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

function getInsforgeBaseUrl(): string {
  const value = process.env.INSFORGE_BASE_URL ?? process.env.NEXT_PUBLIC_INSFORGE_BASE_URL;
  if (!value) {
    throw new Error("Missing environment variable: INSFORGE_BASE_URL");
  }
  return value;
}

function getBearerToken(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (!authHeader) {
    return null;
  }

  const prefix = "Bearer ";
  if (!authHeader.startsWith(prefix)) {
    return null;
  }

  const token = authHeader.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}

function parseRequestBody(payload: unknown): { documentId: string } {
  if (!payload || typeof payload !== "object") {
    throw new BadRequestError("Invalid request body");
  }

  const body = payload as Record<string, unknown>;
  if (typeof body.documentId !== "string" || body.documentId.trim().length === 0) {
    throw new BadRequestError("documentId is required");
  }

  return {
    documentId: body.documentId,
  };
}

async function parseFormDataRequest(formData: FormData): Promise<{
  studyPlanId: string;
  fileName: string;
  pdfBuffer: Buffer;
}> {
  const planValue = formData.get("studyPlanId") ?? formData.get("study_plan_id");

  if (typeof planValue !== "string" || planValue.trim().length === 0) {
    throw new BadRequestError("studyPlanId is required in form-data");
  }

  const fileValue = formData.get("file");
  if (!(fileValue instanceof File)) {
    throw new BadRequestError("PDF file is required");
  }

  if (fileValue.size === 0) {
    throw new BadRequestError("Uploaded file is empty");
  }

  if (fileValue.size > MAX_UPLOAD_BYTES) {
    throw new BadRequestError("PDF exceeds maximum upload size (20 MB)");
  }

  const fileName = fileValue.name?.trim() || "documento.pdf";
  const isPdf = fileValue.type === "application/pdf" || fileName.toLowerCase().endsWith(".pdf");

  if (!isPdf) {
    throw new BadRequestError("Only PDF files are allowed");
  }

  const pdfBuffer = Buffer.from(await fileValue.arrayBuffer());

  const hasPdfSignature = pdfBuffer.subarray(0, 5).toString("ascii") === "%PDF-";
  if (!hasPdfSignature) {
    throw new BadRequestError("Uploaded file is not a valid PDF");
  }

  return {
    studyPlanId: planValue.trim(),
    fileName,
    pdfBuffer,
  };
}

async function parseIncomingRequest(request: Request): Promise<ParsedProcessRequest> {
  const contentType = request.headers.get("Content-Type")?.toLowerCase() ?? "";

  if (contentType.includes("multipart/form-data")) {
    const formData = await request.formData();
    const parsedUpload = await parseFormDataRequest(formData);

    return {
      kind: "upload",
      studyPlanId: parsedUpload.studyPlanId,
      fileName: parsedUpload.fileName,
      pdfBuffer: parsedUpload.pdfBuffer,
    };
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    throw new BadRequestError("Request body must be valid JSON or form-data");
  }

  const parsedJson = parseRequestBody(payload);

  return {
    kind: "document-id",
    documentId: parsedJson.documentId,
  };
}

async function updateDocumentStatus(
  client: ReturnType<typeof createClient>,
  documentId: string,
  status: DocumentStatus,
) {
  const { error } = await client.database
    .from("study_documents")
    .update({ status })
    .eq("id", documentId);

  if (error) {
    throw new Error(`Failed to update document status: ${error.message}`);
  }
}

async function updateStudyPlanStatus(
  client: ReturnType<typeof createClient>,
  studyPlanId: string,
  status: StudyPlanStatus,
) {
  const { error } = await client.database.from("study_plans").update({ status }).eq("id", studyPlanId);

  if (error) {
    throw new Error(`Failed to update study plan status: ${error.message}`);
  }
}

async function fetchDocument(
  client: ReturnType<typeof createClient>,
  documentId: string,
  userId: string,
): Promise<StudyDocument | null> {
  const { data, error } = await client.database
    .from("study_documents")
    .select("*")
    .eq("id", documentId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load document: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return data as StudyDocument;
}

async function fetchStudyPlan(
  client: ReturnType<typeof createClient>,
  studyPlanId: string,
  userId: string,
): Promise<StudyPlan | null> {
  const { data, error } = await client.database
    .from("study_plans")
    .select("id, user_id, status")
    .eq("id", studyPlanId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load study plan: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return data as StudyPlan;
}

async function createDocumentFromUpload(
  client: ReturnType<typeof createClient>,
  input: UploadDocumentInput,
): Promise<StudyDocument> {
  const baseName = input.fileName.replace(/\.pdf$/i, "").trim();
  const documentName = baseName.length > 0 ? baseName : "Documento";

  const requiredPayload = {
    plan_id: input.studyPlanId,
    user_id: input.userId,
    nombre: documentName,
    file_url: input.fileUrl,
    status: "done" as const,
  };

  const metadataPayload = {
    ...requiredPayload,
    page_count: input.pageCount,
    file_size_bytes: input.fileSizeBytes,
  };

  const legacyCompatiblePayload = {
    ...metadataPayload,
    title: documentName,
    source_file_name: input.fileName,
    storage_path: input.storagePath,
  };

  const payloadAttempts: Array<Record<string, unknown>> = [
    legacyCompatiblePayload,
    metadataPayload,
    requiredPayload,
  ];

  let latestError: unknown = null;

  for (const payload of payloadAttempts) {
    const { data, error } = await client.database.from("study_documents").insert([payload]).select("*").single();

    if (!error && data) {
      return data as StudyDocument;
    }

    latestError = error;

    const { code, message } = extractDatabaseErrorInfo(error);
    if (!isMissingColumnError(code, message)) {
      break;
    }
  }

  const dbErrorMessage = latestError ? extractDatabaseErrorInfo(latestError).message : "";
  throw new Error(`Failed to create study document: ${dbErrorMessage || "Unknown error"}`);
}

function buildSimpleResponse(document: StudyDocument) {
  return {
    success: true,
    mode: "simple-upload" as const,
    message: "Documento subido y registrado correctamente.",
    document: {
      id: document.id,
      studyPlanId: document.plan_id,
      status: document.status,
      fileName: document.nombre,
      fileUrl: document.file_url,
      pageCount: document.page_count ?? null,
      fileSizeBytes: document.file_size_bytes ?? null,
      createdAt: document.created_at ?? null,
    },
  };
}

export async function POST(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();
  const requestStartedAt = Date.now();

  try {
    logProcessInfo(requestId, "Inicio de subida simple de documento", {
      contentType: request.headers.get("Content-Type") ?? null,
      method: request.method,
      hasAuthorizationHeader: Boolean(request.headers.get("Authorization")),
    });

    const token = getBearerToken(request);
    if (!token) {
      logProcessWarn(requestId, "Solicitud rechazada: falta bearer token");
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    const parsedRequest = await parseIncomingRequest(request);

    const client = createClient({
      baseUrl: getInsforgeBaseUrl(),
      edgeFunctionToken: token,
      isServerMode: true,
    });

    const { data: currentUserData, error: currentUserError } = await client.auth.getCurrentUser();
    const currentUserId = currentUserData?.user?.id;

    if (currentUserError || !currentUserId) {
      logProcessWarn(requestId, "Solicitud rechazada: usuario no autenticado", {
        authError: currentUserError?.message ?? null,
      });
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    let document: StudyDocument;

    if (parsedRequest.kind === "upload") {
      logProcessInfo(requestId, "Request parseado como upload simple", {
        studyPlanId: parsedRequest.studyPlanId,
        fileName: parsedRequest.fileName,
        pdfBytes: parsedRequest.pdfBuffer.length,
      });

      const studyPlan = await fetchStudyPlan(client, parsedRequest.studyPlanId, currentUserId);

      if (!studyPlan) {
        return jsonResponse({ error: "Study plan not found" }, 404);
      }

      await updateStudyPlanStatus(client, studyPlan.id, "processing");

      const uploadResult = await uploadPdfToGCS({
        userId: currentUserId,
        studyPlanId: studyPlan.id,
        fileName: parsedRequest.fileName,
        pdfBuffer: parsedRequest.pdfBuffer,
      });

      const metadata = extractPdfMetadata(parsedRequest.pdfBuffer);

      document = await createDocumentFromUpload(client, {
        studyPlanId: studyPlan.id,
        userId: currentUserId,
        fileName: parsedRequest.fileName,
        fileUrl: uploadResult.fileUrl,
        storagePath: `gs://${uploadResult.bucketName}/${uploadResult.objectPath}`,
        pageCount: metadata.pageCount,
        fileSizeBytes: metadata.fileSizeBytes,
      });

      await updateStudyPlanStatus(client, studyPlan.id, "done");
    } else {
      logProcessInfo(requestId, "Request parseado como document-id", {
        documentId: parsedRequest.documentId,
      });

      const existingDocument = await fetchDocument(client, parsedRequest.documentId, currentUserId);

      if (!existingDocument) {
        return jsonResponse({ error: "Document not found" }, 404);
      }

      document = existingDocument;

      if (document.status !== "done") {
        await updateDocumentStatus(client, document.id, "done");
        document = {
          ...document,
          status: "done",
        };
      }

      if (document.plan_id) {
        await updateStudyPlanStatus(client, document.plan_id, "done");
      }
    }

    const totalDurationMs = Date.now() - requestStartedAt;
    logProcessInfo(requestId, "Documento subido y registrado", {
      documentId: document.id,
      studyPlanId: document.plan_id,
      pageCount: document.page_count ?? null,
      fileSizeBytes: document.file_size_bytes ?? null,
      durationMs: totalDurationMs,
    });

    return jsonResponse(buildSimpleResponse(document), 200);
  } catch (error) {
    if (error instanceof BadRequestError) {
      return jsonResponse({ error: error.message }, 400);
    }

    logProcessError(requestId, "Fallo en subida simple de documento", error, {
      durationMs: Date.now() - requestStartedAt,
    });

    const message = error instanceof Error ? error.message : "Unexpected error while uploading document";
    return jsonResponse({ error: message }, 500);
  }
}

export async function GET(request: Request): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    const token = getBearerToken(request);
    if (!token) {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    const url = new URL(request.url);
    const documentId = url.searchParams.get("documentId")?.trim();

    if (!documentId) {
      return jsonResponse({ error: "documentId is required" }, 400);
    }

    const client = createClient({
      baseUrl: getInsforgeBaseUrl(),
      edgeFunctionToken: token,
      isServerMode: true,
    });

    const { data: currentUserData, error: currentUserError } = await client.auth.getCurrentUser();
    const currentUserId = currentUserData?.user?.id;

    if (currentUserError || !currentUserId) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const document = await fetchDocument(client, documentId, currentUserId);

    if (!document) {
      return jsonResponse({ error: "Document not found" }, 404);
    }

    return jsonResponse({
      success: true,
      document: {
        id: document.id,
        studyPlanId: document.plan_id,
        status: document.status,
        fileName: document.nombre,
        fileUrl: document.file_url,
        pageCount: document.page_count ?? null,
        fileSizeBytes: document.file_size_bytes ?? null,
        createdAt: document.created_at ?? null,
      },
    });
  } catch (error) {
    logProcessError(requestId, "Fallo consultando documento", error);
    const message = error instanceof Error ? error.message : "Unexpected error while getting document";
    return jsonResponse({ error: message }, 500);
  }
}
