import { getAuthenticatedContext, jsonResponse } from "@/lib/insforge/server-auth";

export const runtime = "nodejs";

type UserPublicProfileRow = {
  user_id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
};

function normalizeSearchTerm(value: string | null): string {
  if (!value) {
    return "";
  }

  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

function includesNormalized(source: string | null | undefined, searchTerm: string): boolean {
  if (!source) {
    return false;
  }

  return source.toLowerCase().includes(searchTerm);
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);
    const { searchParams } = new URL(request.url);
    const searchTerm = normalizeSearchTerm(searchParams.get("q"));

    if (searchTerm.length < 2) {
      return jsonResponse({
        success: true,
        users: [],
      });
    }

    const { data, error } = await client.database
      .from("user_public_profiles")
      .select("user_id, email, display_name, avatar_url")
      .limit(200);

    if (error) {
      return jsonResponse({ error: `No se pudo buscar usuarios: ${error.message}` }, 500);
    }

    const users = ((data as UserPublicProfileRow[] | null) ?? [])
      .filter((profile) => profile.user_id !== user.id)
      .filter(
        (profile) =>
          includesNormalized(profile.display_name, searchTerm) || includesNormalized(profile.email, searchTerm),
      )
      .sort((left, right) => left.display_name.localeCompare(right.display_name, "es", { sensitivity: "base" }))
      .slice(0, 20)
      .map((profile) => ({
        userId: profile.user_id,
        email: profile.email,
        displayName: profile.display_name,
        avatarUrl: profile.avatar_url,
      }));

    return jsonResponse({
      success: true,
      users,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while searching contacts";
    return jsonResponse({ error: message }, 500);
  }
}
