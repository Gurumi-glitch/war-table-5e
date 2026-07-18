/**
 * Fifth-edition auto-calc for the character card (issue #9 pre-step-5 toolkit).
 * Pure functions + the canonical 6-save / 18-skill templates — no React/Convex
 * deps, so this is unit-testable and the seed codegen (scripts/gen-characters.mjs)
 * mirrors the same formulas.
 *
 * Design (per grilling): **auto-calc + overrideable**. Derived values
 * (ability mods, save/skill totals, spell attack/DC, initiative) auto-update
 * when an INPUT changes, but every field stays directly editable. A manual
 * edit to a derived value sticks until an input that feeds it changes again —
 * so the card's input handlers call the *granular* helpers (recompute only the
 * dependent rows), while `recalcCard` is the full reset behind the 重算 button.
 *
 * Formulas (verified against a worked example card):
 *   pb         = 2 + floor((level - 1) / 4)       — lv 1-4→+2 … 17-20→+6
 *   mod        = floor((score - 10) / 2)          — WIS 8 → -1
 *   saveTotal  = mod + (proficient ? pb : 0)      — CON 2 + PB 2 = 4
 *   skillTotal = mod + (prof ? pb : 0) + (expertise ? pb : 0)
 *   spellAttack = spellMod + pb                    — CHA 2 + 2 = 4
 *   spellDc     = 8 + spellMod + pb                — 8 + 2 + 2 = 12
 *   initiative  = dexMod  (overrideable for feat bonuses)
 *
 * Level feeds ONLY pb (which then cascades to saves/skills/spell numbers).
 * Max HP and class resources also scale with level in 5e, but they depend on
 * class composition (hit dice, rage/ki/lay-on-hands…) which the card keeps as
 * free text — those stay manual per the "DM is the authority" ethos.
 */

/** The six abilities in display order (力量..魅力). Saves are one-per-ability. */
export const ABILITY_KEYS = [
  "力量",
  "敏捷",
  "體質",
  "智力",
  "感知",
  "魅力",
] as const;
export type AbilityKey = (typeof ABILITY_KEYS)[number];

/** One ability row (mod is stored + auto-synced, never read as input by calc). */
export type AbilityRow = { key: string; score: number; mod: number };

export type SaveRow = { key: string; prof: boolean; total: number };

export type SkillProf = "none" | "proficient" | "expertise";
export type SkillRow = {
  key: string;
  ability: string;
  prof: SkillProf;
  total: number;
};

/**
 * The 18 default 5e skills, display order, each mapped to its governing
 * ability (zh keys matching ABILITY_KEYS). Matches the user's example table.
 */
export const SKILLS: ReadonlyArray<{ key: string; ability: AbilityKey }> = [
  { key: "運動", ability: "力量" },
  { key: "特技", ability: "敏捷" },
  { key: "巧手", ability: "敏捷" },
  { key: "隱匿", ability: "敏捷" },
  { key: "奧秘", ability: "智力" },
  { key: "歷史", ability: "智力" },
  { key: "調查", ability: "智力" },
  { key: "自然", ability: "智力" },
  { key: "宗教", ability: "智力" },
  { key: "馴獸", ability: "感知" },
  { key: "洞悉", ability: "感知" },
  { key: "醫藥", ability: "感知" },
  { key: "察覺", ability: "感知" },
  { key: "求生", ability: "感知" },
  { key: "欺瞞", ability: "魅力" },
  { key: "威嚇", ability: "魅力" },
  { key: "表演", ability: "魅力" },
  { key: "說服", ability: "魅力" },
];

/** proficiency bonus from character level (clamped to the 1–20 PC table). */
export function pbForLevel(level: number): number {
  const lv = Math.min(20, Math.max(1, level));
  return 2 + Math.floor((lv - 1) / 4);
}

/** ability modifier from score. */
export function modFor(score: number): number {
  return Math.floor((score - 10) / 2);
}

/** save total = mod + (proficient ? pb : 0). */
export function saveTotal(mod: number, pb: number, prof: boolean): number {
  return mod + (prof ? pb : 0);
}

/** skill total = mod + proficiency bonus (pb for proficient, 2×pb for expertise). */
export function skillTotal(mod: number, pb: number, prof: SkillProf): number {
  const bonus = prof === "none" ? 0 : prof === "proficient" ? pb : pb * 2;
  return mod + bonus;
}

/** spell attack bonus = spellcasting ability mod + pb. */
export function spellAttackFn(spellMod: number, pb: number): number {
  return spellMod + pb;
}

/** spell save DC = 8 + spellcasting ability mod + pb. */
export function spellDcFn(spellMod: number, pb: number): number {
  return 8 + spellMod + pb;
}

/**
 * Passive perception = 10 + Perception skill total (SRD § Passive Checks). The
 * Perception total already folds in the WIS mod + proficiency/expertise bonus,
 * so this is a single addition. adv/disadv ±5 is a manual note (this system's
 * adv is combat-scoped, not passive-perception-scoped) — left out per (B) 修正 4.
 */
export function passivePerceptionFn(perceptionTotal: number): number {
  return 10 + perceptionTotal;
}

/** Map of ability key → derived mod, for a set of ability rows. */
export function modByKey(abilities: AbilityRow[]): Record<string, number> {
  const m: Record<string, number> = {};
  for (const a of abilities) m[a.key] = modFor(a.score);
  return m;
}

/** The Perception skill's zh key (governs passive perception). */
export const PERCEPTION_KEY = "察覺";

/**
 * Perception skill total from a skill list, falling back to the WIS mod when
 * the row is absent (defensive — the default template always includes 察覺).
 * Used to derive passive perception in `recalcCard` and the card window.
 */
export function perceptionTotalIn(
  skills: ReadonlyArray<SkillRow>,
  wisMod: number,
): number {
  return skills.find((s) => s.key === PERCEPTION_KEY)?.total ?? wisMod;
}

/** Build the default 6-save template (all non-proficient), totals from mods+pb. */
export function defaultSaves(mods: Record<string, number>, pb: number): SaveRow[] {
  return ABILITY_KEYS.map((key) => ({
    key,
    prof: false,
    total: saveTotal(mods[key] ?? 0, pb, false),
  }));
}

/** Build the default 18-skill template (all `none`), totals from mods+pb. */
export function defaultSkills(mods: Record<string, number>, pb: number): SkillRow[] {
  return SKILLS.map((s) => ({
    key: s.key,
    ability: s.ability,
    prof: "none",
    total: skillTotal(mods[s.ability] ?? 0, pb, "none"),
  }));
}

/** Cycle a skill proficiency: none → proficient → expertise → none. */
export function nextSkillProf(prof: SkillProf): SkillProf {
  return prof === "none" ? "proficient" : prof === "proficient" ? "expertise" : "none";
}

/**
 * A card's auto-calculable slice. `recalcCard` is a FULL recompute from inputs
 * (scores, pb, save profs, skill profs, spellcasting ability) — the 重算 button
 * uses it to backfill migrated cards. The card's per-input handlers use the
 * granular helpers instead so manual overrides survive unrelated edits.
 */
export type CalcCard = {
  abilities: AbilityRow[];
  /** When present, pb is re-derived from level (pb input then ignored). */
  level?: number;
  pb: number;
  initBonus: number;
  saves: SaveRow[];
  skills: SkillRow[];
  spellcastingAbility: string; // "" = none, else a zh ability key
  spellAttack: number;
  spellDc: number;
  passivePerception: number;
};

/** Recompute every derived value from inputs. Does not mutate the argument. */
export function recalcCard(card: CalcCard): CalcCard {
  const pb = card.level != null ? pbForLevel(card.level) : card.pb;
  const mods = modByKey(card.abilities);
  const dexMod = mods["敏捷"] ?? 0;
  const saves = card.saves.map((s) => ({
    ...s,
    total: saveTotal(mods[s.key] ?? 0, pb, s.prof),
  }));
  const skills = card.skills.map((s) => ({
    ...s,
    total: skillTotal(mods[s.ability] ?? 0, pb, s.prof),
  }));
  const spellMod = card.spellcastingAbility
    ? mods[card.spellcastingAbility] ?? 0
    : 0;
  const has = card.spellcastingAbility !== "";
  const passivePerception = passivePerceptionFn(
    perceptionTotalIn(skills, mods["感知"] ?? 0),
  );
  return {
    ...card,
    abilities: card.abilities.map((a) => ({ ...a, mod: modFor(a.score) })),
    pb,
    initBonus: dexMod,
    saves,
    skills,
    spellAttack: has ? spellAttackFn(spellMod, pb) : 0,
    spellDc: has ? spellDcFn(spellMod, pb) : 0,
    passivePerception,
  };
}
