import { test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { CombatantRow, type CombatantPatch } from "./CombatantRow";
import type { CombatantView } from "../../convex/games";

const base: CombatantView = {
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
};

/** Editing typeable fields does NOT mutate per keystroke; Save batches them. */
test("row holds edits in a draft and commits HP + Notes on one Save click", () => {
  const patches: CombatantPatch[] = [];
  render(
    <CombatantRow
      combatant={base}
      isCurrentTurn={false}
      editable
      onPatch={(p) => patches.push(p)}
    />,
  );

  const save = screen.getByLabelText("save Hero");
  // Nothing dirty yet → disabled.
  expect(save).toBeDisabled();

  // Type into HP and Notes. No patch fires per keystroke.
  fireEvent.change(screen.getByLabelText("hp Hero"), { target: { value: "14" } });
  fireEvent.change(screen.getByLabelText("notes Hero"), { target: { value: "prone" } });
  expect(patches).toEqual([]);

  // Save is now enabled and commits both fields in one patch.
  expect(save).not.toBeDisabled();
  fireEvent.click(save);
  expect(patches).toEqual([{ hp: 14, notes: "prone" }]);
});

/** A remote change to a field the user isn't editing is adopted into the draft. */
test("row adopts a remote HP change when the user isn't editing it", () => {
  const { rerender } = render(
    <CombatantRow combatant={base} isCurrentTurn={false} editable onPatch={() => {}} />,
  );

  // Remote lowers HP (e.g. a Confirm applied damage). The field reflects it.
  rerender(
    <CombatantRow
      combatant={{ ...base, hp: 7 }}
      isCurrentTurn={false}
      editable
      onPatch={() => {}}
    />,
  );
  expect(screen.getByLabelText("hp Hero")).toHaveValue(7);
});

test("saving a blank numeric draft omits it instead of silently committing zero", () => {
  const patches: CombatantPatch[] = [];
  render(
    <CombatantRow
      combatant={base}
      isCurrentTurn={false}
      editable
      onPatch={(patch) => patches.push(patch)}
    />,
  );

  fireEvent.change(screen.getByLabelText("hp Hero"), {
    target: { value: "" },
  });
  fireEvent.change(screen.getByLabelText("notes Hero"), {
    target: { value: "still standing" },
  });
  fireEvent.click(screen.getByLabelText("save Hero"));

  expect(patches).toEqual([{ notes: "still standing" }]);
});
