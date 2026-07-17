import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { EffectsCell } from "./EffectsCell";
import type { CombatantView } from "../../convex/games";

/**
 * The 狀態免疫 warn (non-blocking, ADR-0002): an applied condition the
 * combatant is immune to still works, but the chip and the condition picker
 * flag it so the DM overrides knowingly.
 */

const enemy: CombatantView = {
  _id: "e1",
  _creationTime: 0,
  gameId: "g1",
  name: "Zombie",
  kind: "enemy",
  characterId: null,
  color: "#00ff00",
  hp: 22,
  maxHp: 22,
  ac: 8,
  initiative: 0,
  notes: "",
  alive: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  order: 0,
  effects: [
    {
      _id: "fx1",
      _creationTime: 0,
      combatantId: "e1",
      type: "condition",
      conditionKey: "poisoned",
      label: "Poisoned",
      specs: [],
      active: true,
    },
  ],
  effectiveAc: { base: 8, bonus: 0, override: null, value: 8 },
  saves: null,
  resist: [],
  vuln: [],
  immune: [],
  conditionImmune: ["poisoned"],
  recipes: [],
  resources: [],
};

test("an applied condition the combatant is immune to shows the ⚠ warn", () => {
  // Default locale is zh-TW: the stored English label ("Poisoned") displays
  // through the terms map as 中毒, while aria/remove handles keep the raw label.
  render(<EffectsCell combatant={enemy} editable />);
  expect(screen.getByTitle("中毒（⚠ 免疫）")).toHaveTextContent("⚠中毒");
});

test("the condition picker flags immune conditions but still offers them", () => {
  render(<EffectsCell combatant={enemy} editable />);
  const option = screen.getByRole("option", { name: /中毒（⚠免疫）/ });
  expect(option).not.toBeDisabled();
});

/**
 * Issue #32: the custom-condition editor had no ability selector for save
 * auto-fail (and adv/disadv), so a custom condition couldn't express "auto-fail
 * STR/DEX saves only" the way curated Stunned does. These tests cover the
 * per-ability multi-select, the expand-to-one-spec-per-ability save path, the
 * backward-compatible "no abilities = all saves" fallback, and stale-scope
 * clearing when the row stops being ability-scopable.
 */

const blank: CombatantView = { ...enemy, effects: [] };

/** Stat + mode selects on spec row `i` (0-based). */
const rowSelects = (i = 0) => {
  const stat = screen.getAllByLabelText("row stat")[i] as HTMLSelectElement;
  const mode = screen.getAllByLabelText("row mode")[i] as HTMLSelectElement;
  return { stat, mode };
};

test("auto-fail save mode reveals the per-ability multi-select", () => {
  render(<EffectsCell combatant={blank} editable />);
  // No ability selector while the default row is AC / bonus.
  expect(screen.queryByLabelText("row abilities")).toBeNull();
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "autoFail" } });
  // zh-TW ability abbreviations: 力 敏 體 智 感 魅.
  for (const ab of ["力", "敏", "體", "智", "感", "魅"]) {
    expect(screen.getByLabelText(ab)).toBeDefined();
  }
});

test("checking abilities expands to one ModifierSpec per ability on save", () => {
  const onAddCustom = vi.fn();
  render(<EffectsCell combatant={blank} editable onAddCustom={onAddCustom} />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "autoFail" } });
  fireEvent.click(screen.getByLabelText("力"));
  fireEvent.click(screen.getByLabelText("敏"));
  fireEvent.click(screen.getByText("新增效果"));
  expect(onAddCustom).toHaveBeenCalledOnce();
  const [, label, specs] = onAddCustom.mock.calls[0];
  // One spec per checked ability, each carrying its `ability` (Stunned shape).
  expect(specs).toEqual([
    { stat: "save", mode: "autoFail", value: 0, ability: "力量" },
    { stat: "save", mode: "autoFail", value: 0, ability: "敏捷" },
  ]);
  // Default label reflects the scope, fully localized (zh-TW prefix + abbrevs + stat).
  expect(label).toBe("自動失敗: 力/敏 豁免");
});

test("auto-fail save with no abilities checked stays a single generic spec", () => {
  const onAddCustom = vi.fn();
  render(<EffectsCell combatant={blank} editable onAddCustom={onAddCustom} />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "autoFail" } });
  fireEvent.click(screen.getByText("新增效果"));
  const [, , specs] = onAddCustom.mock.calls[0];
  // Generic spec — no `ability` — means "all saves auto-fail" (backward compat).
  expect(specs).toEqual([{ stat: "save", mode: "autoFail", value: 0 }]);
});

test("save disadvantage also exposes the ability selector (Restrained-shape)", () => {
  render(<EffectsCell combatant={blank} editable />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "disadvantage" } });
  expect(screen.getByLabelText("row abilities")).toBeDefined();
});

test("save bonus is ability-scopable and keeps its value through the expand", () => {
  const onAddCustom = vi.fn();
  render(<EffectsCell combatant={blank} editable onAddCustom={onAddCustom} />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "bonus" } });
  expect(screen.getByLabelText("row abilities")).toBeDefined();
  fireEvent.change(screen.getByLabelText("row value"), { target: { value: "2" } });
  fireEvent.click(screen.getByLabelText("力"));
  fireEvent.click(screen.getByText("新增效果"));
  const [, label, specs] = onAddCustom.mock.calls[0];
  // The per-ability expand must carry `value` — a scoped +2 STR save is not a 0.
  expect(specs).toEqual([{ stat: "save", mode: "bonus", value: 2, ability: "力量" }]);
  expect(label).toBe("+2 力 豁免");
});

test("save override is ability-scopable and keeps its value", () => {
  const onAddCustom = vi.fn();
  render(<EffectsCell combatant={blank} editable onAddCustom={onAddCustom} />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "override" } });
  fireEvent.change(screen.getByLabelText("row value"), { target: { value: "5" } });
  fireEvent.click(screen.getByLabelText("體" ));
  fireEvent.click(screen.getByText("新增效果"));
  const [, label, specs] = onAddCustom.mock.calls[0];
  expect(specs).toEqual([{ stat: "save", mode: "override", value: 5, ability: "體質" }]);
  expect(label).toBe("體 豁免 = 5");
});

test("ability-check bonus is scopable but auto-fail is not (save-only mechanic)", () => {
  render(<EffectsCell combatant={blank} editable />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "abilityCheck" } });
  fireEvent.change(mode, { target: { value: "bonus" } });
  expect(screen.getByLabelText("row abilities")).toBeDefined();
  fireEvent.change(mode, { target: { value: "autoFail" } });
  expect(screen.queryByLabelText("row abilities")).toBeNull();
});

test("attack stays unscoped — the engine never passes an ability for it", () => {
  render(<EffectsCell combatant={blank} editable />);
  const { stat, mode } = rowSelects();
  for (const s of ["attack", "attackAgainst"]) {
    fireEvent.change(stat, { target: { value: s } });
    for (const m of ["bonus", "advantage", "disadvantage"]) {
      fireEvent.change(mode, { target: { value: m } });
      expect(screen.queryByLabelText("row abilities")).toBeNull();
    }
  }
});

test("changing stat away from save clears a stale ability scope", () => {
  const onAddCustom = vi.fn();
  render(<EffectsCell combatant={blank} editable onAddCustom={onAddCustom} />);
  const { stat, mode } = rowSelects();
  fireEvent.change(stat, { target: { value: "save" } });
  fireEvent.change(mode, { target: { value: "autoFail" } });
  fireEvent.click(screen.getByLabelText("力"));
  // Back to AC — the selector disappears and the saved spec has no ability.
  fireEvent.change(stat, { target: { value: "ac" } });
  expect(screen.queryByLabelText("row abilities")).toBeNull();
  fireEvent.change(mode, { target: { value: "bonus" } });
  fireEvent.click(screen.getByText("新增效果"));
  const [, , specs] = onAddCustom.mock.calls[0];
  expect(specs).toEqual([{ stat: "ac", mode: "bonus", value: 1 }]);
});
