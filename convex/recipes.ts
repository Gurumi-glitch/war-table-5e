import { mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { ownsChild, resolveChild, resolveChildOwner } from "./characters";
import { resolveGame } from "./games";
import { battleDraftHelpers } from "./battleDraftHelpers";
import { childBelongsTo } from "./ownership";
import {
  diceTermValidator,
  extraRollValidator,
  hitTypeValidator,
  modifierSpecValidator,
  multiTargetValidator,
} from "./schema";
import type { ExtraRoll, HitType, Recipe } from "./rules";
import type { ModifierSpec } from "./modifiers";

/**
 * Action recipes (issue #7 / PRD US22–US24): a combatant's known actions. Each
 * defines hit type (attack/save/automatic), the dice to Claim, a manual
 * modifier, damage type, save DC, crit immunity, optional Resource consumption,
 * and a multi-target mode. Open to either role; recipes are visible to everyone
 * (a player can see an enemy's declared action, by design — DM may redact by not
 * creating the recipe). Deleted with its combatant.
 */

/** A recipe as projected to a role (shared — not DM-only). */
export type RecipeView = {
  _id: string;
  _creationTime: number;
  combatantId: string;
  name: string;
  hitType: HitType;
  attackMod: number;
  damageDice: Recipe["damageDice"];
  damageMod: number;
  damageType: string;
  dc: number;
  saveAbility: string;
  critImmune: boolean;
  resourceId: string | null;
  resourceCost: number;
  multiTarget: Recipe["multiTarget"];
  appliesMods: ModifierSpec[];
  extraRolls: ExtraRoll[];
};

/** Validator for the full recipe shape (used by add + update patch). */
const recipeFieldsValidator = v.object({
  name: v.string(),
  hitType: hitTypeValidator,
  attackMod: v.number(),
  damageDice: v.array(diceTermValidator),
  damageMod: v.number(),
  damageType: v.string(),
  dc: v.number(),
  saveAbility: v.string(),
  critImmune: v.boolean(),
  resourceId: v.optional(v.id("resources")),
  resourceCost: v.number(),
  multiTarget: multiTargetValidator,
  appliesMods: v.optional(v.array(modifierSpecValidator)),
  extraRolls: v.optional(v.array(extraRollValidator)),
});

/**
 * Add a recipe. Owner is EITHER a combatant (a linked PC's recipes are
 * redirected onto its character — campaign state, issue #9) OR a character
 * directly (the card window edits recipes with no combatant in play). Either
 * role.
 */
export const add = mutation({
  args: {
    playerToken: v.string(),
    combatantId: v.optional(v.id("combatants")),
    characterId: v.optional(v.id("characters")),
    recipe: recipeFieldsValidator,
  },
  handler: async (ctx, args) => {
    const owner = await resolveChildOwner(
      ctx.db,
      args.playerToken,
      args.combatantId,
      args.characterId,
    );
    // If a resource is referenced, it must belong to the same owner.
    if (args.recipe.resourceId !== undefined) {
      const resource = await ctx.db.get(args.recipe.resourceId);
      if (resource === null || !ownsChild(owner, resource)) {
        throw new Error("Resource not found on this combatant");
      }
    }
    const id = await ctx.db.insert("recipes", {
      ...owner.fields,
      ...args.recipe,
      appliesMods: args.recipe.appliesMods ?? [],
      extraRolls: args.recipe.extraRolls ?? [],
    });
    return id;
  },
});

/** Edit any field of a recipe. Either role. Manual override always wins. */
export const update = mutation({
  args: {
    playerToken: v.string(),
    recipeId: v.id("recipes"),
    patch: recipeFieldsValidator,
  },
  handler: async (ctx, args) => {
    const recipe = await resolveRecipe(ctx.db, args.playerToken, args.recipeId);
    // A newly linked resource must belong to the recipe's owner (issue #9
    // step 3: the "consumes" dropdown / duplicate-&-relink flow).
    if (args.patch.resourceId !== undefined) {
      const resource = await ctx.db.get(args.patch.resourceId);
      let ok = false;
      if (resource !== null) {
        if (recipe.combatantId !== undefined) {
          const combatant = await ctx.db.get(recipe.combatantId);
          ok = combatant !== null && childBelongsTo(resource, combatant);
        } else {
          ok = resource.characterId === recipe.characterId;
        }
      }
      if (!ok) {
        throw new Error("Resource not found on this recipe's owner");
      }
    }
    await ctx.db.patch(recipe._id, {
      ...args.patch,
      appliesMods: args.patch.appliesMods ?? [],
      extraRolls: args.patch.extraRolls ?? [],
      // Explicit so an absent resourceId UNLINKS (patch removes the field) —
      // the form always sends the full recipe shape.
      resourceId: args.patch.resourceId,
    });
  },
});

/** Remove a recipe. Either role. */
export const remove = mutation({
  args: {
    playerToken: v.string(),
    recipeId: v.id("recipes"),
  },
  handler: async (ctx, args) => {
    const recipe = await resolveRecipe(ctx.db, args.playerToken, args.recipeId);
    const { game } = await resolveGame(ctx.db, args.playerToken);
    await battleDraftHelpers.removeChildDraftReferences(ctx.db, game._id, recipe._id, "recipe");
    await ctx.db.delete(recipe._id);
  },
});

/** Resolve a recipe by id, authorizing via its owner. */
const resolveRecipe = (db: any, playerToken: string, recipeId: string) =>
  resolveChild(db, playerToken, recipeId, "Recipe");
