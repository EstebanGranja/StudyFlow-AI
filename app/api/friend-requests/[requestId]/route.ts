import { getAuthenticatedContext, jsonResponse } from "@/lib/insforge/server-auth";

export const runtime = "nodejs";

type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

type FriendRequestRow = {
  id: string;
  sender_user_id: string;
  receiver_user_id: string;
  status: FriendRequestStatus;
  created_at: string;
  responded_at: string | null;
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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ requestId: string }> | { requestId: string } },
): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);
    const params = await context.params;
    const requestId = params?.requestId?.trim();

    if (!requestId) {
      return jsonResponse({ error: "requestId is required" }, 400);
    }

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON" }, 400);
    }

    if (!payload || typeof payload !== "object") {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    const action = (payload as { action?: unknown }).action;

    if (action !== "accept" && action !== "reject") {
      return jsonResponse({ error: "action debe ser accept o reject." }, 400);
    }

    const { data: friendRequest, error: requestError } = await client.database
      .from("friend_requests")
      .select("id, sender_user_id, receiver_user_id, status, created_at, responded_at")
      .eq("id", requestId)
      .eq("receiver_user_id", user.id)
      .maybeSingle();

    if (requestError) {
      return jsonResponse({ error: `No se pudo cargar la solicitud: ${requestError.message}` }, 500);
    }

    const currentRequest = friendRequest as FriendRequestRow | null;

    if (!currentRequest) {
      return jsonResponse({ error: "Solicitud no encontrada." }, 404);
    }

    if (currentRequest.status !== "pending") {
      return jsonResponse({ error: "La solicitud ya fue respondida." }, 409);
    }

    const nextStatus: FriendRequestStatus = action === "accept" ? "accepted" : "rejected";

    const { data: updatedRequest, error: updateError } = await client.database
      .from("friend_requests")
      .update({ status: nextStatus })
      .eq("id", requestId)
      .eq("receiver_user_id", user.id)
      .eq("status", "pending")
      .select("id, sender_user_id, receiver_user_id, status, created_at, responded_at")
      .maybeSingle();

    if (updateError) {
      return jsonResponse({ error: `No se pudo actualizar la solicitud: ${updateError.message}` }, 500);
    }

    if (!updatedRequest) {
      return jsonResponse({ error: "La solicitud ya no esta pendiente." }, 409);
    }

    let friendshipCreated = false;

    if (nextStatus === "accepted") {
      const { userAId, userBId } = normalizePair(updatedRequest.sender_user_id, updatedRequest.receiver_user_id);

      const { data: existingFriendship, error: existingFriendshipError } = await client.database
        .from("friendships")
        .select("id")
        .eq("user_a_id", userAId)
        .eq("user_b_id", userBId)
        .maybeSingle();

      if (existingFriendshipError) {
        return jsonResponse(
          { error: `No se pudo validar la relacion de amistad: ${existingFriendshipError.message}` },
          500,
        );
      }

      if (!existingFriendship) {
        const { error: insertFriendshipError } = await client.database.from("friendships").insert([
          {
            user_a_id: userAId,
            user_b_id: userBId,
          },
        ]);

        if (insertFriendshipError) {
          const normalizedMessage = insertFriendshipError.message.toLowerCase();

          if (!normalizedMessage.includes("duplicate")) {
            return jsonResponse(
              { error: `No se pudo crear la amistad: ${insertFriendshipError.message}` },
              500,
            );
          }
        } else {
          friendshipCreated = true;
        }
      }
    }

    return jsonResponse({
      success: true,
      request: {
        id: updatedRequest.id,
        senderUserId: updatedRequest.sender_user_id,
        receiverUserId: updatedRequest.receiver_user_id,
        status: updatedRequest.status,
        createdAt: updatedRequest.created_at,
        respondedAt: updatedRequest.responded_at,
      },
      friendshipCreated,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while responding friend request";
    return jsonResponse({ error: message }, 500);
  }
}
