import { getInsforgeClient } from "@/lib/insforge/client";
import type { StudyPlanStatus } from "@/lib/insforge/study.types";

type CreateStudyPlanInput = {
  title: string;
  description?: string;
  nivel?: string;
  file: File;
};

type CreateStudyPlanResult = {
  planId: string;
  documentId: string;
};

type ProcessDocumentResponse = {
  success?: boolean;
  mode?: "simple-upload";
  message?: string;
  document?: {
    id: string;
    studyPlanId: string | null;
    status: "pending" | "processing" | "done" | "error";
    fileName: string;
    fileUrl: string;
    pageCount: number | null;
    fileSizeBytes: number | null;
    createdAt: string | null;
  };
  error?: string;
};

function buildOperationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `create-plan-${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function logCreateStudyPlanInfo(operationId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[create-study-plan][${operationId}] ${message}`, details);
    return;
  }

  console.info(`[create-study-plan][${operationId}] ${message}`);
}

function logCreateStudyPlanWarn(operationId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.warn(`[create-study-plan][${operationId}] ${message}`, details);
    return;
  }

  console.warn(`[create-study-plan][${operationId}] ${message}`);
}

function logCreateStudyPlanError(
  operationId: string,
  message: string,
  error: unknown,
  details?: Record<string, unknown>,
) {
  const payload = {
    ...(details ?? {}),
    error: serializeError(error),
  };

  console.error(`[create-study-plan][${operationId}] ${message}`, payload);
}

function getAuthHeader(): string {
  const client = getInsforgeClient();
  const headers = client.getHttpClient().getHeaders();
  const token = headers.Authorization ?? headers.authorization;

  if (!token) {
    throw new Error("No hay sesion activa para autorizar el procesamiento.");
  }

  return token;
}

function normalizeOptionalText(value: string | undefined): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function toUserFriendlyProcessError(message: string): string {
  return message;
}

function getApiProcessError(payload: ProcessDocumentResponse | null): string {
  const rawError = payload?.error;

  if (typeof rawError === "string") {
    const normalized = rawError.trim();

    if (normalized.length > 0) {
      return normalized;
    }
  }

  return "Fallo el procesamiento del documento.";
}

async function setStudyPlanStatus(planId: string, status: StudyPlanStatus, userId: string) {
  const client = getInsforgeClient();

  const { error } = await client.database
    .from("study_plans")
    .update({ status })
    .eq("id", planId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`No se pudo actualizar el estado del plan: ${error.message}`);
  }
}

export async function createStudyPlan(input: CreateStudyPlanInput): Promise<CreateStudyPlanResult> {
  const operationId = buildOperationId();
  const startedAt = Date.now();
  let createdPlanId: string | null = null;

  logCreateStudyPlanInfo(operationId, "Inicio de creacion de study plan", {
    titleLength: input.title.trim().length,
    hasDescription: Boolean(normalizeOptionalText(input.description)),
    nivel: normalizeOptionalText(input.nivel),
    fileName: input.file?.name ?? null,
    fileType: input.file?.type ?? null,
    fileBytes: input.file?.size ?? null,
  });

  const client = getInsforgeClient();

  const { data: currentUserData, error: currentUserError } = await client.auth.getCurrentUser();
  const userId = currentUserData?.user?.id;

  if (currentUserError || !userId) {
    logCreateStudyPlanWarn(operationId, "No hay usuario autenticado", {
      authError: currentUserError?.message ?? null,
    });
    throw new Error("No hay usuario autenticado.");
  }

  logCreateStudyPlanInfo(operationId, "Usuario autenticado para crear plan", {
    userId,
  });

  const title = input.title.trim();
  if (!title) {
    logCreateStudyPlanWarn(operationId, "Validacion fallida: titulo vacio");
    throw new Error("El titulo del plan es obligatorio.");
  }

  if (!input.file) {
    logCreateStudyPlanWarn(operationId, "Validacion fallida: PDF no seleccionado");
    throw new Error("Debes seleccionar un PDF.");
  }

  logCreateStudyPlanInfo(operationId, "Creando study plan en base de datos", {
    userId,
    title,
  });

  const { data: createdPlan, error: createPlanError } = await client.database
    .from("study_plans")
    .insert([
      {
        user_id: userId,
        nombre: title,
        description: normalizeOptionalText(input.description),
        nivel: normalizeOptionalText(input.nivel),
        status: "processing" as const,
      },
    ])
    .select("id")
    .single();

  if (createPlanError || !createdPlan?.id) {
    logCreateStudyPlanError(
      operationId,
      "Fallo al crear el study plan en base de datos",
      createPlanError ?? new Error("No se obtuvo id de study plan"),
    );
    throw new Error(`No se pudo crear el plan: ${createPlanError?.message ?? "Error desconocido"}`);
  }

  const planId = createdPlan.id as string;
  createdPlanId = planId;

  logCreateStudyPlanInfo(operationId, "Study plan creado", {
    planId,
  });

  try {
    const formData = new FormData();
    formData.append("studyPlanId", planId);
    formData.append("file", input.file, input.file.name);

    logCreateStudyPlanInfo(operationId, "Enviando PDF a /api/process-document", {
      planId,
      fileName: input.file.name,
      fileBytes: input.file.size,
    });

    const response = await fetch("/api/process-document", {
      method: "POST",
      headers: {
        Authorization: getAuthHeader(),
      },
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as ProcessDocumentResponse | null;

    logCreateStudyPlanInfo(operationId, "Respuesta recibida desde /api/process-document", {
      planId,
      ok: response.ok,
      status: response.status,
      mode: payload?.mode ?? null,
      documentId: payload?.document?.id ?? null,
      documentStatus: payload?.document?.status ?? null,
      pageCount: payload?.document?.pageCount ?? null,
      fileSizeBytes: payload?.document?.fileSizeBytes ?? null,
      apiError: payload?.error ?? null,
    });

    if (!response.ok) {
      throw new Error(toUserFriendlyProcessError(getApiProcessError(payload)));
    }

    if (!payload?.document?.id) {
      throw new Error("La API no devolvio documentId.");
    }

    logCreateStudyPlanInfo(operationId, "Creacion y registro de PDF completados", {
      planId,
      documentId: payload.document.id,
      pageCount: payload.document.pageCount,
      fileSizeBytes: payload.document.fileSizeBytes,
      durationMs: Date.now() - startedAt,
    });

    return {
      planId,
      documentId: payload.document.id,
    };
  } catch (error) {
    logCreateStudyPlanError(operationId, "Fallo durante subida del PDF", error, {
      planId: createdPlanId,
      durationMs: Date.now() - startedAt,
    });

    try {
      await setStudyPlanStatus(planId, "error", userId);
      logCreateStudyPlanWarn(operationId, "Study plan marcado como error tras fallo", {
        planId,
      });
    } catch {
      logCreateStudyPlanWarn(operationId, "No se pudo marcar el study plan como error", {
        planId,
      });
    }

    throw error;
  }
}
