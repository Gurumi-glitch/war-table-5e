import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Messages } from "./types";
import { defaultLocale, localeTags, locales, type LocaleTag } from "./registry";

export type { Messages } from "./types";
export { defaultLocale, localeNames, localeTags, type LocaleTag } from "./registry";

const STORAGE_KEY = "dnd-locale";

function isLocaleTag(value: string | null): value is LocaleTag {
  return value !== null && value in locales;
}

/**
 * Per-device preference: `?lang=` URL override (transient — never written
 * back, so a TTS-tablet bookmark pins the language) > localStorage > zh-TW.
 */
export function resolveInitialLocale(search: string): LocaleTag {
  const param = new URLSearchParams(search).get("lang");
  if (isLocaleTag(param)) return param;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (isLocaleTag(stored)) return stored;
  } catch {
    // localStorage unavailable (TTS embedded Chromium may deny access).
  }
  return defaultLocale;
}

type LocaleContextValue = {
  locale: LocaleTag;
  messages: Messages;
  setLocale: (tag: LocaleTag) => void;
};

const LocaleContext = createContext<LocaleContextValue>({
  locale: defaultLocale,
  messages: locales[defaultLocale],
  setLocale: () => {},
});

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleTag>(() =>
    typeof window === "undefined"
      ? defaultLocale
      : resolveInitialLocale(window.location.search),
  );

  const setLocale = useCallback((tag: LocaleTag) => {
    try {
      localStorage.setItem(STORAGE_KEY, tag);
    } catch {
      // Preference just won't persist; the in-memory switch still applies.
    }
    setLocaleState(tag);
  }, []);

  const value = useMemo(
    () => ({ locale, messages: locales[locale], setLocale }),
    [locale, setLocale],
  );

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/** Current locale's messages — direct typed property access (`t.common.save`). */
export function useT(): Messages {
  return useContext(LocaleContext).messages;
}

export function useLocale(): {
  locale: LocaleTag;
  setLocale: (tag: LocaleTag) => void;
  available: readonly LocaleTag[];
} {
  const { locale, setLocale } = useContext(LocaleContext);
  return { locale, setLocale, available: localeTags };
}
