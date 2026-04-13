"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useState } from "react";
import { FiBell, FiEdit2, FiLogOut, FiRefreshCw, FiUserPlus, FiUsers } from "react-icons/fi";
import { LoadingSpinner } from "@/components/loading-spinner";
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
  avatar_url: string | null;
  onboarding_completed: boolean;
};

type UserProfileApiResponse = {
  success?: boolean;
  error?: string;
  profile?: {
    userId?: string;
    email?: string;
    displayName?: string;
    avatarUrl?: string | null;
  };
};

type StudyPlanSummary = {
  id: string;
  nombre: string;
  description: string | null;
  fecha_examen: string | null;
  status: "processing" | "done" | "error";
  created_at: string;
};

type DeleteStudyPlanResponse = {
  success?: boolean;
  error?: string;
};

type SocialUserSummary = {
  userId: string;
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

type ContactSearchApiResponse = {
  success?: boolean;
  error?: string;
  users?: SocialUserSummary[];
};

type FriendListItem = SocialUserSummary & {
  friendsSince: string | null;
};

type FriendsApiResponse = {
  success?: boolean;
  error?: string;
  friends?: FriendListItem[];
};

type FriendRequestStatus = "pending" | "accepted" | "rejected" | "cancelled";

type FriendRequestSummary = {
  id: string;
  status: FriendRequestStatus;
  createdAt: string;
  respondedAt: string | null;
  sender: SocialUserSummary;
  receiver: SocialUserSummary;
};

type FriendRequestsApiResponse = {
  success?: boolean;
  error?: string;
  requests?: FriendRequestSummary[];
};

type FriendRequestActionApiResponse = {
  success?: boolean;
  error?: string;
};

const AVATAR_CATEGORIES = [
  { id: "faces", label: "Caras", style: "adventurer-neutral" },
  { id: "robots", label: "Robots", style: "bottts-neutral" },
  { id: "pixel", label: "Pixel", style: "pixel-art-neutral" },
  { id: "geometric", label: "Geometricos", style: "shapes" },
  { id: "icons", label: "Iconos", style: "icons" },
] as const;

type AvatarCategoryId = (typeof AVATAR_CATEGORIES)[number]["id"];

const DEFAULT_AVATAR_CATEGORY: AvatarCategoryId = "faces";
const DICEBEAR_AVATAR_OPTIONS = 12;

function createAvatarSeed(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function getAvatarCategoryConfig(categoryId: AvatarCategoryId) {
  return AVATAR_CATEGORIES.find((category) => category.id === categoryId) ?? AVATAR_CATEGORIES[0];
}

function buildDiceBearAvatarUrl(style: string, seed: string): string {
  const query = new URLSearchParams({
    seed,
    size: "96",
    scale: "90",
    backgroundType: "gradientLinear",
  });

  return `https://api.dicebear.com/9.x/${style}/svg?${query.toString()}`;
}

function buildDiceBearAvatarList(style: string, total = DICEBEAR_AVATAR_OPTIONS): string[] {
  if (total <= 0) {
    return [];
  }

  return Array.from({ length: total }, () => buildDiceBearAvatarUrl(style, createAvatarSeed()));
}

function buildInitialDiceBearAvatarsByCategory(): Record<AvatarCategoryId, string[]> {
  return AVATAR_CATEGORIES.reduce(
    (result, category) => {
      result[category.id] = buildDiceBearAvatarList(category.style);
      return result;
    },
    {} as Record<AvatarCategoryId, string[]>,
  );
}

function formatPlanStatus(status: StudyPlanSummary["status"]): string {
  if (status === "done") {
    return "Listo";
  }

  if (status === "processing") {
    return "En revision";
  }

  return "Con error";
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

function resolveDisplayName(user: AuthUser | null, settings: UserSettings | null): string {
  const settingsDisplayName = settings?.display_name?.trim();

  if (settingsDisplayName) {
    return settingsDisplayName;
  }

  const profileName = user?.profile?.name?.trim();

  if (profileName) {
    return profileName;
  }

  const emailPrefix = user?.email?.split("@")[0]?.trim();

  if (emailPrefix) {
    return emailPrefix;
  }

  return "Sin nombre";
}

function resolveAvatarInitial(displayName: string, email: string | undefined): string {
  const fromName = displayName.trim().charAt(0);

  if (fromName) {
    return fromName.toUpperCase();
  }

  const fromEmail = email?.trim().charAt(0);

  if (fromEmail) {
    return fromEmail.toUpperCase();
  }

  return "U";
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
  const [isProfileEditorOpen, setIsProfileEditorOpen] = useState(false);
  const [profileDraftName, setProfileDraftName] = useState("");
  const [selectedAvatarCategory, setSelectedAvatarCategory] =
    useState<AvatarCategoryId>(DEFAULT_AVATAR_CATEGORY);
  const [diceBearAvatarsByCategory, setDiceBearAvatarsByCategory] = useState<Record<AvatarCategoryId, string[]>>(
    () => buildInitialDiceBearAvatarsByCategory(),
  );
  const [selectedDiceBearAvatarUrl, setSelectedDiceBearAvatarUrl] = useState<string | null>(null);
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileErrorMessage, setProfileErrorMessage] = useState<string | null>(null);
  const [profileSuccessMessage, setProfileSuccessMessage] = useState<string | null>(null);
  const [isContactSearchOpen, setIsContactSearchOpen] = useState(false);
  const [contactSearchQuery, setContactSearchQuery] = useState("");
  const [contactSearchResults, setContactSearchResults] = useState<SocialUserSummary[]>([]);
  const [isSearchingContacts, setIsSearchingContacts] = useState(false);
  const [contactSearchErrorMessage, setContactSearchErrorMessage] = useState<string | null>(null);
  const [isFriendsModalOpen, setIsFriendsModalOpen] = useState(false);
  const [friends, setFriends] = useState<FriendListItem[]>([]);
  const [isLoadingFriends, setIsLoadingFriends] = useState(false);
  const [friendsErrorMessage, setFriendsErrorMessage] = useState<string | null>(null);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [incomingFriendRequests, setIncomingFriendRequests] = useState<FriendRequestSummary[]>([]);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [notificationsErrorMessage, setNotificationsErrorMessage] = useState<string | null>(null);
  const [respondingFriendRequestId, setRespondingFriendRequestId] = useState<string | null>(null);
  const [socialMessage, setSocialMessage] = useState<string | null>(null);
  const [socialErrorMessage, setSocialErrorMessage] = useState<string | null>(null);

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
        .select("id, nombre, description, fecha_examen, status, created_at")
        .eq("user_id", sessionUser.id)
        .order("created_at", { ascending: false });

      if (plansError) {
        warnings.push(`planes: ${plansError.message}`);
      }

      const resolvedSettings = (endpointData?.settings as UserSettings | null) ?? null;
      const resolvedDisplayName = resolveDisplayName(sessionUser, resolvedSettings);

      if (!isCancelled) {
        setUser(sessionUser);
        setSettings(resolvedSettings);
        setProfileDraftName(resolvedDisplayName);
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

  useEffect(() => {
    if (!user?.id) {
      return;
    }

    void fetchIncomingFriendRequests({ silent: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!isContactSearchOpen) {
      return;
    }

    const normalizedQuery = contactSearchQuery.replace(/\s+/g, " ").trim();

    if (normalizedQuery.length < 2) {
      setContactSearchResults([]);
      setContactSearchErrorMessage(null);
      setIsSearchingContacts(false);
      return;
    }

    let isCancelled = false;

    const timeoutId = window.setTimeout(() => {
      async function executeSearch() {
        setIsSearchingContacts(true);
        setContactSearchErrorMessage(null);

        try {
          const response = await fetch(`/api/contacts/search?q=${encodeURIComponent(normalizedQuery)}`, {
            method: "GET",
            headers: {
              Authorization: getAuthHeaderForApiRequest(),
            },
          });

          const payload = (await response.json().catch(() => null)) as ContactSearchApiResponse | null;

          if (!response.ok) {
            const message = payload?.error?.trim();
            throw new Error(message && message.length > 0 ? message : "No se pudo buscar contactos.");
          }

          if (!isCancelled) {
            setContactSearchResults((payload?.users ?? []).filter((candidate) => Boolean(candidate?.userId)));
          }
        } catch (error) {
          if (!isCancelled) {
            const message = error instanceof Error ? error.message : "No se pudo buscar contactos.";
            setContactSearchResults([]);
            setContactSearchErrorMessage(message);
          }
        } finally {
          if (!isCancelled) {
            setIsSearchingContacts(false);
          }
        }
      }

      void executeSearch();
    }, 280);

    return () => {
      isCancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [contactSearchQuery, isContactSearchOpen]);

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
      throw new Error("No hay sesion activa.");
    }

    return token;
  }

  async function fetchIncomingFriendRequests(options?: { silent?: boolean }) {
    const silent = options?.silent ?? false;

    if (!silent) {
      setIsLoadingNotifications(true);
    }

    setNotificationsErrorMessage(null);

    try {
      const response = await fetch("/api/friend-requests?direction=incoming&status=pending", {
        method: "GET",
        headers: {
          Authorization: getAuthHeaderForApiRequest(),
        },
      });

      const payload = (await response.json().catch(() => null)) as FriendRequestsApiResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudieron cargar las notificaciones.");
      }

      setIncomingFriendRequests((payload?.requests ?? []).filter((request) => request?.status === "pending"));
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudieron cargar las notificaciones.";
      setNotificationsErrorMessage(message);
    } finally {
      if (!silent) {
        setIsLoadingNotifications(false);
      }
    }
  }

  async function fetchFriendsList() {
    setIsLoadingFriends(true);
    setFriendsErrorMessage(null);

    try {
      const response = await fetch("/api/friends", {
        method: "GET",
        headers: {
          Authorization: getAuthHeaderForApiRequest(),
        },
      });

      const payload = (await response.json().catch(() => null)) as FriendsApiResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo obtener la lista de amigos.");
      }

      setFriends((payload?.friends ?? []).filter((friend) => Boolean(friend?.userId)));
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo obtener la lista de amigos.";
      setFriendsErrorMessage(message);
    } finally {
      setIsLoadingFriends(false);
    }
  }

  function handleOpenContactSearchModal() {
    setIsNotificationsOpen(false);
    setIsContactSearchOpen(true);
    setContactSearchQuery("");
    setContactSearchResults([]);
    setContactSearchErrorMessage(null);
    setSocialErrorMessage(null);
    setSocialMessage(null);
  }

  function handleCloseContactSearchModal() {
    setIsContactSearchOpen(false);
    setContactSearchQuery("");
    setContactSearchResults([]);
    setContactSearchErrorMessage(null);
  }

  function handleOpenFriendsModal() {
    setIsNotificationsOpen(false);
    setIsFriendsModalOpen(true);
    setSocialErrorMessage(null);
    setSocialMessage(null);
    void fetchFriendsList();
  }

  function handleCloseFriendsModal() {
    setIsFriendsModalOpen(false);
  }

  function handleToggleNotificationsMenu() {
    if (isNotificationsOpen) {
      setIsNotificationsOpen(false);
      return;
    }

    setIsNotificationsOpen(true);
    setSocialErrorMessage(null);
    setSocialMessage(null);
    void fetchIncomingFriendRequests();
  }

  async function handleResolveFriendRequest(requestId: string, action: "accept" | "reject") {
    if (respondingFriendRequestId) {
      return;
    }

    setRespondingFriendRequestId(requestId);
    setNotificationsErrorMessage(null);
    setSocialErrorMessage(null);
    setSocialMessage(null);

    try {
      const response = await fetch(`/api/friend-requests/${requestId}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: getAuthHeaderForApiRequest(),
        },
        body: JSON.stringify({ action }),
      });

      const payload = (await response.json().catch(() => null)) as FriendRequestActionApiResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo procesar la solicitud.");
      }

      setIncomingFriendRequests((currentRequests) =>
        currentRequests.filter((currentRequest) => currentRequest.id !== requestId),
      );
      setSocialMessage(action === "accept" ? "Solicitud aceptada correctamente." : "Solicitud rechazada.");

      if (action === "accept" && isFriendsModalOpen) {
        void fetchFriendsList();
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo procesar la solicitud.";
      setNotificationsErrorMessage(message);
      setSocialErrorMessage(message);
    } finally {
      setRespondingFriendRequestId(null);
    }
  }

  function resetProfileEditorToCurrentProfile() {
    setProfileDraftName(resolveDisplayName(user, settings));
    setSelectedDiceBearAvatarUrl(null);
    setSelectedAvatarCategory(DEFAULT_AVATAR_CATEGORY);
    setProfileErrorMessage(null);
    setProfileSuccessMessage(null);
  }

  function refreshDiceBearAvatars(categoryId: AvatarCategoryId) {
    const category = getAvatarCategoryConfig(categoryId);

    setDiceBearAvatarsByCategory((previousAvatars) => ({
      ...previousAvatars,
      [categoryId]: buildDiceBearAvatarList(category.style),
    }));
    setSelectedDiceBearAvatarUrl((previousAvatarUrl) => {
      if (!previousAvatarUrl) {
        return previousAvatarUrl;
      }

      return previousAvatarUrl.includes(`/9.x/${category.style}/`) ? null : previousAvatarUrl;
    });
    setProfileErrorMessage(null);
    setProfileSuccessMessage(null);
  }

  function handleAvatarCategorySelection(categoryId: AvatarCategoryId) {
    setSelectedAvatarCategory(categoryId);
    setProfileErrorMessage(null);
    setProfileSuccessMessage(null);

    setDiceBearAvatarsByCategory((previousAvatars) => {
      if ((previousAvatars[categoryId]?.length ?? 0) > 0) {
        return previousAvatars;
      }

      const category = getAvatarCategoryConfig(categoryId);

      return {
        ...previousAvatars,
        [categoryId]: buildDiceBearAvatarList(category.style),
      };
    });
  }

  function handleToggleProfileEditor() {
    if (isProfileEditorOpen) {
      resetProfileEditorToCurrentProfile();
      setIsProfileEditorOpen(false);
      return;
    }

    setProfileDraftName(resolveDisplayName(user, settings));
    setProfileErrorMessage(null);
    setProfileSuccessMessage(null);
    setSelectedAvatarCategory(DEFAULT_AVATAR_CATEGORY);
    setDiceBearAvatarsByCategory(buildInitialDiceBearAvatarsByCategory());
    setSelectedDiceBearAvatarUrl(null);
    setIsProfileEditorOpen(true);
  }

  async function handleSaveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileErrorMessage(null);
    setProfileSuccessMessage(null);

    const normalizedName = profileDraftName.replace(/\s+/g, " ").trim();

    if (normalizedName.length < 2 || normalizedName.length > 80) {
      setProfileErrorMessage("El nombre debe tener entre 2 y 80 caracteres.");
      return;
    }

    const currentDisplayName = resolveDisplayName(user, settings);
    const currentAvatarUrl = settings?.avatar_url ?? null;
    const nextAvatarUrl = selectedDiceBearAvatarUrl?.trim() || null;
    const shouldUpdateName = normalizedName !== currentDisplayName;
    const shouldUpdateAvatar = nextAvatarUrl !== null && nextAvatarUrl !== currentAvatarUrl;

    if (!shouldUpdateName && !shouldUpdateAvatar) {
      setProfileSuccessMessage("No hay cambios para guardar.");
      return;
    }

    setIsSavingProfile(true);

    try {
      const authorization = getAuthHeaderForApiRequest();
      const response = await fetch("/api/user-profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: authorization,
        },
        body: JSON.stringify({
          display_name: normalizedName,
          ...(shouldUpdateAvatar ? { avatar_url: nextAvatarUrl } : {}),
        }),
      });

      const payload = (await response.json().catch(() => null)) as UserProfileApiResponse | null;

      if (!response.ok) {
        const message = payload?.error?.trim();
        throw new Error(message && message.length > 0 ? message : "No se pudo actualizar el perfil.");
      }

      const updatedDisplayName = payload?.profile?.displayName?.trim() || normalizedName;
      const updatedAvatarUrlFromApi = payload?.profile?.avatarUrl;
      const updatedAvatarUrl =
        typeof updatedAvatarUrlFromApi === "string"
          ? updatedAvatarUrlFromApi.trim() || null
          : shouldUpdateAvatar
            ? nextAvatarUrl
            : currentAvatarUrl;

      setSettings((previousSettings) => ({
        user_id: previousSettings?.user_id ?? user?.id ?? "",
        display_name: updatedDisplayName,
        avatar_url: updatedAvatarUrl,
        onboarding_completed: previousSettings?.onboarding_completed ?? false,
      }));
      setProfileDraftName(updatedDisplayName);
      setSelectedDiceBearAvatarUrl(null);
      setProfileSuccessMessage("Perfil actualizado correctamente.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "No se pudo actualizar el perfil.";
      setProfileErrorMessage(message);
    } finally {
      setIsSavingProfile(false);
    }
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
        <div className="flex items-center gap-3">
          <LoadingSpinner size="lg" />
          <p className="text-sm text-zinc-300">Cargando sesion...</p>
        </div>
      </div>
    );
  }

  const displayName = resolveDisplayName(user, settings);
  const avatarUrl = selectedDiceBearAvatarUrl ?? settings?.avatar_url ?? null;
  const avatarInitial = resolveAvatarInitial(displayName, user?.email);
  const currentAvatarOptions = diceBearAvatarsByCategory[selectedAvatarCategory] ?? [];

  return (
    <div className="min-h-screen bg-zinc-950 px-6 py-12 text-zinc-100">
      <main className="mx-auto w-full max-w-5xl space-y-6">
        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-sm uppercase tracking-[0.14em] text-teal-300">FLOWSTUDY</p>
              <h1 className="mt-2 text-3xl font-semibold text-white">Dashboard de estudio</h1>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleOpenContactSearchModal}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                <FiUserPlus className="h-4 w-4" aria-hidden="true" />
                Buscar contactos
              </button>

              <button
                type="button"
                onClick={handleOpenFriendsModal}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-3 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                <FiUsers className="h-4 w-4" aria-hidden="true" />
                Amigos
              </button>

              <div className="relative">
                <button
                  type="button"
                  onClick={handleToggleNotificationsMenu}
                  aria-label="Notificaciones"
                  title="Notificaciones"
                  className="relative inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800"
                >
                  <FiBell className="h-4 w-4" aria-hidden="true" />
                  {incomingFriendRequests.length > 0 ? (
                    <span className="absolute -right-1 -top-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-full bg-teal-300 px-1 text-[10px] font-semibold text-zinc-900">
                      {incomingFriendRequests.length}
                    </span>
                  ) : null}
                </button>

                {isNotificationsOpen ? (
                  <div className="absolute right-0 z-20 mt-2 w-[22rem] rounded-xl border border-zinc-700 bg-zinc-900 p-3 shadow-[0_20px_50px_rgba(0,0,0,0.45)]">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-zinc-100">Notificaciones</p>
                      <button
                        type="button"
                        onClick={() => setIsNotificationsOpen(false)}
                        className="text-xs text-zinc-400 transition hover:text-zinc-200"
                      >
                        Cerrar
                      </button>
                    </div>

                    {isLoadingNotifications ? (
                      <div className="flex items-center gap-2 text-xs text-zinc-400">
                        <LoadingSpinner size="sm" />
                        <p>Cargando notificaciones...</p>
                      </div>
                    ) : null}

                    {notificationsErrorMessage ? (
                      <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
                        {notificationsErrorMessage}
                      </p>
                    ) : null}

                    {!isLoadingNotifications && !notificationsErrorMessage && incomingFriendRequests.length === 0 ? (
                      <p className="text-xs text-zinc-400">No tienes solicitudes pendientes.</p>
                    ) : null}

                    {!isLoadingNotifications && incomingFriendRequests.length > 0 ? (
                      <div className="max-h-72 space-y-3 overflow-y-auto pr-1">
                        {incomingFriendRequests.map((request) => (
                          <div key={request.id} className="rounded-lg border border-zinc-700 bg-zinc-950 p-3">
                            <div className="flex items-start gap-3">
                              <div className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-xs font-semibold text-teal-200">
                                {request.sender.avatarUrl ? (
                                  <img
                                    src={request.sender.avatarUrl}
                                    alt={`Avatar de ${request.sender.displayName}`}
                                    className="h-full w-full object-cover"
                                  />
                                ) : (
                                  <span aria-hidden="true">
                                    {resolveAvatarInitial(request.sender.displayName, request.sender.email)}
                                  </span>
                                )}
                              </div>

                              <div className="min-w-0 flex-1">
                                <p className="truncate text-xs font-semibold text-zinc-100">
                                  {request.sender.displayName}
                                </p>
                                <p className="truncate text-[11px] text-zinc-400">{request.sender.email}</p>
                                <p className="mt-1 text-[11px] text-zinc-500">
                                  Quiere agregarte como amigo.
                                </p>
                              </div>
                            </div>

                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                              <Link
                                href={`/dashboard/users/${request.sender.userId}`}
                                onClick={() => setIsNotificationsOpen(false)}
                                className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-700 px-3 text-[11px] font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
                              >
                                Ver perfil
                              </Link>
                              <button
                                type="button"
                                onClick={() => void handleResolveFriendRequest(request.id, "reject")}
                                disabled={respondingFriendRequestId === request.id}
                                className="inline-flex h-8 items-center justify-center rounded-lg border border-zinc-700 px-3 text-[11px] font-semibold text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Rechazar
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleResolveFriendRequest(request.id, "accept")}
                                disabled={respondingFriendRequestId === request.id}
                                className="inline-flex h-8 items-center justify-center rounded-lg bg-teal-300 px-3 text-[11px] font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                Aceptar
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>

              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Cerrar sesion"
                title="Cerrar sesion"
                className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                <FiLogOut className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="mt-7 rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex min-w-0 items-center gap-4">
                <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-xl font-semibold text-teal-200">
                  {avatarUrl ? (
                    <img
                      src={avatarUrl}
                      alt={`Avatar de ${displayName}`}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span aria-hidden="true">{avatarInitial}</span>
                  )}
                </div>

                <div className="min-w-0">
                  <p className="truncate text-lg font-semibold text-zinc-100">{displayName}</p>
                  <p className="truncate text-sm text-zinc-300">{user?.email}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={handleToggleProfileEditor}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                <FiEdit2 className="h-4 w-4" aria-hidden="true" />
                {isProfileEditorOpen ? "Cerrar editor" : "Editar perfil"}
              </button>
            </div>

            {isProfileEditorOpen ? (
              <form onSubmit={handleSaveProfile} className="mt-6 space-y-4 border-t border-zinc-800 pt-5">
                <div>
                  <label htmlFor="profile-display-name" className="mb-2 block text-sm font-medium text-zinc-100">
                    Nombre visible
                  </label>
                  <input
                    id="profile-display-name"
                    type="text"
                    value={profileDraftName}
                    onChange={(event) => setProfileDraftName(event.target.value)}
                    maxLength={80}
                    disabled={isSavingProfile}
                    className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-900/70 px-4 text-sm text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2 disabled:cursor-not-allowed disabled:opacity-60"
                    placeholder="Tu nombre"
                  />
                </div>

                <div className="rounded-xl border border-zinc-800 bg-zinc-900/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-zinc-100">Avatar</p>
                  </div>

                  <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {AVATAR_CATEGORIES.map((category) => {
                      const isActiveCategory = selectedAvatarCategory === category.id;

                      return (
                        <div
                          key={category.id}
                          className={`flex items-center overflow-hidden rounded-lg border ${
                            isActiveCategory ? "border-teal-300/60 bg-teal-300/10" : "border-zinc-700 bg-zinc-900"
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => handleAvatarCategorySelection(category.id)}
                            disabled={isSavingProfile}
                            className="flex-1 px-3 py-2 text-left text-xs font-semibold text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                          >
                            {category.label}
                          </button>

                          <button
                            type="button"
                            onClick={() => refreshDiceBearAvatars(category.id)}
                            disabled={isSavingProfile}
                            className="inline-flex h-9 w-9 items-center justify-center border-l border-zinc-700 text-zinc-300 transition hover:bg-zinc-800 hover:text-zinc-100 disabled:cursor-not-allowed disabled:opacity-60"
                            aria-label={`Refresh ${category.label}`}
                            title={`Refresh ${category.label}`}
                          >
                            <FiRefreshCw className="h-3.5 w-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  <div className="mt-3 grid grid-cols-4 gap-3 sm:grid-cols-6">
                    {currentAvatarOptions.map((avatarOptionUrl, index) => {
                      const isSelected = avatarOptionUrl === selectedDiceBearAvatarUrl;

                      return (
                        <button
                          key={avatarOptionUrl}
                          type="button"
                          onClick={() => {
                            setSelectedDiceBearAvatarUrl(avatarOptionUrl);
                            setProfileErrorMessage(null);
                            setProfileSuccessMessage(null);
                          }}
                          disabled={isSavingProfile}
                          className={`inline-flex h-14 w-14 items-center justify-center overflow-hidden rounded-full border transition disabled:cursor-not-allowed disabled:opacity-60 ${
                            isSelected
                              ? "border-teal-300 bg-teal-300/10"
                              : "border-zinc-700 bg-zinc-900 hover:border-zinc-500"
                          }`}
                          aria-label={`Seleccionar avatar ${index + 1}`}
                        >
                          <img
                            src={avatarOptionUrl}
                            alt={`Avatar DiceBear ${index + 1}`}
                            className="h-full w-full object-cover"
                          />
                        </button>
                      );
                    })}
                  </div>
                </div>

                {profileErrorMessage ? (
                  <p className="rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                    {profileErrorMessage}
                  </p>
                ) : null}

                {profileSuccessMessage ? (
                  <p className="rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
                    {profileSuccessMessage}
                  </p>
                ) : null}

                <div className="flex flex-wrap items-center justify-end gap-3 pt-1">
                  <button
                    type="button"
                    onClick={handleToggleProfileEditor}
                    disabled={isSavingProfile}
                    className="inline-flex h-10 items-center justify-center rounded-lg border border-zinc-700 px-4 text-sm font-semibold text-zinc-100 transition hover:border-zinc-500 hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    className="inline-flex h-10 items-center justify-center rounded-lg bg-teal-300 px-5 text-sm font-semibold text-zinc-900 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isSavingProfile ? "Guardando..." : "Guardar perfil"}
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          {warningMessage ? (
            <p className="mt-6 rounded-lg border border-amber-400/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
              Advertencias: {warningMessage}
            </p>
          ) : null}

          {socialErrorMessage ? (
            <p className="mt-3 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {socialErrorMessage}
            </p>
          ) : null}

          {socialMessage ? (
            <p className="mt-3 rounded-lg border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-200">
              {socialMessage}
            </p>
          ) : null}
        </section>

        <section className="rounded-2xl border border-zinc-800 bg-zinc-900 p-8">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-semibold text-white">Tus planes de estudio</h2>
              <p className="mt-1 text-xs uppercase tracking-[0.1em] text-zinc-400">{plans.length} total</p>
            </div>

            <NewStudyPlanButton />
          </div>

          {deleteErrorMessage ? (
            <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {deleteErrorMessage}
            </p>
          ) : null}

          {plans.length === 0 ? (
            <p className="mt-5 text-sm text-zinc-400">
              Aun no tienes planes creados. Usa el boton de arriba para subir tu primer PDF.
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
                        <span>Examen: {formatExamDate(plan.fecha_examen)}</span>
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

      {isContactSearchOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-teal-300">Contactos</p>
                <h3 className="mt-1 text-2xl font-semibold text-white">Buscar personas</h3>
              </div>

              <button
                type="button"
                onClick={handleCloseContactSearchModal}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                Cerrar
              </button>
            </div>

            <div className="mt-5">
              <label htmlFor="contact-search" className="mb-2 block text-sm font-medium text-zinc-100">
                Buscar por nombre o email
              </label>
              <input
                id="contact-search"
                type="text"
                value={contactSearchQuery}
                onChange={(event) => setContactSearchQuery(event.target.value)}
                className="h-11 w-full rounded-xl border border-zinc-700 bg-zinc-950/80 px-4 text-sm text-zinc-100 outline-none ring-zinc-500 transition focus:ring-2"
                placeholder="Ej: ana o ana@email.com"
              />
            </div>

            {contactSearchErrorMessage ? (
              <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {contactSearchErrorMessage}
              </p>
            ) : null}

            {isSearchingContacts ? (
              <div className="mt-4 flex items-center gap-2 text-sm text-zinc-400">
                <LoadingSpinner size="sm" />
                <p>Buscando contactos...</p>
              </div>
            ) : null}

            {!isSearchingContacts && contactSearchQuery.trim().length < 2 ? (
              <p className="mt-4 text-sm text-zinc-400">Ingresa al menos 2 caracteres para comenzar la busqueda.</p>
            ) : null}

            {!isSearchingContacts && contactSearchQuery.trim().length >= 2 && contactSearchResults.length === 0 ? (
              <p className="mt-4 text-sm text-zinc-400">No se encontraron resultados.</p>
            ) : null}

            {contactSearchResults.length > 0 ? (
              <div className="mt-4 max-h-80 space-y-3 overflow-y-auto pr-1">
                {contactSearchResults.map((contact) => (
                  <Link
                    key={contact.userId}
                    href={`/dashboard/users/${contact.userId}`}
                    onClick={handleCloseContactSearchModal}
                    className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950 p-3 transition hover:border-zinc-500 hover:bg-zinc-900"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-sm font-semibold text-teal-200">
                      {contact.avatarUrl ? (
                        <img
                          src={contact.avatarUrl}
                          alt={`Avatar de ${contact.displayName}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-hidden="true">{resolveAvatarInitial(contact.displayName, contact.email)}</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">{contact.displayName}</p>
                      <p className="truncate text-xs text-zinc-400">{contact.email}</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {isFriendsModalOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-zinc-800 bg-zinc-900 p-6 shadow-[0_30px_80px_rgba(0,0,0,0.55)] sm:p-7">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-teal-300">Social</p>
                <h3 className="mt-1 text-2xl font-semibold text-white">Amigos</h3>
              </div>

              <button
                type="button"
                onClick={handleCloseFriendsModal}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-sm font-medium text-zinc-200 transition hover:border-zinc-500 hover:bg-zinc-800"
              >
                Cerrar
              </button>
            </div>

            {isLoadingFriends ? (
              <div className="mt-5 flex items-center gap-2 text-sm text-zinc-400">
                <LoadingSpinner size="sm" />
                <p>Cargando amigos...</p>
              </div>
            ) : null}

            {friendsErrorMessage ? (
              <p className="mt-4 rounded-lg border border-red-400/30 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                {friendsErrorMessage}
              </p>
            ) : null}

            {!isLoadingFriends && !friendsErrorMessage && friends.length === 0 ? (
              <p className="mt-5 text-sm text-zinc-400">Aun no tienes amigos agregados.</p>
            ) : null}

            {friends.length > 0 ? (
              <div className="mt-5 max-h-80 space-y-3 overflow-y-auto pr-1">
                {friends.map((friend) => (
                  <Link
                    key={friend.userId}
                    href={`/dashboard/users/${friend.userId}`}
                    onClick={handleCloseFriendsModal}
                    className="flex items-center gap-3 rounded-xl border border-zinc-700 bg-zinc-950 p-3 transition hover:border-zinc-500 hover:bg-zinc-900"
                  >
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full border border-zinc-700 bg-zinc-900 text-sm font-semibold text-teal-200">
                      {friend.avatarUrl ? (
                        <img
                          src={friend.avatarUrl}
                          alt={`Avatar de ${friend.displayName}`}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span aria-hidden="true">{resolveAvatarInitial(friend.displayName, friend.email)}</span>
                      )}
                    </div>

                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-zinc-100">{friend.displayName}</p>
                      <p className="truncate text-xs text-zinc-400">{friend.email}</p>
                    </div>
                  </Link>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
