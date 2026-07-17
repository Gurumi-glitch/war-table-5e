import type { Messages } from "./types";
import { zhTW } from "./locales/zh-TW";
import { en } from "./locales/en";

/**
 * Adding a language = add `locales/<tag>.ts` (typed `Messages`, so tsc forces
 * a complete translation) and register it here. Nothing else changes — the
 * language switcher and resolution logic read this registry.
 */
export const locales = {
  "zh-TW": zhTW,
  en,
} satisfies Record<string, Messages>;

export type LocaleTag = keyof typeof locales;

export const localeTags = Object.keys(locales) as LocaleTag[];

export const defaultLocale: LocaleTag = "zh-TW";

/** Native-language display name for the switcher (never translated). */
export const localeNames: Record<LocaleTag, string> = {
  "zh-TW": "繁體中文",
  en: "English",
};
