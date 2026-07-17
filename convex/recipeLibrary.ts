/**
 * The weapons + spells DATABASE + the recipe-draft types (issue #7 / PRD US22).
 *
 * The actual data lives in the generated `./library` module (built from the PHB
 * 2014 reference CSVs by `npm run gen:library`). This module owns the hand-written
 * types (`RecipeDraft`, `LibraryEntry`) and the `toRecipeDraft` projection that
 * the recipe editor uses when adding a library entry to a combatant.
 *
 * Manual ethos (ADR-0002): a library entry pre-fills a recipe's computable
 * fields (hit type, base dice, damage type, multi-target mode); the DM enters the
 * character-specific numbers (attack mod, save DC, damage mod) and can override
 * anything. #9 later seeds per-character recipes from 六人角色卡.
 */

import type { DiceTerm, ExtraRoll, HitType } from "./rules";
import type { ModifierSpec } from "./modifiers";
import { LIBRARY } from "./library";

/** The field shape `recipes.add` expects (minus ids). */
export type RecipeDraft = {
  name: string;
  hitType: HitType;
  attackMod: number;
  damageDice: DiceTerm[];
  damageMod: number;
  damageType: string;
  dc: number;
  saveAbility: string;
  critImmune: boolean;
  // Resource pool this recipe consumes on Confirm (issue #9 step 3): the id of
  // one of the OWNER's pools, or absent = no link. Plain string in the UI;
  // the pages brand it to Id<"resources"> at the mutation boundary.
  resourceId?: string;
  resourceCost: number;
  multiTarget: "none" | "aoe" | "darts";
  // Modifier specs the recipe applies to its target on Confirm (non-damage
  // buffs: Shield +5 AC, True Strike adv. attack, …). Reuses the #5 model.
  appliesMods: ModifierSpec[];
  // Extra dice rolls beyond the main roll: roleplay flavor dice or a second
  // battle damage roll (own dice/mod/damageType).
  extraRolls: ExtraRoll[];
};

/**
 * One database entry. The recipe-draft fields are the computable projection;
 * `ref` holds reference metadata (range, components, level, properties, the
 * source note) shown in the picker so the DM has context, never auto-applied.
 */
export type LibraryEntry = {
  id: string;
  kind: "weapon" | "spell";
  name: string;
  nameZh: string;
  hitType: HitType;
  attackMod: number;
  damageDice: DiceTerm[];
  damageMod: number;
  damageType: string;
  dc: number;
  saveAbility: string;
  critImmune: boolean;
  resourceCost: number;
  multiTarget: "none" | "aoe" | "darts";
  appliesMods: ModifierSpec[];
  // Absent on every generated library entry (SRD data has no extra rolls);
  // `toRecipeDraft` defaults it to [].
  extraRolls?: ExtraRoll[];
  ref: {
    // Weapons
    category?: string;
    group?: string;
    attackMode?: string;
    attackAbility?: string;
    properties?: string;
    propertyTags?: string;
    versatile?: string;
    normalRange?: number;
    longRange?: number;
    // Spells
    level?: number;
    school?: string;
    schoolZh?: string;
    castingTime?: string;
    range?: string;
    components?: string;
    material?: string;
    duration?: string;
    concentration?: boolean;
    ritual?: boolean;
    saveAbilities?: string;
    attackType?: string;
    diceRaw?: string;
    areaShapes?: string;
    areaSizesFt?: string;
    conditionsMentioned?: string;
    effectTags?: string;
    classLists?: string;
    note?: string;
  };
};

/** Strip reference metadata → the recipe draft that `recipes.add` consumes. */
export function toRecipeDraft(e: LibraryEntry): RecipeDraft {
  return {
    name: e.name,
    hitType: e.hitType,
    attackMod: e.attackMod,
    damageDice: e.damageDice,
    damageMod: e.damageMod,
    damageType: e.damageType,
    dc: e.dc,
    saveAbility: e.saveAbility,
    critImmune: e.critImmune,
    resourceCost: e.resourceCost,
    multiTarget: e.multiTarget,
    appliesMods: e.appliesMods,
    extraRolls: e.extraRolls ?? [],
  };
}

export { LIBRARY };
export { WEAPONS, SPELLS } from "./library";
