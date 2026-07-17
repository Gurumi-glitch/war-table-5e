import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { resolveGame } from "./games";
import { resolveCombatant } from "./combatants";
import { childOwner } from "./ownership";
import { modifierSpecValidator } from "./schema";
import { CONDITION_BY_KEY, type Effect, type EffectType } from "./modifiers";

/**
 * Conditions & Modifiers persistence (issue #5). A stored effect is either a
 * curated Condition (bundled specs) or a custom standalone Modifier (one spec).
 * `active` is the reversible toggle — toggling off removes the contribution and
 * reverts the Effective stat without mutating the base (ADR-0002). Either role
 * may add/toggle/remove (open-buttons ethos); effects are visible to everyone.
 */

/** A stored effect as projected to a role (shared — not DM-only). */
export type EffectView = {
  _id: string;
  _creationTime: number;
  combatantId: string;
  type: EffectType;
  conditionKey: string | null;
  label: string;
  specs: Effect["specs"];
  active: boolean;
};

const effectTypeValidator = v.union(
  v.literal("condition"),
  v.literal("custom"),
);

/**
 * Resolve an effect + its combatant + game by player token. Open to either role;
 * throws if the effect's combatant doesn't belong to the token's game.
 */
async function resolveEffect(
  db: any,
  playerToken: string,
  effectId: string,
): Promise<{ effect: any; combatant: any }> {
  const { game } = await resolveGame(db, playerToken);
  const effect = await db.get(effectId);
  if (effect === null) {
    throw new Error("Effect not found");
  }
  // Character-owned (issue #9): cards are global — any valid game token
  // grants access (conditions persist across Games; no gating).
  if (effect.characterId !== undefined) {
    return { effect, combatant: null };
  }
  const combatant = await db.get(effect.combatantId);
  if (combatant === null || combatant.gameId !== game._id) {
    throw new Error("Effect not found");
  }
  return { effect, combatant };
}

/**
 * Apply a curated 5e Condition to a combatant as one unit — its bundled
 * ModifierSpecs are snapshotted onto the row so Effective-stat math never needs
 * the catalog at read time. Either role.
 */
export const applyCondition = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
    conditionKey: v.string(),
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    const def = CONDITION_BY_KEY[args.conditionKey];
    if (def === undefined) {
      throw new Error(`Unknown condition: ${args.conditionKey}`);
    }
    // A linked PC's conditions live on the character — they persist across
    // Games (campaign state, issue #9).
    const id = await ctx.db.insert("effects", {
      ...childOwner(combatant),
      type: "condition",
      conditionKey: def.key,
      label: def.label,
      specs: def.specs,
      active: true,
    });
    return id;
  },
});

/**
 * Add a custom standalone Modifier (one or more specs) to a combatant. Either
 * role. The DM picks stat / mode / value / label; presets live in the UI.
 * Multiple specs are bundled under one label — toggling the chip applies or
 * reverts all of them at once (same as a curated Condition, issue #5 / Case 2).
 */
export const addCustomModifier = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.id("combatants"),
    label: v.string(),
    // Accept specs array (Case 2: multi-spec custom conditions).
    specs: v.array(modifierSpecValidator),
  },
  handler: async (ctx, args) => {
    const combatant = await resolveCombatant(
      ctx.db,
      args.playerToken,
      args.combatantId,
    );
    const id = await ctx.db.insert("effects", {
      ...childOwner(combatant),
      type: "custom",
      label: args.label,
      specs: args.specs,
      active: true,
    });
    return id;
  },
});

/**
 * Toggle an effect active/inactive. Toggling off reverts the Effective stat
 * (inactive effects contribute nothing); toggling back on restores it. The base
 * stat is never mutated. Either role.
 */
export const toggleEffect = mutation({
  args: {
    playerToken: v.string(),
    effectId: v.id("effects"),
    active: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { effect } = await resolveEffect(ctx.db, args.playerToken, args.effectId);
    await ctx.db.patch(effect._id, { active: args.active });
  },
});

/** Remove an effect entirely (vs. toggling it off). Either role. */
export const removeEffect = mutation({
  args: {
    playerToken: v.string(),
    effectId: v.id("effects"),
  },
  handler: async (ctx, args) => {
    const { effect } = await resolveEffect(ctx.db, args.playerToken, args.effectId);
    await ctx.db.delete(effect._id);
  },
});

// Re-export so consumers can reference the runtime validator/type together.
export { effectTypeValidator };
