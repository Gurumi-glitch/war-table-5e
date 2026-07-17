/**
 * The Modifier/Condition model + Effective-stat math (PRD US7–US13, issue #5).
 *
 * PURE module — no Convex runtime. Imported by `games.ts` (getGameState) and by
 * the frontend (future recipes / Confirm math in #7), exactly like `colors.ts`
 * and the helpers in `dice.ts`.
 *
 * Model:
 * - A **Modifier** is one contribution to one Effective stat. It has a `stat`
 *   (what it affects), a `mode` (how), and a `value`. Modes:
 *     • `bonus`         — numeric add (AC +5, −2 to hit). All bonuses stack (sum).
 *     • `override`      — absolute set (speed 0). Most-restrictive (min) wins;
 *                         bonuses do NOT apply on top of an override.
 *     • `advantage`     — grants advantage on the stat (attack/save/check).
 *     • `disadvantage`  — grants disadvantage.
 *   Advantage + disadvantage on the same stat cancel to neutral (5e rule),
 *   regardless of how many of each.
 * - A **Condition** is a named bundle of Modifiers that apply as one unit
 *   (Poisoned, Restrained, …). Toggling a Condition off removes every Modifier
 *   it bundled — one stored effect, one toggle.
 * - A **custom Modifier** is a standalone single-Modifier effect the DM adds.
 *
 * The **Effective stat** = base + all *active* Modifiers, computed on the fly
 * and NEVER stored. Toggling an effect off (active=false) excludes its
 * Modifiers, so the Effective stat reverts without ever mutating the base
 * (ADR-0002: manual override / base is authoritative).
 *
 * Combat math is wired end-to-end: the Confirm handler (convex/combatLog.ts)
 * and the frontend preview (ConfirmPanel.tsx) both consume advantage/
 * disadvantage, per-ability saves, auto-fail, and resist-all via the helpers
 * below. `attackAgainst` is a defensive stat (like AC) — "attacks against this
 * combatant have adv/dis" — combined with the actor's own `attack` adv/dis via
 * `combineAdv` (5e: any-adv + any-dis cancels to neutral). `autoFail` (saves
 * only) and `ability`-scoped save specs let Stunned/Paralyzed/Petrified/
 * Unconscious auto-fail STR/DEX saves. `resistAllDamage` / `cantAct` are
 * condition-level flags read by the confirm path / UI respectively.
 *
 * v1 cut (documented): multiplicative speed changes (Prone "speed halved",
 * Haste "speed doubled") and dice bonuses (Bless +1d4) don't fit bonus/override,
 * so they live in the condition's `description` as a manual note the DM applies
 * by hand — consistent with the manual ethos. Speed also has no stored base yet,
 * so speed-only effects are note-only. Range-dependent effects (Paralyzed/
 * Unconscious auto-crit within 5 ft; Prone melee-adv/ranged-dis vs you) are also
 * note-only — no range data is stored.
 */

import type { DiceTerm } from "./rules";

/** The six ability keys (zh, matching dndCalc.ABILITY_KEYS / characters.saves[].key). */
export const ABILITY_KEYS = [
  "力量",
  "敏捷",
  "體質",
  "智力",
  "感知",
  "魅力",
] as const;

/** Map a recipe's lowercase-English saveAbility ("dex") to the zh ability key ("敏捷"). */
export const SAVE_ABILITY_EN_TO_ZH: Record<string, string> = {
  str: "力量",
  dex: "敏捷",
  con: "體質",
  int: "智力",
  wis: "感知",
  cha: "魅力",
};

/** Normalize a recipe.saveAbility (English) to the zh ability key, or "" if unknown. */
export function saveAbilityToZh(en: string): string {
  return SAVE_ABILITY_EN_TO_ZH[(en ?? "").toLowerCase().trim()] ?? "";
}

/** The Effective stats a Modifier can contribute to. */
export type Stat =
  | "ac"
  | "attack"
  | "attackAgainst"
  | "save"
  | "abilityCheck"
  | "initiative";

/** How a Modifier contributes to its stat. */
export type Mode =
  | "bonus"
  | "override"
  | "advantage"
  | "disadvantage"
  | "autoFail";

/** One Modifier's contribution (the unit of Effective-stat math). */
export type ModifierSpec = {
  /**
   * `"healing"` and `"tempHp"` are valid ONLY inside a recipe's `appliesMods`:
   * instant effects applied at Confirm (dice + `value`), never stored as a
   * chip and inert to all Effective-stat math (every helper filters by a real
   * Stat). `"healing"` is an HP gain (capped at maxHp); `"tempHp"` grants a
   * temporary-HP pool via `grantTempHp` (no stacking, keep the larger —
   * PHB p.198 — and never clamped by maxHp).
   */
  stat: Stat | "healing" | "tempHp";
  mode: Mode;
  /** Bonus amount or override value; ignored for advantage/disadvantage/autoFail. */
  value: number;
  /**
   * Optional ability scope (zh key) for `save` / `abilityCheck` specs — e.g. a
   * Restrained DEX-save disadvantage, or a Stunned DEX-save auto-fail. Absent
   * means the spec applies to ALL saves/checks (the legacy generic-`save` meaning).
   */
  ability?: string;
  /** Optional human note (e.g. the part of a condition the math doesn't capture). */
  note?: string;
  /**
   * `appliesMods` only — who receives this row on Confirm. `"targets"` (and
   * absent, the legacy default) = the confirmed target(s); `"self"` = the
   * acting combatant. Ignored on stored effects and by the reaction path
   * (a reaction always applies to the reactor).
   */
  direction?: "self" | "targets";
  /**
   * `appliesMods` healing rows only — dice claimed by the actor and consumed
   * at Confirm (after the main damage dice and extra rolls), added to `value`.
   */
  dice?: DiceTerm[];
};

/** Whether a stored effect is a curated Condition bundle or a custom Modifier. */
export type EffectType = "condition" | "custom";

/**
 * A stored effect on a combatant: either a curated Condition (carrying its
 * bundled specs) or a custom standalone Modifier (one spec). `active` is the
 * toggle — inactive effects contribute nothing, so toggling off reverts the
 * Effective stat without touching the base.
 */
export type Effect = {
  type: EffectType;
  /** Present iff type === "condition" — the curated condition key. */
  conditionKey?: string;
  label: string;
  specs: ModifierSpec[];
  active: boolean;
};

/** A computed numeric Effective stat (ac, initiative). */
export type EffectiveNumber = {
  base: number;
  /** Sum of all active bonuses to this stat. */
  bonus: number;
  /** Active override value (most-restrictive = min), or null if none. */
  override: number | null;
  /** The Effective value: override if any, else base + bonus. */
  value: number;
};

/** Advantage state for a stat (attack, save, abilityCheck). */
export type Advantage = "advantage" | "disadvantage" | "none";

/** Raw advantage/disadvantage presence before 5e cancellation. */
export type AdvSignals = { hasAdv: boolean; hasDis: boolean };

/** A computed Effective stat that can also carry advantage/disadvantage. */
export type EffectiveStat = EffectiveNumber & { advantage: Advantage };

/** All computed Effective stats for a combatant. */
export type EffectiveStats = {
  ac: EffectiveNumber;
  attack: EffectiveStat;
  save: EffectiveStat;
  abilityCheck: EffectiveStat;
  initiative: EffectiveNumber;
};

/** Per-stat base values; stats without a base default to 0. */
export type Bases = Partial<Record<Stat, number>>;

/** A curated 5e Condition definition: its bundled Modifiers as one unit. */
export type ConditionDef = {
  key: string;
  label: string;
  description: string;
  specs: ModifierSpec[];
  /** True if the condition resists ALL damage while active (Petrified). */
  resistAllDamage?: boolean;
  /** True if the combatant can't take actions while active (Incapacitated, Paralyzed, …). */
  cantAct?: boolean;
};

/**
 * Curated 5e Conditions. Each applies its bundled Modifiers as one unit.
 * `description` carries the parts the math doesn't model (speed changes, auto-
 * crit within 5 ft, can't-move flavor) as manual notes — the DM reads and
 * applies them. Combat-math effects (attack/save adv/dis, per-ability auto-fail,
 * attacks-against adv/dis, resist-all, can't-act) ARE wired into the engine.
 *
 * Ability keys are zh (力量=STR, 敏捷=DEX, 體質=CON, 智力=INT, 感知=WIS, 魅力=CHA),
 * matching `characters.saves[].key`. Recipes carry lowercase-English saveAbility;
 * `saveAbilityToZh` bridges the two at the confirm boundary.
 */
export const CONDITIONS: readonly ConditionDef[] = [
  {
    key: "blinded",
    label: "Blinded",
    description: "Can't see. [auto] Your attacks have disadvantage; attacks against you have advantage.",
    specs: [
      { stat: "attack", mode: "disadvantage", value: 0 },
      { stat: "attackAgainst", mode: "advantage", value: 0 },
    ],
  },
  {
    key: "charmed",
    label: "Charmed",
    description: "Can't attack the charmer (targeting restriction, manual). Charmer gains advantage on social ability checks against you (out of combat).",
    specs: [],
  },
  {
    key: "deafened",
    label: "Deafened",
    description: "Can't hear. No combat-math effect.",
    specs: [],
  },
  {
    key: "frightened",
    label: "Frightened",
    description: "[auto] Disadvantage on ability checks and attack rolls while you can see the source. Can't willingly move closer (manual).",
    specs: [
      { stat: "attack", mode: "disadvantage", value: 0 },
      { stat: "abilityCheck", mode: "disadvantage", value: 0 },
    ],
  },
  {
    key: "grappled",
    label: "Grappled",
    description: "Speed becomes 0 (manual — no stored speed base). Ends if the grappler is moved away or incapacitated.",
    specs: [],
  },
  {
    key: "incapacitated",
    label: "Incapacitated",
    description: "[auto] Can't take actions or reactions (warning shown when picked as actor).",
    specs: [],
    cantAct: true,
  },
  {
    key: "invisible",
    label: "Invisible",
    description: "[auto] Your attacks have advantage; attacks against you have disadvantage.",
    specs: [
      { stat: "attack", mode: "advantage", value: 0 },
      { stat: "attackAgainst", mode: "disadvantage", value: 0 },
    ],
  },
  {
    key: "paralyzed",
    label: "Paralyzed",
    description: "[auto] Can't act. Auto-fails Strength and Dexterity saves; attacks against you have advantage. [manual] Attacks within 5 ft auto-crit (range not tracked).",
    specs: [
      { stat: "save", mode: "autoFail", value: 0, ability: "力量" },
      { stat: "save", mode: "autoFail", value: 0, ability: "敏捷" },
      { stat: "attackAgainst", mode: "advantage", value: 0 },
    ],
    cantAct: true,
  },
  {
    key: "petrified",
    label: "Petrified",
    description: "[auto] Transformed to stone: can't act; auto-fails STR/DEX saves; attacks against you have advantage; resists ALL damage. [manual] Weight ×10.",
    specs: [
      { stat: "save", mode: "autoFail", value: 0, ability: "力量" },
      { stat: "save", mode: "autoFail", value: 0, ability: "敏捷" },
      { stat: "attackAgainst", mode: "advantage", value: 0 },
    ],
    resistAllDamage: true,
    cantAct: true,
  },
  {
    key: "poisoned",
    label: "Poisoned",
    description: "[auto] Disadvantage on attack rolls and ability checks.",
    specs: [
      { stat: "attack", mode: "disadvantage", value: 0 },
      { stat: "abilityCheck", mode: "disadvantage", value: 0 },
    ],
  },
  {
    key: "prone",
    label: "Prone",
    description: "[auto] Disadvantage on your attacks. [manual] Speed halved; attacks within 5 ft against you have advantage, ranged attacks against you have disadvantage (range not tracked).",
    specs: [{ stat: "attack", mode: "disadvantage", value: 0 }],
  },
  {
    key: "restrained",
    label: "Restrained",
    description: "[auto] Attacks against you have advantage; your attacks and Dexterity saves have disadvantage. [manual] Speed 0.",
    specs: [
      { stat: "attack", mode: "disadvantage", value: 0 },
      { stat: "save", mode: "disadvantage", value: 0, ability: "敏捷" },
      { stat: "attackAgainst", mode: "advantage", value: 0 },
    ],
  },
  {
    key: "stunned",
    label: "Stunned",
    description: "[auto] Can't act. Auto-fails Strength and Dexterity saves; attacks against you have advantage.",
    specs: [
      { stat: "save", mode: "autoFail", value: 0, ability: "力量" },
      { stat: "save", mode: "autoFail", value: 0, ability: "敏捷" },
      { stat: "attackAgainst", mode: "advantage", value: 0 },
    ],
    cantAct: true,
  },
  {
    key: "unconscious",
    label: "Unconscious",
    description: "[auto] Can't act; auto-fails STR/DEX saves; attacks against you have advantage. [manual] Drops prone; attacks within 5 ft auto-crit (range not tracked).",
    specs: [
      { stat: "save", mode: "autoFail", value: 0, ability: "力量" },
      { stat: "save", mode: "autoFail", value: 0, ability: "敏捷" },
      { stat: "attackAgainst", mode: "advantage", value: 0 },
    ],
    cantAct: true,
  },
];

/** Lookup a curated Condition by key. */
export const CONDITION_BY_KEY: Record<string, ConditionDef> = Object.fromEntries(
  CONDITIONS.map((c) => [c.key, c]),
);

/** A quick-add custom Modifier preset (Shield, cover, Bardic, etc.). */
export type CustomPreset = { label: string; spec: ModifierSpec };

/**
 * Common custom Modifiers the DM adds often. These are NOT conditions — they're
 * standalone single-Modifier effects, offered as one-click buttons.
 */
export const CUSTOM_PRESETS: readonly CustomPreset[] = [
  { label: "Shield (+5 AC)", spec: { stat: "ac", mode: "bonus", value: 5 } },
  { label: "Half cover (+2 AC)", spec: { stat: "ac", mode: "bonus", value: 2 } },
  { label: "Three-quarters cover (+5 AC)", spec: { stat: "ac", mode: "bonus", value: 5 } },
  { label: "+1 AC", spec: { stat: "ac", mode: "bonus", value: 1 } },
  { label: "−2 to hit", spec: { stat: "attack", mode: "bonus", value: -2 } },
  { label: "Bardic Inspiration (adv. attack)", spec: { stat: "attack", mode: "advantage", value: 0 } },
  { label: "Guidance (adv. check)", spec: { stat: "abilityCheck", mode: "advantage", value: 0 } },
];

/** The list of stat labels for custom-modifier UI dropdowns. */
export const STAT_LABELS: Record<Stat, string> = {
  ac: "AC",
  attack: "Attack (to hit)",
  attackAgainst: "Attacks against",
  save: "Saving throw",
  abilityCheck: "Ability check",
  initiative: "Initiative",
};

/** The list of mode labels for custom-modifier UI dropdowns. */
export const MODE_LABELS: Record<Mode, string> = {
  bonus: "Bonus / penalty",
  override: "Set (override)",
  advantage: "Advantage",
  disadvantage: "Disadvantage",
  autoFail: "Auto-fail (saves)",
};

/**
 * Flatten active effects into their ModifierSpecs. Inactive (toggled-off)
 * effects contribute nothing — this is the reversibility lever.
 */
export function expandSpecs(effects: readonly Effect[]): ModifierSpec[] {
  return effects.filter((e) => e.active).flatMap((e) => e.specs);
}

/**
 * Whether `spec` answers a query scoped to `ability` — the single ability-scope
 * rule shared by all three resolution axes (ADR-0008): `effectiveNumber`,
 * `advantageSignalsFor`, `autoFailFor`.
 *
 * An unscoped spec is generic and always applies. A scoped spec applies ONLY to
 * its own ability — including when the query itself is unscoped, because "the
 * save bonus in general" is not answered by a STR-only +2. That last clause is
 * the whole point: an unscoped query is the default (every non-save caller uses
 * it), so it must be the SAFE one. Letting a scoped spec leak into it would
 * silently apply a STR-only bonus to every save, with no error and no UI tell.
 */
function appliesToAbility(spec: ModifierSpec, ability?: string): boolean {
  return spec.ability === undefined || spec.ability === ability;
}

/**
 * Compute the Effective number for `stat`: override (min of active overrides)
 * wins; otherwise base + summed bonuses. Pure and side-effect free.
 *
 * `ability` scopes the query (see `appliesToAbility`) — pass it whenever `stat`
 * is `save`/`abilityCheck`, the two stats a spec can be scoped to.
 */
export function effectiveNumber(
  base: number,
  specs: readonly ModifierSpec[],
  stat: Stat,
  ability?: string,
): EffectiveNumber {
  const relevant = specs.filter((s) => s.stat === stat && appliesToAbility(s, ability));
  const bonus = relevant
    .filter((s) => s.mode === "bonus")
    .reduce((sum, s) => sum + s.value, 0);
  const overrides = relevant
    .filter((s) => s.mode === "override")
    .map((s) => s.value);
  const override = overrides.length > 0 ? Math.min(...overrides) : null;
  const value = override !== null ? override : base + bonus;
  return { base, bonus, override, value };
}

/**
 * Net advantage for `stat`: advantage + disadvantage cancel to neutral (5e),
 * no matter how many of each are active. `ability` scopes the query per
 * `appliesToAbility` — so a Restrained DEX-save disadvantage doesn't bleed into
 * a WIS save, and an unscoped query never picks up a scoped spec.
 */
export function advantageSignalsFor(
  specs: readonly ModifierSpec[],
  stat: Stat,
  ability?: string,
): AdvSignals {
  const relevant = specs.filter((s) => s.stat === stat && appliesToAbility(s, ability));
  return {
    hasAdv: relevant.some((s) => s.mode === "advantage"),
    hasDis: relevant.some((s) => s.mode === "disadvantage"),
  };
}

export function advantageFor(
  specs: readonly ModifierSpec[],
  stat: Stat,
  ability?: string,
): Advantage {
  const { hasAdv, hasDis } = advantageSignalsFor(specs, stat, ability);
  if (hasAdv && hasDis) return "none";
  if (hasAdv) return "advantage";
  if (hasDis) return "disadvantage";
  return "none";
}

/** Net advantage for `stat`, unscoped — i.e. generic specs only (see `appliesToAbility`). */
export function advantage(
  specs: readonly ModifierSpec[],
  stat: Stat,
): Advantage {
  return advantageFor(specs, stat);
}

/** True if any active spec auto-fails `stat` for `ability` (saves only). */
export function autoFailFor(
  specs: readonly ModifierSpec[],
  stat: Stat,
  ability?: string,
): boolean {
  return specs.some(
    (s) => s.stat === stat && s.mode === "autoFail" && appliesToAbility(s, ability),
  );
}

/** Reduce raw advantage/disadvantage signals once all sources are present. */
export function combineAdvSignals(...sources: readonly AdvSignals[]): Advantage {
  const hasAdv = sources.some((source) => source.hasAdv);
  const hasDis = sources.some((source) => source.hasDis);
  if (hasAdv && hasDis) return "none";
  if (hasAdv) return "advantage";
  if (hasDis) return "disadvantage";
  return "none";
}

/**
 * Combine multiple advantage states per 5e: any advantage + any disadvantage
 * cancels to neutral; otherwise any advantage → advantage, any disadvantage →
 * disadvantage, else none. Use `combineAdvSignals` instead when any source may
 * contain both raw signals before the final roll-level cancellation.
 */
export function combineAdv(...advantages: Advantage[]): Advantage {
  const hasAdv = advantages.includes("advantage");
  const hasDis = advantages.includes("disadvantage");
  if (hasAdv && hasDis) return "none";
  if (hasAdv) return "advantage";
  if (hasDis) return "disadvantage";
  return "none";
}

/** Effective number for `stat` plus its net advantage state. */
export function effectiveStat(
  base: number,
  specs: readonly ModifierSpec[],
  stat: Stat,
): EffectiveStat {
  return { ...effectiveNumber(base, specs, stat), advantage: advantage(specs, stat) };
}

/**
 * Compute every Effective stat from the per-stat bases and the combatant's
 * effects. Stats without an explicit base default to 0 (their `bonus` still
 * reflects active modifiers, which is what recipes in #7 consume).
 */
export function computeEffective(
  bases: Bases,
  effects: readonly Effect[],
): EffectiveStats {
  const specs = expandSpecs(effects);
  return {
    ac: effectiveNumber(bases.ac ?? 0, specs, "ac"),
    attack: effectiveStat(bases.attack ?? 0, specs, "attack"),
    save: effectiveStat(bases.save ?? 0, specs, "save"),
    abilityCheck: effectiveStat(bases.abilityCheck ?? 0, specs, "abilityCheck"),
    initiative: effectiveNumber(bases.initiative ?? 0, specs, "initiative"),
  };
}

/** True if any active condition on this combatant sets the given boolean flag. */
function hasConditionFlag(
  effects: readonly Effect[],
  flag: "resistAllDamage" | "cantAct",
): boolean {
  return effects.some(
    (e) =>
      e.active &&
      e.type === "condition" &&
      e.conditionKey !== undefined &&
      CONDITION_BY_KEY[e.conditionKey]?.[flag] === true,
  );
}

/** True if any active condition on this combatant resists ALL damage (Petrified). */
export function hasResistAll(effects: readonly Effect[]): boolean {
  return hasConditionFlag(effects, "resistAllDamage");
}

/** True if any active condition on this combatant means it can't take actions. */
export function hasCantAct(effects: readonly Effect[]): boolean {
  return hasConditionFlag(effects, "cantAct");
}
