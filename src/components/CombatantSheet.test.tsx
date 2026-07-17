import { test, expect, vi } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { CombatantSheet } from "./CombatantSheet";
import type { CombatantView } from "../../convex/games";
import type { RecipeDraft } from "../../convex/recipeLibrary";

/**
 * Issue #9 step 3: the recipe ↔ resource linking UI. The "consumes" dropdown
 * lists the owner's pools and Save sends the picked resourceId in the draft —
 * the link is the DEFAULT armed pool the Confirm panel pre-toggles
 * (BG3-style resource arming; the old duplicate-&-relink flow was dropped).
 */

const combatant: CombatantView = {
  _id: "c1",
  _creationTime: 0,
  gameId: "g1",
  characterId: null,
  name: "測試法師",
  kind: "pc",
  color: "#7d5ba6",
  hp: 8,
  maxHp: 8,
  ac: 11,
  initiative: 12,
  notes: "",
  alive: true,
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  order: 0,
  effects: [],
  effectiveAc: { base: 11, bonus: 0, override: null, value: 11 },
  saves: null,
  resist: [],
  vuln: [],
  immune: [],
  conditionImmune: [],
  recipes: [
    {
      _id: "r1",
      _creationTime: 0,
      combatantId: "c1",
      name: "魔法飛彈",
      hitType: "automatic",
      attackMod: 0,
      damageDice: [{ type: "d4", count: 1 }],
      damageMod: 1,
      damageType: "force",
      dc: 0,
      saveAbility: "",
      critImmune: true,
      resourceId: "res1",
      resourceCost: 1,
      multiTarget: "darts",
      appliesMods: [],
      extraRolls: [],
    },
  ],
  resources: [
    { _id: "res1", _creationTime: 0, combatantId: "c1", label: "L1 法術位", current: 2, max: 2 },
    { _id: "res2", _creationTime: 0, combatantId: "c1", label: "L2 法術位", current: 1, max: 1 },
  ],
};

function renderSheet(onAdd = vi.fn(), onUpdate = vi.fn()) {
  render(
    <CombatantSheet
      combatant={combatant}
      onAddRecipe={onAdd}
      onUpdateRecipe={onUpdate}
    />,
  );
  // Expand the collapsed sheet.
  fireEvent.click(screen.getByText("屬性表"));
  return { onAdd, onUpdate };
}

test("recipe row shows the linked pool; edit form offers the owner's pools and Save sends resourceId", () => {
  const { onUpdate } = renderSheet();

  // Summary line names the linked pool.
  expect(screen.getByText(/消耗 L1 法術位/)).toBeInTheDocument();

  // Open edit → the consumes dropdown lists both pools; relink to L2.
  fireEvent.click(screen.getByLabelText("edit recipe 魔法飛彈"));
  const editForm = screen.getByLabelText("edit form 魔法飛彈");
  const consumes = within(editForm).getByLabelText("recipe consumes resource");
  expect(within(consumes).getByText(/L2 法術位/)).toBeInTheDocument();
  fireEvent.change(consumes, { target: { value: "res2" } });
  fireEvent.click(within(editForm).getByText("儲存"));

  expect(onUpdate).toHaveBeenCalledTimes(1);
  const [recipeId, draft] = onUpdate.mock.calls[0] as [string, RecipeDraft];
  expect(recipeId).toBe("r1");
  expect(draft.resourceId).toBe("res2");
  // #61: fields the edit didn't touch ride through unchanged.
  expect(draft.multiTarget).toBe("darts");
});

test("adding a 治療 applied mod (dice + flat) survives Save", () => {
  const { onUpdate } = renderSheet();

  fireEvent.click(screen.getByLabelText("edit recipe 魔法飛彈"));
  const editForm = screen.getByLabelText("edit form 魔法飛彈");

  // + mod → switch the row to 治療 → 1d8 dice + flat 3 → Save.
  fireEvent.click(within(editForm).getByText("+ 效果列"));
  fireEvent.change(within(editForm).getByLabelText("mod stat 0"), { target: { value: "healing" } });
  // Two "damage dice" inputs exist now: the recipe's main dice, then the heal row's.
  fireEvent.change(within(editForm).getAllByLabelText("damage dice")[1], { target: { value: "1d8" } });
  fireEvent.change(within(editForm).getByLabelText("mod value 0"), { target: { value: "3" } });
  fireEvent.click(within(editForm).getByText("儲存"));

  expect(onUpdate).toHaveBeenCalledTimes(1);
  const [, draft] = onUpdate.mock.calls[0] as [string, RecipeDraft];
  expect(draft.appliesMods).toEqual([
    { stat: "healing", mode: "bonus", value: 3, dice: [{ type: "d8", count: 1 }] },
  ]);
});

test("issue #61: the multiTarget select shows an existing recipe's value and Save sends the change", () => {
  const { onUpdate } = renderSheet();

  fireEvent.click(screen.getByLabelText("edit recipe 魔法飛彈"));
  const editForm = screen.getByLabelText("edit form 魔法飛彈");
  const multiTarget = within(editForm).getByLabelText("目標方式") as HTMLSelectElement;
  expect(multiTarget.value).toBe("darts");

  fireEvent.change(multiTarget, { target: { value: "aoe" } });
  fireEvent.click(within(editForm).getByText("儲存"));

  const [, draft] = onUpdate.mock.calls[0] as [string, RecipeDraft];
  expect(draft.multiTarget).toBe("aoe");
});

test("issue #61: a new recipe defaults to single-target and can be created as darts", () => {
  const { onAdd } = renderSheet();

  fireEvent.click(screen.getByText("自訂招式"));
  const multiTarget = screen.getByLabelText("目標方式") as HTMLSelectElement;
  expect(multiTarget.value).toBe("none");

  fireEvent.change(multiTarget, { target: { value: "darts" } });
  fireEvent.click(screen.getByText("新增招式"));

  const [, draft] = onAdd.mock.calls[0] as [string, RecipeDraft];
  expect(draft.multiTarget).toBe("darts");
});

test("recipe rows offer no duplicate button (superseded by BG3-style resource arming)", () => {
  renderSheet();
  expect(screen.queryByLabelText("duplicate recipe 魔法飛彈")).not.toBeInTheDocument();
});

test("resource pip icon/color controls: default preview is the combatant color; changes call onUpdateResource; reset clears the override", () => {
  const onUpdateResource = vi.fn();
  render(
    <CombatantSheet
      combatant={combatant}
      onAddRecipe={vi.fn()}
      onUpdateRecipe={vi.fn()}
      onUpdateResource={onUpdateResource}
    />,
  );
  fireEvent.click(screen.getByText("屬性表"));

  // res1 has no icon/color override — color previews the combatant's own color.
  expect(screen.getByLabelText("resource color res1")).toHaveValue("#7d5ba6");
  // No override yet → no reset button.
  expect(screen.queryByLabelText("reset resource color res1")).not.toBeInTheDocument();

  // Icon picker: click the button to open the grid, then pick "flame".
  fireEvent.click(screen.getByLabelText("resource icon res1"));
  fireEvent.click(screen.getByLabelText("icon flame"));
  expect(onUpdateResource).toHaveBeenCalledWith("res1", { icon: "flame" });

  fireEvent.change(screen.getByLabelText("resource color res1"), { target: { value: "#a32638" } });
  expect(onUpdateResource).toHaveBeenCalledWith("res1", { color: "#a32638" });
});

test("resource pip color reset button appears once an override is set, and clears it", () => {
  const onUpdateResource = vi.fn();
  const withOverride: CombatantView = {
    ...combatant,
    resources: [{ ...combatant.resources![0], color: "#a32638" }],
  };
  render(
    <CombatantSheet
      combatant={withOverride}
      onAddRecipe={vi.fn()}
      onUpdateRecipe={vi.fn()}
      onUpdateResource={onUpdateResource}
    />,
  );
  fireEvent.click(screen.getByText("屬性表"));

  fireEvent.click(screen.getByLabelText("reset resource color res1"));
  expect(onUpdateResource).toHaveBeenCalledWith("res1", { color: null });
});

test("extra rolls: adding one defaults to roleplay; switching to battle reveals mod + damage type, and Save sends it", () => {
  const { onUpdate } = renderSheet();

  fireEvent.click(screen.getByLabelText("edit recipe 魔法飛彈"));
  const editForm = screen.getByLabelText("edit form 魔法飛彈");
  fireEvent.click(within(editForm).getByText("+ extra roll"));

  // Defaults to roleplay — no mod/damage-type fields yet.
  fireEvent.change(within(editForm).getByLabelText("extra roll label 0"), {
    target: { value: "Push direction" },
  });
  expect(within(editForm).queryByLabelText("extra roll mod 0")).not.toBeInTheDocument();

  // Switch to battle — mod + damage type fields appear.
  fireEvent.change(within(editForm).getByLabelText("extra roll usage 0"), {
    target: { value: "battle" },
  });
  fireEvent.change(within(editForm).getByLabelText("extra roll mod 0"), {
    target: { value: "2" },
  });
  fireEvent.change(within(editForm).getByLabelText("extra roll damage type 0"), {
    target: { value: "fire" },
  });
  fireEvent.click(within(editForm).getByText("儲存"));

  expect(onUpdate).toHaveBeenCalledTimes(1);
  const [, draft] = onUpdate.mock.calls[0] as [string, RecipeDraft];
  expect(draft.extraRolls).toEqual([
    { label: "Push direction", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 2, damageType: "fire" },
  ]);
});
