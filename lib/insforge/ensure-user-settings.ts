"use client";

import { getInsforgeClient } from "@/lib/insforge/client";

type AuthUser = {
  id: string;
  email: string;
  profile?: {
    name?: string | null;
  } | null;
};

export async function ensureUserSettings(user: AuthUser) {
  const client = getInsforgeClient();

  const { data, error } = await client.database
    .from("user_settings")
    .select("user_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  if (data) {
    return;
  }

  const inferredName = user.profile?.name ?? user.email.split("@")[0];
  const { error: insertError } = await client.database.from("user_settings").insert([
    {
      user_id: user.id,
      display_name: inferredName,
      onboarding_completed: false,
    },
  ]);

  if (insertError) {
    throw insertError;
  }
}
