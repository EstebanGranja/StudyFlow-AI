import { createClient } from "@insforge/sdk";
import { deletePdfFromGCSUrl } from "@/lib/gcp/storage";

export const runtime = "nodejs";

type StudyPlan = {
  id: string;
  user_id: string;
};

type StudyDocument = {
  id: string;
  file_url: string | null;
};

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
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

function logDeletePlanInfo(requestId: string, message: string, details?: Record<string, unknown>) {
  if (details) {
    console.info(`[delete-study-plan][${requestId}] ${message}`, details);
    return;
  }

  console.info(`[delete-study-plan][${requestId}] ${message}`);
}

function logDeletePlanError(
  requestId: string,
  message: string,
  error: unknown,
  details?: Record<string, unknown>,
) {
  const payload = {
    ...(details ?? {}),
    error: serializeError(error),
  };

  console.error(`[delete-study-plan][${requestId}] ${message}`, payload);
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

async function fetchStudyPlan(
  client: ReturnType<typeof createClient>,
  planId: string,
  userId: string,
): Promise<StudyPlan | null> {
  const { data, error } = await client.database
    .from("study_plans")
    .select("id, user_id")
    .eq("id", planId)
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

async function fetchPlanDocuments(
  client: ReturnType<typeof createClient>,
  planId: string,
  userId: string,
): Promise<StudyDocument[]> {
  const { data, error } = await client.database
    .from("study_documents")
    .select("id, file_url")
    .eq("plan_id", planId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to load study documents: ${error.message}`);
  }

  return (data as StudyDocument[] | null) ?? [];
}

async function deleteStudyPlan(
  client: ReturnType<typeof createClient>,
  planId: string,
  userId: string,
): Promise<void> {
  const { error } = await client.database
    .from("study_plans")
    .delete()
    .eq("id", planId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to delete study plan: ${error.message}`);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ planId: string }> | { planId: string } },
): Promise<Response> {
  const requestId = crypto.randomUUID();

  try {
    const token = getBearerToken(request);

    if (!token) {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    const params = await context.params;
    const planId = params?.planId?.trim();

    if (!planId) {
      return jsonResponse({ error: "planId is required" }, 400);
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

    const plan = await fetchStudyPlan(client, planId, currentUserId);

    if (!plan) {
      return jsonResponse({ error: "Study plan not found" }, 404);
    }

    const documents = await fetchPlanDocuments(client, planId, currentUserId);
    const uniqueUrls = Array.from(
      new Set(
        documents
          .map((document) => (typeof document.file_url === "string" ? document.file_url.trim() : ""))
          .filter((value) => value.length > 0),
      ),
    );

    let deletedObjects = 0;
    let skippedObjects = 0;

    for (const fileUrl of uniqueUrls) {
      try {
        const result = await deletePdfFromGCSUrl(fileUrl);

        if (result.deleted) {
          deletedObjects += 1;
        }

        if (result.skipped) {
          skippedObjects += 1;
        }
      } catch (error) {
        logDeletePlanError(requestId, "Fallo eliminando objeto PDF del bucket", error, {
          planId,
          fileUrl,
        });

        return jsonResponse(
          {
            error:
              "No se pudo eliminar uno o mas PDFs del bucket. El plan no fue eliminado para evitar inconsistencias.",
          },
          500,
        );
      }
    }

    await deleteStudyPlan(client, planId, currentUserId);

    logDeletePlanInfo(requestId, "Plan eliminado correctamente", {
      planId,
      documentsCount: documents.length,
      deletedObjects,
      skippedObjects,
    });

    return jsonResponse({
      success: true,
      planId,
      documentsDeleted: documents.length,
      bucketObjectsDeleted: deletedObjects,
      bucketObjectsSkipped: skippedObjects,
    });
  } catch (error) {
    logDeletePlanError(requestId, "Fallo eliminando plan", error);
    const message = error instanceof Error ? error.message : "Unexpected error while deleting study plan";
    return jsonResponse({ error: message }, 500);
  }
}