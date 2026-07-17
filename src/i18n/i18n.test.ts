import { describe, expect, it, beforeEach } from "vitest";
import { resolveInitialLocale } from "./index";
import { defaultLocale, localeNames, localeTags, locales } from "./registry";
import { zhTW } from "./locales/zh-TW";

/**
 * The real completeness guarantee is `tsc`: every locale is declared
 * `: Messages` (derived from zh-TW), so a missing/extra/misspelled key fails
 * the build. These runtime checks document that contract and catch key-tree
 * drift that type laundering (any-casts) could sneak past.
 */
function keyTree(obj: object, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    v !== null && typeof v === "object"
      ? keyTree(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}

describe("locale registry", () => {
  it("every registered locale implements the exact zh-TW key tree", () => {
    const baseline = keyTree(zhTW).sort();
    for (const tag of localeTags) {
      expect(keyTree(locales[tag]).sort(), `locale ${tag}`).toEqual(baseline);
    }
  });

  it("every locale has a native display name for the switcher", () => {
    for (const tag of localeTags) {
      expect(localeNames[tag]).toBeTruthy();
    }
  });

  it("no locale leaves a message empty", () => {
    for (const tag of localeTags) {
      const leaves = Object.entries(locales[tag]).flatMap(([, ns]) =>
        keyTree(ns as object),
      );
      expect(leaves.length).toBeGreaterThan(0);
      const walk = (obj: object): void => {
        for (const v of Object.values(obj)) {
          if (v !== null && typeof v === "object") walk(v);
          else if (typeof v === "string") expect(v.trim()).not.toBe("");
        }
      };
      walk(locales[tag]);
    }
  });
});

describe("resolveInitialLocale", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("?lang= URL param wins over localStorage", () => {
    localStorage.setItem("dnd-locale", "en");
    expect(resolveInitialLocale("?lang=zh-TW")).toBe("zh-TW");
  });

  it("falls back to localStorage when no ?lang=", () => {
    localStorage.setItem("dnd-locale", "en");
    expect(resolveInitialLocale("")).toBe("en");
  });

  it("ignores unknown ?lang= values", () => {
    expect(resolveInitialLocale("?lang=xx")).toBe(defaultLocale);
  });

  it("ignores unknown localStorage values", () => {
    localStorage.setItem("dnd-locale", "garbage");
    expect(resolveInitialLocale("")).toBe(defaultLocale);
  });

  it("defaults to zh-TW with no signal at all", () => {
    expect(resolveInitialLocale("")).toBe("zh-TW");
  });
});
