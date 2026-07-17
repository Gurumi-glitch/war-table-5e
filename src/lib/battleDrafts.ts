import type { Id } from "../../convex/_generated/dataModel";
import type { BattleDraftPatch } from "../components/ConfirmPanel";

const combatantId = (id: string) => id as Id<"combatants">;
const recipeId = (id: string) => id as Id<"recipes">;
const resourceId = (id: string) => id as Id<"resources">;

// The slot-key format is a wire contract shared with the backend — derive it
// from the one canonical definition rather than re-stating it here.
export { draftSlotKey } from "../../convex/battleDraftHelpers";

/** Convert UI string ids and blank rows into the validated Convex draft shape. */
export function brandBattleDraftPatch(patch: BattleDraftPatch) {
  return {
    ...patch,
    recipeId:
      patch.recipeId === undefined
        ? undefined
        : patch.recipeId === null ? null : recipeId(patch.recipeId),
    manualTargets: patch.manualTargets?.map((target) => ({
      ...target,
      combatantId: target.combatantId === "" ? null : combatantId(target.combatantId),
    })),
    recipeTargets: patch.recipeTargets?.map((target) => ({
      ...target,
      combatantId: target.combatantId === "" ? null : combatantId(target.combatantId),
      reactionRecipeId:
        target.reactionRecipeId === "" ? null : recipeId(target.reactionRecipeId),
    })),
    spendResources: patch.spendResources?.map((spend) => ({
      ...spend,
      resourceId: resourceId(spend.resourceId),
    })),
  };
}
