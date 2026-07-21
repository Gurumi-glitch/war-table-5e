import { useParams } from "react-router-dom";
import { useQuery, useMutation } from "convex/react";
import { api } from "../api";
import type { Id } from "../../convex/_generated/dataModel";
import type { GameState } from "../../convex/games";
import type { BattleDraftView } from "../../convex/battleDrafts";
import type { CharacterView } from "../../convex/characters";
import type { CombatLogEntry } from "../../convex/combatLog";
import type { DieType } from "../../convex/diceHelpers";
import type { ModifierSpec } from "../../convex/modifiers";
import type { RecipeDraft } from "../../convex/recipeLibrary";
import { BackstageView } from "../components/BackstageView";
import { EnemyDbPanel } from "../components/EnemyDbPanel";
import type { EnemyView } from "../../convex/enemies";
import { type NewCombatant } from "../components/GameBoard";
import { type ConfirmEffect, type RecipeConfirm } from "../components/ConfirmPanel";
import { brandBattleDraftPatch, draftSlotKey } from "../lib/battleDrafts";
import { blankCardFields } from "../lib/cardFile";
import { useT } from "../i18n";
import type { CombatantPatch } from "../components/CombatantRow";
import {
  optimisticAddRecipe,
  optimisticUpdateRecipe,
  optimisticRemoveRecipe,
  optimisticAddResource,
  optimisticUpdateResource,
  optimisticRemoveResource,
} from "../lib/optimistic";

// The UI carries ids as plain strings (from the views); the generated mutation
// args brand them as Id<...>. The values are identical at runtime, so bridge
// the boundary here.
const asId = (id: string) => id as Id<"combatants">;
const asDieId = (id: string) => id as Id<"dice">;
const asEffectId = (id: string) => id as Id<"effects">;
const asRecipeId = (id: string) => id as Id<"recipes">;
const asResourceId = (id: string) => id as Id<"resources">;

/** Brand a RecipeDraft's plain-string resourceId for the mutation boundary. */
const brandRecipe = (recipe: RecipeDraft) => ({
  ...recipe,
  resourceId:
    recipe.resourceId === undefined ? undefined : asResourceId(recipe.resourceId),
});

/** DM view: full state + controls. Granted by the secret token in the URL. */
export function Backstage() {
  const { playerToken = "", dmToken = "" } = useParams();
  const t = useT();
  // State is split into three independent subscriptions (concurrency): dice
  // claims / note edits no longer re-run the combatant projection. Combined
  // back into the GameState shape GameBoard expects. getGameState is kept on
  // the backend as the test entry point; the frontend uses the granular ones.
  const meta = useQuery(api.games.getGameMeta, { playerToken, dmToken }) as
    | Omit<GameState, "dice" | "combatants">
    | undefined;
  const dice = useQuery(api.games.getDice, { playerToken }) as
    | GameState["dice"]
    | undefined;
  const combatants = useQuery(api.games.getCombatants, { playerToken, dmToken }) as
    | GameState["combatants"]
    | undefined;
  const drafts = useQuery(api.battleDrafts.getDrafts, { playerToken, dmToken }) as
    | BattleDraftView[]
    | undefined;
  const state: GameState | undefined =
    meta === undefined || dice === undefined || combatants === undefined
      ? undefined
      : { ...meta, dice, combatants };
  const log = useQuery(api.combatLog.getCombatLog, { playerToken, dmToken }) as
    | CombatLogEntry[]
    | undefined;
  // Global character cards (issue #9): own subscription so card churn doesn't
  // re-render through getGameState.
  const characters = useQuery(api.characters.list, { playerToken }) as
    | CharacterView[]
    | undefined;
  // Enemy database (issue #6): DM-gated on the backend; Backstage-only.
  const enemies = useQuery(api.enemies.list, { playerToken, dmToken }) as
    | EnemyView[]
    | undefined;

  const setNote = useMutation(api.games.setNote);
  const seedCharacters = useMutation(api.characters.seedAll);
  const joinBattle = useMutation(api.characters.joinBattle);
  const incrementCounter = useMutation(api.games.incrementCounter);
  const setDmNote = useMutation(api.games.setDmNote);
  const addCombatant = useMutation(api.combatants.add);
  const updateCombatant = useMutation(api.combatants.update);
  const setColor = useMutation(api.combatants.setColor);
  const setAlive = useMutation(api.combatants.setAlive);
  const removeCombatant = useMutation(api.combatants.remove);
  const advanceTurn = useMutation(api.combatants.advanceTurn);
  const resetActionEconomy = useMutation(api.combatants.resetActionEconomy);
  const rollInitiative = useMutation(api.combatants.rollInitiative);
  const batchRoll = useMutation(api.dice.batchRoll);
  const startBatchRun = useMutation(api.batch.startBatchRun);
  const advanceBatchTurn = useMutation(api.batch.advanceBatchTurn);
  const endBatchRun = useMutation(api.batch.endBatchRun);
  const setDieClaim = useMutation(api.dice.setDieClaim);
  const rerollDie = useMutation(api.dice.rerollDie);
  const setDieValue = useMutation(api.dice.setDieValue);
  const confirm = useMutation(api.combatLog.confirm);
  const patchBattleDraft = useMutation(api.battleDrafts.patch);
  const selectNormalBattleActor = useMutation(api.battleDrafts.selectNormalActor);
  const applyCondition = useMutation(api.effects.applyCondition);
  const addCustomModifier = useMutation(api.effects.addCustomModifier);
  const toggleEffect = useMutation(api.effects.toggleEffect);
  const removeEffect = useMutation(api.effects.removeEffect);
  const addRecipe = useMutation(api.recipes.add).withOptimisticUpdate(
    (localStore, args) =>
      optimisticAddRecipe(localStore, { combatantId: args.combatantId }, args.recipe),
  );
  const updateRecipe = useMutation(api.recipes.update).withOptimisticUpdate(
    (localStore, args) =>
      optimisticUpdateRecipe(localStore, args.recipeId, args.patch),
  );
  const removeRecipe = useMutation(api.recipes.remove).withOptimisticUpdate(
    (localStore, args) => optimisticRemoveRecipe(localStore, args.recipeId),
  );
  const addResource = useMutation(api.resources.add).withOptimisticUpdate(
    (localStore, args) =>
      optimisticAddResource(
        localStore,
        { combatantId: args.combatantId },
        args.label,
        args.max,
        args.current,
      ),
  );
  const updateResource = useMutation(api.resources.update).withOptimisticUpdate(
    (localStore, args) =>
      optimisticUpdateResource(
        localStore,
        args.resourceId,
        args.label,
        args.current,
        args.max,
        args.icon,
        args.color,
      ),
  );
  const removeResource = useMutation(api.resources.remove).withOptimisticUpdate(
    (localStore, args) => optimisticRemoveResource(localStore, args.resourceId),
  );
  // Issue #9 step 4 — character-owned sheet edits from the card window. The
  // update/remove hooks are reused (owner-agnostic, keyed by row id); only Add
  // needs its own optimistic layer keyed on `characterId`.
  const updateCharacter = useMutation(api.characters.update);
  const removeCharacter = useMutation(api.characters.remove);
  const createCharacter = useMutation(api.characters.create);
  const importCards = useMutation(api.characters.importCards);
  // Portrait medallion upload (codex-folio-card-ui): mirrors the map-piece
  // upload flow (generateUploadUrl → PUT the file → point the row at the
  // resulting blob) — see MapBoard's `uploadFile` helper for the precedent.
  const generatePortraitUploadUrl = useMutation(api.characters.generateUploadUrl);
  const setCharacterPortrait = useMutation(api.characters.setCharacterPortrait);
  const seedEnemies = useMutation(api.enemies.seedAll);
  const backfillEnemyZh = useMutation(api.enemies.backfillZhNames);
  const spawnEnemy = useMutation(api.enemies.spawn);
  const createEnemy = useMutation(api.enemies.create);
  const updateEnemy = useMutation(api.enemies.update);
  const removeEnemy = useMutation(api.enemies.remove);
  const addCharacterRecipe = useMutation(api.recipes.add).withOptimisticUpdate(
    (localStore, args) =>
      optimisticAddRecipe(localStore, { characterId: args.characterId }, args.recipe),
  );
  const addCharacterResource = useMutation(api.resources.add).withOptimisticUpdate(
    (localStore, args) =>
      optimisticAddResource(
        localStore,
        { characterId: args.characterId },
        args.label,
        args.max,
        args.current,
      ),
  );

  if (state === undefined || log === undefined || drafts === undefined) {
    return <p>Loading…</p>;
  }
  if (state.role !== "dm") {
    return <p>DM token required.</p>;
  }

  const origin = window.location.origin;

  return (
    <BackstageView
      state={state}
      log={log}
      drafts={drafts}
      onSelectNormalBattleActor={(actorId) =>
        selectNormalBattleActor({ playerToken, dmToken, actorId: asId(actorId) })
      }
      onPatchBattleDraft={(scope, actorId, runId, patch) =>
        patchBattleDraft({
          playerToken,
          dmToken,
          scope,
          actorId: asId(actorId),
          runId,
          slotKey: draftSlotKey(scope, actorId, runId),
          patch: brandBattleDraftPatch(patch),
        })
      }
      characters={characters}
      dmToken={dmToken}
      onSeedCharacters={() => seedCharacters({ playerToken })}
      onJoinBattle={(characterId) =>
        joinBattle({ playerToken, characterId: characterId as Id<"characters"> })
      }
      onUpdateCharacter={(characterId, patch) =>
        updateCharacter({
          playerToken,
          characterId: characterId as Id<"characters">,
          patch,
        })
      }
      onDeleteCharacter={async (characterId) => {
        await removeCharacter({ playerToken, characterId: characterId as Id<"characters"> });
      }}
      onCreateCharacter={async (fields) =>
        (await createCharacter({
          playerToken,
          fields: (fields ?? blankCardFields(t)) as Parameters<typeof createCharacter>[0]["fields"],
        })) as string
      }
      onImportCards={async (envelope) => {
        await importCards({ playerToken, envelope });
      }}
      onUploadPortrait={async (characterId, file) => {
        const url = await generatePortraitUploadUrl({ playerToken });
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type },
          body: file,
        });
        const { storageId } = (await res.json()) as { storageId: Id<"_storage"> };
        await setCharacterPortrait({
          playerToken,
          characterId: characterId as Id<"characters">,
          portraitStorageId: storageId,
        });
      }}
      onAddCharacterResource={(characterId, label, max, current) =>
        addCharacterResource({
          playerToken,
          characterId: characterId as Id<"characters">,
          label,
          max,
          current,
        })
      }
      onUpdateCharacterResource={(resourceId, patch) =>
        updateResource({ playerToken, resourceId: asResourceId(resourceId), ...patch })
      }
      onRemoveCharacterResource={(resourceId) =>
        removeResource({ playerToken, resourceId: asResourceId(resourceId) })
      }
      onAddCharacterRecipe={(characterId, recipe) =>
        addCharacterRecipe({
          playerToken,
          characterId: characterId as Id<"characters">,
          recipe: brandRecipe(recipe),
        })
      }
      onUpdateCharacterRecipe={(recipeId, recipe) =>
        updateRecipe({ playerToken, recipeId: asRecipeId(recipeId), patch: brandRecipe(recipe) })
      }
      onRemoveCharacterRecipe={(recipeId) =>
        removeRecipe({ playerToken, recipeId: asRecipeId(recipeId) })
      }
      enemyDbPanel={
        <EnemyDbPanel
          enemies={enemies}
          onSeed={() => seedEnemies({ playerToken, dmToken })}
          onBackfill={() => backfillEnemyZh({ playerToken, dmToken })}
          onSpawn={(enemyId, name) =>
            spawnEnemy({ playerToken, dmToken, enemyId: enemyId as Id<"enemies">, name })
          }
          onCreate={(fields) => createEnemy({ playerToken, dmToken, fields })}
          onUpdate={(enemyId, fields) =>
            updateEnemy({
              playerToken,
              dmToken,
              enemyId: enemyId as Id<"enemies">,
              fields,
            })
          }
          onRemove={(enemyId) =>
            removeEnemy({ playerToken, dmToken, enemyId: enemyId as Id<"enemies"> })
          }
        />
      }
      dmUrls={{
        playerUrl: `${origin}/play/${playerToken}`,
        dmUrl: `${origin}/dm/${playerToken}/${dmToken}`,
      }}
      onSetNote={(note) => setNote({ playerToken, note })}
      onIncrement={() => incrementCounter({ playerToken })}
      onAdvance={() => advanceTurn({ playerToken })}
      onSetDmNote={(dmNote) => setDmNote({ playerToken, dmToken, dmNote })}
      onAddCombatant={(c: NewCombatant) =>
        addCombatant({ playerToken, ...c })
      }
      onPatch={(id, patch: CombatantPatch) =>
        // Color overrides route through setColor; everything else through update.
        patch.color !== undefined
          ? setColor({ playerToken, combatantId: asId(id), color: patch.color })
          : updateCombatant({ playerToken, combatantId: asId(id), patch })
      }
      onKill={(id) =>
        setAlive({
          playerToken,
          combatantId: asId(id),
          alive: !state.combatants.find((c) => c._id === id)?.alive,
        })
      }
      onRemove={(id) =>
        removeCombatant({ playerToken, combatantId: asId(id) })
      }
      onResetEconomy={() => resetActionEconomy({ playerToken })}
      onRollInitiative={() => rollInitiative({ playerToken })}
      onBatchRoll={(types?: DieType[]) => batchRoll({ playerToken, types })}
      onStartBatchRun={(combatantIds) =>
        startBatchRun({ playerToken, combatantIds: combatantIds.map(asId) })
      }
      onAdvanceBatchTurn={() => advanceBatchTurn({ playerToken })}
      onEndBatchRun={() => endBatchRun({ playerToken })}
      onSetClaim={(dieId, claimedBy) =>
        setDieClaim({
          playerToken,
          dieId: asDieId(dieId),
          claimedBy: claimedBy === null ? null : asId(claimedBy),
        })
      }
      onReroll={(dieId) => rerollDie({ playerToken, dieId: asDieId(dieId) })}
      onSetValue={(dieId, value) =>
        setDieValue({ playerToken, dieId: asDieId(dieId), value })
      }
      onConfirm={(
        actingCombatantId,
        effectText,
        effects: ConfirmEffect[],
      ) =>
        confirm({
          playerToken,
          actingCombatantId: actingCombatantId === null ? undefined : asId(actingCombatantId),
          effectText,
          effects: effects.map((e) => ({ combatantId: asId(e.combatantId), hpDelta: e.hpDelta })),
        })
      }
      onApplyCondition={(combatantId, conditionKey) =>
        applyCondition({ playerToken, combatantId: asId(combatantId), conditionKey })
      }
      onAddCustom={(combatantId, label, specs: ModifierSpec[]) =>
        addCustomModifier({ playerToken, combatantId: asId(combatantId), label, specs })
      }
      onToggleEffect={(effectId, active) =>
        toggleEffect({ playerToken, effectId: asEffectId(effectId), active })
      }
      onRemoveEffect={(effectId) =>
        removeEffect({ playerToken, effectId: asEffectId(effectId) })
      }
      onAddRecipe={(combatantId, recipe: RecipeDraft) =>
        addRecipe({ playerToken, combatantId: asId(combatantId), recipe: brandRecipe(recipe) })
      }
      onUpdateRecipe={(recipeId, recipe: RecipeDraft) =>
        updateRecipe({ playerToken, recipeId: asRecipeId(recipeId), patch: brandRecipe(recipe) })
      }
      onRemoveRecipe={(recipeId) =>
        removeRecipe({ playerToken, recipeId: asRecipeId(recipeId) })
      }
      onAddResource={(combatantId, label, max, current) =>
        addResource({ playerToken, combatantId: asId(combatantId), label, max, current })
      }
      onUpdateResource={(resourceId, patch) =>
        updateResource({ playerToken, resourceId: asResourceId(resourceId), ...patch })
      }
      onRemoveResource={(resourceId) =>
        removeResource({ playerToken, resourceId: asResourceId(resourceId) })
      }
      onConfirmRecipe={(payload: RecipeConfirm) =>
        confirm({
          playerToken,
          actingCombatantId: asId(payload.actingCombatantId),
          recipeId: asRecipeId(payload.recipeId),
          attackMod: payload.attackMod,
          damageMod: payload.damageMod,
          damageType: payload.damageType,
          dc: payload.dc,
          actorAdvOverride: payload.actorAdvOverride,
          targets: payload.targets.map((t) => ({
            combatantId: asId(t.combatantId),
            saveBonus: t.saveBonus,
            forceOutcome: t.forceOutcome,
            forceDamage: t.forceDamage,
            darts: t.darts,
            reactionRecipeId:
              t.reactionRecipeId === undefined ? undefined : asRecipeId(t.reactionRecipeId),
            advOverride: t.advOverride,
            saveMode: t.saveMode,
          })),
          modTargets: payload.modTargets?.map((mt) => ({
            modIndex: mt.modIndex,
            combatantIds: mt.combatantIds.map(asId),
          })),
          effectText: payload.effectText,
          spendResources: payload.spendResources.map((s) => ({
            resourceId: asResourceId(s.resourceId),
            amount: s.amount,
          })),
        })
      }
    />
  );
}
