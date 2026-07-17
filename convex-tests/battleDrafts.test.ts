import { expect, test } from "vitest";
import { newTestClient } from "./testHelper";
import { create, getGameState } from "../convex/games";
import { add as addCombatant } from "../convex/combatants";
import { endBatchRun, startBatchRun } from "../convex/batch";
import { getDrafts, patch, selectNormalActor } from "../convex/battleDrafts";
import { add as addRecipe } from "../convex/recipes";
import { confirm } from "../convex/combatLog";

async function setup() {
  const t = newTestClient();
  const game = await t.mutation(create, {});
  const hero = await t.mutation(addCombatant, {
    playerToken: game.playerToken,
    name: "Hero",
    kind: "pc",
    maxHp: 20,
    ac: 14,
    initiative: 3,
    notes: "",
  });
  const enemy = await t.mutation(addCombatant, {
    playerToken: game.playerToken,
    name: "Secret Enemy",
    kind: "enemy",
    maxHp: 20,
    ac: 14,
    initiative: 2,
    notes: "",
  });
  return { t, ...game, hero, enemy };
}

test("normal Battle draft synchronizes field groups without overwriting other fields", async () => {
  const { t, playerToken, dmToken, hero } = await setup();
  await t.mutation(selectNormalActor, { playerToken, actorId: hero });
  await t.mutation(patch, {
    playerToken,
    slotKey: "normal",
    scope: "normal",
    actorId: hero,
    patch: { effectText: "reckless swing" },
  });
  await t.mutation(patch, {
    playerToken,
    slotKey: "normal",
    scope: "normal",
    actorId: hero,
    patch: { damageMod: "4" },
  });

  const playerDrafts = await t.query(getDrafts, { playerToken });
  const dmDrafts = await t.query(getDrafts, { playerToken, dmToken });
  expect(playerDrafts[0]).toMatchObject({ actorId: hero, effectText: "reckless swing", damageMod: "4" });
  expect(dmDrafts[0]).toMatchObject({ actorId: hero, effectText: "reckless swing", damageMod: "4" });
});

test("drafts stay isolated by game and reject invalid game tokens", async () => {
  const { t, playerToken, hero } = await setup();
  const other = await t.mutation(create, {});
  await t.mutation(selectNormalActor, { playerToken, actorId: hero });
  expect(await t.query(getDrafts, { playerToken: other.playerToken })).toEqual([]);
  await expect(
    t.mutation(selectNormalActor, { playerToken: "not-a-game", actorId: hero }),
  ).rejects.toThrow(/Game not found/);
  expect(await t.query(getDrafts, { playerToken })).toHaveLength(1);
});

test("a draft cannot select a recipe owned by another combatant", async () => {
  const { t, playerToken, hero, enemy } = await setup();
  const enemyRecipe = await t.mutation(addRecipe, {
    playerToken,
    combatantId: enemy,
    recipe: {
      name: "Secret slash", hitType: "attack", attackMod: 4,
      damageDice: [], damageMod: 0, damageType: "slashing", dc: 0,
      saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
    },
  });
  await t.mutation(selectNormalActor, { playerToken, actorId: hero });
  await expect(
    t.mutation(patch, {
      playerToken, slotKey: "normal", scope: "normal", actorId: hero,
      patch: { recipeId: enemyRecipe },
    }),
  ).rejects.toThrow(/acting combatant/);
});

test("successful Confirm clears its draft while a rejected Confirm keeps it", async () => {
  const { t, playerToken, hero } = await setup();
  await t.mutation(selectNormalActor, { playerToken, actorId: hero });
  await t.mutation(patch, {
    playerToken, slotKey: "normal", scope: "normal", actorId: hero,
    patch: { effectText: "manual result" },
  });
  await t.mutation(confirm, { playerToken, actingCombatantId: hero, effectText: "manual result", effects: [] });
  expect(await t.query(getDrafts, { playerToken })).toEqual([]);

  const recipeId = await t.mutation(addRecipe, {
    playerToken,
    combatantId: hero,
    recipe: {
      name: "Needs target", hitType: "attack", attackMod: 3,
      damageDice: [], damageMod: 0, damageType: "slashing", dc: 0,
      saveAbility: "", critImmune: false, resourceCost: 0, multiTarget: "none",
    },
  });
  await t.mutation(selectNormalActor, { playerToken, actorId: hero });
  await t.mutation(patch, {
    playerToken, slotKey: "normal", scope: "normal", actorId: hero,
    patch: { recipeId },
  });
  await expect(
    t.mutation(confirm, { playerToken, actingCombatantId: hero, recipeId, effectText: "", targets: [] }),
  ).rejects.toThrow(/at least one target/);
  expect(await t.query(getDrafts, { playerToken })).toEqual(
    [expect.objectContaining({ recipeId })],
  );
});

test("changing normal actor atomically clears actor-dependent draft fields", async () => {
  const { t, playerToken, dmToken, hero, enemy } = await setup();
  await t.mutation(selectNormalActor, { playerToken, actorId: hero });
  await t.mutation(patch, {
    playerToken,
    slotKey: "normal",
    scope: "normal",
    actorId: hero,
    patch: { effectText: "old actor", damageMod: "9" },
  });
  await t.mutation(selectNormalActor, { playerToken, actorId: enemy });
  const [draft] = await t.query(getDrafts, { playerToken, dmToken });
  expect(draft).toMatchObject({ actorId: enemy, effectText: "", damageMod: "", recipeId: null });
});

test("player projection keeps an enemy action draft restricted", async () => {
  const { t, playerToken, dmToken, enemy } = await setup();
  await t.mutation(selectNormalActor, { playerToken, actorId: enemy });
  await t.mutation(patch, {
    playerToken,
    slotKey: "normal",
    scope: "normal",
    actorId: enemy,
    patch: { effectText: "DM-only enemy action", damageMod: "99" },
  });
  const [playerDraft] = await t.query(getDrafts, { playerToken });
  const [dmDraft] = await t.query(getDrafts, { playerToken, dmToken });
  expect(playerDraft).toMatchObject({ actorId: enemy, restricted: true });
  expect((playerDraft as any).effectText).toBeUndefined();
  expect(dmDraft).toMatchObject({ effectText: "DM-only enemy action", damageMod: "99" });
});

test("Batch drafts are run-scoped and removed when the run ends", async () => {
  const { t, playerToken, dmToken, hero } = await setup();
  await t.mutation(startBatchRun, { playerToken, combatantIds: [hero] });
  const state = await t.query(getGameState, { playerToken, dmToken });
  const runId = state.batchRun!.runId!;
  await t.mutation(patch, {
    playerToken,
    slotKey: `batch:${runId}:${hero}`,
    scope: "batch",
    actorId: hero,
    runId,
    patch: { effectText: "prepared" },
  });
  expect(await t.query(getDrafts, { playerToken })).toHaveLength(1);
  await t.mutation(endBatchRun, { playerToken });
  expect(await t.query(getDrafts, { playerToken })).toHaveLength(0);
});

test("Batch actors retain separate drafts in the same run", async () => {
  const { t, playerToken, dmToken, hero, enemy } = await setup();
  await t.mutation(startBatchRun, { playerToken, combatantIds: [hero, enemy] });
  const runId = (await t.query(getGameState, { playerToken, dmToken })).batchRun!.runId!;
  for (const [actorId, effectText] of [[hero, "hero prepared"], [enemy, "enemy prepared"]] as const) {
    await t.mutation(patch, {
      playerToken,
      slotKey: `batch:${runId}:${actorId}`,
      scope: "batch",
      actorId,
      runId,
      patch: { effectText },
    });
  }
  expect(await t.query(getDrafts, { playerToken, dmToken })).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ actorId: hero, effectText: "hero prepared" }),
      expect.objectContaining({ actorId: enemy, effectText: "enemy prepared" }),
    ]),
  );
});
