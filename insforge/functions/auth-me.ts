/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck
import { createClient } from "npm:@insforge/sdk";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

export default async function handler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return json({ error: "Method not allowed" }, 405);
  }

  const authHeader = req.headers.get("Authorization");
  const userToken = authHeader?.replace("Bearer ", "");

  if (!userToken) {
    return json({ error: "Missing bearer token" }, 401);
  }

  const baseUrl = Deno.env.get("INSFORGE_BASE_URL");
  if (!baseUrl) {
    return json({ error: "INSFORGE_BASE_URL is not configured" }, 500);
  }

  const client = createClient({
    baseUrl,
    edgeFunctionToken: userToken,
  });

  const { data: currentUser, error: currentUserError } = await client.auth.getCurrentUser();

  if (currentUserError || !currentUser?.user?.id) {
    return json({ error: "Unauthorized" }, 401);
  }

  const { data: settings, error: settingsError } = await client.database
    .from("user_settings")
    .select("*")
    .eq("user_id", currentUser.user.id)
    .maybeSingle();

  if (settingsError) {
    return json({ error: settingsError.message }, 500);
  }

  return json({
    user: currentUser.user,
    settings,
  });
}
