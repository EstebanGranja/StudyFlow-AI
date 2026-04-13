import { createClient } from "@insforge/sdk";

export const runtime = "nodejs";

type AuthenticatedUser = {
  id: string;
  email?: string | null;
  profile?: {
    name?: string | null;
  } | null;
};

type UserSettingsRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  onboarding_completed: boolean;
};

type UserProfileResponse = {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
};

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

function resolveDisplayNameFallback(user: AuthenticatedUser): string {
  const profileName = user.profile?.name?.trim();

  if (profileName) {
    return profileName;
  }

  const emailPrefix = user.email?.split("@")[0]?.trim();

  if (emailPrefix) {
    return emailPrefix;
  }

  return "Sin nombre";
}

function normalizeDisplayName(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length < 2 || normalized.length > 80) {
    return null;
  }

  return normalized;
}

function normalizeDiceBearAvatarUrl(value: unknown): {
  isProvided: boolean;
  value: string | null;
  error?: string;
} {
  if (value === undefined) {
    return {
      isProvided: false,
      value: null,
    };
  }

  if (value === null) {
    return {
      isProvided: true,
      value: null,
    };
  }

  if (typeof value !== "string") {
    return {
      isProvided: true,
      value: null,
      error: "avatar_url debe ser un string o null.",
    };
  }

  const trimmed = value.trim();

  if (!trimmed) {
    return {
      isProvided: true,
      value: null,
    };
  }

  let parsedUrl: URL;

  try {
    parsedUrl = new URL(trimmed);
  } catch {
    return {
      isProvided: true,
      value: null,
      error: "avatar_url no es una URL valida.",
    };
  }

  const isDiceBearUrl =
    parsedUrl.protocol === "https:" &&
    parsedUrl.hostname === "api.dicebear.com" &&
    /^\/\d+\.x\/[a-z0-9-]+\/(svg|png|jpg|jpeg|webp)$/i.test(parsedUrl.pathname);

  if (!isDiceBearUrl) {
    return {
      isProvided: true,
      value: null,
      error: "avatar_url debe apuntar a la API publica de DiceBear.",
    };
  }

  return {
    isProvided: true,
    value: parsedUrl.toString(),
  };
}

function buildUserProfilePayload(user: AuthenticatedUser, settings: UserSettingsRow): UserProfileResponse {
  const displayName = settings.display_name?.trim() || resolveDisplayNameFallback(user);

  return {
    userId: user.id,
    email: user.email?.trim() || "",
    displayName,
    avatarUrl: settings.avatar_url,
  };
}

async function syncUserPublicProfile(
  client: ReturnType<typeof createClient>,
  user: AuthenticatedUser,
  settings: UserSettingsRow,
): Promise<void> {
  const email = user.email?.trim();

  if (!email) {
    return;
  }

  const displayName = settings.display_name?.trim() || resolveDisplayNameFallback(user);
  const payload = {
    user_id: user.id,
    email,
    display_name: displayName,
    avatar_url: settings.avatar_url,
  };

  const { data: existingProfile, error: selectError } = await client.database
    .from("user_public_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (selectError) {
    throw new Error(`No se pudo consultar user_public_profiles: ${selectError.message}`);
  }

  if (existingProfile) {
    const { error: updateError } = await client.database
      .from("user_public_profiles")
      .update(payload)
      .eq("user_id", user.id);

    if (updateError) {
      throw new Error(`No se pudo actualizar user_public_profiles: ${updateError.message}`);
    }

    return;
  }

  const { error: insertError } = await client.database.from("user_public_profiles").insert([payload]);

  if (insertError) {
    throw new Error(`No se pudo crear user_public_profiles: ${insertError.message}`);
  }
}

async function ensureUserSettingsRow(
  client: ReturnType<typeof createClient>,
  user: AuthenticatedUser,
): Promise<UserSettingsRow> {
  const { data, error } = await client.database
    .from("user_settings")
    .select("user_id, display_name, avatar_url, onboarding_completed")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw new Error(`No se pudo consultar user_settings: ${error.message}`);
  }

  if (data) {
    return data as UserSettingsRow;
  }

  const inferredName = resolveDisplayNameFallback(user);
  const { data: insertedData, error: insertError } = await client.database
    .from("user_settings")
    .insert([
      {
        user_id: user.id,
        display_name: inferredName,
        onboarding_completed: false,
      },
    ])
    .select("user_id, display_name, avatar_url, onboarding_completed")
    .single();

  if (insertError || !insertedData) {
    throw new Error(`No se pudo crear user_settings: ${insertError?.message ?? "error desconocido"}`);
  }

  return insertedData as UserSettingsRow;
}

async function getAuthenticatedContext(request: Request): Promise<{
  client: ReturnType<typeof createClient>;
  user: AuthenticatedUser;
}> {
  const token = getBearerToken(request);

  if (!token) {
    throw new Error("MISSING_TOKEN");
  }

  const client = createClient({
    baseUrl: getInsforgeBaseUrl(),
    edgeFunctionToken: token,
    isServerMode: true,
  });

  const { data: currentUserData, error: currentUserError } = await client.auth.getCurrentUser();
  const user = currentUserData?.user;

  if (currentUserError || !user?.id) {
    throw new Error("UNAUTHORIZED");
  }

  return {
    client,
    user: user as AuthenticatedUser,
  };
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);
    const settings = await ensureUserSettingsRow(client, user);
    await syncUserPublicProfile(client, user, settings);

    return jsonResponse({
      success: true,
      profile: buildUserProfilePayload(user, settings),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while getting profile";
    return jsonResponse({ error: message }, 500);
  }
}

export async function PATCH(request: Request): Promise<Response> {
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

    const payloadRecord = payload as Record<string, unknown>;
    const hasDisplayName = Object.prototype.hasOwnProperty.call(payloadRecord, "display_name");
    const displayName = normalizeDisplayName(payloadRecord.display_name);

    if (hasDisplayName && !displayName) {
      return jsonResponse(
        { error: "display_name debe tener entre 2 y 80 caracteres." },
        400,
      );
    }

    const avatarUpdate = normalizeDiceBearAvatarUrl(payloadRecord.avatar_url);

    if (avatarUpdate.error) {
      return jsonResponse({ error: avatarUpdate.error }, 400);
    }

    if (!hasDisplayName && !avatarUpdate.isProvided) {
      return jsonResponse({ error: "Debes enviar display_name y/o avatar_url." }, 400);
    }

    const settings = await ensureUserSettingsRow(client, user);
    const updates: {
      display_name?: string;
      avatar_url?: string | null;
    } = {};

    if (hasDisplayName && displayName) {
      updates.display_name = displayName;
    }

    if (avatarUpdate.isProvided) {
      updates.avatar_url = avatarUpdate.value;
    }

    const { error: updateError } = await client.database
      .from("user_settings")
      .update(updates)
      .eq("user_id", user.id);

    if (updateError) {
      return jsonResponse({ error: `No se pudo actualizar el perfil: ${updateError.message}` }, 500);
    }

    const updatedSettings: UserSettingsRow = {
      ...settings,
      ...updates,
    };

    await syncUserPublicProfile(client, user, updatedSettings);

    return jsonResponse({
      success: true,
      profile: buildUserProfilePayload(user, updatedSettings),
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while updating profile";
    return jsonResponse({ error: message }, 500);
  }
}
