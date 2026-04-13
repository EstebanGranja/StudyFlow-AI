import { getAuthenticatedContext, jsonResponse } from "@/lib/insforge/server-auth";

export const runtime = "nodejs";

type StudyPlanSummary = {
  id: string;
  nombre: string;
  description: string | null;
  fecha_examen: string | null;
  status: "processing" | "done" | "error";
  created_at: string;
};

function normalizePair(leftUserId: string, rightUserId: string): { userAId: string; userBId: string } {
  if (leftUserId < rightUserId) {
    return {
      userAId: leftUserId,
      userBId: rightUserId,
    };
  }

  return {
    userAId: rightUserId,
    userBId: leftUserId,
  };
}

export async function GET(
  request: Request,
  context: { params: Promise<{ userId: string }> | { userId: string } },
): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);
    const params = await context.params;
    const userId = params?.userId?.trim();

    if (!userId) {
      return jsonResponse({ error: "userId is required" }, 400);
    }

    const { data: profileData, error: profileError } = await client.database
      .from("user_public_profiles")
      .select("user_id, email, display_name, avatar_url")
      .eq("user_id", userId)
      .maybeSingle();

    if (profileError) {
      return jsonResponse({ error: `No se pudo cargar el perfil: ${profileError.message}` }, 500);
    }

    if (!profileData) {
      return jsonResponse({ error: "Perfil no encontrado." }, 404);
    }

    let relationStatus: "self" | "friends" | "incoming_request" | "outgoing_request" | "none" = "none";
    let pendingRequestId: string | null = null;

    if (userId === user.id) {
      relationStatus = "self";
    } else {
      const { userAId, userBId } = normalizePair(user.id, userId);

      const { data: friendshipData, error: friendshipError } = await client.database
        .from("friendships")
        .select("id")
        .eq("user_a_id", userAId)
        .eq("user_b_id", userBId)
        .maybeSingle();

      if (friendshipError) {
        return jsonResponse({ error: `No se pudo validar amistad: ${friendshipError.message}` }, 500);
      }

      if (friendshipData) {
        relationStatus = "friends";
      } else {
        const { data: outgoingRequest, error: outgoingError } = await client.database
          .from("friend_requests")
          .select("id")
          .eq("sender_user_id", user.id)
          .eq("receiver_user_id", userId)
          .eq("status", "pending")
          .maybeSingle();

        if (outgoingError) {
          return jsonResponse({ error: `No se pudo validar solicitud enviada: ${outgoingError.message}` }, 500);
        }

        if (outgoingRequest) {
          relationStatus = "outgoing_request";
          pendingRequestId = outgoingRequest.id;
        } else {
          const { data: incomingRequest, error: incomingError } = await client.database
            .from("friend_requests")
            .select("id")
            .eq("sender_user_id", userId)
            .eq("receiver_user_id", user.id)
            .eq("status", "pending")
            .maybeSingle();

          if (incomingError) {
            return jsonResponse({ error: `No se pudo validar solicitud recibida: ${incomingError.message}` }, 500);
          }

          if (incomingRequest) {
            relationStatus = "incoming_request";
            pendingRequestId = incomingRequest.id;
          }
        }
      }
    }

    const { data: plansData, error: plansError } = await client.database
      .from("study_plans")
      .select("id, nombre, description, fecha_examen, status, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (plansError) {
      return jsonResponse({ error: `No se pudieron cargar los planes: ${plansError.message}` }, 500);
    }

    const plans = ((plansData as StudyPlanSummary[] | null) ?? []).filter((plan) => Boolean(plan?.id));

    return jsonResponse({
      success: true,
      profile: {
        userId: profileData.user_id,
        email: profileData.email,
        displayName: profileData.display_name,
        avatarUrl: profileData.avatar_url,
      },
      relation: {
        status: relationStatus,
        pendingRequestId,
      },
      plans,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while loading user profile";
    return jsonResponse({ error: message }, 500);
  }
}
