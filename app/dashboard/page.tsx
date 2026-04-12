"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { NewStudyPlanButton } from "@/components/study-plans/new-study-plan-button";
import { getInsforgeClient } from "@/lib/insforge/client";
import { ensureUserSettings } from "@/lib/insforge/ensure-user-settings";

type AuthUser = {
  id: string;
  email: string;
  profile?: {
    name?: string | null;
  } | null;
};

type UserSettings = {
  user_id: string;
  display_name: string | null;
  onboarding_completed: boolean;
};

type StudyPlanSummary = {
  id: string;
  nombre: string;
  description: string | null;
  nivel: string | null;
  status: "processing" | "done" | "error";
  created_at: string;
};

type DeleteStudyPlanResponse = {
  success?: boolean;
  error?: string;
};

function formatPlanStatus(status: StudyPlanSummary["status"]): string {
  if (status === "done") {
    return "Listo";
  }

  if (status === "processing") {
    return "En revision";
  }

  return "Con error";
}

export default function DashboardPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [warningMessage, setWarningMessage] = useState<string | null>(null);
  const [plans, setPlans] = useState<StudyPlanSummary[]>([]);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [deleteErrorMessage, setDeleteErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let isCancelled = false;

    async function loadSession() {
      const client = getInsforgeClient();
      const { data, error } = await client.auth.getCurrentUser();

      if (error || !data?.user) {
        if (!isCancelled) {
          router.replace("/login");
        }
        return;
      }

      const sessionUser: AuthUser = {
        id: data.user.id,
        email: data.user.email,
        profile: data.user.profile,
      };

      const warnings: string[] = [];

      try {
        await ensureUserSettings(sessionUser);
      } catch {
        warnings.push("No se pudo inicializar tu perfil en base de datos.");
      }

      const { data: endpointData, error: invokeError } = await client.functions.invoke("auth-me", {
        method: "GET",
      });

      if (invokeError) {
        warnings.push(`auth-me: ${invokeError.message}`);
      }

      const { data: plansData, error: plansError } = await client.database
        .from("study_plans")
        .select("id, nombre, description, nivel, status, created_at")
        .eq("user_id", sessionUser.id)
        .order("created_at", { ascending: false });

      if (plansError) {
        warnings.push(`planes: ${plansError.message}`);
      }

      if (!isCancelled) {
        setUser(sessionUser);
        setSettings((endpointData?.settings as UserSettings | null) ?? null);
        setPlans(((plansData as StudyPlanSummary[] | null) ?? []).filter((plan) => Boolean(plan?.id)));
        setWarningMessage(warnings.length > 0 ? warnings.join(" | ") : null);
        setIsLoading(false);
      }
    }

    void loadSession();

    return () => {
      isCancelled = true;
    };
  }, [router]);

  async function handleSignOut() {
    const client = getInsforgeClient();
    await client.auth.signOut();
    router.replace("/login");
    router.refresh();
  }

  function getAuthHeaderForApiRequest(): string {
    const client = getInsforgeClient();
    const headers = client.getHttpClient().getHeaders();
    const token = headers.Authorization ?? headers.authorization;

    if (!token) {
      throw new Error("No hay sesion activa para eliminar el plan.");
    }

    return token;
  }

  async function handleDeletePlan(plan: StudyPlanSummary) {
    if (deletingPlanId) {
      return;
    }

    const confirmed = window.confirm(
      `Se eliminara el plan "${plan.nombre}" junto con documentos, temas y PDFs en el bucket. Esta accion no se puede deshacer.`,
    );

    if (!confirmed) {
      return;
    }

    setDeleteErrorMessage(null);
    setDeletingPlanId(plan.id);

    try {
      const response = await fetch(`/api/study-plans/${plan.id}`, {
        method: "DELETE",
        headers: {
          Authorization: getAuthHeaderForApiRequest(),
        },
      });

      const payload = (await response.json().catch(() => null)) as DeleteStudyPlanResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo eliminar el plan de estudio.");
      }

      setPlans((previousPlans) => previousPlans.filter((currentPlan) => currentPlan.id !== plan.id));
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo eliminar el plan de estudio.";
      setDeleteErrorMessage(message);
    } finally {
      setDeletingPlanId(null);
    }
  }

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12">
        <p className="text-sm text-zinc-300">Cargando sesion segura...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <main className="mx-auto w-full max-w-5xl space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-teal-300">Sesion activa</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Dashboard de estudio</h1>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <NewStudyPlanButton />
              <button
                type="button"
                onClick={handleSignOut}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                Cerrar sesion
              </button>
            </div>
          </div>

          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs uppercase tracking-[0.1em] text-zinc-400">Email</p>
              <p className="mt-2 text-sm text-zinc-100">{user?.email}</p>
            </article>
            <article className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
              <p className="text-xs uppercase tracking-[0.1em] text-zinc-400">Display name</p>
              <p className="mt-2 text-sm text-zinc-100">
                {settings?.display_name ?? user?.profile?.name ?? "Sin nombre"}
              </p>
            </article>
          </div>

          {warningMessage ? (
            <p className="mt-6 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Advertencias: {warningMessage}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex items-center justify-between gap-4">
            <h2 className="text-xl font-semibold text-white">Tus planes de estudio</h2>
            <p className="text-xs uppercase tracking-[0.1em] text-zinc-400">{plans.length} total</p>
          </div>

          {deleteErrorMessage ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {deleteErrorMessage}
            </p>
          ) : null}

          {plans.length === 0 ? (
            <p className="mt-5 text-sm text-zinc-400">
              Aun no tienes planes creados. Usa el boton Nuevo plan de estudio para subir tu primer PDF.
            </p>
          ) : (
            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              {plans.map((plan) => (
                <article
                  key={plan.id}
                  className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 transition hover:border-zinc-600 hover:bg-zinc-900"
                >
                  <div className="flex items-start justify-between gap-3">
                    <Link href={`/dashboard/plans/${plan.id}`} className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-zinc-100">{plan.nombre}</p>

                      {plan.description ? (
                        <p className="mt-3 line-clamp-2 text-xs leading-5 text-zinc-400">{plan.description}</p>
                      ) : (
                        <p className="mt-3 text-xs leading-5 text-zinc-500">Sin descripcion.</p>
                      )}

                      <div className="mt-4 flex items-center justify-between text-[11px] text-zinc-500">
                        <span>Nivel: {plan.nivel ?? "Sin definir"}</span>
                        <span>{new Date(plan.created_at).toLocaleDateString()}</span>
                      </div>
                    </Link>

                    <div className="flex shrink-0 flex-col items-end gap-2">
                      <span className="rounded-full border border-zinc-700 px-2.5 py-1 text-[11px] text-zinc-300">
                        {formatPlanStatus(plan.status)}
                      </span>

                      <button
                        type="button"
                        onClick={() => void handleDeletePlan(plan)}
                        disabled={deletingPlanId === plan.id}
                        aria-label={`Eliminar plan ${plan.nombre}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-red-500/40 bg-red-500/10 text-red-300 transition hover:border-red-400 hover:bg-red-500/20 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" aria-hidden="true">
                          <path
                            d="M4 7h16M10 11v6m4-6v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v3"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
