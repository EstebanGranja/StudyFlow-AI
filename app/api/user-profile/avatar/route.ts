import { createClient } from "@insforge/sdk";
import { deleteAvatarFromGCSUrl, uploadAvatarToGCS } from "@/lib/gcp/storage";

export const runtime = "nodejs";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

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

type SupportedAvatarContentType = "image/jpeg" | "image/png" | "image/webp";

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

function detectAvatarContentType(buffer: Buffer): SupportedAvatarContentType | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  const pngSignature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  if (buffer.length >= pngSignature.length && pngSignature.every((value, index) => buffer[index] === value)) {
    return "image/png";
  }

  const isRiff = buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF";
  const isWebp = buffer.length >= 12 && buffer.subarray(8, 12).toString("ascii") === "WEBP";

  if (isRiff && isWebp) {
    return "image/webp";
  }

  return null;
}

function isSupportedDeclaredContentType(value: string): value is SupportedAvatarContentType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
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

export async function POST(request: Request): Promise<Response> {
  try {
    const { client, user } = await getAuthenticatedContext(request);

    const formData = await request.formData();
    const file = formData.get("file");

    if (!(file instanceof File)) {
      return jsonResponse({ error: "Debes enviar un archivo de imagen en el campo file." }, 400);
    }

    if (file.size === 0) {
      return jsonResponse({ error: "El archivo de avatar esta vacio." }, 400);
    }

    if (file.size > MAX_AVATAR_BYTES) {
      return jsonResponse({ error: "El avatar supera el limite de 5 MB." }, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const detectedType = detectAvatarContentType(buffer);

    if (!detectedType) {
      return jsonResponse(
        { error: "Formato de avatar no soportado. Usa JPG, PNG o WebP." },
        400,
      );
    }

    const declaredType = file.type.trim().toLowerCase();

    if (declaredType.length > 0 && (!isSupportedDeclaredContentType(declaredType) || declaredType !== detectedType)) {
      return jsonResponse(
        { error: "El tipo de archivo no coincide con el contenido real de la imagen." },
        400,
      );
    }

    const settings = await ensureUserSettingsRow(client, user);

    const uploadedAvatar = await uploadAvatarToGCS({
      userId: user.id,
      fileName: file.name || "avatar",
      imageBuffer: buffer,
      contentType: detectedType,
    });

    const { error: updateError } = await client.database
      .from("user_settings")
      .update({ avatar_url: uploadedAvatar.fileUrl })
      .eq("user_id", user.id);

    if (updateError) {
      await deleteAvatarFromGCSUrl(uploadedAvatar.fileUrl).catch((cleanupError) => {
        console.warn("No se pudo limpiar avatar subido tras fallo de DB", cleanupError);
      });

      return jsonResponse(
        { error: `No se pudo guardar el avatar en user_settings: ${updateError.message}` },
        500,
      );
    }

    if (settings.avatar_url && settings.avatar_url !== uploadedAvatar.fileUrl) {
      await deleteAvatarFromGCSUrl(settings.avatar_url).catch((cleanupError) => {
        console.warn("No se pudo eliminar avatar anterior", cleanupError);
      });
    }

    return jsonResponse({
      success: true,
      avatarUrl: uploadedAvatar.fileUrl,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "MISSING_TOKEN") {
      return jsonResponse({ error: "Missing bearer token" }, 401);
    }

    if (error instanceof Error && error.message === "UNAUTHORIZED") {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const message = error instanceof Error ? error.message : "Unexpected error while uploading avatar";
    return jsonResponse({ error: message }, 500);
  }
}
