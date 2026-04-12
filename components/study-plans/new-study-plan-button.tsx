"use client";

import { useState } from "react";
import { NewStudyPlanModal } from "@/components/study-plans/new-study-plan-modal";

export function NewStudyPlanButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200"
      >
        Nuevo plan de estudio
      </button>

      <NewStudyPlanModal isOpen={isOpen} onClose={() => setIsOpen(false)} />
    </>
  );
}
