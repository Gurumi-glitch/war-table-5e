import { test, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EnemyEditorWindow } from "./EnemyEditorWindow";
import type { CombatantPatch } from "./CombatantRow";
import type { CombatantView } from "../../convex/games";

const enemy: CombatantView = {
  _id: "e1",
  _creationTime: 0,
  gameId: "g1",
  characterId: null,
  name: "Goblin",
  kind: "enemy",
  color: "#22c55e",
  hp: 7,
  maxHp: 7,
  ac: 15,
  initiative: 12,
  notes: "",
  alive: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  order: 0,
  effects: [],
  effectiveAc: { base: 15, bonus: 0, override: null, value: 15 },
  saves: null,
  resist: [],
  vuln: [],
  immune: [],
  conditionImmune: [],
  recipes: [],
  resources: [],
};

test("saving a blank enemy number omits it instead of silently committing zero", () => {
  const patches: CombatantPatch[] = [];
  render(
    <EnemyEditorWindow
      combatant={enemy}
      onPatch={(patch) => patches.push(patch)}
    />,
  );

  fireEvent.change(screen.getByLabelText("hp"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("notes"), {
    target: { value: "retreating" },
  });
  fireEvent.click(screen.getByLabelText("save"));

  expect(patches).toEqual([{ notes: "retreating" }]);
});

test("saving a valid enemy number still commits its numeric value", () => {
  const patches: CombatantPatch[] = [];
  render(
    <EnemyEditorWindow
      combatant={enemy}
      onPatch={(patch) => patches.push(patch)}
    />,
  );

  fireEvent.change(screen.getByLabelText("initiative"), {
    target: { value: "19" },
  });
  fireEvent.click(screen.getByLabelText("save"));

  expect(patches).toEqual([{ initiative: 19 }]);
});
