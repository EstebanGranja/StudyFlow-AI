import { getAuthenticatedContext, jsonResponse } from "@/lib/insforge/server-auth";
import { type StudyStatusPlanRow, resolveCurrentStudyStatusMap } from "@/lib/study-plans/current-study-status";

export const runtime = "nodejs";

type FriendshipRow = {
  id: string;
  user_a_id: string;
  user_b_id: string;
  created_at: string;
};

type UserPublicProfileRow = {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);

    const [{ data: firstSideData, error: firstSideError }, { data: secondSideData, error: secondSideError }] =
      await Promise.all([
        client.database
          .from("friendships")
          .select("id, user_a_id, user_b_id, created_at")
          .eq("user_a_id", user.id),
        client.database
          .from("friendships")
          .select("id, user_a_id, user_b_id, created_at")
          .eq("user_b_id", user.id),
      ]);

    if (firstSideError || secondSideError) {
      return jsonResponse(
        {
          error: `No se pudo obtener la lista de amigos: ${
            firstSideError?.message ?? secondSideError?.message ?? "error desconocido"
          }`,
        },
        500,
      );
    }

    const friendships = [
      ...((firstSideData as FriendshipRow[] | null) ?? []),
      ...((secondSideData as FriendshipRow[] | null) ?? []),
    ];

    const friendIds = Array.from(
      new Set(
        friendships.map((friendship) =>
          friendship.user_a_id === user.id ? friendship.user_b_id : friendship.user_a_id,
        ),
      ),
    );

    if (friendIds.length === 0) {
      return jsonResponse({
        success: true,
        friends: [],
      });
    }

    const { data: profilesData, error: profilesError } = await client.database
      .from("user_public_profiles")
      .select("user_id, email, display_name, avatar_url")
      .in("user_id", friendIds);

    if (profilesError) {
      return jsonResponse({ error: `No se pudieron cargar los perfiles de amigos: ${profilesError.message}` }, 500);
    }

    const profilesByUserId = new Map<string, UserPublicProfileRow>();

    for (const profile of (profilesData as UserPublicProfileRow[] | null) ?? []) {
      profilesByUserId.set(profile.user_id, profile);
    }

    const referenceDate = new Date();
    const startOfDayUtc = new Date(
      Date.UTC(referenceDate.getUTCFullYear(), referenceDate.getUTCMonth(), referenceDate.getUTCDate()),
    ).toISOString();

    const { data: plansData, error: plansError } = await client.database
      .from("study_plans")
      .select("user_id, nombre, fecha_examen")
      .in("user_id", friendIds)
      .not("fecha_examen", "is", null)
      .gte("fecha_examen", startOfDayUtc)
      .order("fecha_examen", { ascending: true });

    if (plansError) {
      return jsonResponse({ error: `No se pudieron cargar los estados de estudio: ${plansError.message}` }, 500);
    }

    const statusByUserId = resolveCurrentStudyStatusMap((plansData as StudyStatusPlanRow[] | null) ?? []);

    const friends = friendIds
      .map((friendId) => {
        const profile = profilesByUserId.get(friendId);
        const friendship = friendships.find((row) => row.user_a_id === friendId || row.user_b_id === friendId);

        return {
          userId: friendId,
          displayName: profile?.display_name ?? "Usuario",
          email: profile?.email ?? "",
          avatarUrl: profile?.avatar_url ?? null,
          friendsSince: friendship?.created_at ?? null,
          studyStatusLabel: statusByUserId.get(friendId)?.label ?? null,
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName, "es", { sensitivity: "base" }));

    return jsonResponse({
      success: true,
      friends,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while listing friends";
    return jsonResponse({ error: message }, 500);
  }
}
