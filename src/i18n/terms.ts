import { canonicalDamageType } from "../../convex/rules";
import { saveAbilityToZh } from "../../convex/modifiers";
import type { Messages } from "./types";

/**
 * Display-name lookups for game terms whose STORAGE keys never change:
 * zh ability/skill keys (characters.saves/skills, condition specs), canonical
 * English damage-type keys (rules.ts), curated condition English labels
 * (modifiers.ts). Unknown keys (user-typed customs) display as themselves.
 */
export function abilityLabel(t: Messages, key: string): string {
  return (t.terms.abilities as Record<string, string>)[key] ?? key;
}

export function abilityAbbr(t: Messages, key: string): string {
  return (t.terms.abilityAbbr as Record<string, string>)[key] ?? key;
}

/** Recipes store saveAbility as lowercase English ("dex") — route through the zh key. */
export function saveAbilityLabel(t: Messages, saveEn: string): string {
  return abilityLabel(t, saveAbilityToZh(saveEn));
}

export function skillLabel(t: Messages, key: string): string {
  return (t.terms.skills as Record<string, string>)[key] ?? key;
}

/** SRD armor/weapon proficiency term (srdContent armorProfs/weaponProfs/bonusArmorProfs). */
export function profLabel(t: Messages, key: string): string {
  return (t.terms.profs as Record<string, string>)[key] ?? key;
}

/** Accepts any spelling `rules.canonicalDamageType` recognizes (zh aliases included). */
export function damageTypeLabel(t: Messages, raw: string): string {
  const key = canonicalDamageType(raw);
  return key === null
    ? raw
    : ((t.terms.damageTypes as Record<string, string>)[key] ?? raw);
}

export function conditionLabel(t: Messages, label: string): string {
  return (t.terms.conditions as Record<string, string>)[label] ?? label;
}

/** Modifier-spec stat display name (canonical keys: ac/attack/save/…). */
export function statLabel(t: Messages, stat: string): string {
  return (t.terms.stats as Record<string, string>)[stat] ?? stat;
}

/** Modifier-spec mode display name (bonus/override/advantage/…). */
export function modeLabel(t: Messages, mode: string): string {
  return (t.terms.modes as Record<string, string>)[mode] ?? mode;
}
