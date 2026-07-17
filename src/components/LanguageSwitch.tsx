import { localeNames, useLocale, useT } from "../i18n";

/**
 * The 🌐 per-device language button — cycles through the registered locales
 * (registry order), persisting to localStorage. Shared by the GameShell
 * header and the Home (create game) page so the language is choosable before
 * a game even exists.
 */
export function LanguageSwitch({ className }: { className?: string }) {
  const t = useT();
  const { locale, setLocale, available } = useLocale();
  const cycleLocale = () => {
    const next = available[(available.indexOf(locale) + 1) % available.length];
    setLocale(next);
  };
  return (
    <button
      className={className}
      onClick={cycleLocale}
      aria-label={t.shell.language}
      title={t.shell.language}
    >
      🌐 {localeNames[locale]}
    </button>
  );
}
