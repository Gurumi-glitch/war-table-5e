import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BatchBattlePanel } from "./BatchBattlePanel";
import type { CombatantView } from "../../convex/games";
import type { RecipeView } from "../../convex/recipes";

/**
 * The active-run view gives every run member their own actor-bound Confirm
 * session (no shared Acting dropdown to re-drive per turn) — the point of the
 * Batch battle UX rework. The backend seam (convex-tests/batch.test.ts) covers
 * run mechanics; this pins the per-member sessions.
 */

function makeCombatant(id: string, name: string, initiative: number): CombatantView {
  return {
    _id: id,
    _creationTime: 0,
    gameId: "g1",
    characterId: null,
    name,
    kind: "pc",
    color: "#ef4444",
    hp: 10,
    maxHp: 10,
    ac: 13,
    initiative,
    notes: "",
    alive: true,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
    order: 0,
    effects: [],
    effectiveAc: { base: 13, bonus: 0, override: null, value: 13 },
    saves: null,
    resist: [],
    vuln: [],
    immune: [],
    conditionImmune: [],
    recipes: [],
    resources: [],
  } as CombatantView;
}

test("active run renders one actor-bound Confirm session per run member", () => {
  const combatants = [makeCombatant("c1", "Alice", 18), makeCombatant("c2", "Bob", 12)];
  const onConfirm = vi.fn();
  const noop = () => {};

  render(
    <BatchBattlePanel
      batchRun={{ turnIds: ["c1", "c2"], turnIndex: 0 }}
      combatants={combatants}
      dice={[]}
      onConfirm={onConfirm}
      onConfirmRecipe={noop}
      onSetClaim={noop}
    />,
  );

  // One Confirm session per member (both manual mode — no recipes).
  const confirms = screen.getAllByRole("button", { name: "確認" });
  expect(confirms).toHaveLength(2);

  // The actor is bound per session — no Acting dropdown anywhere in the panel.
  expect(screen.queryByLabelText("acting combatant")).not.toBeInTheDocument();

  // Current runner is marked in its queue summary.
  expect(screen.getByText(/下一個確認/, { selector: "summary" })).toHaveTextContent("Alice");

  // Confirming from Bob's session acts as Bob, without any dropdown driving.
  fireEvent.click(confirms[1]);
  expect(onConfirm).toHaveBeenCalledWith("c2", "", []);
});

test("chained previews: a later session's heal preview assumes the earlier pending damage", () => {
  // Alice's automatic-damage recipe (no dice needed → damageMod only) targets
  // Bob; Bob's heal recipe targets himself. Bob is at FULL HP, so without
  // chaining his heal previews +0 — with chaining it previews +3.
  const smite = {
    _id: "r-smite", _creationTime: 0, combatantId: "c1", name: "Smite",
    hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 5,
    damageType: "force", dc: 0, saveAbility: "", critImmune: true,
    resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [], extraRolls: [],
  } as RecipeView;
  const heal = {
    ...smite, _id: "r-heal", combatantId: "c2", name: "Healing Word",
    damageMod: 3, damageType: "healing",
  } as RecipeView;
  const alice = { ...makeCombatant("c1", "Alice", 18), recipes: [smite] };
  const bob = { ...makeCombatant("c2", "Bob", 12), recipes: [heal] };
  const onConfirmRecipe = vi.fn();
  const noop = () => {};

  render(
    <BatchBattlePanel
      batchRun={{ turnIds: ["c1", "c2"], turnIndex: 0 }}
      combatants={[alice, bob]}
      dice={[]}
      onConfirm={noop}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={noop}
    />,
  );

  // Session order = queue order: [0] Alice, [1] Bob.
  const recipeSelects = screen.getAllByLabelText("recipe");
  fireEvent.change(recipeSelects[0], { target: { value: "r-smite" } });
  fireEvent.change(recipeSelects[1], { target: { value: "r-heal" } });
  const targetSelects = screen.getAllByLabelText("target 1");
  fireEvent.change(targetSelects[0], { target: { value: "c2" } }); // Alice → Bob
  fireEvent.change(targetSelects[1], { target: { value: "c2" } }); // Bob → self

  // Alice previews 5 force on Bob; Bob's heal previews against 10-5=5 HP.
  expect(screen.getByText(/Bob: 5 force/)).toBeInTheDocument();
  expect(screen.getByText(/Bob: \+3/)).toBeInTheDocument();
  expect(screen.getByText(/假設前面未結算的回合落地/)).toBeInTheDocument();

  // Once Alice confirms, her prediction clears — Bob (full HP on the still-
  // static test state) previews +0 again.
  const confirms = screen.getAllByRole("button", { name: "確認招式" });
  fireEvent.click(confirms[0]);
  expect(onConfirmRecipe).toHaveBeenCalledTimes(1);
  expect(screen.getByText(/Bob: \+0/)).toBeInTheDocument();
});

test("no active run renders the start form", () => {
  const combatants = [makeCombatant("c1", "Alice", 18)];
  const noop = () => {};

  render(
    <BatchBattlePanel
      batchRun={null}
      combatants={combatants}
      dice={[]}
      onConfirm={noop}
      onConfirmRecipe={noop}
      onSetClaim={noop}
    />,
  );

  expect(
    screen.getByRole("button", { name: "Start run (fresh Batch roll)" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "確認" })).not.toBeInTheDocument();
});
