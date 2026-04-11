"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
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

export default function DashboardPage() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [endpointError, setEndpointError] = useState<string | null>(null);

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

      try {
        await ensureUserSettings(sessionUser);
      } catch {
        if (!isCancelled) {
          setEndpointError("No se pudo inicializar tu perfil en base de datos.");
        }
      }

      const { data: endpointData, error: invokeError } = await client.functions.invoke("auth-me", {
        method: "GET",
      });

      if (!isCancelled) {
        setUser(sessionUser);

        if (invokeError) {
          setEndpointError(invokeError.message);
        } else {
          setSettings((endpointData?.settings as UserSettings | null) ?? null);
        }

        setIsLoading(false);
      }
    }

    loadSession();

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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12">
        <p className="text-sm text-zinc-300">Cargando sesion segura...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <main className="mx-auto w-full max-w-4xl space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-teal-300">Sesion activa</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Dashboard de autenticacion</h1>
            </div>
            <button
              type="button"
              onClick={handleSignOut}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 cursor-pointer"
            >
              Cerrar sesion
            </button>
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

          {endpointError ? (
            <p className="mt-6 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Endpoint auth-me respondio con advertencia: {endpointError}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <h2 className="text-xl font-semibold text-white">Siguientes pasos</h2>
          <p className="mt-3 text-sm leading-6 text-zinc-300">
            Ya tienes autenticacion de usuarios lista con Insforge, base de datos protegida
            por RLS y endpoint backend autenticado. Puedes continuar con upload de PDFs
            usando Storage y guardar metadatos en la tabla study_documents.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <Link
              href="/"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              Volver al inicio
            </Link>
          </div>
        </section>
      </main>
    </div>
  );
}
