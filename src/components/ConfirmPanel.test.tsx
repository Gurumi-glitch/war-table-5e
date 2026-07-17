import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConfirmPanel, type RecipeConfirm } from "./ConfirmPanel";
import { CONDITION_BY_KEY } from "../../convex/modifiers";
import type { CombatantView } from "../../convex/games";
import type { BattleDraftView } from "../../convex/battleDrafts";

/**
 * BG3-style resource arming (issue #9, pip UI per docs/DESIGN.md): picking a
 * recipe pre-arms its linked pool's pips; extra pools can be armed on top by
 * tapping their pips; Confirm sends ALL armed pools in `spendResources`
 * (which the backend spends together — no duplicated upcast recipes).
 */

function makeCombatant(): CombatantView {
  return {
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
    reactionUsed: true,
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
      { _id: "res2", _creationTime: 0, combatantId: "c1", label: "魔法飛彈奧秘", current: 2, max: 2 },
    ],
  };
}

test("issue #18: removing the acting combatant falls back to the first remaining one instead of showing blank", () => {
  const c1 = makeCombatant();
  const c2: CombatantView = { ...makeCombatant(), _id: "c2", name: "哥布林", recipes: [], resources: [] };
  const { rerender } = render(
    <ConfirmPanel
      dice={[]}
      combatants={[c1, c2]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );

  // Pick the Goblin explicitly, then have it removed from the game.
  fireEvent.change(screen.getByLabelText("acting combatant"), { target: { value: "c2" } });
  expect(screen.getByLabelText("acting combatant")).toHaveValue("c2");

  rerender(
    <ConfirmPanel
      dice={[]}
      combatants={[c1]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );

  // Falls back to the remaining combatant, not blank.
  expect(screen.getByLabelText("acting combatant")).toHaveValue("c1");
});

test("a shared draft controls the session and emits field-level patches", () => {
  const onPatchDraft = vi.fn();
  const draft: BattleDraftView = {
    _id: "draft1", slotKey: "normal", scope: "normal", actorId: "c1", runId: null,
    recipeId: null, attackMod: "", actorAdvOverride: "", damageMod: "", damageType: "", dc: "",
    dartTotal: "3", effectText: "shared note", manualTargets: [{ combatantId: "", hpDelta: 0 }],
    recipeTargets: [{ combatantId: "", saveBonus: "0", forceOutcome: "", forceDamage: "", darts: "0", reactionRecipeId: "", advOverride: "", saveMode: "" }],
    spendResources: [], modExcluded: [], updatedAt: 1,
  };
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[makeCombatant()]}
      draft={draft}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
      onPatchDraft={onPatchDraft}
    />,
  );
  expect(screen.getByLabelText("effect text")).toHaveValue("shared note");
  const effect = screen.getByLabelText("effect text");
  fireEvent.change(effect, { target: { value: "everyone sees this" } });
  fireEvent.blur(effect);
  expect(onPatchDraft).toHaveBeenLastCalledWith("c1", { effectText: "everyone sees this" });
});

test("recipe workflow keeps settings, resources, targets, Claim Dice, effect, and Confirm in table order", () => {
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[makeCombatant()]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r1" } });
  const ordered = [
    screen.getByLabelText("recipe"),
    screen.getByLabelText("override damage mod"),
    screen.getByLabelText("L1 法術位 pip 1 of 2"),
    screen.getByLabelText("target 1"),
    screen.getByText("認領骰子"),
    screen.getByLabelText("effect text"),
    screen.getByText("確認招式"),
  ];
  for (let i = 1; i < ordered.length; i++) {
    expect(ordered[i - 1].compareDocumentPosition(ordered[i]) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  }
});

test("picking a recipe pre-arms its linked pool; arming another pool sends both on Confirm", () => {
  const onConfirmRecipe = vi.fn();
  const combatants = [makeCombatant()];
  render(
    <ConfirmPanel
      dice={[]}
      combatants={combatants}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  // Pick the recipe → its linked L1 pool's first pip is pre-armed, the rider is not.
  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r1" } });
  expect(screen.getByLabelText("L1 法術位 pip 1 of 2")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("魔法飛彈奧秘 pip 1 of 2")).toHaveAttribute("aria-pressed", "false");

  // Arm the rider too (tap its first pip), pick a target with 1 dart, confirm.
  fireEvent.click(screen.getByLabelText("魔法飛彈奧秘 pip 1 of 2"));
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c1" } });
  fireEvent.change(screen.getByLabelText("darts target 1"), { target: { value: "1" } });
  fireEvent.click(screen.getByText("確認招式"));

  expect(onConfirmRecipe).toHaveBeenCalledTimes(1);
  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.spendResources).toEqual(
    expect.arrayContaining([
      { resourceId: "res1", amount: 1 },
      { resourceId: "res2", amount: 1 },
    ]),
  );
  expect(payload.spendResources).toHaveLength(2);
});

test("issue #33: a darts recipe edited to hitType save keeps dart assignment AND gains the save UI", () => {
  const onConfirmRecipe = vi.fn();
  // Same 魔法飛彈 recipe, hitType switched to save by the DM. darts is the
  // damage source, not a hitType — changing the gate must never take the
  // multi-target dart assignment away mid-combat.
  const c1 = makeCombatant();
  const saveVariant = {
    ...c1.recipes![0],
    hitType: "save" as const,
    dc: 15,
    saveAbility: "dex",
  };
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[{ ...c1, recipes: [saveVariant] }]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r1" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c1" } });

  // Both are present: still assign darts, and now the target saves too.
  expect(screen.getByLabelText("darts target 1")).toBeInTheDocument();
  expect(screen.getByLabelText("save bonus target 1")).toBeInTheDocument();

  // …and the dart count still reaches the backend.
  fireEvent.change(screen.getByLabelText("darts target 1"), { target: { value: "2" } });
  fireEvent.click(screen.getByText("確認招式"));
  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.targets[0].darts).toBe(2);
});

test("untoggling the pre-armed pool sends an empty spend list (spend nothing)", () => {
  const onConfirmRecipe = vi.fn();
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[makeCombatant()]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r1" } });
  fireEvent.click(screen.getByLabelText("L1 法術位 pip 1 of 2")); // disarm the pre-armed pip
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c1" } });
  fireEvent.click(screen.getByText("確認招式"));

  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.spendResources).toEqual([]);
});

test("save preview shows auto-fail for a Stunned target and reads its card save bonus", () => {
  const actor: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r2", _creationTime: 0, combatantId: "c1", name: "火球術",
        hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }],
        damageMod: 0, damageType: "fire", dc: 15, saveAbility: "dex",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [], extraRolls: [],
      },
    ],
    resources: [],
  };
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20,
    effects: [
      { _id: "e1", _creationTime: 0, combatantId: "c2", type: "condition",
        conditionKey: "stunned", label: "Stunned",
        specs: CONDITION_BY_KEY["stunned"].specs, active: true },
    ],
    saves: [{ key: "敏捷", prof: false, total: 4 }],
    recipes: [],
  };
  const dice = [
    { _id: "d1", _creationTime: 0, gameId: "g1", type: "d6" as const, value: 3, order: 0, claimedBy: "c1" },
    { _id: "d2", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 20, order: 0, claimedBy: "c2" },
  ];

  render(
    <ConfirmPanel
      dice={dice}
      combatants={[actor, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r2" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // Stunned auto-fails the DEX save even with a nat 20 (+4 card bonus) vs DC 15.
  // The "auto-fail" badge shows in the target row, and the preview reports FAIL.
  expect(screen.getByText("自動失敗")).toBeTruthy();
  const preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("FAIL");
});

/** An attacker (attack recipe) + a target, for the adv/disadv toggle tests. */
function attackFixture(
  targetEffects: CombatantView["effects"],
  attackerEffects: CombatantView["effects"] = [],
) {
  const attacker: CombatantView = {
    ...makeCombatant(),
    effects: attackerEffects,
    recipes: [
      {
        _id: "r-atk", _creationTime: 0, combatantId: "c1", name: "長劍",
        hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }],
        damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [], extraRolls: [],
      },
    ],
    resources: [],
  };
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20, ac: 12,
    effectiveAc: { base: 12, bonus: 0, override: null, value: 12 },
    effects: targetEffects,
    recipes: [],
    resources: [],
  };
  return { attacker, target };
}

test("a Blinded target pre-lights the adv toggle; clicking it off sends advOverride 'none'", () => {
  const onConfirmRecipe = vi.fn();
  const { attacker, target } = attackFixture([
    { _id: "e1", _creationTime: 0, combatantId: "c2", type: "condition",
      conditionKey: "blinded", label: "Blinded",
      specs: CONDITION_BY_KEY["blinded"].specs, active: true },
  ]);
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // Blinded → attacks against it have advantage: the toggle is pre-lit (auto).
  const advBtn = screen.getByLabelText("advantage toggle target 1");
  expect(advBtn).toHaveAttribute("aria-pressed", "true");

  // Click it off → forced neutral for this roll, sent as an explicit override.
  fireEvent.click(advBtn);
  expect(advBtn).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByText("確認招式"));

  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.targets[0].advOverride).toBe("none");
});

test("manual 劣勢 toggle sends advOverride 'disadvantage'; ↺ returns to auto (nothing sent)", () => {
  const onConfirmRecipe = vi.fn();
  const { attacker, target } = attackFixture([]); // clean target — no conditions
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  const disBtn = screen.getByLabelText("disadvantage toggle target 1");
  expect(disBtn).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(disBtn);
  expect(disBtn).toHaveAttribute("aria-pressed", "true");

  // ↺ returns to auto: the manual mark clears and no override is sent.
  fireEvent.click(screen.getByLabelText("advantage auto target 1"));
  expect(disBtn).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(screen.getByText("確認招式"));
  expect(
    (onConfirmRecipe.mock.calls[0][0] as RecipeConfirm).targets[0].advOverride,
  ).toBeUndefined();

  // Toggle 劣勢 again and confirm — the override goes through.
  fireEvent.click(disBtn);
  fireEvent.click(screen.getByText("確認招式"));
  expect(
    (onConfirmRecipe.mock.calls[1][0] as RecipeConfirm).targets[0].advOverride,
  ).toBe("disadvantage");
});

test("damage type override select is blank by default and sends the chosen type on Confirm", () => {
  const onConfirmRecipe = vi.fn();
  const { attacker, target } = attackFixture([]);
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  const select = screen.getByLabelText("override damage type") as HTMLSelectElement;
  expect(select.value).toBe(""); // blank = recipe default (slashing)
  fireEvent.change(select, { target: { value: "fire" } });
  fireEvent.click(screen.getByText("確認招式"));

  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.damageType).toBe("fire");
});

/** An attacker with a battle-usage extra roll (Fire Rider) + roleplay roll (Push), for extra-roll tests. */
function extraRollFixture() {
  const attacker: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-atk", _creationTime: 0, combatantId: "c1", name: "長劍",
        hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }],
        damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [],
        extraRolls: [
          { label: "Fire Rider", usage: "battle", dice: [{ type: "d6", count: 1 }], damageMod: 0, damageType: "fire" },
          { label: "Push direction", usage: "roleplay", dice: [{ type: "d4", count: 1 }], damageMod: 0, damageType: "" },
        ],
      },
    ],
    resources: [],
  };
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20, ac: 12,
    effectiveAc: { base: 12, bonus: 0, override: null, value: 12 },
    effects: [],
    recipes: [],
    resources: [],
  };
  return { attacker, target };
}

test("a recipe's extra rolls are summarized; 'Claim dice for recipe' also claims their dice", () => {
  const { attacker, target } = extraRollFixture();
  const onSetClaim = vi.fn();
  const unclaimedD20 = { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 10, order: 0, claimedBy: null };
  const unclaimedD8 = { _id: "d8-1", _creationTime: 0, gameId: "g1", type: "d8" as const, value: 5, order: 0, claimedBy: null };
  const unclaimedD6 = { _id: "d6-1", _creationTime: 0, gameId: "g1", type: "d6" as const, value: 3, order: 0, claimedBy: null };
  const unclaimedD4 = { _id: "d4-1", _creationTime: 0, gameId: "g1", type: "d4" as const, value: 2, order: 0, claimedBy: null };
  render(
    <ConfirmPanel
      dice={[unclaimedD20, unclaimedD8, unclaimedD6, unclaimedD4]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={onSetClaim}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });

  // The recipe's extra rolls are shown so the DM knows what to expect.
  const summary = screen.getByLabelText("extra rolls");
  expect(summary.textContent).toContain("Fire Rider (1d6, battle: +0 fire)");
  expect(summary.textContent).toContain("Push direction (1d4, roleplay)");

  fireEvent.click(screen.getByText("認領骰子"));
  // Main d20 + d8, plus the extra rolls' d6 (Fire Rider) and d4 (Push direction).
  const claimedIds = onSetClaim.mock.calls.map((c) => c[0]);
  expect(claimedIds).toEqual(["d20-1", "d8-1", "d6-1", "d4-1"]);
});

test("Case 1: the actor's toggle and a target's toggle are visually independent (lighting one doesn't light the other)", () => {
  const onConfirmRecipe = vi.fn();
  const { attacker, target } = attackFixture([]); // clean target — no conditions
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  const targetAdvBtn = screen.getByLabelText("advantage toggle target 1");
  const actorAdvBtn = screen.getByLabelText("advantage toggle actor");
  expect(targetAdvBtn).toHaveAttribute("aria-pressed", "false");
  expect(actorAdvBtn).toHaveAttribute("aria-pressed", "false");

  // Lighting the actor's toggle must NOT visually light the target's toggle —
  // they're independent rolls that only combine server-side, not one shared
  // display (this was reported as confusing after the actor toggle shipped).
  fireEvent.click(actorAdvBtn);
  expect(actorAdvBtn).toHaveAttribute("aria-pressed", "true");
  expect(targetAdvBtn).toHaveAttribute("aria-pressed", "false");

  fireEvent.click(screen.getByText("確認招式"));
  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.actorAdvOverride).toBe("advantage");
  expect(payload.targets[0].advOverride).toBeUndefined();
});

test("Case 1: a target's own condition-driven toggle lights up independently of the actor's toggle state", () => {
  const onConfirmRecipe = vi.fn();
  const { attacker, target } = attackFixture([
    { _id: "e1", _creationTime: 0, combatantId: "c2", type: "condition",
      conditionKey: "blinded", label: "Blinded",
      specs: CONDITION_BY_KEY["blinded"].specs, active: true },
  ]);
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // Blinded → attacks against it have advantage: the TARGET's toggle is
  // pre-lit on its own — the actor's toggle stays untouched/unlit.
  expect(screen.getByLabelText("advantage toggle target 1")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("advantage toggle actor")).toHaveAttribute("aria-pressed", "false");
});

test("Claim Dice uses one d20 when raw actor and target signals cancel", () => {
  const { attacker, target } = attackFixture(
    [
      { _id: "e-target-a", _creationTime: 0, combatantId: "c2", type: "condition",
        conditionKey: "blinded", label: "Blinded",
        specs: CONDITION_BY_KEY["blinded"].specs, active: true },
      { _id: "e-target-d", _creationTime: 0, combatantId: "c2", type: "condition",
        conditionKey: "invisible", label: "Invisible",
        specs: CONDITION_BY_KEY["invisible"].specs, active: true },
    ],
    [
      { _id: "e-actor-a", _creationTime: 0, combatantId: "c1", type: "condition",
        conditionKey: "invisible", label: "Invisible",
        specs: CONDITION_BY_KEY["invisible"].specs, active: true },
    ],
  );
  const onSetClaim = vi.fn();
  const dice = [
    { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 4, order: 0, claimedBy: null },
    { _id: "d20-2", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 18, order: 1, claimedBy: null },
    { _id: "d8-1", _creationTime: 0, gameId: "g1", type: "d8" as const, value: 6, order: 0, claimedBy: null },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={onSetClaim}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });
  fireEvent.click(screen.getByText("認領骰子"));

  expect(onSetClaim.mock.calls.map((call) => call[0])).toEqual(["d20-1", "d8-1"]);
});

test("Preview reduces all raw attack signals once while side lamps stay local", () => {
  const { attacker, target } = attackFixture(
    [
      { _id: "e-target-a", _creationTime: 0, combatantId: "c2", type: "condition",
        conditionKey: "blinded", label: "Blinded",
        specs: CONDITION_BY_KEY["blinded"].specs, active: true },
      { _id: "e-target-d", _creationTime: 0, combatantId: "c2", type: "condition",
        conditionKey: "invisible", label: "Invisible",
        specs: CONDITION_BY_KEY["invisible"].specs, active: true },
    ],
    [
      { _id: "e-actor-a", _creationTime: 0, combatantId: "c1", type: "condition",
        conditionKey: "invisible", label: "Invisible",
        specs: CONDITION_BY_KEY["invisible"].specs, active: true },
    ],
  );
  const dice = [
    { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 4, order: 0, claimedBy: "c1" },
    { _id: "d8-1", _creationTime: 0, gameId: "g1", type: "d8" as const, value: 6, order: 0, claimedBy: "c1" },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  expect(screen.getByLabelText("advantage toggle actor")).toHaveAttribute("aria-pressed", "true");
  expect(screen.getByLabelText("advantage toggle target 1")).toHaveAttribute("aria-pressed", "false");
  expect(screen.getByLabelText("disadvantage toggle target 1")).toHaveAttribute("aria-pressed", "false");
  const preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("MISS");
  expect(preview.textContent).not.toContain("need 2 d20s");
  expect(preview.textContent).not.toContain("(adv)");
  expect(preview.textContent).not.toContain("(disadv)");
});

test("the save-result dropdown exists only on DC recipes, not attack recipes", () => {
  const { attacker, target } = attackFixture([]);
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // An attack recipe has no save, so there's nothing for the dropdown to mean.
  expect(screen.queryByLabelText("save result target 1")).toBeNull();
});

test("Case 1 Extend: on a DC spell, HIT or MISS shows the save adv/disadv; Damage is manual-only and sends 'damage'", () => {
  const onConfirmRecipe = vi.fn();
  const attacker: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-save", _creationTime: 0, combatantId: "c1", name: "雷鳴爆",
        hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }],
        damageMod: 0, damageType: "thunder", dc: 15, saveAbility: "dex",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [], extraRolls: [],
      },
    ],
    resources: [],
  };
  // Restrained → disadvantage on the target's own DEX saves (the landing roll
  // for a DC spell); it also grants attackAgainst advantage, which must NOT
  // bleed into this save-recipe UI anywhere.
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20,
    effects: [
      { _id: "e1", _creationTime: 0, combatantId: "c2", type: "condition",
        conditionKey: "restrained", label: "Restrained",
        specs: CONDITION_BY_KEY["restrained"].specs, active: true },
    ],
    saves: [{ key: "敏捷", prof: false, total: 0 }],
    recipes: [],
  };
  render(
    <ConfirmPanel
      dice={[]}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-save" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // The toggle IS the save roll's adv/disadv: Restrained pre-lights 劣勢.
  const saveResult = screen.getByLabelText("save result target 1") as HTMLSelectElement;
  expect(saveResult.value).toBe("damage"); // default = save-for-half
  expect(saveResult.options[0].text).toBe("HIT or MISS");
  expect(saveResult.options[1].text).toBe("傷害");
  expect(screen.getByLabelText("disadvantage toggle target 1")).toHaveAttribute("aria-pressed", "true");

  // Switching the save's MEANING to HIT or MISS must not touch the toggle —
  // the adv/disadv applies to the save roll in both modes (Case 1 Extend).
  fireEvent.change(saveResult, { target: { value: "hitOrMiss" } });
  expect(screen.getByLabelText("disadvantage toggle target 1")).toHaveAttribute("aria-pressed", "true");
  fireEvent.click(screen.getByText("確認招式"));

  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  expect(payload.targets[0].saveMode).toBe("hitOrMiss");
  expect(payload.targets[0].advOverride).toBeUndefined(); // toggle stayed on auto
});

test("Case 1 Extend: 'Claim dice for recipe' on a DC spell claims damage dice to the actor and the save d20 to the TARGET", () => {
  const attacker: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-save", _creationTime: 0, combatantId: "c1", name: "雷鳴爆",
        hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }],
        damageMod: 0, damageType: "thunder", dc: 15, saveAbility: "dex",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [], extraRolls: [],
      },
    ],
    resources: [],
  };
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20,
    effects: [], saves: [{ key: "敏捷", prof: false, total: 0 }], recipes: [], resources: [],
  };
  const onSetClaim = vi.fn();
  const dice = [
    { _id: "d6-1", _creationTime: 0, gameId: "g1", type: "d6" as const, value: 3, order: 0, claimedBy: null },
    { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 14, order: 0, claimedBy: null },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={onSetClaim}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-save" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });
  fireEvent.click(screen.getByText("認領骰子"));

  // Damage d6 → the actor; save d20 → the TARGET (Case 1 Extend: it used to
  // require the Dice Board, whose lingering selector claimed it to the actor).
  expect(onSetClaim.mock.calls).toEqual([
    ["d6-1", "c1"],
    ["d20-1", "c2"],
  ]);
});

test("Case 1 Extend: HIT-or-MISS saveMode previews MISS with 0 damage on a successful save", () => {
  const attacker: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-save", _creationTime: 0, combatantId: "c1", name: "雷鳴爆",
        hitType: "save", attackMod: 0, damageDice: [{ type: "d6", count: 1 }],
        damageMod: 0, damageType: "thunder", dc: 15, saveAbility: "dex",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [], extraRolls: [],
      },
    ],
    resources: [],
  };
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20,
    effects: [], saves: [{ key: "敏捷", prof: false, total: 0 }], recipes: [], resources: [],
  };
  const dice = [
    { _id: "d6-1", _creationTime: 0, gameId: "g1", type: "d6" as const, value: 6, order: 0, claimedBy: "c1" },
    { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 20, order: 0, claimedBy: "c2" },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );

  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-save" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // Default (Damage / save-for-half): 20 ≥ 15 → SAVE, half of 6 = 3.
  let preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("SAVE → 3");

  // HIT or MISS: the same successful save now means the Actor MISSED — 0.
  fireEvent.change(screen.getByLabelText("save result target 1"), { target: { value: "hitOrMiss" } });
  preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("MISS → 0");
});

test("healing-typed extra roll previews as a heal on the target, not damage", () => {
  const attacker: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-atk", _creationTime: 0, combatantId: "c1", name: "汲取之刃",
        hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }],
        damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none", appliesMods: [],
        extraRolls: [
          { label: "回復", usage: "battle", dice: [{ type: "d4", count: 1 }], damageMod: 2, damageType: "healing" },
        ],
      },
    ],
    resources: [],
  };
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 10, maxHp: 20, ac: 12,
    effectiveAc: { base: 12, bonus: 0, override: null, value: 12 },
    effects: [], recipes: [], resources: [],
  };
  const dice = [
    { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 14, order: 0, claimedBy: "c1" },
    { _id: "d8-1", _creationTime: 0, gameId: "g1", type: "d8" as const, value: 6, order: 0, claimedBy: "c1" },
    { _id: "d4-1", _creationTime: 0, gameId: "g1", type: "d4" as const, value: 3, order: 0, claimedBy: "c1" },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  // HIT for 9 slashing; the rider heals 3+2 = 5 (labeled 治療, not added to damage).
  const preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("HIT");
  expect(preview.textContent).toContain("→ 9");
  expect(preview.textContent).toContain("回復 +5治療");
});

test("tempHp applied-mod row (False Life) previews a self grant, claims its dice, changes no HP", () => {
  const caster: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-fl", _creationTime: 0, combatantId: "c1", name: "虛假生命術",
        hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
        damageType: "", dc: 0, saveAbility: "", critImmune: true,
        resourceId: null, resourceCost: 0, multiTarget: "none",
        appliesMods: [
          { stat: "tempHp", mode: "bonus", value: 4, dice: [{ type: "d4", count: 1 }], direction: "self" },
        ],
        extraRolls: [],
      },
    ],
    resources: [],
  };
  const dice = [
    { _id: "d4-1", _creationTime: 0, gameId: "g1", type: "d4" as const, value: 3, order: 0, claimedBy: "c1" },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[caster]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-fl" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c1" } });

  const block = screen.getByLabelText("applied mods");
  expect(block.textContent).toContain("臨時HP 1d4+4");
  expect(block.textContent).toContain("[自身]");

  // d4 3 + 4 = +7 temp, labeled 臨時 — no real-HP heal (8/8 stays untouched).
  const preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("+7臨時 → 測試法師");
});

/** A caster with directed appliesMods (heal → targets, AC → self) + two allies. */
function appliedModsFixture() {
  const caster: CombatantView = {
    ...makeCombatant(),
    recipes: [
      {
        _id: "r-bless", _creationTime: 0, combatantId: "c1", name: "群體祝福",
        hitType: "automatic", attackMod: 0, damageDice: [], damageMod: 0,
        damageType: "force", dc: 0, saveAbility: "", critImmune: false,
        resourceId: null, resourceCost: 0, multiTarget: "aoe",
        appliesMods: [
          { stat: "healing", mode: "bonus", value: 3, dice: [{ type: "d8", count: 1 }], direction: "targets" },
          { stat: "ac", mode: "bonus", value: 5, direction: "self" },
        ],
        extraRolls: [],
      },
    ],
    resources: [],
  };
  const allyA: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "艾拉", hp: 10, maxHp: 20, recipes: [], resources: [],
  };
  const allyB: CombatantView = {
    ...makeCombatant(),
    _id: "c3", name: "卡財", hp: 15, maxHp: 20, recipes: [], resources: [],
  };
  return { caster, allyA, allyB };
}

test("applied mods block: per-target checkboxes direct each row; unticking excludes that target from the payload", () => {
  const onConfirmRecipe = vi.fn();
  const { caster, allyA, allyB } = appliedModsFixture();
  const dice = [
    { _id: "d8-1", _creationTime: 0, gameId: "g1", type: "d8" as const, value: 6, order: 0, claimedBy: "c1" },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[caster, allyA, allyB]}
      onConfirm={vi.fn()}
      onConfirmRecipe={onConfirmRecipe}
      onSetClaim={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-bless" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });
  fireEvent.click(screen.getByText("新增目標"));
  fireEvent.change(screen.getByLabelText("target 2"), { target: { value: "c3" } });

  // The block lists each row: the heal with per-target checkboxes, the self row without.
  const block = screen.getByLabelText("applied mods");
  expect(block.textContent).toContain("治療 1d8+3");
  expect(block.textContent).toContain("+5 ac");
  expect(block.textContent).toContain("[自身]");
  expect(screen.getByLabelText("mod 0 to 艾拉")).toBeChecked();
  expect(screen.getByLabelText("mod 0 to 卡財")).toBeChecked();

  // Both checked → the preview heals both with the full d8+3 = 9.
  let preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("heals +9 → 艾拉, 卡財");

  // Untick 卡財 → excluded from the preview and the payload.
  fireEvent.click(screen.getByLabelText("mod 0 to 卡財"));
  preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("heals +9 → 艾拉");
  expect(preview.textContent).not.toContain("heals +9 → 艾拉, 卡財");

  fireEvent.click(screen.getByText("確認招式"));
  const payload = onConfirmRecipe.mock.calls[0][0] as RecipeConfirm;
  // One entry for the targets-directed heal row; the self row sends none.
  expect(payload.modTargets).toEqual([{ modIndex: 0, combatantIds: ["c2"] }]);
});

test("Preview reflects a custom 'attack: bonus' modifier on the actor (previously silently ignored)", () => {
  const attacker: CombatantView = {
    ...makeCombatant(),
    effects: [
      { _id: "e1", _creationTime: 0, combatantId: "c1", type: "custom", conditionKey: null,
        label: "+3 to hit", specs: [{ stat: "attack", mode: "bonus", value: 3 }], active: true },
    ],
    recipes: [
      {
        _id: "r-atk", _creationTime: 0, combatantId: "c1", name: "長劍",
        hitType: "attack", attackMod: 5, damageDice: [{ type: "d8", count: 1 }],
        damageMod: 3, damageType: "slashing", dc: 0, saveAbility: "",
        critImmune: false, resourceId: null, resourceCost: 0, multiTarget: "none",
        appliesMods: [], extraRolls: [],
      },
    ],
    resources: [],
  };
  // AC 17: 9(d20)+5(recipe)=14 misses; +3 from the modifier reaches 17 → hits.
  const target: CombatantView = {
    ...makeCombatant(),
    _id: "c2", name: "哥布林", hp: 20, maxHp: 20, ac: 17,
    effectiveAc: { base: 17, bonus: 0, override: null, value: 17 },
    effects: [], recipes: [], resources: [],
  };
  const dice = [
    { _id: "d20-1", _creationTime: 0, gameId: "g1", type: "d20" as const, value: 9, order: 0, claimedBy: "c1" },
    { _id: "d8-1", _creationTime: 0, gameId: "g1", type: "d8" as const, value: 6, order: 0, claimedBy: "c1" },
  ];
  render(
    <ConfirmPanel
      dice={dice}
      combatants={[attacker, target]}
      onConfirm={vi.fn()}
      onConfirmRecipe={vi.fn()}
      onSetClaim={vi.fn()}
    />,
  );
  fireEvent.change(screen.getByLabelText("recipe"), { target: { value: "r-atk" } });
  fireEvent.change(screen.getByLabelText("target 1"), { target: { value: "c2" } });

  const preview = screen.getByText(/預覽：/).parentElement!;
  expect(preview.textContent).toContain("HIT");
  expect(preview.textContent).not.toContain("MISS");
});
