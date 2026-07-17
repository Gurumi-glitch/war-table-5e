import { v } from "convex/values";
import { canonicalDamageType } from "./rules";
import { CONDITIONS } from "./modifiers";

/**
 * The enemy stat-block field set, shared by three consumers:
 *  - the `enemies` table (templates, convex/schema.ts + convex/enemies.ts),
 *  - `combatants.statBlock` (the per-instance deep copy written at spawn so
 *    the full 敵人庫 attributes stay editable on the battlefield, ADR-0002),
 *  - the frontend 敵人庫 editor form (EnemyForm), reused by the on-field
 *    enemy editor window.
 *
 * Lives in its own module with no ./_generated/server import so `src/` can
 * import the type + helpers without pulling server-only code into the bundle
 * (same pattern as convex/colors.ts).
 */

/** One entry's insertable fields (everything but the Convex system fields). */
export const enemyFieldsValidator = {
  seedKey: v.optional(v.string()),
  source: v.union(v.literal("seed"), v.literal("srd"), v.literal("custom")),
  nameZh: v.string(),
  nameEn: v.string(),
  symbol: v.string(),
  role: v.string(),
  themeTags: v.string(),
  size: v.string(),
  creatureType: v.string(),
  temperament: v.string(),
  threatTier: v.number(),
  ac: v.number(),
  hpMax: v.number(),
  hpFormula: v.string(),
  speedText: v.string(),
  abilities: v.array(
    v.object({ key: v.string(), score: v.number(), mod: v.number() }),
  ),
  saveBonuses: v.array(v.object({ key: v.string(), bonus: v.number() })),
  skills: v.array(v.object({ key: v.string(), bonus: v.number() })),
  senses: v.string(),
  passivePerception: v.number(),
  languages: v.string(),
  damageResistances: v.string(),
  damageVulnerabilities: v.string(),
  damageImmunities: v.string(),
  conditionImmunities: v.string(),
  traits: v.array(v.any()),
  actions: v.array(v.any()),
  bonusActions: v.array(v.any()),
  reactions: v.array(v.any()),
  legendaryActions: v.array(v.any()),
  tactics: v.string(),
  encounterNotes: v.string(),
};

/** One template's fields (the insertable shape; `EnemyView` adds _id). */
export type EnemyFields = {
  seedKey?: string;
  source: "seed" | "srd" | "custom";
  nameZh: string;
  nameEn: string;
  symbol: string;
  role: string;
  themeTags: string;
  size: string;
  creatureType: string;
  temperament: string;
  threatTier: number;
  ac: number;
  hpMax: number;
  hpFormula: string;
  speedText: string;
  abilities: { key: string; score: number; mod: number }[];
  saveBonuses: { key: string; bonus: number }[];
  skills: { key: string; bonus: number }[];
  senses: string;
  passivePerception: number;
  languages: string;
  damageResistances: string;
  damageVulnerabilities: string;
  damageImmunities: string;
  conditionImmunities: string;
  traits: unknown[];
  actions: unknown[];
  bonusActions: unknown[];
  reactions: unknown[];
  legendaryActions: unknown[];
  tactics: string;
  encounterNotes: string;
};

/** Split a modifier text cell ("necrotic, poison" / "毒、精神") into a list. */
export function splitTypes(raw: string): string[] {
  return (raw ?? "")
    .split(/[,;、；／]/)
    .map((s) => s.trim())
    .filter((s) => s !== "" && s !== "—");
}

/**
 * Parse a 抗性/易傷/免疫 text cell into canonical damage-type keys for the
 * combatant's working R/V/I lists. Handles zh 「鈍擊、穿刺、揮砍（非魔法）」 and
 * SRD sentences ("cold, bludgeoning, piercing, and slashing from nonmagical
 * weapons that aren't silvered"). Unrecognized fragments are dropped from the
 * lists — the original text stays visible on the stat block.
 */
export function parseRviText(raw: string): string[] {
  const out: string[] = [];
  for (const token of splitTypes((raw ?? "").replace(/[（(][^（）()]*[）)]/g, ""))) {
    const cleaned = token
      .replace(/^and\s+/i, "")
      .replace(/\s+from\s+.*$/i, "")
      .replace(/\s+that\s+.*$/i, "");
    const key = canonicalDamageType(cleaned);
    if (key !== null && key !== "healing" && !out.includes(key)) out.push(key);
  }
  return out;
}

// zh condition names → curated condition keys (modifiers.ts CONDITIONS);
// English spellings (any case) map via the key itself.
const CONDITION_ZH: Record<string, string> = {
  目盲: "blinded",
  魅惑: "charmed",
  耳聾: "deafened",
  恐懼: "frightened",
  擒抱: "grappled",
  失能: "incapacitated",
  隱形: "invisible",
  麻痺: "paralyzed",
  石化: "petrified",
  中毒: "poisoned",
  倒地: "prone",
  束縛: "restrained",
  震懾: "stunned",
  昏迷: "unconscious",
};
const CONDITION_KEYS = new Set(CONDITIONS.map((c) => c.key));

/**
 * Parse a 狀態免疫 text cell into curated condition keys (中毒/Poisoned →
 * poisoned) for the combatant's `conditionImmune` list (non-blocking ⚠ warn
 * when applying an immune condition). Tokens without a curated condition
 * (力竭/Exhaustion) are dropped — they stay reference text on the stat block.
 */
export function parseConditionImmunities(raw: string): string[] {
  const out: string[] = [];
  for (const token of splitTypes(raw ?? "")) {
    const key =
      CONDITION_ZH[token] ??
      (CONDITION_KEYS.has(token.toLowerCase()) ? token.toLowerCase() : null);
    if (key !== null && !out.includes(key)) out.push(key);
  }
  return out;
}
