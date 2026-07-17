import type { OptimisticLocalStore } from "convex/browser";
import { api } from "../api";
import type { CombatantView } from "../../convex/games";
import type { CharacterView } from "../../convex/characters";
import type { RecipeView } from "../../convex/recipes";
import type { ResourceView } from "../../convex/resources";

/**
 * Optimistic updates (issue #9): make sheet edits (recipe + resource
 * add/remove/update) render INSTANTLY instead of waiting for the query
 * round-trip Convex re-runs after each write. With 7 concurrent editors this
 * is the difference between a snappy sheet and a 1s lag per click.
 *
 * Two caches may hold the edited row:
 *  - `getCombatants` — the combat table (a linked PC's character-owned rows are
 *    joined onto its combatant).
 *  - `characters.list` — the card windows (issue #9 step 4 reads a character's
 *    own resources/recipes directly).
 * Each helper patches EVERY subscribed result of BOTH queries on this client
 * (DM + player tabs share a client) via `getAllQueries` — no need to know each
 * subscription's `dmToken`. Other clients receive the real value via realtime.
 *
 * Convex reconciles automatically when the mutation commits: the optimistic
 * value is replaced by the fresh query result (real id / server truth) and
 * reverted on error. Query results are IMMUTABLE — always spread copies.
 */

/** A recipe's editable fields (the validator's shape: appliesMods/extraRolls optional). */
type RecipeInput = Omit<
  RecipeView,
  "_id" | "_creationTime" | "combatantId" | "resourceId" | "appliesMods" | "extraRolls"
> & {
  resourceId?: string;
  appliesMods?: RecipeView["appliesMods"];
  extraRolls?: RecipeView["extraRolls"];
};

/** The owner a new row is being added under (exactly one is set). */
type Owner = { combatantId?: string; characterId?: string };

let nextOptimisticId = 1;
const tempId = (prefix: string) => `${prefix}-optimistic-${nextOptimisticId++}`;

/** Apply `updater` to every subscribed getCombatants result (skip loading). */
function updateCombatants(
  localStore: OptimisticLocalStore,
  updater: (combatants: CombatantView[]) => CombatantView[],
): void {
  for (const { args, value } of localStore.getAllQueries(
    api.games.getCombatants,
  )) {
    if (value !== undefined) {
      localStore.setQuery(api.games.getCombatants, args, updater(value));
    }
  }
}

/** Apply `updater` to every subscribed characters.list result (skip loading). */
function updateCharacters(
  localStore: OptimisticLocalStore,
  updater: (characters: CharacterView[]) => CharacterView[],
): void {
  for (const { args, value } of localStore.getAllQueries(
    api.characters.list,
  )) {
    if (value !== undefined) {
      localStore.setQuery(api.characters.list, args, updater(value));
    }
  }
}

/** Build a RecipeView temp row projected onto a given owner id. */
function tempRecipe(recipe: RecipeInput, ownerId: string): RecipeView {
  return {
    _id: tempId("recipe"),
    _creationTime: Date.now(),
    combatantId: ownerId,
    name: recipe.name,
    hitType: recipe.hitType,
    attackMod: recipe.attackMod,
    damageDice: recipe.damageDice,
    damageMod: recipe.damageMod,
    damageType: recipe.damageType,
    dc: recipe.dc,
    saveAbility: recipe.saveAbility,
    critImmune: recipe.critImmune,
    resourceId: recipe.resourceId ?? null,
    resourceCost: recipe.resourceCost,
    multiTarget: recipe.multiTarget,
    appliesMods: recipe.appliesMods ?? [],
    extraRolls: recipe.extraRolls ?? [],
  };
}

/** Build a ResourceView temp row projected onto a given owner id. */
function tempResource(
  label: string,
  max: number,
  current: number,
  ownerId: string,
): ResourceView {
  return {
    _id: tempId("resource"),
    _creationTime: Date.now(),
    combatantId: ownerId,
    label,
    current,
    max,
  };
}

/**
 * Add: append a temp recipe row. Patches both caches:
 *  - getCombatants: the combatant matching combatantId, OR the linked combatant
 *    for characterId (character-owned rows project onto it).
 *  - characters.list: the character matching characterId.
 */
export function optimisticAddRecipe(
  localStore: OptimisticLocalStore,
  owner: Owner,
  recipe: RecipeInput,
): void {
  const { combatantId, characterId } = owner;
  if (combatantId === undefined && characterId === undefined) return;
  // getCombatants: match by combatant id, else by linked characterId.
  updateCombatants(localStore, (cs) =>
    cs.map((c) => {
      const match =
        (combatantId !== undefined && c._id === combatantId) ||
        (characterId !== undefined && c.characterId === characterId);
      return match
        ? { ...c, recipes: [...(c.recipes ?? []), tempRecipe(recipe, c._id)] }
        : c;
    }),
  );
  // characters.list: match by characterId only.
  if (characterId !== undefined) {
    updateCharacters(localStore, (chars) =>
      chars.map((ch) =>
        ch._id === characterId
          ? { ...ch, recipes: [...ch.recipes, tempRecipe(recipe, characterId)] }
          : ch,
      ),
    );
  }
}

/** Update: overwrite the recipe row's editable fields in place (both caches). */
export function optimisticUpdateRecipe(
  localStore: OptimisticLocalStore,
  recipeId: string,
  patch: RecipeInput,
): void {
  const upd = (r: RecipeView): RecipeView => ({
    ...r,
    name: patch.name,
    hitType: patch.hitType,
    attackMod: patch.attackMod,
    damageDice: patch.damageDice,
    damageMod: patch.damageMod,
    damageType: patch.damageType,
    dc: patch.dc,
    saveAbility: patch.saveAbility,
    critImmune: patch.critImmune,
    resourceId: patch.resourceId ?? null,
    resourceCost: patch.resourceCost,
    multiTarget: patch.multiTarget,
    appliesMods: patch.appliesMods ?? [],
  });
  updateCombatants(localStore, (cs) =>
    cs.map((c) =>
      (c.recipes ?? []).some((r) => r._id === recipeId)
        ? { ...c, recipes: (c.recipes ?? []).map((r) => (r._id === recipeId ? upd(r) : r)) }
        : c,
    ),
  );
  updateCharacters(localStore, (chars) =>
    chars.map((ch) =>
      ch.recipes.some((r) => r._id === recipeId)
        ? { ...ch, recipes: ch.recipes.map((r) => (r._id === recipeId ? upd(r) : r)) }
        : ch,
    ),
  );
}

/** Remove: drop the recipe row from both caches. */
export function optimisticRemoveRecipe(
  localStore: OptimisticLocalStore,
  recipeId: string,
): void {
  updateCombatants(localStore, (cs) =>
    cs.map((c) =>
      (c.recipes ?? []).some((r) => r._id === recipeId)
        ? { ...c, recipes: (c.recipes ?? []).filter((r) => r._id !== recipeId) }
        : c,
    ),
  );
  updateCharacters(localStore, (chars) =>
    chars.map((ch) =>
      ch.recipes.some((r) => r._id === recipeId)
        ? { ...ch, recipes: ch.recipes.filter((r) => r._id !== recipeId) }
        : ch,
    ),
  );
}

/** Add: append a temp resource row (both caches; see optimisticAddRecipe). */
export function optimisticAddResource(
  localStore: OptimisticLocalStore,
  owner: Owner,
  label: string,
  max: number,
  current: number | undefined,
): void {
  const { combatantId, characterId } = owner;
  if (combatantId === undefined && characterId === undefined) return;
  const cur = current ?? max;
  updateCombatants(localStore, (cs) =>
    cs.map((c) => {
      const match =
        (combatantId !== undefined && c._id === combatantId) ||
        (characterId !== undefined && c.characterId === characterId);
      return match
        ? { ...c, resources: [...(c.resources ?? []), tempResource(label, max, cur, c._id)] }
        : c;
    }),
  );
  if (characterId !== undefined) {
    updateCharacters(localStore, (chars) =>
      chars.map((ch) =>
        ch._id === characterId
          ? {
              ...ch,
              resources: [
                ...ch.resources,
                tempResource(label, max, cur, characterId),
              ],
            }
          : ch,
      ),
    );
  }
}

/** Update: patch only the provided resource fields (both caches). */
export function optimisticUpdateResource(
  localStore: OptimisticLocalStore,
  resourceId: string,
  label: string | undefined,
  current: number | undefined,
  max: number | undefined,
  icon: string | undefined,
  color: string | null | undefined,
): void {
  const patch: { label?: string; current?: number; max?: number; icon?: string; color?: string } = {};
  if (label !== undefined) patch.label = label;
  if (current !== undefined) patch.current = current;
  if (max !== undefined) patch.max = max;
  if (icon !== undefined) patch.icon = icon;
  // `color: null` clears the override — same null-clears/undefined-untouched
  // convention as the real mutation (convex/resources.ts).
  if (color !== undefined) patch.color = color === null ? undefined : color;
  if (Object.keys(patch).length === 0) return;
  updateCombatants(localStore, (cs) =>
    cs.map((c) =>
      (c.resources ?? []).some((r) => r._id === resourceId)
        ? {
            ...c,
            resources: (c.resources ?? []).map((r) =>
              r._id === resourceId ? { ...r, ...patch } : r,
            ),
          }
        : c,
    ),
  );
  updateCharacters(localStore, (chars) =>
    chars.map((ch) =>
      ch.resources.some((r) => r._id === resourceId)
        ? {
            ...ch,
            resources: ch.resources.map((r) =>
              r._id === resourceId ? { ...r, ...patch } : r,
            ),
          }
        : ch,
    ),
  );
}

/** Remove: drop the resource row from both caches. */
export function optimisticRemoveResource(
  localStore: OptimisticLocalStore,
  resourceId: string,
): void {
  updateCombatants(localStore, (cs) =>
    cs.map((c) =>
      (c.resources ?? []).some((r) => r._id === resourceId)
        ? { ...c, resources: (c.resources ?? []).filter((r) => r._id !== resourceId) }
        : c,
    ),
  );
  updateCharacters(localStore, (chars) =>
    chars.map((ch) =>
      ch.resources.some((r) => r._id === resourceId)
        ? { ...ch, resources: ch.resources.filter((r) => r._id !== resourceId) }
        : ch,
    ),
  );
}
