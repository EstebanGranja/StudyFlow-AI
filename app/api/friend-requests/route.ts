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

type UserPublicProfileRow = {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

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

function normalizeStatus(value: string | null): FriendRequestStatus | "all" {
  if (value === "accepted" || value === "rejected" || value === "cancelled" || value === "pending") {
    return value;
  }

  if (value === "all") {
    return "all";
  }

  return "pending";
}

function resolveDirection(value: string | null): "incoming" | "outgoing" {
  if (value === "outgoing") {
    return "outgoing";
  }

  return "incoming";
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);
    const { searchParams } = new URL(request.url);
    const direction = resolveDirection(searchParams.get("direction"));
    const status = normalizeStatus(searchParams.get("status"));

    let query = client.database
      .from("friend_requests")
      .select("id, sender_user_id, receiver_user_id, status, created_at, responded_at")
      .order("created_at", { ascending: false })
      .limit(100);

    if (direction === "incoming") {
      query = query.eq("receiver_user_id", user.id);
    } else {
      query = query.eq("sender_user_id", user.id);
    }

    if (status !== "all") {
      query = query.eq("status", status);
    }

    const { data: requestsData, error: requestsError } = await query;

    if (requestsError) {
      return jsonResponse({ error: `No se pudo obtener las solicitudes: ${requestsError.message}` }, 500);
    }

    const requests = (requestsData as FriendRequestRow[] | null) ?? [];
    const userIds = Array.from(
      new Set(requests.flatMap((friendRequest) => [friendRequest.sender_user_id, friendRequest.receiver_user_id])),
    );

    const profilesByUserId = new Map<string, UserPublicProfileRow>();

    if (userIds.length > 0) {
      const { data: profilesData, error: profilesError } = await client.database
        .from("user_public_profiles")
        .select("user_id, email, display_name, avatar_url")
        .in("user_id", userIds);

      if (profilesError) {
        return jsonResponse({ error: `No se pudieron cargar los perfiles de solicitudes: ${profilesError.message}` }, 500);
      }

      for (const profile of (profilesData as UserPublicProfileRow[] | null) ?? []) {
        profilesByUserId.set(profile.user_id, profile);
      }
    }

    return jsonResponse({
      success: true,
      requests: requests.map((friendRequest) => {
        const senderProfile = profilesByUserId.get(friendRequest.sender_user_id);
        const receiverProfile = profilesByUserId.get(friendRequest.receiver_user_id);

        return {
          id: friendRequest.id,
          status: friendRequest.status,
          createdAt: friendRequest.created_at,
          respondedAt: friendRequest.responded_at,
          sender: {
            userId: friendRequest.sender_user_id,
            displayName: senderProfile?.display_name ?? "Usuario",
            email: senderProfile?.email ?? "",
            avatarUrl: senderProfile?.avatar_url ?? null,
          },
          receiver: {
            userId: friendRequest.receiver_user_id,
            displayName: receiverProfile?.display_name ?? "Usuario",
            email: receiverProfile?.email ?? "",
            avatarUrl: receiverProfile?.avatar_url ?? null,
          },
        };
      }),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while listing friend requests";
    return jsonResponse({ error: message }, 500);
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);

    let payload: unknown;

    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ error: "Request body must be valid JSON" }, 400);
    }

    if (!payload || typeof payload !== "object") {
      return jsonResponse({ error: "Invalid request body" }, 400);
    }

    const receiverUserId = (payload as { receiverUserId?: unknown }).receiverUserId;

    if (typeof receiverUserId !== "string" || !isUuid(receiverUserId)) {
      return jsonResponse({ error: "receiverUserId es invalido." }, 400);
    }

    if (receiverUserId === user.id) {
      return jsonResponse({ error: "No puedes enviarte una solicitud a ti mismo." }, 400);
    }

    const { data: receiverProfile, error: receiverError } = await client.database
      .from("user_public_profiles")
      .select("user_id")
      .eq("user_id", receiverUserId)
      .maybeSingle();

    if (receiverError) {
      return jsonResponse({ error: `No se pudo validar el usuario destino: ${receiverError.message}` }, 500);
    }

    if (!receiverProfile) {
      return jsonResponse({ error: "Usuario no encontrado." }, 404);
    }

    const { userAId, userBId } = normalizePair(user.id, receiverUserId);

    const { data: existingFriendship, error: friendshipError } = await client.database
      .from("friendships")
      .select("id")
      .eq("user_a_id", userAId)
      .eq("user_b_id", userBId)
      .maybeSingle();

    if (friendshipError) {
      return jsonResponse({ error: `No se pudo validar la amistad actual: ${friendshipError.message}` }, 500);
    }

    if (existingFriendship) {
      return jsonResponse({ error: "Ya son amigos." }, 409);
    }

    const { data: existingOutgoing, error: outgoingError } = await client.database
      .from("friend_requests")
      .select("id")
      .eq("sender_user_id", user.id)
      .eq("receiver_user_id", receiverUserId)
      .eq("status", "pending")
      .maybeSingle();

    if (outgoingError) {
      return jsonResponse({ error: `No se pudo validar solicitudes enviadas: ${outgoingError.message}` }, 500);
    }

    if (existingOutgoing) {
      return jsonResponse({ error: "Ya enviaste una solicitud a este usuario." }, 409);
    }

    const { data: existingIncoming, error: incomingError } = await client.database
      .from("friend_requests")
      .select("id")
      .eq("sender_user_id", receiverUserId)
      .eq("receiver_user_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (incomingError) {
      return jsonResponse({ error: `No se pudo validar solicitudes recibidas: ${incomingError.message}` }, 500);
    }

    if (existingIncoming) {
      return jsonResponse({ error: "Ya tienes una solicitud pendiente de este usuario." }, 409);
    }

    const { data: insertedRequest, error: insertError } = await client.database
      .from("friend_requests")
      .insert([
        {
          sender_user_id: user.id,
          receiver_user_id: receiverUserId,
          status: "pending",
        },
      ])
      .select("id, sender_user_id, receiver_user_id, status, created_at")
      .single();

    if (insertError || !insertedRequest) {
      const message = insertError?.message ?? "error desconocido";

      if (message.toLowerCase().includes("duplicate")) {
        return jsonResponse({ error: "Ya existe una solicitud pendiente entre ambos usuarios." }, 409);
      }

      return jsonResponse({ error: `No se pudo crear la solicitud: ${message}` }, 500);
    }

    return jsonResponse({
      success: true,
      request: {
        id: insertedRequest.id,
        senderUserId: insertedRequest.sender_user_id,
        receiverUserId: insertedRequest.receiver_user_id,
        status: insertedRequest.status,
        createdAt: insertedRequest.created_at,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while sending friend request";
    return jsonResponse({ error: message }, 500);
  }
}
