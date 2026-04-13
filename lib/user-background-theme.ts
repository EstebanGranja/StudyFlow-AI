export const USER_BACKGROUND_THEME_KEYS = ["celeste", "rojo", "amarillo", "violeta"] as const;

export type UserBackgroundTheme = (typeof USER_BACKGROUND_THEME_KEYS)[number];

export const DEFAULT_USER_BACKGROUND_THEME: UserBackgroundTheme = "celeste";

type UserBackgroundThemeOption = {
  key: UserBackgroundTheme;
  label: string;
  imagePath: string;
  swatchColor: string;
};

export const USER_BACKGROUND_THEME_OPTIONS: readonly UserBackgroundThemeOption[] = [
  {
    key: "celeste",
    label: "Celeste (predeterminado)",
    imagePath: "/fondos/fondo.png",
    swatchColor: "#38bdf8",
  },
  {
    key: "rojo",
    label: "Rojo",
    imagePath: "/fondos/fondo_rojo.png",
    swatchColor: "#ef4444",
  },
  {
    key: "amarillo",
    label: "Amarillo",
    imagePath: "/fondos/fondo_amarillo.png",
    swatchColor: "#facc15",
  },
  {
    key: "violeta",
    label: "Violeta",
    imagePath: "/fondos/fondo_violeta.png",
    swatchColor: "#a855f7",
  },
] as const;

const USER_BACKGROUND_THEME_OPTION_BY_KEY: Record<UserBackgroundTheme, UserBackgroundThemeOption> = {
  celeste: USER_BACKGROUND_THEME_OPTIONS[0],
  rojo: USER_BACKGROUND_THEME_OPTIONS[1],
  amarillo: USER_BACKGROUND_THEME_OPTIONS[2],
  violeta: USER_BACKGROUND_THEME_OPTIONS[3],
};

export function isUserBackgroundTheme(value: unknown): value is UserBackgroundTheme {
  return typeof value === "string" && (USER_BACKGROUND_THEME_KEYS as readonly string[]).includes(value);
}

export function normalizeUserBackgroundTheme(value: unknown): UserBackgroundTheme {
  if (isUserBackgroundTheme(value)) {
    return value;
  }

  return DEFAULT_USER_BACKGROUND_THEME;
}

export function getUserBackgroundImagePath(value: unknown): string {
  const normalizedTheme = normalizeUserBackgroundTheme(value);
  return USER_BACKGROUND_THEME_OPTION_BY_KEY[normalizedTheme].imagePath;
}
