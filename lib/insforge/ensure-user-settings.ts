"use client";

import { getInsforgeClient } from "@/lib/insforge/client";

type AuthUser = {
  id: string;
  email: string;
  profile?: {
    name?: string | null;
  } | null;
};

type UserSettingsRow = {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
};

function resolveFallbackDisplayName(user: AuthUser): string {
  const profileName = user.profile?.name?.trim();

  if (profileName) {
    return profileName;
  }

  const emailPrefix = user.email.split("@")[0]?.trim();

  if (emailPrefix) {
    return emailPrefix;
  }

  return "Sin nombre";
}

async function syncUserPublicProfile(user: AuthUser, settings: UserSettingsRow) {
  const client = getInsforgeClient();
  const resolvedDisplayName = settings.display_name?.trim() || resolveFallbackDisplayName(user);

  const profilePayload = {
    user_id: user.id,
    email: user.email,
    display_name: resolvedDisplayName,
    avatar_url: settings.avatar_url,
  };

  const { data: existingProfile, error: profileError } = await client.database
    .from("user_public_profiles")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    throw profileError;
  }

  if (existingProfile) {
    const { error: updateError } = await client.database
      .from("user_public_profiles")
      .update(profilePayload)
      .eq("user_id", user.id);

    if (updateError) {
      throw updateError;
    }

    return;
  }

  const { error: insertProfileError } = await client.database.from("user_public_profiles").insert([profilePayload]);

  if (insertProfileError) {
    throw insertProfileError;
  }
}

export async function ensureUserSettings(user: AuthUser) {
  const client = getInsforgeClient();

  const { data, error } = await client.database
    .from("user_settings")
    .select("user_id, display_name, avatar_url")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    await syncUserPublicProfile(user, data as UserSettingsRow);
    return;
  }

  const inferredName = resolveFallbackDisplayName(user);
  const { data: insertedSettings, error: insertError } = await client.database
    .from("user_settings")
    .insert([
      {
        user_id: user.id,
        display_name: inferredName,
        onboarding_completed: false,
      },
    ])
    .select("user_id, display_name, avatar_url")
    .single();

  if (insertError || !insertedSettings) {
    throw insertError ?? new Error("No se pudo crear user_settings");
  }

  await syncUserPublicProfile(user, insertedSettings as UserSettingsRow);
}
