import { createClient } from "@insforge/sdk";

export type AuthenticatedUser = {
  id: string;
  email?: string | null;
  profile?: {
    name?: string | null;
  } | null;
};

export function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
}

export function getInsforgeBaseUrl(): string {
  const value = process.env.INSFORGE_BASE_URL ?? process.env.NEXT_PUBLIC_INSFORGE_BASE_URL;

  if (!value) {
    throw new Error("Missing environment variable: INSFORGE_BASE_URL");
  }

  return value;
}

export function getBearerToken(request: Request): string | null {
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

export async function getAuthenticatedContext(request: Request): Promise<{
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
