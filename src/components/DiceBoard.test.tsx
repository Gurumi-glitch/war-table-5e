import { test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DiceBoard } from "./DiceBoard";
import type { CombatantView, DiceView } from "../../convex/games";

function makeCombatant(overrides: Partial<CombatantView>): CombatantView {
  return {
    _id: "c1",
    _creationTime: 0,
    gameId: "g1",
    characterId: null,
    name: "Hero",
    kind: "pc",
    color: "#ef4444",
    hp: 20,
    maxHp: 20,
    ac: 16,
    initiative: 18,
    notes: "",
    alive: true,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
    order: 0,
    effects: [],
    effectiveAc: { base: 16, bonus: 0, override: null, value: 16 },
    saves: null,
    resist: [],
    vuln: [],
    immune: [],
    conditionImmune: [],
    recipes: [],
    resources: [],
    ...overrides,
  };
}

const combatants: CombatantView[] = [
  {
    _id: "c1",
    _creationTime: 0,
    gameId: "g1",
    characterId: null,
    name: "Hero",
    kind: "pc",
    color: "#ef4444",
    hp: 20,
    maxHp: 20,
    ac: 16,
    initiative: 18,
    notes: "",
    alive: true,
    actionUsed: false,
    bonusUsed: false,
    reactionUsed: false,
    order: 0,
    effects: [],
    effectiveAc: { base: 16, bonus: 0, override: null, value: 16 },
    saves: null,
    resist: [],
    vuln: [],
    immune: [],
    conditionImmune: [],
    recipes: [],
    resources: [],
  },
];

function renderSingleD20(
  onSetValue: (dieId: string, value: number) => void,
) {
  const dice: DiceView[] = [
    {
      _id: "d1",
      _creationTime: 0,
      gameId: "g1",
      type: "d20",
      value: 14,
      order: 0,
      claimedBy: null,
    },
  ];
  return render(
    <DiceBoard
      dice={dice}
      combatants={combatants}
      onBatchRoll={() => {}}
      onSetClaim={() => {}}
      onReroll={() => {}}
      onSetValue={onSetValue}
    />,
  );
}

/** Pure-component smoke: the board renders die values and a claim toggle. */
test("DiceBoard renders die values and claims a die in the active combatant's color", () => {
  const dice: DiceView[] = [
    {
      _id: "d1",
      _creationTime: 0,
      gameId: "g1",
      type: "d20",
      value: 14,
      order: 0,
      claimedBy: null,
    },
    {
      _id: "d2",
      _creationTime: 0,
      gameId: "g1",
      type: "d6",
      value: 4,
      order: 0,
      claimedBy: "c1",
    },
  ];

  const claims: Array<{ dieId: string; claimedBy: string | null }> = [];
  render(
    <DiceBoard
      dice={dice}
      combatants={combatants}
      onBatchRoll={() => {}}
      onSetClaim={(dieId, claimedBy) => claims.push({ dieId, claimedBy })}
      onReroll={() => {}}
      onSetValue={() => {}}
    />,
  );

  // Values render (labels are unique per die: `${type} #${order+1}`).
  expect(screen.getByLabelText("d20 #1 value")).toHaveValue(14);
  expect(screen.getByLabelText("d6 #1 value")).toHaveValue(4);

  // Clicking the unclaimed d20's claim toggle claims it for the active combatant.
  fireEvent.click(screen.getByLabelText("claim d20 #1"));
  expect(claims).toEqual([{ dieId: "d1", claimedBy: "c1" }]);

  // The already-claimed d6 names its owner in text, not just by its color dot.
  const claimedD6 = screen.getByLabelText("claim d6 #1 — claimed by Hero");
  // Default locale zh-TW: the claim tooltip is localized.
  expect(claimedD6).toHaveAttribute("title", "認領 / 釋放 — Hero 已認領");
  fireEvent.click(claimedD6);
  expect(claims[1]).toEqual({ dieId: "d2", claimedBy: null });
});

test("Case 1 Extend: 'Claiming for' resets when resetSignal changes, instead of silently lingering on the previous actor", () => {
  const twoCombatants = [
    makeCombatant({ _id: "c1", name: "Hero" }),
    makeCombatant({ _id: "c2", name: "Goblin", color: "#3a7" }),
  ];
  const dice: DiceView[] = [
    { _id: "d1", _creationTime: 0, gameId: "g1", type: "d20", value: 14, order: 0, claimedBy: null },
  ];
  const claims: Array<{ dieId: string; claimedBy: string | null }> = [];
  const { rerender } = render(
    <DiceBoard
      dice={dice}
      combatants={twoCombatants}
      onBatchRoll={() => {}}
      onSetClaim={(dieId, claimedBy) => claims.push({ dieId, claimedBy })}
      onReroll={() => {}}
      onSetValue={() => {}}
      resetSignal={0}
    />,
  );

  // Pick the Goblin explicitly (simulating "claimed the actor's own dice").
  fireEvent.change(screen.getByLabelText("active claimer"), { target: { value: "c2" } });
  expect(screen.getByLabelText("active claimer")).toHaveValue("c2");

  // A Confirm commits (resetSignal bumps, e.g. the combat log grew) — the
  // selector must NOT silently stay on the Goblin; it resets to unset so the
  // next die claimed requires an explicit, deliberate pick.
  rerender(
    <DiceBoard
      dice={dice}
      combatants={twoCombatants}
      onBatchRoll={() => {}}
      onSetClaim={(dieId, claimedBy) => claims.push({ dieId, claimedBy })}
      onReroll={() => {}}
      onSetValue={() => {}}
      resetSignal={1}
    />,
  );
  expect(screen.getByLabelText("active claimer")).toHaveValue("c1"); // falls back to the first combatant, not the lingering Goblin

  fireEvent.click(screen.getByLabelText("claim d20 #1"));
  expect(claims).toEqual([{ dieId: "d1", claimedBy: "c1" }]);
});

test("issue #18: removing the claimed combatant falls back to the first remaining one instead of showing blank", () => {
  const twoCombatants = [
    makeCombatant({ _id: "c1", name: "Hero" }),
    makeCombatant({ _id: "c2", name: "Goblin", color: "#3a7" }),
  ];
  const dice: DiceView[] = [
    { _id: "d1", _creationTime: 0, gameId: "g1", type: "d20", value: 14, order: 0, claimedBy: null },
  ];
  const claims: Array<{ dieId: string; claimedBy: string | null }> = [];
  const { rerender } = render(
    <DiceBoard
      dice={dice}
      combatants={twoCombatants}
      onBatchRoll={() => {}}
      onSetClaim={(dieId, claimedBy) => claims.push({ dieId, claimedBy })}
      onReroll={() => {}}
      onSetValue={() => {}}
    />,
  );

  // Pick the Goblin explicitly, then have it removed from the game.
  fireEvent.change(screen.getByLabelText("active claimer"), { target: { value: "c2" } });
  expect(screen.getByLabelText("active claimer")).toHaveValue("c2");

  rerender(
    <DiceBoard
      dice={dice}
      combatants={[twoCombatants[0]]}
      onBatchRoll={() => {}}
      onSetClaim={(dieId, claimedBy) => claims.push({ dieId, claimedBy })}
      onReroll={() => {}}
      onSetValue={() => {}}
    />,
  );

  // Falls back to the remaining combatant, not blank.
  expect(screen.getByLabelText("active claimer")).toHaveValue("c1");
  fireEvent.click(screen.getByLabelText("claim d20 #1"));
  expect(claims).toEqual([{ dieId: "d1", claimedBy: "c1" }]);
});

test("clearing a die value does not commit zero while the user is editing", () => {
  const values: Array<{ dieId: string; value: number }> = [];
  renderSingleD20((dieId, value) => values.push({ dieId, value }));

  fireEvent.change(screen.getByLabelText("d20 #1 value"), {
    target: { value: "" },
  });

  expect(values).toEqual([]);
});

test("typing a valid die value still commits immediately", () => {
  const values: Array<{ dieId: string; value: number }> = [];
  renderSingleD20((dieId, value) => values.push({ dieId, value }));

  fireEvent.change(screen.getByLabelText("d20 #1 value"), {
    target: { value: "9" },
  });

  expect(values).toEqual([{ dieId: "d1", value: 9 }]);
});
