export type StudyStatusPlanRow = {
  user_id: string;
  nombre: string | null;
  fecha_examen: string | null;
};

export type StudyStatusPlanCandidate = {
  nombre: string | null;
  fecha_examen: string | null;
};

export type CurrentStudyStatus = {
  planName: string;
  examDate: string;
  daysUntilExam: number;
  label: string;
};

const DAY_IN_MS = 24 * 60 * 60 * 1000;

function getUtcStartTimestamp(date: Date): number {
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function normalizePlanName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 ? normalized : null;
}

export function calculateDaysUntilExam(examDate: string, referenceDate = new Date()): number | null {
  const parsedExamDate = new Date(examDate);

  if (Number.isNaN(parsedExamDate.getTime())) {
    return null;
  }

  const examDateUtcStart = getUtcStartTimestamp(parsedExamDate);
  const referenceUtcStart = getUtcStartTimestamp(referenceDate);

  return Math.floor((examDateUtcStart - referenceUtcStart) / DAY_IN_MS);
}

export function buildStudyStatusLabel(planName: string, daysUntilExam: number): string {
  const normalizedDays = Math.max(0, Math.trunc(daysUntilExam));
  const daysLabel = normalizedDays === 1 ? "1 dia" : `${normalizedDays} dias`;

  return `Estudiando: ${planName} (examen en ${daysLabel})`;
}

export function resolveCurrentStudyStatusMap(
  plans: StudyStatusPlanRow[],
  referenceDate = new Date(),
): Map<string, CurrentStudyStatus> {
  const statusByUserId = new Map<string, CurrentStudyStatus>();

  for (const plan of plans) {
    const userId = plan.user_id;
    const planName = normalizePlanName(plan.nombre);
    const examDate = plan.fecha_examen;

    if (!userId || !planName || !examDate) {
      continue;
    }

    const daysUntilExam = calculateDaysUntilExam(examDate, referenceDate);

    if (daysUntilExam === null || daysUntilExam < 0) {
      continue;
    }

    const currentStatus = statusByUserId.get(userId);

    if (!currentStatus || daysUntilExam < currentStatus.daysUntilExam) {
      statusByUserId.set(userId, {
        planName,
        examDate,
        daysUntilExam,
        label: buildStudyStatusLabel(planName, daysUntilExam),
      });
    }
  }

  return statusByUserId;
}

export function resolveCurrentStudyStatusFromPlans(
  plans: StudyStatusPlanCandidate[],
  referenceDate = new Date(),
): CurrentStudyStatus | null {
  const normalizedRows: StudyStatusPlanRow[] = plans.map((plan) => ({
    user_id: "self",
    nombre: plan.nombre,
    fecha_examen: plan.fecha_examen,
  }));

  return resolveCurrentStudyStatusMap(normalizedRows, referenceDate).get("self") ?? null;
}
