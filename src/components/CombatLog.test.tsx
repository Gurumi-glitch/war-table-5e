import { test, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CombatLog } from "./CombatLog";
import type { CombatLogEntry } from "../../convex/combatLog";

/**
 * Backward compatibility (structured-combat-log spec): legacy rows (no
 * `event`) render their server-composed rollSummary verbatim; new rows render
 * the structured event in the viewer's locale (default zh-TW). Both coexist.
 */

const legacy: CombatLogEntry = {
  _id: "l1",
  _creationTime: 1,
  gameId: "g1",
  round: 1,
  actingCombatantId: null,
  actingName: "Hero",
  rollSummary: "Longsword · Goblin: HIT 9 [legacy string]",
  effectText: "old style",
  effects: [{ combatantId: "c1", name: "Goblin", hpDelta: -9 }],
};

const structured: CombatLogEntry = {
  _id: "l2",
  _creationTime: 2,
  gameId: "g1",
  round: 2,
  actingCombatantId: null,
  actingName: "Hero",
  rollSummary: "Longsword · Goblin: HIT 9 slashing (server string)",
  effectText: "",
  effects: [{ combatantId: "c1", name: "Goblin", hpDelta: -9 }],
  event: {
    kind: "attack",
    recipeName: "Longsword",
    targets: [{ name: "Goblin", hit: true, damage: 9, damageType: "slashing" }],
  },
};

test("legacy rows show rollSummary; event rows render localized (zh-TW default)", () => {
  render(<CombatLog entries={[structured, legacy]} />);
  const rows = screen.getAllByTestId("log entry");
  // Structured row: rendered from the event — zh damage type, not the server string.
  expect(rows[0]).toHaveTextContent("Longsword · Goblin: HIT 9 揮砍");
  expect(rows[0]).not.toHaveTextContent("server string");
  // Legacy row: the stored string verbatim.
  expect(rows[1]).toHaveTextContent("Longsword · Goblin: HIT 9 [legacy string]");
});
