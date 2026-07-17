import { test, expect } from "vitest";
import { newTestClient } from "./testHelper";
import { create, getGameState } from "../convex/games";
import { add as addCombatant } from "../convex/combatants";
import { add as addResource, update as updateResource } from "../convex/resources";

/**
 * Backend-seam tests for the resource-pips icon/color override fields
 * (resource-pips-build-plan Step 1). Both fields are optional and additive;
 * `update`'s `color` follows the codebase's null-clears/undefined-untouched
 * convention (see `combatLog.ts`'s `claimedBy` reset).
 */

async function setup() {
  const t = newTestClient();
  const { playerToken } = await t.mutation(create, {});
  const hero = await t.mutation(addCombatant, {
    playerToken, name: "Hero", kind: "pc", maxHp: 30, ac: 16, initiative: 10, notes: "",
  });
  return { t, playerToken, hero };
}

test("add without icon/color leaves both undefined (plain square, combatant color)", async () => {
  const { t, playerToken, hero } = await setup();
  await t.mutation(addResource, { playerToken, combatantId: hero, label: "Ki", max: 3 });
  const state = await t.query(getGameState, { playerToken });
  const resource = state.combatants.find((c: any) => c.name === "Hero")!.resources[0];
  expect(resource.icon).toBeUndefined();
  expect(resource.color).toBeUndefined();
});

test("add accepts icon/color; update patches only the provided field", async () => {
  const { t, playerToken, hero } = await setup();
  const id = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "Rage", max: 2, icon: "skull", color: "#a32638",
  });
  let state = await t.query(getGameState, { playerToken });
  let resource = state.combatants.find((c: any) => c.name === "Hero")!.resources[0];
  expect(resource.icon).toBe("skull");
  expect(resource.color).toBe("#a32638");

  // Update icon only — color untouched.
  await t.mutation(updateResource, { playerToken, resourceId: id, icon: "flame" });
  state = await t.query(getGameState, { playerToken });
  resource = state.combatants.find((c: any) => c.name === "Hero")!.resources[0];
  expect(resource.icon).toBe("flame");
  expect(resource.color).toBe("#a32638"); // unchanged
});

test("update color:null clears the override back to the combatant default; icon:null is not accepted", async () => {
  const { t, playerToken, hero } = await setup();
  const id = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "Sorcery Points", max: 20, icon: "star", color: "#8a6fd1",
  });
  await t.mutation(updateResource, { playerToken, resourceId: id, color: null });
  const state = await t.query(getGameState, { playerToken });
  const resource = state.combatants.find((c: any) => c.name === "Hero")!.resources[0];
  expect(resource.color).toBeUndefined(); // cleared
  expect(resource.icon).toBe("star"); // untouched by the color reset
});

test("omitting icon/color entirely on update leaves an existing override untouched (PATCH semantics)", async () => {
  const { t, playerToken, hero } = await setup();
  const id = await t.mutation(addResource, {
    playerToken, combatantId: hero, label: "Lay on Hands", max: 5, icon: "droplet", color: "#7fae5a",
  });
  await t.mutation(updateResource, { playerToken, resourceId: id, current: 3 });
  const state = await t.query(getGameState, { playerToken });
  const resource = state.combatants.find((c: any) => c.name === "Hero")!.resources[0];
  expect(resource.current).toBe(3);
  expect(resource.icon).toBe("droplet");
  expect(resource.color).toBe("#7fae5a");
});
