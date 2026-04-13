"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { FaFilePdf, FaGithub, FaGoogle, FaWikipediaW } from "react-icons/fa";
import { FiExternalLink, FiLink } from "react-icons/fi";
import { LoadingSpinner } from "@/components/loading-spinner";
import { getInsforgeClient } from "@/lib/insforge/client";
import {
  DEFAULT_USER_BACKGROUND_THEME,
  getUserBackgroundImagePath,
  normalizeUserBackgroundTheme,
  type UserBackgroundTheme,
} from "@/lib/user-background-theme";

type StudyPlan = {
  id: string;
  nombre: string;
  description: string | null;
  fecha_examen: string | null;
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
  pages_read: number | null;
  display_order: number | null;
  file_size_bytes: number | null;
};

type UserSettings = {
  display_name: string | null;
  avatar_url: string | null;
  background_theme: UserBackgroundTheme;
};

type StudyPlanLink = {
  id: string;
  nombre: string;
  url: string;
  site_name: string | null;
  created_at: string;
};

type LinkSiteKey = "github" | "wikipedia" | "google" | "generic";

type ProcessDocumentResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  document?: {
    id: string;
    studyPlanId: string | null;
    status: "pending" | "processing" | "done" | "error";
    fileName: string;
    fileUrl: string;
    pageCount: number | null;
    displayOrder: number | null;
    fileSizeBytes: number | null;
    createdAt: string | null;
  };
};

const SLIDER_DEBOUNCE_MS = 350;

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

function formatCreatedByDate(value: string): string {
  const parsedDate = new Date(value);

  if (Number.isNaN(parsedDate.getTime())) {
    return "fecha no disponible";
  }

  return new Intl.DateTimeFormat("es-AR", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
  }).format(parsedDate);
}

function getDisplayNameFallback(user: unknown): string {
  if (!user || typeof user !== "object") {
    return "Sin nombre";
  }

  const userData = user as {
    email?: string | null;
    profile?: {
      name?: string | null;
    } | null;
  };

  const profileName = userData.profile?.name?.trim();
  if (profileName) {
    return profileName;
  }

  const emailPrefix = userData.email?.split("@")[0]?.trim();
  if (emailPrefix) {
    return emailPrefix;
  }

  return "Sin nombre";
}

function getAvatarInitial(displayName: string): string {
  const initial = displayName.trim().charAt(0);

  if (initial) {
    return initial.toUpperCase();
  }

  return "U";
}

function normalizeLinkUrl(rawValue: string): string | null {
  const trimmedValue = rawValue.trim();

  if (!trimmedValue) {
    return null;
  }

  const urlCandidate = /^https?:\/\//i.test(trimmedValue) ? trimmedValue : `https://${trimmedValue}`;

  try {
    const parsed = new URL(urlCandidate);

    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return parsed.toString();
  } catch {
    return null;
  }
}

function getDomainLabel(url: string): string {
  try {
    const hostName = new URL(url).hostname.toLowerCase();
    return hostName.replace(/^www\./, "");
  } catch {
    return "sitio externo";
  }
}

function detectLinkSiteKey(url: string): LinkSiteKey {
  const domainLabel = getDomainLabel(url);

  if (domainLabel.includes("github.com")) {
    return "github";
  }

  if (domainLabel.includes("wikipedia.org") || domainLabel.includes("wikimedia.org")) {
    return "wikipedia";
  }

  if (domainLabel.includes("google.")) {
    return "google";
  }

  return "generic";
}

function getLinkSiteInfo(url: string, siteName: string | null): {
  siteKey: LinkSiteKey;
  siteLabel: string;
} {
  const siteKey = detectLinkSiteKey(url);

  if (siteName && siteName.trim().length > 0) {
    return {
      siteKey,
      siteLabel: siteName.trim(),
    };
  }

  if (siteKey === "github") {
    return {
      siteKey,
      siteLabel: "GitHub",
    };
  }

  if (siteKey === "wikipedia") {
    return {
      siteKey,
      siteLabel: "Wikipedia",
    };
  }

  if (siteKey === "google") {
    return {
      siteKey,
      siteLabel: "Google",
    };
  }

  return {
    siteKey,
    siteLabel: getDomainLabel(url),
  };
}

function renderLinkSiteIcon(siteKey: LinkSiteKey) {
  if (siteKey === "github") {
    return <FaGithub className="h-4 w-4" aria-hidden="true" />;
  }

  if (siteKey === "wikipedia") {
    return <FaWikipediaW className="h-4 w-4" aria-hidden="true" />;
  }

  if (siteKey === "google") {
    return <FaGoogle className="h-4 w-4" aria-hidden="true" />;
  }

  return <FiLink className="h-4 w-4" aria-hidden="true" />;
}

function getDocumentTotalPages(document: StudyDocument): number | null {
  if (typeof document.page_count !== "number") {
    return null;
  }

  if (!Number.isFinite(document.page_count) || document.page_count <= 0) {
    return null;
  }

  return Math.trunc(document.page_count);
}

function clampPagesRead(value: number, document: StudyDocument): number {
  const normalized = Number.isFinite(value) ? Math.trunc(value) : 0;
  const nonNegative = Math.max(0, normalized);
  const totalPages = getDocumentTotalPages(document);

  if (totalPages === null) {
    return nonNegative;
  }

  return Math.min(nonNegative, totalPages);
}

function getProgressPercent(pagesRead: number, totalPages: number | null): number | null {
  if (!totalPages || totalPages <= 0) {
    return null;
  }

  const rawPercent = Math.round((pagesRead / totalPages) * 100);
  return Math.min(100, Math.max(0, rawPercent));
}

function getProgressGreen(progressPercent: number): string {
  const normalized = Math.min(100, Math.max(0, progressPercent)) / 100;
  const start = { r: 134, g: 239, b: 172 };
  const end = { r: 34, g: 197, b: 94 };

  const r = Math.round(start.r + (end.r - start.r) * normalized);
  const g = Math.round(start.g + (end.g - start.g) * normalized);
  const b = Math.round(start.b + (end.b - start.b) * normalized);

  return `rgb(${r} ${g} ${b})`;
}

function buildSliderBackground(progressPercent: number): string {
  const clampedPercent = Math.min(100, Math.max(0, progressPercent));
  const filledColor = getProgressGreen(clampedPercent);

  return `linear-gradient(90deg, ${filledColor} 0%, ${filledColor} ${clampedPercent}%, rgba(39, 39, 42, 0.9) ${clampedPercent}%, rgba(39, 39, 42, 0.9) 100%)`;
}

function getDaysUntilExam(examDate: string | null): number | null {
  if (!examDate) {
    return null;
  }

  const parsedDate = new Date(examDate);

  if (Number.isNaN(parsedDate.getTime())) {
    return null;
  }

  const now = new Date();
  const msPerDay = 24 * 60 * 60 * 1000;
  const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const examUtc = Date.UTC(parsedDate.getUTCFullYear(), parsedDate.getUTCMonth(), parsedDate.getUTCDate());

  return Math.ceil((examUtc - todayUtc) / msPerDay);
}

function formatExamCountdown(examDate: string | null): {
  message: string;
  tone: "neutral" | "good" | "warning" | "danger";
} {
  const daysUntilExam = getDaysUntilExam(examDate);

  if (daysUntilExam === null) {
    return {
      message: "Agrega la fecha de examen para activar el contador de dias.",
      tone: "neutral",
    };
  }

  if (daysUntilExam > 7) {
    return {
      message: `Faltan ${daysUntilExam} dias para el examen. Buen ritmo para sostener el avance.`,
      tone: "good",
    };
  }

  if (daysUntilExam > 1) {
    return {
      message: `Faltan ${daysUntilExam} dias para el examen. Es un gran momento para reforzar repasos.`,
      tone: "warning",
    };
  }

  if (daysUntilExam === 1) {
    return {
      message: "Falta 1 dia para el examen. Prioriza temas clave y descanso.",
      tone: "danger",
    };
  }

  if (daysUntilExam === 0) {
    return {
      message: "El examen es hoy. Enfoque en resumenes y confianza final.",
      tone: "danger",
    };
  }

  return {
    message:
      daysUntilExam === -1
        ? "El examen fue ayer. Puedes ajustar la fecha para el proximo objetivo."
        : `El examen fue hace ${Math.abs(daysUntilExam)} dias. Puedes definir una nueva fecha para seguir el plan.`,
    tone: "neutral",
  };
}

function getCountdownClasses(tone: "neutral" | "good" | "warning" | "danger"): string {
  if (tone === "good") {
    return "border-emerald-400/30 bg-emerald-500/10 text-emerald-100";
  }

  if (tone === "warning") {
    return "border-amber-400/30 bg-amber-500/10 text-amber-100";
  }

  if (tone === "danger") {
    return "border-red-400/30 bg-red-500/10 text-red-100";
  }

  return "border-zinc-700 bg-zinc-950 text-zinc-300";
}

function getExamCountdownLabel(examDate: string | null): string {
  const daysUntilExam = getDaysUntilExam(examDate);

  if (daysUntilExam === null) {
    return "Define la fecha de examen";
  }

  if (daysUntilExam > 1) {
    return `Faltan ${daysUntilExam} dias para el examen`;
  }

  if (daysUntilExam === 1) {
    return "Falta 1 dia para el examen";
  }

  if (daysUntilExam === 0) {
    return "El examen es hoy";
  }

  if (daysUntilExam === -1) {
    return "El examen fue ayer";
  }

  return `El examen fue hace ${Math.abs(daysUntilExam)} dias`;
}

function buildPdfPreviewUrl(fileUrl: string): string {
  if (fileUrl.includes("#")) {
    return fileUrl;
  }

  return `${fileUrl}#view=FitH&toolbar=0&navpanes=0`;
}

function sortDocumentsByDisplayOrder(documents: StudyDocument[]): StudyDocument[] {
  return [...documents].sort((left, right) => {
    const leftOrder = typeof left.display_order === "number" ? left.display_order : Number.MAX_SAFE_INTEGER;
    const rightOrder = typeof right.display_order === "number" ? right.display_order : Number.MAX_SAFE_INTEGER;

    if (leftOrder !== rightOrder) {
      return leftOrder - rightOrder;
    }

    const leftTime = new Date(left.created_at).getTime();
    const rightTime = new Date(right.created_at).getTime();

    if (!Number.isNaN(leftTime) && !Number.isNaN(rightTime)) {
      return rightTime - leftTime;
    }

    return left.id.localeCompare(right.id);
  });
}

function reorderDocumentsByStep(
  documents: StudyDocument[],
  documentId: string,
  direction: "up" | "down",
): StudyDocument[] | null {
  const currentIndex = documents.findIndex((document) => document.id === documentId);

  if (currentIndex < 0) {
    return null;
  }

  const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;

  if (targetIndex < 0 || targetIndex >= documents.length) {
    return null;
  }

  const reorderedDocuments = [...documents];
  const [movedDocument] = reorderedDocuments.splice(currentIndex, 1);
  reorderedDocuments.splice(targetIndex, 0, movedDocument);

  return reorderedDocuments.map((document, index) => ({
    ...document,
    display_order: index,
  }));
}

export default function StudyPlanDetailPage() {
  const params = useParams<{ planId: string }>();
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [plan, setPlan] = useState<StudyPlan | null>(null);
  const [creatorDisplayName, setCreatorDisplayName] = useState("Sin nombre");
  const [creatorAvatarUrl, setCreatorAvatarUrl] = useState<string | null>(null);
  const [planLinks, setPlanLinks] = useState<StudyPlanLink[]>([]);
  const [planLinksErrorMessage, setPlanLinksErrorMessage] = useState<string | null>(null);
  const [backgroundTheme, setBackgroundTheme] = useState<UserBackgroundTheme>(DEFAULT_USER_BACKGROUND_THEME);
  const [isBackgroundImageLoading, setIsBackgroundImageLoading] = useState(false);
  const [showAddLinkForm, setShowAddLinkForm] = useState(false);
  const [newLinkName, setNewLinkName] = useState("");
  const [newLinkUrl, setNewLinkUrl] = useState("");
  const [isSavingLink, setIsSavingLink] = useState(false);
  const [saveLinkErrorMessage, setSaveLinkErrorMessage] = useState<string | null>(null);
  const [saveLinkSuccessMessage, setSaveLinkSuccessMessage] = useState<string | null>(null);
  const [documents, setDocuments] = useState<StudyDocument[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string>("");
  const [progressByDocumentId, setProgressByDocumentId] = useState<Record<string, number>>({});
  const [manualInputByDocumentId, setManualInputByDocumentId] = useState<Record<string, string>>({});
  const [savingByDocumentId, setSavingByDocumentId] = useState<Record<string, boolean>>({});
  const [saveErrorByDocumentId, setSaveErrorByDocumentId] = useState<Record<string, string | null>>({});
  const [previewDocumentId, setPreviewDocumentId] = useState<string | null>(null);
  const [isAddingPdf, setIsAddingPdf] = useState(false);
  const [uploadingPdfCount, setUploadingPdfCount] = useState(0);
  const [addPdfMessage, setAddPdfMessage] = useState<string | null>(null);
  const [addPdfErrorMessage, setAddPdfErrorMessage] = useState<string | null>(null);
  const [isPersistingDocumentOrder, setIsPersistingDocumentOrder] = useState(false);
  const [documentOrderErrorMessage, setDocumentOrderErrorMessage] = useState<string | null>(null);
  const saveTimeoutByDocumentIdRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const addPdfInputRef = useRef<HTMLInputElement | null>(null);
  const documentCardRefs = useRef<Record<string, HTMLElement | null>>({});

  const planId = useMemo(() => {
    const value = params?.planId;
    return typeof value === "string" ? value : "";
  }, [params]);

  const examCountdown = useMemo(() => {
    return formatExamCountdown(plan?.fecha_examen ?? null);
  }, [plan?.fecha_examen]);

  const examCountdownLabel = useMemo(() => {
    return getExamCountdownLabel(plan?.fecha_examen ?? null);
  }, [plan?.fecha_examen]);

  const planProgress = useMemo(() => {
    let trackedDocuments = 0;
    let pagesRead = 0;
    let totalPages = 0;

    for (const document of documents) {
      const documentTotalPages = getDocumentTotalPages(document);

      if (!documentTotalPages) {
        continue;
      }

      trackedDocuments += 1;
      totalPages += documentTotalPages;

      const persistedPagesRead = clampPagesRead(document.pages_read ?? 0, document);
      const currentPagesRead = progressByDocumentId[document.id] ?? persistedPagesRead;
      pagesRead += Math.min(currentPagesRead, documentTotalPages);
    }

    const progressPercent = totalPages > 0 ? Math.round((pagesRead / totalPages) * 100) : null;

    return {
      trackedDocuments,
      pagesRead,
      totalPages,
      progressPercent,
    };
  }, [documents, progressByDocumentId]);

  function captureCardRectMap(): Record<string, DOMRect> {
    const rectMap: Record<string, DOMRect> = {};

    for (const [documentId, element] of Object.entries(documentCardRefs.current)) {
      if (!element) {
        continue;
      }

      rectMap[documentId] = element.getBoundingClientRect();
    }

    return rectMap;
  }

  function animateCardOrderTransition(previousRects: Record<string, DOMRect>): void {
    requestAnimationFrame(() => {
      for (const [documentId, previousRect] of Object.entries(previousRects)) {
        const element = documentCardRefs.current[documentId];

        if (!element) {
          continue;
        }

        const nextRect = element.getBoundingClientRect();
        const deltaY = previousRect.top - nextRect.top;

        if (Math.abs(deltaY) < 1) {
          continue;
        }

        element.style.transition = "none";
        element.style.transform = `translateY(${deltaY}px)`;
        element.style.willChange = "transform";

        requestAnimationFrame(() => {
          element.style.transition = "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)";
          element.style.transform = "translateY(0)";

          const handleTransitionEnd = () => {
            element.style.transition = "";
            element.style.willChange = "";
            element.removeEventListener("transitionend", handleTransitionEnd);
          };

          element.addEventListener("transitionend", handleTransitionEnd);
        });
      }
    });
  }

  useEffect(() => {
    const timeoutMap = saveTimeoutByDocumentIdRef.current;

    return () => {
      for (const timeout of Object.values(timeoutMap)) {
        clearTimeout(timeout);
      }
    };
  }, []);

  useEffect(() => {
    if (!planId) {
      return;
    }

    let isCancelled = false;

    async function loadData() {
      const client = getInsforgeClient();

      const { data: currentUserData, error: currentUserError } = await client.auth.getCurrentUser();
      const currentUser = currentUserData?.user;
      const userId = currentUser?.id;

      if (currentUserError || !userId) {
        if (!isCancelled) {
          router.replace("/login");
        }
        return;
      }

      if (!isCancelled) {
        setCurrentUserId(userId);
      }

      const displayNameFallback = getDisplayNameFallback(currentUser);
      const { data: settingsData, error: settingsError } = await client.database
        .from("user_settings")
        .select("display_name, avatar_url, background_theme")
        .eq("user_id", userId)
        .maybeSingle();

      const settingsRow = settingsData as Partial<UserSettings> | null;
      const resolvedDisplayName =
        !settingsError && settingsRow?.display_name?.trim()
          ? settingsRow.display_name.trim()
          : displayNameFallback;

      const resolvedAvatarUrl = !settingsError && settingsRow?.avatar_url ? settingsRow.avatar_url : null;
      const resolvedBackgroundTheme = normalizeUserBackgroundTheme(
        !settingsError ? settingsRow?.background_theme : null,
      );

      if (!isCancelled) {
        setCreatorDisplayName(resolvedDisplayName);
        setCreatorAvatarUrl(resolvedAvatarUrl);
        setBackgroundTheme(resolvedBackgroundTheme);
      }

      const { data: planData, error: planError } = await client.database
        .from("study_plans")
        .select("id, nombre, description, fecha_examen, status, created_at")
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

      let resolvedDocuments: StudyDocument[] = [];
      let docsErrorMessage: string | null = null;
      let resolvedPlanLinks: StudyPlanLink[] = [];
      let linksErrorMessage: string | null = null;

      const docsWithOrderResult = await client.database
        .from("study_documents")
        .select("id, nombre, status, created_at, file_url, page_count, pages_read, display_order, file_size_bytes")
        .eq("plan_id", planId)
        .eq("user_id", userId)
        .order("display_order", { ascending: true })
        .order("created_at", { ascending: false });

      if (docsWithOrderResult.error) {
        const normalizedError = docsWithOrderResult.error.message.toLowerCase();
        const displayOrderMissing =
          normalizedError.includes("display_order") &&
          (normalizedError.includes("does not exist") || normalizedError.includes("schema"));

        if (displayOrderMissing) {
          const fallbackDocsResult = await client.database
            .from("study_documents")
            .select("id, nombre, status, created_at, file_url, page_count, pages_read, file_size_bytes")
            .eq("plan_id", planId)
            .eq("user_id", userId)
            .order("created_at", { ascending: false });

          if (fallbackDocsResult.error) {
            docsErrorMessage = fallbackDocsResult.error.message;
          } else {
            const fallbackDocuments =
              ((fallbackDocsResult.data as Omit<StudyDocument, "display_order">[] | null) ?? []).map(
                (document, index) => ({
                  ...document,
                  display_order: index,
                }),
              );

            resolvedDocuments = fallbackDocuments;
          }
        } else {
          docsErrorMessage = docsWithOrderResult.error.message;
        }
      } else {
        resolvedDocuments = ((docsWithOrderResult.data as StudyDocument[] | null) ?? []).map((document, index) => ({
          ...document,
          display_order: typeof document.display_order === "number" ? Math.trunc(document.display_order) : index,
        }));
      }

      const linksResult = await client.database
        .from("study_plan_links")
        .select("id, nombre, url, site_name, created_at")
        .eq("plan_id", planId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false });

      if (linksResult.error) {
        const normalizedLinksError = linksResult.error.message.toLowerCase();
        const isMissingLinksTable =
          normalizedLinksError.includes("study_plan_links") &&
          (normalizedLinksError.includes("does not exist") ||
            normalizedLinksError.includes("not found") ||
            normalizedLinksError.includes("42p01"));

        linksErrorMessage = isMissingLinksTable
          ? "La seccion de links de utilidad requiere la migracion insforge/sql/009_study_plan_links.sql."
          : linksResult.error.message;
      } else {
        resolvedPlanLinks = (linksResult.data as StudyPlanLink[] | null) ?? [];
      }

      if (!isCancelled) {
        setPlan(planData as StudyPlan);

        if (docsErrorMessage) {
          setErrorMessage(docsErrorMessage);
          setDocuments([]);
        } else {
          setErrorMessage(null);
          setDocuments(sortDocumentsByDisplayOrder(resolvedDocuments));
        }

        if (linksErrorMessage) {
          setPlanLinksErrorMessage(linksErrorMessage);
          setPlanLinks([]);
        } else {
          setPlanLinksErrorMessage(null);
          setPlanLinks(resolvedPlanLinks);
        }

        setIsLoading(false);
      }
    }

    void loadData();

    return () => {
      isCancelled = true;
    };
  }, [planId, router]);

  useEffect(() => {
    setProgressByDocumentId((previousState) => {
      const nextState: Record<string, number> = {};

      for (const document of documents) {
        const persistedValue = clampPagesRead(document.pages_read ?? 0, document);
        const previousValue = previousState[document.id];

        nextState[document.id] =
          typeof previousValue === "number" ? clampPagesRead(previousValue, document) : persistedValue;
      }

      return nextState;
    });

    setManualInputByDocumentId((previousState) => {
      const nextState: Record<string, string> = {};

      for (const document of documents) {
        const pagesRead = clampPagesRead(document.pages_read ?? 0, document);
        const previousValue = previousState[document.id];
        nextState[document.id] = typeof previousValue === "string" ? previousValue : String(pagesRead);
      }

      return nextState;
    });

    setPreviewDocumentId((currentPreviewId) => {
      if (documents.length === 0) {
        return null;
      }

      if (currentPreviewId && documents.some((document) => document.id === currentPreviewId)) {
        return currentPreviewId;
      }

      return documents[0]?.id ?? null;
    });

    const validDocumentIds = new Set(documents.map((document) => document.id));

    for (const documentId of Object.keys(documentCardRefs.current)) {
      if (!validDocumentIds.has(documentId)) {
        delete documentCardRefs.current[documentId];
      }
    }
  }, [documents]);

  async function persistDocumentProgress(document: StudyDocument, nextPagesRead: number): Promise<void> {
    if (!currentUserId) {
      return;
    }

    const client = getInsforgeClient();

    setSavingByDocumentId((previousState) => ({
      ...previousState,
      [document.id]: true,
    }));

    setSaveErrorByDocumentId((previousState) => ({
      ...previousState,
      [document.id]: null,
    }));

    try {
      const { error } = await client.database
        .from("study_documents")
        .update({ pages_read: nextPagesRead })
        .eq("id", document.id)
        .eq("plan_id", planId)
        .eq("user_id", currentUserId);

      if (error) {
        setSaveErrorByDocumentId((previousState) => ({
          ...previousState,
          [document.id]: error.message || "No se pudo guardar el avance.",
        }));
        return;
      }

      setDocuments((previousDocuments) =>
        previousDocuments.map((currentDocument) =>
          currentDocument.id === document.id
            ? {
                ...currentDocument,
                pages_read: nextPagesRead,
              }
            : currentDocument,
        ),
      );
    } finally {
      setSavingByDocumentId((previousState) => ({
        ...previousState,
        [document.id]: false,
      }));
    }
  }

  function scheduleProgressSave(document: StudyDocument, nextPagesRead: number): void {
    const currentTimeout = saveTimeoutByDocumentIdRef.current[document.id];

    if (currentTimeout) {
      clearTimeout(currentTimeout);
    }

    saveTimeoutByDocumentIdRef.current[document.id] = setTimeout(() => {
      delete saveTimeoutByDocumentIdRef.current[document.id];
      void persistDocumentProgress(document, nextPagesRead);
    }, SLIDER_DEBOUNCE_MS);
  }

  function handleSliderChange(document: StudyDocument, event: ChangeEvent<HTMLInputElement>): void {
    const rawValue = Number(event.target.value);
    const nextPagesRead = clampPagesRead(rawValue, document);

    setProgressByDocumentId((previousState) => ({
      ...previousState,
      [document.id]: nextPagesRead,
    }));

    setManualInputByDocumentId((previousState) => ({
      ...previousState,
      [document.id]: String(nextPagesRead),
    }));

    scheduleProgressSave(document, nextPagesRead);
  }

  function handleManualInputChange(documentId: string, rawValue: string): void {
    setManualInputByDocumentId((previousState) => ({
      ...previousState,
      [documentId]: rawValue,
    }));
  }

  function commitManualInput(document: StudyDocument): void {
    const rawValue = manualInputByDocumentId[document.id] ?? "0";
    const parsedValue = Number(rawValue);
    const nextPagesRead = clampPagesRead(parsedValue, document);

    const currentTimeout = saveTimeoutByDocumentIdRef.current[document.id];

    if (currentTimeout) {
      clearTimeout(currentTimeout);
      delete saveTimeoutByDocumentIdRef.current[document.id];
    }

    setProgressByDocumentId((previousState) => ({
      ...previousState,
      [document.id]: nextPagesRead,
    }));

    setManualInputByDocumentId((previousState) => ({
      ...previousState,
      [document.id]: String(nextPagesRead),
    }));

    void persistDocumentProgress(document, nextPagesRead);
  }

  function handleManualInputKeyDown(event: KeyboardEvent<HTMLInputElement>, document: StudyDocument): void {
    if (event.key !== "Enter") {
      return;
    }

    event.preventDefault();
    commitManualInput(document);
  }

  function getAuthHeaderForApiRequest(): string {
    const client = getInsforgeClient();
    const headers = client.getHttpClient().getHeaders();
    const token = headers.Authorization ?? headers.authorization;

    if (!token) {
      throw new Error("No hay sesion activa para subir PDFs.");
    }

    return token;
  }

  async function handleSubmitNewLink(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    if (!currentUserId) {
      setSaveLinkErrorMessage("No hay sesion activa para agregar links.");
      setSaveLinkSuccessMessage(null);
      return;
    }

    const normalizedUrl = normalizeLinkUrl(newLinkUrl);

    if (!normalizedUrl) {
      setSaveLinkErrorMessage("Ingresa una URL valida. Puedes pegarla con o sin https://");
      setSaveLinkSuccessMessage(null);
      return;
    }

    const siteInfo = getLinkSiteInfo(normalizedUrl, null);
    const finalLinkName = newLinkName.trim().length > 0 ? newLinkName.trim() : siteInfo.siteLabel;

    setIsSavingLink(true);
    setSaveLinkErrorMessage(null);
    setSaveLinkSuccessMessage(null);

    try {
      const client = getInsforgeClient();
      const { data, error } = await client.database
        .from("study_plan_links")
        .insert([
          {
            plan_id: planId,
            user_id: currentUserId,
            nombre: finalLinkName,
            url: normalizedUrl,
            site_name: siteInfo.siteLabel,
          },
        ])
        .select("id, nombre, url, site_name, created_at")
        .single();

      if (error || !data) {
        throw new Error(error?.message ?? "No se pudo guardar el link.");
      }

      setPlanLinks((previousLinks) => [data as StudyPlanLink, ...previousLinks]);
      setNewLinkName("");
      setNewLinkUrl("");
      setSaveLinkSuccessMessage("Link agregado correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el link.";
      setSaveLinkErrorMessage(message);
    } finally {
      setIsSavingLink(false);
    }
  }

  function getApiProcessError(payload: ProcessDocumentResponse | null): string {
    const rawError = payload?.error;

    if (typeof rawError === "string") {
      const normalized = rawError.trim();

      if (normalized.length > 0) {
        return normalized;
      }
    }

    return "No se pudo subir el PDF.";
  }

  async function uploadSinglePdf(file: File, authorization: string): Promise<StudyDocument> {
    const formData = new FormData();
    formData.append("studyPlanId", planId);
    formData.append("file", file, file.name);

    const response = await fetch("/api/process-document", {
      method: "POST",
      headers: {
        Authorization: authorization,
      },
      body: formData,
    });

    const payload = (await response.json().catch(() => null)) as ProcessDocumentResponse | null;

    if (!response.ok) {
      throw new Error(getApiProcessError(payload));
    }

    if (!payload?.document?.id) {
      throw new Error("La API no devolvio el documento creado.");
    }

    return {
      id: payload.document.id,
      nombre: payload.document.fileName,
      status: payload.document.status,
      created_at: payload.document.createdAt ?? new Date().toISOString(),
      file_url: payload.document.fileUrl,
      page_count: payload.document.pageCount,
      pages_read: 0,
      display_order:
        typeof payload.document.displayOrder === "number" && Number.isFinite(payload.document.displayOrder)
          ? Math.trunc(payload.document.displayOrder)
          : null,
      file_size_bytes: payload.document.fileSizeBytes,
    };
  }

  async function handleAddPdfChange(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    const hasInvalidFile = selectedFiles.some((file) => {
      const normalizedName = file.name.toLowerCase();
      return file.type !== "application/pdf" && !normalizedName.endsWith(".pdf");
    });

    if (hasInvalidFile) {
      setAddPdfErrorMessage("Solo puedes subir archivos PDF.");
      setAddPdfMessage(null);
      return;
    }

    setIsAddingPdf(true);
    setUploadingPdfCount(selectedFiles.length);
    setAddPdfMessage(null);
    setAddPdfErrorMessage(null);

    const successfulDocuments: StudyDocument[] = [];
    const failedFiles: string[] = [];

    try {
      const authorization = getAuthHeaderForApiRequest();

      for (const file of selectedFiles) {
        try {
          const createdDocument = await uploadSinglePdf(file, authorization);
          successfulDocuments.push(createdDocument);
        } catch {
          failedFiles.push(file.name);
        }
      }

      if (successfulDocuments.length > 0) {
        setDocuments((previousDocuments) => {
          const mergedDocuments = [...previousDocuments, ...successfulDocuments];
          return sortDocumentsByDisplayOrder(mergedDocuments);
        });
        setPreviewDocumentId(successfulDocuments[0]?.id ?? null);
      }

      if (failedFiles.length > 0) {
        setAddPdfErrorMessage(
          `No se pudieron subir ${failedFiles.length} archivo(s): ${failedFiles.join(", ")}. Reintenta esos documentos.`,
        );
      }

      if (successfulDocuments.length > 0) {
        setAddPdfMessage(
          `Se agregaron ${successfulDocuments.length} PDF(s) al plan. Cada uno ya cuenta para el progreso total.`,
        );
      }

      if (successfulDocuments.length === 0 && failedFiles.length === 0) {
        setAddPdfErrorMessage("No se seleccionaron PDFs para subir.");
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron agregar PDFs al plan.";
      setAddPdfErrorMessage(message);
    } finally {
      setIsAddingPdf(false);
      setUploadingPdfCount(0);
    }
  }

  async function persistDocumentOrder(
    previousDocuments: StudyDocument[],
    orderedDocuments: StudyDocument[],
  ): Promise<void> {
    if (!currentUserId) {
      return;
    }

    const previousIndexByDocumentId = new Map(previousDocuments.map((document, index) => [document.id, index]));
    const client = getInsforgeClient();

    setIsPersistingDocumentOrder(true);
    setDocumentOrderErrorMessage(null);

    try {
      for (let index = 0; index < orderedDocuments.length; index += 1) {
        const document = orderedDocuments[index];
        const previousIndex = previousIndexByDocumentId.get(document.id);

        if (previousIndex === index) {
          continue;
        }

        const { error } = await client.database
          .from("study_documents")
          .update({ display_order: index })
          .eq("id", document.id)
          .eq("plan_id", planId)
          .eq("user_id", currentUserId);

        if (error) {
          throw new Error(error.message || "No se pudo guardar el nuevo orden de documentos.");
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo guardar el nuevo orden de documentos.";
      setDocumentOrderErrorMessage(`${message} Se restauro el orden anterior.`);
      setDocuments(previousDocuments);
    } finally {
      setIsPersistingDocumentOrder(false);
    }
  }

  function handleMoveDocument(documentId: string, direction: "up" | "down"): void {
    if (isPersistingDocumentOrder) {
      return;
    }

    const previousDocuments = documents.map((document) => ({ ...document }));
    const reorderedDocuments = reorderDocumentsByStep(documents, documentId, direction);

    if (!reorderedDocuments) {
      return;
    }

    const previousRects = captureCardRectMap();

    setDocumentOrderErrorMessage(null);
    setDocuments(reorderedDocuments);
    animateCardOrderTransition(previousRects);
    void persistDocumentOrder(previousDocuments, reorderedDocuments);
  }

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

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 py-12">
        <div className="flex items-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-zinc-300">Cargando plan...</p>
        </div>
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
    <div className="relative min-h-screen overflow-hidden bg-zinc-950 px-6 py-12 text-zinc-100">
      <div
        className="absolute inset-0 bg-cover bg-center bg-no-repeat"
        style={{ backgroundImage: `url('${activeBackgroundImagePath}')` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0 bg-black/55" aria-hidden="true" />

      <main className="relative z-10 mx-auto w-full max-w-4xl space-y-6">
        {isBackgroundImageLoading ? (
          <div className="flex items-center gap-2 text-xs text-zinc-300">
            <LoadingSpinner size="sm" className="border-zinc-500 border-t-teal-200" />
            <span>Cargando fondo...</span>
          </div>
        ) : null}
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm uppercase tracking-[0.14em] text-teal-300">Plan de estudio</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">{plan.nombre}</h1>

              <div className="mt-3 flex min-w-0 items-center gap-3 text-sm text-zinc-300">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-950 text-sm font-semibold text-teal-200">
                  {creatorAvatarUrl ? (
                    <img
                      src={creatorAvatarUrl}
                      alt={`Avatar de ${creatorDisplayName}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span aria-hidden="true">{getAvatarInitial(creatorDisplayName)}</span>
                  )}
                </div>

                <p className="min-w-0 truncate">
                  Creado por: <span className="font-semibold text-zinc-100">{creatorDisplayName}</span> el{" "}
                  {formatCreatedByDate(plan.created_at)}
                </p>
              </div>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200"
            >
              Volver al dashboard
            </Link>
          </div>

          {plan.description ? <p className="mt-5 text-sm leading-6 text-zinc-300">{plan.description}</p> : null}

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="rounded-xl border border-zinc-700 bg-zinc-950 px-4 py-2 text-sm font-semibold text-zinc-200">
              Fecha de examen: {formatExamDate(plan.fecha_examen)}
            </span>

            <span
              className={`rounded-xl border px-4 py-2 text-sm font-medium ${getCountdownClasses(examCountdown.tone)}`}
            >
              {examCountdownLabel}
            </span>
          </div>

          <div className="mt-5 rounded-xl border border-emerald-400/25 bg-emerald-500/5 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm font-semibold text-emerald-100">Progreso total del plan</p>
              <p className="text-xs text-emerald-200">
                {planProgress.progressPercent ?? "--"}% · {planProgress.pagesRead}/
                {planProgress.totalPages > 0 ? planProgress.totalPages : "N/A"} pags
              </p>
            </div>

            <div className="mt-3 h-3 overflow-hidden rounded-full bg-zinc-800">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{
                  width: `${planProgress.progressPercent ?? 0}%`,
                  backgroundColor: getProgressGreen(planProgress.progressPercent ?? 0),
                }}
              />
            </div>

            <p className="mt-2 text-xs text-zinc-300">
              {planProgress.trackedDocuments > 0
                ? `Se calcula con ${planProgress.trackedDocuments} documento(s) que tienen cantidad total de paginas.`
                : "El progreso total aparecera cuando haya documentos con cantidad de paginas detectada."}
            </p>
          </div>

        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-xl font-semibold text-white">Links de utilidad</h2>
              <p className="mt-1 text-xs text-zinc-400">
                Guarda recursos externos para este plan y abrelos rapido desde aqui.
              </p>
            </div>

            <button
              type="button"
              onClick={() => {
                setShowAddLinkForm((currentValue) => !currentValue);
                setSaveLinkErrorMessage(null);
                setSaveLinkSuccessMessage(null);
              }}
              className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200"
            >
              {showAddLinkForm ? "Cerrar" : "Agregar links de utilidad"}
            </button>
          </div>

          {showAddLinkForm ? (
            <form onSubmit={(event) => void handleSubmitNewLink(event)} className="mt-4 rounded-xl border border-zinc-800 bg-zinc-950/70 p-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="new-plan-link-name" className="mb-2 block text-xs uppercase tracking-[0.08em] text-zinc-400">
                    Nombre del link
                  </label>
                  <input
                    id="new-plan-link-name"
                    type="text"
                    value={newLinkName}
                    onChange={(event) => setNewLinkName(event.target.value)}
                    placeholder="Ej: Repo principal"
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
                  />
                </div>

                <div>
                  <label htmlFor="new-plan-link-url" className="mb-2 block text-xs uppercase tracking-[0.08em] text-zinc-400">
                    URL
                  </label>
                  <input
                    id="new-plan-link-url"
                    type="text"
                    value={newLinkUrl}
                    onChange={(event) => setNewLinkUrl(event.target.value)}
                    placeholder="https://github.com/..."
                    required
                    className="h-10 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 text-sm text-zinc-100 outline-none transition focus:border-teal-300/70"
                  />
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button
                  type="submit"
                  disabled={isSavingLink}
                  className="inline-flex h-9 items-center justify-center rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isSavingLink ? "Guardando..." : "Guardar link"}
                </button>
              </div>

              {saveLinkErrorMessage ? (
                <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {saveLinkErrorMessage}
                </p>
              ) : null}

              {saveLinkSuccessMessage ? (
                <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                  {saveLinkSuccessMessage}
                </p>
              ) : null}
            </form>
          ) : null}

          {planLinksErrorMessage ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {planLinksErrorMessage}
            </p>
          ) : null}

          {planLinks.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">Aun no agregaste links de utilidad para este plan.</p>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {planLinks.map((planLink) => {
                const siteInfo = getLinkSiteInfo(planLink.url, planLink.site_name);

                return (
                  <a
                    key={planLink.id}
                    href={planLink.url}
                    target="_blank"
                    rel="noreferrer"
                    className="group rounded-xl border border-zinc-700 bg-zinc-950/70 p-4 transition hover:border-teal-300/50 hover:bg-zinc-900"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 bg-zinc-900 text-teal-200">
                          {renderLinkSiteIcon(siteInfo.siteKey)}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-zinc-100">{planLink.nombre}</p>
                          <p className="truncate text-xs text-zinc-400">{planLink.url}</p>
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-2">
                        <span className="rounded-full border border-zinc-700 px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-zinc-400">
                          {siteInfo.siteLabel}
                        </span>
                        <FiExternalLink className="h-3.5 w-3.5 text-zinc-500 transition group-hover:text-zinc-200" aria-hidden="true" />
                      </div>
                    </div>
                  </a>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <h2 className="text-xl font-semibold text-white">Documentos del plan</h2>

          {errorMessage ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {errorMessage}
            </p>
          ) : null}

          {isPersistingDocumentOrder ? (
            <p className="mt-4 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              Guardando nuevo orden de documentos...
            </p>
          ) : null}

          {documentOrderErrorMessage ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {documentOrderErrorMessage}
            </p>
          ) : null}

          {documents.length === 0 ? (
            <p className="mt-4 text-sm text-zinc-400">Aun no hay documentos en este plan.</p>
          ) : (
            <div className="mt-4 space-y-4">
              {documents.map((document, documentIndex) => {
                const totalPages = getDocumentTotalPages(document);
                const persistedPagesRead = clampPagesRead(document.pages_read ?? 0, document);
                const pagesRead = progressByDocumentId[document.id] ?? persistedPagesRead;
                const progressPercent = getProgressPercent(pagesRead, totalPages) ?? 0;
                const sliderMax = totalPages ?? Math.max(1, pagesRead);
                const sliderBackground = buildSliderBackground(progressPercent);
                const isPreviewVisible = previewDocumentId === document.id;
                const isSaving = savingByDocumentId[document.id] ?? false;
                const saveError = saveErrorByDocumentId[document.id];
                const isFirstDocument = documentIndex === 0;
                const isLastDocument = documentIndex === documents.length - 1;
                const previewContainerClasses = isPreviewVisible
                  ? "border-zinc-800 bg-zinc-900/60"
                  : "border-red-300/20 bg-red-400/10";
                const previewTitleClasses = isPreviewVisible ? "text-zinc-400" : "text-red-100/80";
                const previewButtonClasses = isPreviewVisible
                  ? "border-zinc-700 text-zinc-200 hover:border-zinc-500 hover:bg-zinc-800"
                  : "border-red-200/40 bg-red-400/10 text-red-100/90 hover:border-red-200/70 hover:bg-red-400/20";

                return (
                  <article
                    key={document.id}
                    ref={(element) => {
                      documentCardRefs.current[document.id] = element;
                    }}
                    className="rounded-2xl border border-zinc-700/80 bg-zinc-950/90 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)] transition-colors duration-200"
                  >
                    <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 px-4 py-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-start gap-3">
                            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-red-300/35 bg-red-500/15 text-red-200">
                              <FaFilePdf className="h-5 w-5" aria-hidden="true" />
                            </span>

                            <div className="min-w-0 space-y-2">
                              <p className="text-lg font-semibold tracking-[0.01em] text-zinc-100">{document.nombre}</p>
                              <div className="h-[2px] w-52 max-w-full bg-gradient-to-r from-emerald-300/70 via-emerald-200/30 to-transparent" />
                              <p className="text-xs text-zinc-500">
                                Paginas: {document.page_count ?? "N/A"} · Peso: {formatBytes(document.file_size_bytes)}
                              </p>
                            </div>
                          </div>
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
                    </div>

                    <div className="mt-4 rounded-xl border border-emerald-400/25 bg-emerald-500/10 p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-xs uppercase tracking-[0.1em] text-emerald-200">Avance de lectura</p>
                        <p className="text-[11px] text-emerald-100">{isSaving ? "Guardando..." : "Guardado"}</p>
                      </div>

                      <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center">
                        <div className="min-w-0 flex-1">
                          <input
                            type="range"
                            min={0}
                            max={sliderMax}
                            value={Math.min(pagesRead, sliderMax)}
                            disabled={totalPages === null}
                            onChange={(event) => handleSliderChange(document, event)}
                            className="h-2 w-full cursor-pointer appearance-none rounded-full bg-zinc-800 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border [&::-webkit-slider-thumb]:border-emerald-200/80 [&::-webkit-slider-thumb]:bg-emerald-400 [&::-webkit-slider-thumb]:shadow-[0_0_0_4px_rgba(16,185,129,0.18)] [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border [&::-moz-range-thumb]:border-emerald-200/80 [&::-moz-range-thumb]:bg-emerald-400 disabled:cursor-not-allowed disabled:opacity-50"
                            style={{ background: sliderBackground }}
                            aria-label={`Progreso de lectura ${document.nombre}`}
                          />

                          {totalPages === null ? (
                            <p className="mt-2 text-[11px] text-zinc-400">
                              No se detecto el total de paginas de este PDF. Puedes usar el campo manual para guardar tu
                              avance.
                            </p>
                          ) : null}
                        </div>

                        <div className="flex items-center gap-3 rounded-lg border border-emerald-300/25 bg-zinc-950/60 px-3 py-2">
                          <p className="text-sm font-semibold text-emerald-100">
                            {totalPages === null ? "--" : `${progressPercent}%`}
                          </p>
                          <p className="text-xs text-emerald-200">
                            {pagesRead}/{totalPages ?? "N/A"} pags
                          </p>
                        </div>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <label
                          htmlFor={`manual-pages-${document.id}`}
                          className="text-xs uppercase tracking-[0.08em] text-emerald-200"
                        >
                          Pagina actual
                        </label>
                        <input
                          id={`manual-pages-${document.id}`}
                          type="number"
                          inputMode="numeric"
                          min={0}
                          max={totalPages ?? undefined}
                          value={manualInputByDocumentId[document.id] ?? String(pagesRead)}
                          onChange={(event) => handleManualInputChange(document.id, event.target.value)}
                          onBlur={() => commitManualInput(document)}
                          onKeyDown={(event) => handleManualInputKeyDown(event, document)}
                          className="h-9 w-28 rounded-lg border border-emerald-300/30 bg-zinc-950 px-3 text-sm text-zinc-100 outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-300/20"
                        />
                        <button
                          type="button"
                          onClick={() => commitManualInput(document)}
                          className="inline-flex h-9 items-center justify-center rounded-lg border border-emerald-300/30 bg-emerald-500/15 px-3 text-xs font-semibold text-emerald-100 transition hover:bg-emerald-500/25"
                        >
                          Guardar pagina
                        </button>
                      </div>

                      {saveError ? (
                        <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                          {saveError}
                        </p>
                      ) : null}
                    </div>

                    <div className={`mt-4 rounded-xl border p-4 ${previewContainerClasses}`}>
                      <div className="flex flex-wrap items-center justify-between gap-3 pl-1">
                        <p className={`text-xs uppercase tracking-[0.1em] ${previewTitleClasses}`}>Vista previa del PDF</p>
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewDocumentId((currentId) => (currentId === document.id ? null : document.id))
                          }
                          className={`inline-flex h-8 items-center justify-center rounded-lg border px-3 text-xs font-semibold transition ${previewButtonClasses}`}
                        >
                          {isPreviewVisible ? "Ocultar vista previa" : "Ver vista previa"}
                        </button>
                      </div>

                      {isPreviewVisible ? (
                        <div className="mt-4 overflow-hidden rounded-lg border border-zinc-800 bg-black">
                          <iframe
                            src={buildPdfPreviewUrl(document.file_url)}
                            title={`Vista previa de ${document.nombre}`}
                            className="h-[460px] w-full"
                          />
                        </div>
                      ) : (
                        <p className="mt-3 pl-1 text-xs leading-5 text-red-100/70">
                          Activa la vista previa para revisar el PDF sin salir de esta pantalla.
                        </p>
                      )}
                    </div>

                    <div className="mt-4 flex justify-center">
                      <div className="inline-flex items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900/70 px-3 py-2 text-[11px] uppercase tracking-[0.1em] text-zinc-400">
                        <span>Desplazar</span>
                        <button
                          type="button"
                          aria-label={`Subir ${document.nombre}`}
                          disabled={isPersistingDocumentOrder || isFirstDocument}
                          onClick={() => handleMoveDocument(document.id, "up")}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sm font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-600"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          aria-label={`Bajar ${document.nombre}`}
                          disabled={isPersistingDocumentOrder || isLastDocument}
                          onClick={() => handleMoveDocument(document.id, "down")}
                          className="inline-flex h-6 w-6 items-center justify-center rounded-md text-sm font-bold text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:text-zinc-600"
                        >
                          ↓
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}

          <div className="mt-6 rounded-xl border border-zinc-700 bg-zinc-950/70 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-zinc-100">Agregar PDF</p>
                <p className="mt-1 text-xs text-zinc-400">
                  Sube uno o varios PDFs para sumarlos al plan. Cada documento tendra su progreso propio.
                </p>
              </div>

              <input
                ref={addPdfInputRef}
                type="file"
                accept="application/pdf"
                multiple
                disabled={isAddingPdf}
                onChange={(event) => {
                  void handleAddPdfChange(event);
                }}
                className="hidden"
              />

              <button
                type="button"
                disabled={isAddingPdf}
                onClick={() => addPdfInputRef.current?.click()}
                className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-4 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isAddingPdf ? `Subiendo ${uploadingPdfCount} PDF(s)...` : "Agregar PDF"}
              </button>
            </div>

            {addPdfMessage ? (
              <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                {addPdfMessage}
              </p>
            ) : null}

            {addPdfErrorMessage ? (
              <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {addPdfErrorMessage}
              </p>
            ) : null}
          </div>
        </section>
      </main>
    </div>
  );
}
