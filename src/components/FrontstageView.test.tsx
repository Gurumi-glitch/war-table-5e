import { test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { FrontstageView } from "./FrontstageView";
import type { GameState } from "../../convex/games";

/**
 * Thin UI smoke test. The backend seam (convex games/combatants/dice/combatLog
 * tests) carries the correctness guarantees — including DM-only field
 * withholding. This just confirms Frontstage renders shared state, the
 * combatant list, and the dice board, with no DM-notes surface for a player.
 */
test("FrontstageView renders shared state, combatants, and dice; no DM-notes surface", () => {
  const state: GameState = {
    role: "player",
    playerToken: "ptok",
    note: "hello world",
    counter: 3,
    dmNote: "",
    round: 1,
    playgroundMode: false,
    currentTurnId: "c1",
    batchRun: null,
    combatants: [
      {
        _id: "c1",
        _creationTime: 0,
        gameId: "g1",
        characterId: null,
        name: "Goblin",
        kind: "enemy",
        color: "#ef4444",
        hp: 5,
        maxHp: 7,
        ac: 13,
        initiative: 12,
        notes: "scimitar",
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
      },
    ],
    dice: [
      {
        _id: "d1",
        _creationTime: 0,
        gameId: "g1",
        type: "d20",
        value: 14,
        order: 0,
        claimedBy: null,
      },
    ],
  };

  const noop = () => {};
  render(
    <FrontstageView
      state={state}
      log={[]}
      characters={[]}
      onSeedCharacters={noop}
      onUpdateCharacter={noop}
      onDeleteCharacter={async () => {}}
      onAddCharacterResource={noop}
      onUpdateCharacterResource={noop}
      onRemoveCharacterResource={noop}
      onAddCharacterRecipe={noop}
      onUpdateCharacterRecipe={noop}
      onRemoveCharacterRecipe={noop}
      onSetNote={noop}
      onIncrement={noop}
      onAdvance={noop}
      onResetEconomy={noop}
      onRollInitiative={noop}
      onAddCombatant={noop}
      onPatch={noop}
      onKill={noop}
      onRemove={noop}
      onBatchRoll={noop}
      onSetClaim={noop}
      onReroll={noop}
      onSetValue={noop}
      onConfirm={noop}
      onConfirmRecipe={noop}
    />,
  );

  // Shared state is visible once the 共用板 window is opened from the top bar.
  fireEvent.click(screen.getByRole("button", { name: /共用板/ }));
  expect(screen.getByTestId("counter")).toHaveTextContent("3");
  expect(screen.getByTestId("note")).toHaveTextContent("hello world");

  // Combatant public stats are visible (in both turn order and the table).
  expect(screen.getAllByText(/Goblin/).length).toBeGreaterThan(0);

  // The dice board renders the d20 value.
  expect(screen.getByLabelText("d20 #1 value")).toHaveValue(14);

  // There is no DM-notes input on Frontstage (player role).
  expect(screen.queryByLabelText("dm notes")).not.toBeInTheDocument();
  expect(screen.queryByText("DM Notes (secret)")).not.toBeInTheDocument();
});
