"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createStudyPlan } from "@/lib/study-plans/create-study-plan";

type NewStudyPlanModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function NewStudyPlanModal({ isOpen, onClose }: NewStudyPlanModalProps) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [nivel, setNivel] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      setTitle("");
      setDescription("");
      setNivel("");
      setFile(null);
      setErrorMessage(null);
      setSuccessMessage(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) {
    return null;
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!file) {
      setErrorMessage("Debes seleccionar un archivo PDF.");
      return;
    }

    setIsSubmitting(true);

    try {
      const result = await createStudyPlan({
        title,
        description,
        nivel,
        file,
      });

      setSuccessMessage("Plan creado y PDF subido correctamente. Redirigiendo...");
      router.push(`/dashboard/plans/${result.planId}`);
      router.refresh();
      onClose();
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo crear el plan de estudio.";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] sm:p-7">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-[0.12em] text-teal-300">Nuevo plan</p>
            <h3 className="mt-1 text-2xl font-semibold text-white">Nuevo plan de estudio</h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSubmitting}
            className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Cerrar
          </button>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="plan-title" className="mb-2 block text-sm font-medium text-zinc-100">
              Titulo
            </label>
            <input
              id="plan-title"
              type="text"
              required
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 text-sm text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2"
              placeholder="Ej: Biologia celular - parcial 1"
            />
          </div>

          <div>
            <label htmlFor="plan-description" className="mb-2 block text-sm font-medium text-zinc-100">
              Descripcion (opcional)
            </label>
            <textarea
              id="plan-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2"
              placeholder="Objetivo del plan, alcance del PDF, fecha, etc."
            />
          </div>

          <div>
            <label htmlFor="plan-level" className="mb-2 block text-sm font-medium text-zinc-100">
              Nivel (opcional)
            </label>
            <select
              id="plan-level"
              value={nivel}
              onChange={(event) => setNivel(event.target.value)}
              className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 text-sm text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2"
            >
              <option value="">Selecciona nivel</option>
              <option value="basico">Basico</option>
              <option value="intermedio">Intermedio</option>
              <option value="avanzado">Avanzado</option>
            </select>
          </div>

          <div>
            <label htmlFor="plan-file" className="mb-2 block text-sm font-medium text-zinc-100">
              PDF
            </label>
            <input
              id="plan-file"
              type="file"
              accept="application/pdf"
              required
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              className="block w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 py-3 text-sm text-zinc-200 file:mr-4 file:rounded-lg file:border-0 file:bg-zinc-800 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-zinc-100 hover:file:bg-zinc-700"
            />
            <p className="mt-2 text-xs text-zinc-400">Solo PDF. Se guardara el archivo y sus metadatos basicos.</p>
          </div>

          {errorMessage ? (
            <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">{errorMessage}</p>
          ) : null}

          {successMessage ? (
            <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {successMessage}
            </p>
          ) : null}

          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-5 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Creando y subiendo PDF..." : "Crear plan"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
