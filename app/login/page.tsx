"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { LoadingSpinner } from "@/components/loading-spinner";
import { getInsforgeClient } from "@/lib/insforge/client";
import { ensureUserSettings } from "@/lib/insforge/ensure-user-settings";

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 48 48" className="h-5 w-5">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303C33.654 32.657 29.23 36 24 36c-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.959 3.041l5.657-5.657C34.046 6.053 29.277 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.959 3.041l5.657-5.657C34.046 6.053 29.277 4 24 4c-7.682 0-14.342 4.337-17.694 10.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.176 0 9.86-1.977 13.409-5.192l-6.19-5.238C29.146 35.091 26.715 36 24 36c-5.209 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.503 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.07 12.07 0 0 1-4.084 5.57l.003-.002 6.19 5.238C37.003 39.183 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isGoogleSubmitting, setIsGoogleSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setIsSubmitting(true);

    try {
      const client = getInsforgeClient();
      const { data, error } = await client.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setErrorMessage(error.message);
        return;
      }

      if (!data?.user) {
        setErrorMessage("No se pudo crear la sesion del usuario.");
        return;
      }

      await ensureUserSettings({
        id: data.user.id,
        email: data.user.email,
        profile: data.user.profile,
      });

      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado al iniciar sesion.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleGoogleSignIn() {
    setErrorMessage(null);
    setIsGoogleSubmitting(true);

    try {
      const client = getInsforgeClient();
      const { error } = await client.auth.signInWithOAuth({
        provider: "google",
        redirectTo: `${window.location.origin}/dashboard`,
      });

      if (error) {
        setErrorMessage(error.message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Error inesperado al continuar con Google.";
      setErrorMessage(message);
    } finally {
      setIsGoogleSubmitting(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-black px-4 py-8">
      <main className="w-full max-w-md rounded-2xl border border-zinc-800 bg-gradient-to-b from-zinc-900 to-zinc-950 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.45)] sm:p-7">
        <h1 className="text-center text-3xl font-semibold tracking-tight text-white">Inicia sesion en StudyFlow AI</h1>
        <p className="mt-2 text-center text-base text-zinc-400">Gestiona tus sesiones de estudio</p>

        <div className="mt-6">
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={isGoogleSubmitting || isSubmitting}
            className="inline-flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 text-sm font-medium text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            <GoogleIcon />
            {isGoogleSubmitting ? "Conectando con Google..." : "Continuar con Google"}
          </button>
        </div>

        <div className="my-6 flex items-center gap-3 text-xs text-zinc-500">
          <span className="h-px flex-1 bg-zinc-800" />
          <span>o con email</span>
          <span className="h-px flex-1 bg-zinc-800" />
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-2 block text-base font-medium text-zinc-100">
              Email
            </label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 text-base text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2"
              placeholder="tu@email.com"
            />
          </div>

          <div>
            <label htmlFor="password" className="mb-2 block text-base font-medium text-zinc-100">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 text-base text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2"
              placeholder="********"
            />
          </div>

          {errorMessage ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isSubmitting || isGoogleSubmitting}
            className="mt-1 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-zinc-100 text-base font-semibold text-zinc-900 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60 cursor-pointer"
          >
            {isSubmitting ? (
              <>
                <LoadingSpinner size="sm" className="border-zinc-400 border-t-zinc-900" />
                Iniciando...
              </>
            ) : (
              "Iniciar sesion"
            )}
          </button>
        </form>

        <p className="mt-6 text-center text-base text-zinc-400">
          No tienes cuenta?{" "}
          <Link href="/register" className="font-semibold text-zinc-100 hover:text-white">
            Registrate
          </Link>
        </p>
      </main>
    </div>
  );
}
