export const runtime = "nodejs";

function jsonResponse(data: unknown, status = 200): Response {
  return Response.json(data, { status });
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

export async function POST(request: Request): Promise<Response> {
  const token = getBearerToken(request);

  if (!token) {
    return jsonResponse({ error: "Missing bearer token" }, 401);
  }

  return jsonResponse(
    {
      success: false,
      message: "Worker desactivado en modo simple. No hay procesamiento IA en esta etapa.",
    },
    410,
  );
}
