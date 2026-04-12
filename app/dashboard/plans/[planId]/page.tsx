"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { getInsforgeClient } from "@/lib/insforge/client";

type StudyPlan = {
  id: string;
  nombre: string;
  description: string | null;
  nivel: string | null;
  status: "processing" | "done" | "error";
  created_at: string;
};

type StudyDocument = {
  id: string;
  nombre: string;
  status: "pending" | "processing" | "done" | "error";
  created_at: string;
  file_url: string;
  page_count: number | null;
  file_size_bytes: number | null;
};

function formatStatus(status: StudyPlan["status"]) {
  if (status === "processing") {
    return "En revision";
  }

  if (status === "done") {
    return "Listo";
  }

  return "Error";
}

function formatDocumentStatus(status: StudyDocument["status"]) {
  if (status === "done") {
    return "Disponible";
  }

  if (status === "processing") {
    return "En revision";
  }

  if (status === "pending") {
    return "Pendiente";
  }

  return "Error";
}

function formatBytes(bytes: number | null): string {
  if (!bytes || bytes <= 0) {
    return "N/A";
  }

  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  const decimalPlaces = size >= 10 || unitIndex === 0 ? 0 : 1;
  return `${size.toFixed(decimalPlaces)} ${units[unitIndex]}`;
}

export default function StudyPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [documents, setDocuments] = useState<StudyDocument[]>([]);

  const planId = useMemo(() => {
    const value = params?.planId;
    return typeof value === "string" ? value : "";
  }, [params]);

  useEffect(() => {
    if (!planId) {
      return;
    }

    let isCancelled = false;

    async function loadData() {
      const client = getInsforgeClient();

      const { data: currentUserData, error: currentUserError } = await client.auth.getCurrentUser();
      const userId = currentUserData?.user?.id;

      if (currentUserError || !userId) {
        if (!isCancelled) {
          router.replace("/login");
        }
        return;
      }

      const { data: planData, error: planError } = await client.database
        .from("study_plans")
        .select("id, nombre, description, nivel, status, created_at")
        .eq("id", planId)
        .eq("user_id", userId)
        .maybeSingle();

      if (planError || !planData) {
        if (!isCancelled) {
          setErrorMessage(planError?.message ?? "No se encontro el plan de estudio.");
          setIsLoading(false);
        }
        return;
      }

      const { data: docsData, error: docsError } = await client.database
        .from("study_documents")
        .select("id, nombre, status, created_at, file_url, page_count, file_size_bytes")
        .eq("plan_id", planId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (!isCancelled) {
        setPlan(planData as StudyPlan);

        if (docsError) {
          setErrorMessage(docsError.message);
          setDocuments([]);
        } else {
          setErrorMessage(null);
          setDocuments((docsData as StudyDocument[]) ?? []);
        }

        setIsLoading(false);
      }
    }

    void loadData();

    return () => {
      isCancelled = true;
    };
  }, [planId, router]);

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12">
        <p className="text-sm text-zinc-300">Cargando plan...</p>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12">
        <div className="rounded-xl border border-zinc-800 bg-zinc-900 px-6 py-5 text-sm text-zinc-300">
          No se pudo cargar el plan.
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <main className="mx-auto w-full max-w-4xl space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-teal-300">Plan de estudio</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">{plan.nombre}</h1>
              <p className="mt-3 text-sm text-zinc-300">Estado: {formatStatus(plan.status)}</p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
            >
              Volver al dashboard
            </Link>
          </div>

          {plan.description ? <p className="mt-5 text-sm leading-6 text-zinc-300">{plan.description}</p> : null}

          <div className="mt-6 flex flex-wrap gap-3 text-xs">
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
              Nivel: {plan.nivel ?? "Sin definir"}
            </span>
            <span className="rounded-full border border-zinc-700 bg-zinc-950 px-3 py-1 text-zinc-300">
              Creado: {new Date(plan.created_at).toLocaleString()}
            </span>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <h2 className="text-xl font-semibold text-white">Documentos del plan</h2>

          {errorMessage ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </p>
          ) : null}

          {documents.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">Aun no hay documentos en este plan.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {documents.map((document) => (
                <article key={document.id} className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="space-y-2">
                      <p className="text-sm font-medium text-zinc-100">{document.nombre}</p>
                      <p className="text-xs text-zinc-400">
                        Estado: {formatDocumentStatus(document.status)} · {new Date(document.created_at).toLocaleString()}
                      </p>
                      <p className="text-xs text-zinc-500">
                        Paginas: {document.page_count ?? "N/A"} · Peso: {formatBytes(document.file_size_bytes)}
                      </p>
                    </div>

                    <a
                      href={document.file_url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200"
                    >
                      Abrir PDF
                    </a>
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
