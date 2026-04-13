"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { FiArrowLeft, FiCheck, FiClock, FiUserPlus } from "react-icons/fi";
import { LoadingSpinner } from "@/components/loading-spinner";
import { getInsforgeClient } from "@/lib/insforge/client";
import {
  DEFAULT_USER_BACKGROUND_THEME,
  getUserBackgroundImagePath,
  normalizeUserBackgroundTheme,
  type UserBackgroundTheme,
} from "@/lib/user-background-theme";

type RelationStatus = "self" | "friends" | "incoming_request" | "outgoing_request" | "none";

type ContactProfile = {
  userId: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  studyStatusLabel: string | null;
};

type StudyPlanSummary = {
  id: string;
  nombre: string;
  description: string | null;
  fecha_examen: string | null;
  status: "processing" | "done" | "error";
  created_at: string;
  progressPercent: number;
};

type UserPublicProfileApiResponse = {
  success?: boolean;
  error?: string;
  profile?: ContactProfile;
  relation?: {
    status?: RelationStatus;
    pendingRequestId?: string | null;
  };
  plans?: StudyPlanSummary[];
};

type FriendRequestCreateApiResponse = {
  success?: boolean;
  error?: string;
};

type FriendRequestUpdateApiResponse = {
  success?: boolean;
  error?: string;
};

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}

function getPlanProgressLabel(progressPercent: number): "En curso" | "Finalizado" {
  return progressPercent >= 100 ? "Finalizado" : "En curso";
}

function formatExamDate(examDate: string | null): string {
  if (!examDate) {
    return "Sin definir";
  }

  const parsedDate = new Date(examDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return "Sin definir";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsedDate);
}

function resolveAvatarInitial(displayName: string, email: string): string {
  const fromName = displayName.trim().charAt(0);

  if (fromName) {
    return fromName.toUpperCase();
  }

  const fromEmail = email.trim().charAt(0);

  if (fromEmail) {
    return fromEmail.toUpperCase();
  }

  return "U";
}

function resolveStudyStatusLabel(studyStatusLabel: string | null | undefined): string {
  if (!studyStatusLabel) {
    return "Sin plan en curso";
  }

  const normalized = studyStatusLabel.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : "Sin plan en curso";
}

function PlanProgressCircle({ progressPercent }: { progressPercent: number }) {
  const size = 72;
  const strokeWidth = 7;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedProgress = clampPercent(progressPercent);
  const strokeDashoffset = circumference * (1 - clampedProgress / 100);

  return (
    <div
      className="relative inline-flex h-[72px] w-[72px] shrink-0 items-center justify-center"
      role="img"
      aria-label={`Progreso del plan: ${clampedProgress}%`}
      title={`Progreso del plan: ${clampedProgress}%`}
    >
      <svg
        viewBox={`0 0 ${size} ${size}`}
        className="h-[72px] w-[72px] -rotate-90 transition-[filter,transform] duration-300 group-hover:scale-[1.03] group-hover:drop-shadow-[0_0_4px_rgba(70,237,213,0.28)]"
        aria-hidden="true"
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="rgb(63 63 70)"
          strokeWidth={strokeWidth}
          fill="transparent"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="#46edd5"
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          fill="transparent"
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          className="transition-[stroke-dashoffset] duration-500 ease-out"
        />
      </svg>
      <span className="absolute text-sm font-semibold text-zinc-100">{clampedProgress}%</span>
    </div>
  );
}

export default function UserProfilePage() {
  const router = useRouter();
  const params = useParams<{ userId: string }>();
  const userId = typeof params?.userId === "string" ? params.userId : "";
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<ContactProfile | null>(null);
  const [plans, setPlans] = useState<StudyPlanSummary[]>([]);
  const [relationStatus, setRelationStatus] = useState<RelationStatus>("none");
  const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
  const [isMutatingRelation, setIsMutatingRelation] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [backgroundTheme, setBackgroundTheme] = useState<UserBackgroundTheme>(DEFAULT_USER_BACKGROUND_THEME);
  const [isBackgroundImageLoading, setIsBackgroundImageLoading] = useState(false);

  function getAuthHeaderForApiRequest(): string {
    const client = getInsforgeClient();
    const headers = client.getHttpClient().getHeaders();
    const token = headers.Authorization ?? headers.authorization;

    if (!token) {
      throw new Error("No hay sesion activa.");
    }

    return token;
  }

  async function loadProfile() {
    if (!userId) {
      setErrorMessage("No se pudo identificar el usuario solicitado.");
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/users/${userId}/profile`, {
        method: "GET",
        headers: {
          Authorization: getAuthHeaderForApiRequest(),
        },
      });

      const payload = (await response.json().catch(() => null)) as UserPublicProfileApiResponse | null;

      if (response.status === 401) {
        router.replace("/login");
        return;
      }

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo cargar el perfil.");
      }

      if (!payload?.profile) {
        throw new Error("No se recibio informacion del perfil.");
      }

      setProfile(payload.profile);
      setPlans((payload.plans ?? []).filter((plan) => Boolean(plan?.id)));
      setRelationStatus(payload.relation?.status ?? "none");
      setPendingRequestId(payload.relation?.pendingRequestId ?? null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo cargar el perfil.";
      setErrorMessage(message);
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  useEffect(() => {
    let isCancelled = false;

    async function loadActiveBackgroundTheme() {
      try {
        const client = getInsforgeClient();
        const { data, error } = await client.auth.getCurrentUser();

        if (error || !data?.user?.id) {
          return;
        }

        const { data: settingsData, error: settingsError } = await client.database
          .from("user_settings")
          .select("background_theme")
          .eq("user_id", data.user.id)
          .maybeSingle();

        if (settingsError || isCancelled) {
          return;
        }

        const settingsRow = settingsData as { background_theme?: unknown } | null;

        setBackgroundTheme(normalizeUserBackgroundTheme(settingsRow?.background_theme));
      } catch {
        // Keep default theme when background cannot be resolved.
      }
    }

    void loadActiveBackgroundTheme();

    return () => {
      isCancelled = true;
    };
  }, []);

  const activeBackgroundImagePath = getUserBackgroundImagePath(backgroundTheme);

  useEffect(() => {
    let isCancelled = false;

    setIsBackgroundImageLoading(true);

    const image = new Image();

    image.onload = () => {
      if (!isCancelled) {
        setIsBackgroundImageLoading(false);
      }
    };

    image.onerror = () => {
      if (!isCancelled) {
        setIsBackgroundImageLoading(false);
      }
    };

    image.src = activeBackgroundImagePath;

    return () => {
      isCancelled = true;
    };
  }, [activeBackgroundImagePath]);

  async function handleSendFriendRequest() {
    if (!profile || isMutatingRelation) {
      return;
    }

    setIsMutatingRelation(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch("/api/friend-requests", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAuthHeaderForApiRequest(),
        },
        body: JSON.stringify({
          receiverUserId: profile.userId,
        }),
      });

      const payload = (await response.json().catch(() => null)) as FriendRequestCreateApiResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo enviar la solicitud.");
      }

      setRelationStatus("outgoing_request");
      setSuccessMessage("Solicitud enviada correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo enviar la solicitud.";
      setErrorMessage(message);
    } finally {
      setIsMutatingRelation(false);
    }
  }

  async function handleAcceptFriendRequest() {
    if (!pendingRequestId || isMutatingRelation) {
      return;
    }

    setIsMutatingRelation(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const response = await fetch(`/api/friend-requests/${pendingRequestId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAuthHeaderForApiRequest(),
        },
        body: JSON.stringify({
          action: "accept",
        }),
      });

      const payload = (await response.json().catch(() => null)) as FriendRequestUpdateApiResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo aceptar la solicitud.");
      }

      setRelationStatus("friends");
      setPendingRequestId(null);
      setSuccessMessage("Ahora son amigos.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo aceptar la solicitud.";
      setErrorMessage(message);
    } finally {
      setIsMutatingRelation(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-12 text-zinc-100">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${activeBackgroundImagePath}')` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

      <main className="relative z-10 mx-auto w-full max-w-5xl space-y-6">
        {isBackgroundImageLoading ? (
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <LoadingSpinner size="sm" className="border-zinc-500 border-t-teal-200" />
            <span>Cargando fondo...</span>
          </div>
        ) : null}

        <Link
          href="/dashboard"
          className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 px-3 py-2 text-sm text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-900"
        >
          <FiArrowLeft className="h-4 w-4" aria-hidden="true" />
          Volver al dashboard
        </Link>

        {isLoading ? (
          <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
            <div className="flex items-center gap-3">
              <LoadingSpinner size="sm" />
              <p className="text-sm text-zinc-300">Cargando perfil...</p>
            </div>
          </section>
        ) : null}

        {!isLoading && errorMessage ? (
          <section className="rounded-2xl border border-red-400/30 bg-red-500/10 p-8">
            <p className="text-sm text-red-200">{errorMessage}</p>
          </section>
        ) : null}

        {!isLoading && !errorMessage && profile ? (
          <>
            <section className="relative rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
              <p className="pointer-events-none absolute left-1/2 top-1/2 inline-flex max-w-[14rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-sky-300/30 bg-sky-300/10 px-2.5 py-1 text-[11px] font-medium text-sky-200/85 sm:max-w-[20rem]">
                <span className="truncate">{resolveStudyStatusLabel(profile.studyStatusLabel)}</span>
              </p>

              <div className="flex flex-wrap items-center justify-between gap-4">
                <div className="flex min-w-0 items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-xl font-semibold text-teal-200">
                    {profile.avatarUrl ? (
                      <img src={profile.avatarUrl} alt={`Avatar de ${profile.displayName}`} className="h-full w-full object-cover" />
                    ) : (
                      <span aria-hidden="true">{resolveAvatarInitial(profile.displayName, profile.email)}</span>
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold text-zinc-100">{profile.displayName}</p>
                    <p className="truncate text-sm text-zinc-300">{profile.email}</p>
                  </div>
                </div>

                <div className="ml-auto flex shrink-0 items-center gap-2">

                  {relationStatus === "none" ? (
                    <button
                      type="button"
                      onClick={handleSendFriendRequest}
                      disabled={isMutatingRelation}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <FiUserPlus className="h-4 w-4" aria-hidden="true" />
                      Enviar solicitud
                    </button>
                  ) : null}

                  {relationStatus === "outgoing_request" ? (
                    <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-200">
                      <FiClock className="h-4 w-4" aria-hidden="true" />
                      Solicitud enviada
                    </span>
                  ) : null}

                  {relationStatus === "incoming_request" ? (
                    <button
                      type="button"
                      onClick={handleAcceptFriendRequest}
                      disabled={isMutatingRelation || !pendingRequestId}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      <FiCheck className="h-4 w-4" aria-hidden="true" />
                      Aceptar solicitud
                    </button>
                  ) : null}

                  {relationStatus === "friends" ? (
                    <span className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-emerald-300/50 bg-emerald-500/10 px-4 text-sm font-semibold text-emerald-200">
                      <FiCheck className="h-4 w-4" aria-hidden="true" />
                      Amigos
                    </span>
                  ) : null}

                  {relationStatus === "self" ? (
                    <span className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-200">
                      Este eres tu
                    </span>
                  ) : null}
                </div>
              </div>

              {successMessage ? (
                <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  {successMessage}
                </p>
              ) : null}
            </section>

            <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold text-white">Planes de estudio</h2>
                  <p className="mt-1 text-sm uppercase tracking-[0.1em] text-zinc-400">{plans.length} total</p>
                </div>
              </div>

              {plans.length === 0 ? (
                <p className="mt-5 text-base text-zinc-400">Este usuario aun no tiene planes visibles.</p>
              ) : (
                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  {plans.map((plan) => (
                    <article
                      key={plan.id}
                      className="group rounded-2xl border border-zinc-800 bg-zinc-950 p-6 transition-all duration-300 hover:-translate-y-0.5 hover:scale-[1.015] hover:border-[#46edd5] hover:bg-zinc-900 hover:shadow-[0_0_0_1px_rgba(70,237,213,0.38),0_0_14px_rgba(70,237,213,0.14)] focus-within:-translate-y-0.5 focus-within:scale-[1.015] focus-within:border-[#46edd5] focus-within:shadow-[0_0_0_1px_rgba(70,237,213,0.38),0_0_14px_rgba(70,237,213,0.14)]"
                    >
                      <div className="flex items-start justify-between gap-4">
                        <Link href={`/dashboard/plans/${plan.id}`} className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <p className="text-lg font-semibold text-zinc-100">{plan.nombre}</p>
                            <span
                              className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${
                                plan.progressPercent >= 100
                                  ? "border-emerald-300/60 bg-emerald-400/10 text-emerald-200"
                                  : "border-cyan-300/50 bg-cyan-400/10 text-cyan-100"
                              }`}
                            >
                              {getPlanProgressLabel(plan.progressPercent)}
                            </span>
                          </div>

                          {plan.description ? (
                            <p className="mt-3 line-clamp-2 text-sm leading-6 text-zinc-300">{plan.description}</p>
                          ) : (
                            <p className="mt-3 text-sm leading-6 text-zinc-500">Sin descripcion.</p>
                          )}

                          <div className="mt-4 text-sm text-zinc-400">
                            <span>Examen: {formatExamDate(plan.fecha_examen)}</span>
                          </div>
                        </Link>

                        <PlanProgressCircle progressPercent={plan.progressPercent} />
                      </div>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </>
        ) : null}
      </main>
    </div>
  );
}
