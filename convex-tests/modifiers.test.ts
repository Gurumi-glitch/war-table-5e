import { test, expect } from "vitest";
import {
  CONDITIONS,
  CONDITION_BY_KEY,
  CUSTOM_PRESETS,
  advantage,
  advantageFor,
  advantageSignalsFor,
  autoFailFor,
  combineAdv,
  combineAdvSignals,
  computeEffective,
  effectiveNumber,
  effectiveStat,
  expandSpecs,
  hasCantAct,
  hasResistAll,
  saveAbilityToZh,
  type Effect,
  type ModifierSpec,
} from "../convex/modifiers";

/**
 * Pure unit tests for the Modifier/Condition math (issue #5). Effective stat =
 * base + active modifiers, computed on the fly; toggling off reverts; bonuses
 * stack; advantage + disadvantage cancel; overrides (min) win.
 */

const spec = (
  stat: ModifierSpec["stat"],
  mode: ModifierSpec["mode"],
  value = 0,
): ModifierSpec => ({ stat, mode, value });

const effect = (specs: ModifierSpec[], active = true): Effect => ({
  type: "custom",
  label: "x",
  specs,
  active,
});

/**
 * The one ability-scope rule, shared by all three resolution axes. The load-
 * bearing half is the UNSCOPED query: it's the default every non-save caller
 * uses, so a scoped spec must never leak into it — otherwise a "STR saves +2"
 * would silently become "+2 to every save" the moment anyone reads saves
 * generically, with no error and no UI tell.
 */
const scoped = (
  stat: ModifierSpec["stat"],
  mode: ModifierSpec["mode"],
  value: number,
  ability: string,
): ModifierSpec => ({ stat, mode, value, ability });

test("a scoped bonus counts only for its own ability", () => {
  const specs = [scoped("save", "bonus", 2, "力量")];
  expect(effectiveNumber(5, specs, "save", "力量").value).toBe(7);
  expect(effectiveNumber(5, specs, "save", "感知").value).toBe(5);
});

test("a scoped bonus never leaks into an unscoped query", () => {
  const specs = [scoped("save", "bonus", 2, "力量")];
  expect(effectiveNumber(5, specs, "save").value).toBe(5);
});

test("a generic spec applies to every ability, scoped or not", () => {
  const specs = [spec("save", "bonus", 3)];
  expect(effectiveNumber(5, specs, "save", "力量").value).toBe(8);
  expect(effectiveNumber(5, specs, "save").value).toBe(8);
});

test("generic and scoped bonuses sum for the matching ability only", () => {
  const specs = [spec("save", "bonus", 3), scoped("save", "bonus", 2, "力量")];
  expect(effectiveNumber(5, specs, "save", "力量").value).toBe(10);
  expect(effectiveNumber(5, specs, "save", "感知").value).toBe(8);
});

test("a scoped override wins only for its own ability", () => {
  const specs = [scoped("save", "override", 20, "力量")];
  expect(effectiveNumber(5, specs, "save", "力量").value).toBe(20);
  expect(effectiveNumber(5, specs, "save", "感知").value).toBe(5);
});

test("advantageSignalsFor and autoFailFor share the same scope rule", () => {
  const adv = [scoped("save", "advantage", 0, "力量")];
  expect(advantageSignalsFor(adv, "save", "力量").hasAdv).toBe(true);
  expect(advantageSignalsFor(adv, "save", "感知").hasAdv).toBe(false);
  // The unscoped query must not pick it up either.
  expect(advantageSignalsFor(adv, "save").hasAdv).toBe(false);

  const af = [scoped("save", "autoFail", 0, "力量")];
  expect(autoFailFor(af, "save", "力量")).toBe(true);
  expect(autoFailFor(af, "save", "感知")).toBe(false);
  expect(autoFailFor(af, "save")).toBe(false);
});

test("effectiveNumber sums bonuses onto the base", () => {
  const specs = [spec("ac", "bonus", 2), spec("ac", "bonus", 5)];
  expect(effectiveNumber(15, specs, "ac")).toEqual({
    base: 15,
    bonus: 7,
    override: null,
    value: 22,
  });
});

test("effectiveNumber ignores modifiers for other stats", () => {
  const specs = [spec("attack", "bonus", 3), spec("ac", "bonus", 1)];
  expect(effectiveNumber(15, specs, "ac").value).toBe(16);
});

test("a value:0 bonus row (note-only reminder chip) never changes the Effective number", () => {
  // Bless/Bane-style curated rows: value 0 + a note = a visible chip with no
  // math. effectiveNumber only sums `value`, so the result must be the base.
  const specs = [spec("attack", "bonus", 0), spec("ac", "bonus", 0)];
  expect(effectiveNumber(15, specs, "ac")).toEqual({
    base: 15,
    bonus: 0,
    override: null,
    value: 15,
  });
  expect(effectiveNumber(5, specs, "attack").value).toBe(5);
  expect(advantageFor(specs, "attack")).toBe("none");
});

test("healing/tempHp specs stored as an effect are inert to all Effective-stat math", () => {
  // Instant appliesMods-only stats: if one ever lands in a stored effect it
  // must contribute nothing (every helper filters by a real Stat).
  const specs = [spec("healing", "bonus", 8), spec("tempHp", "bonus", 12)];
  expect(effectiveNumber(15, specs, "ac").value).toBe(15);
  expect(effectiveNumber(2, specs, "attack").value).toBe(2);
  expect(advantageFor(specs, "attack")).toBe("none");
  expect(advantageFor(specs, "save")).toBe("none");
  expect(autoFailFor(specs, "save")).toBe(false);
});

test("negative bonuses (penalties) stack like any bonus", () => {
  const specs = [spec("attack", "bonus", -2), spec("attack", "bonus", -1)];
  expect(effectiveNumber(5, specs, "attack").value).toBe(2);
});

test("override replaces base+bonus; most-restrictive (min) override wins", () => {
  const specs = [
    spec("ac", "bonus", 5), // ignored once an override is present
    spec("ac", "override", 18),
    spec("ac", "override", 12),
  ];
  const eff = effectiveNumber(15, specs, "ac");
  expect(eff.override).toBe(12);
  expect(eff.value).toBe(12);
  expect(eff.bonus).toBe(5); // still reported, just not applied
});

test("advantage + disadvantage cancel to neutral regardless of count", () => {
  expect(advantage([spec("attack", "advantage")], "attack")).toBe("advantage");
  expect(advantage([spec("attack", "disadvantage")], "attack")).toBe("disadvantage");
  expect(
    advantage(
      [spec("attack", "advantage"), spec("attack", "disadvantage")],
      "attack",
    ),
  ).toBe("none");
  // Two advantages + one disadvantage still cancels.
  expect(
    advantage(
      [
        spec("attack", "advantage"),
        spec("attack", "advantage"),
        spec("attack", "disadvantage"),
      ],
      "attack",
    ),
  ).toBe("none");
  expect(advantage([], "attack")).toBe("none");
});

test("advantageSignalsFor preserves simultaneous advantage and disadvantage", () => {
  const specs = [spec("attack", "advantage"), spec("attack", "disadvantage")];
  expect(advantageSignalsFor(specs, "attack")).toEqual({
    hasAdv: true,
    hasDis: true,
  });
  // The existing side-local helper still reduces the same complete source list.
  expect(advantageFor(specs, "attack")).toBe("none");
});

test("advantageSignalsFor keeps advantageFor's stat and ability filtering", () => {
  const specs: ModifierSpec[] = [
    spec("attack", "advantage"),
    { ...spec("save", "advantage"), ability: "敏捷" },
    { ...spec("save", "disadvantage"), ability: "感知" },
    spec("save", "disadvantage"),
  ];
  expect(advantageSignalsFor(specs, "attack")).toEqual({ hasAdv: true, hasDis: false });
  expect(advantageSignalsFor(specs, "save", "敏捷")).toEqual({ hasAdv: true, hasDis: true });
  expect(advantageSignalsFor(specs, "save", "感知")).toEqual({ hasAdv: false, hasDis: true });
  expect(advantageSignalsFor(specs, "abilityCheck")).toEqual({ hasAdv: false, hasDis: false });
});

test("combineAdvSignals reduces actor and target sources only after union", () => {
  const a = { hasAdv: true, hasDis: false };
  const d = { hasAdv: false, hasDis: true };
  const both = { hasAdv: true, hasDis: true };
  for (const [actor, target] of [
    [a, both],
    [d, both],
    [both, a],
    [both, d],
  ] as const) {
    expect(combineAdvSignals(actor, target)).toBe("none");
  }
});

test("effectiveStat carries both the number and the advantage state", () => {
  const specs = [spec("attack", "bonus", 2), spec("attack", "advantage")];
  const eff = effectiveStat(5, specs, "attack");
  expect(eff.value).toBe(7);
  expect(eff.advantage).toBe("advantage");
});

test("expandSpecs only includes active effects — toggling off reverts", () => {
  const effects: Effect[] = [
    effect([spec("ac", "bonus", 2)]),
    effect([spec("ac", "bonus", 5)], false), // toggled off
  ];
  expect(expandSpecs(effects)).toEqual([spec("ac", "bonus", 2)]);
  expect(effectiveNumber(15, expandSpecs(effects), "ac").value).toBe(17);
});

test("computeEffective produces the full stat map from effects", () => {
  const effects: Effect[] = [
    effect([spec("ac", "bonus", 2), spec("attack", "disadvantage")]),
  ];
  const eff = computeEffective({ ac: 15, attack: 6 }, effects);
  expect(eff.ac.value).toBe(17);
  expect(eff.attack.value).toBe(6);
  expect(eff.attack.advantage).toBe("disadvantage");
  // Stats with no base default to 0; their bonus still reflects modifiers.
  expect(eff.save.value).toBe(0);
  expect(eff.abilityCheck.advantage).toBe("none");
});

test("a Condition bundles multiple modifiers that all apply as one unit", () => {
  const poisoned = CONDITION_BY_KEY["poisoned"];
  expect(poisoned.specs).toEqual([
    { stat: "attack", mode: "disadvantage", value: 0 },
    { stat: "abilityCheck", mode: "disadvantage", value: 0 },
  ]);
  const effects: Effect[] = [
    { type: "condition", conditionKey: "poisoned", label: "Poisoned", specs: poisoned.specs, active: true },
  ];
  const eff = computeEffective({ attack: 5, abilityCheck: 3 }, effects);
  expect(eff.attack.advantage).toBe("disadvantage");
  expect(eff.abilityCheck.advantage).toBe("disadvantage");
  // Toggling the single condition off reverts BOTH contributions.
  effects[0].active = false;
  const reverted = computeEffective({ attack: 5, abilityCheck: 3 }, effects);
  expect(reverted.attack.advantage).toBe("none");
  expect(reverted.abilityCheck.advantage).toBe("none");
});

test("stacking: two AC-bonus effects sum", () => {
  const effects: Effect[] = [
    effect([spec("ac", "bonus", 5)]), // Shield
    effect([spec("ac", "bonus", 2)]), // half cover
  ];
  expect(effectiveNumber(15, expandSpecs(effects), "ac").value).toBe(22);
});

test("the curated catalog covers the conditions named in the issue", () => {
  const keys = CONDITIONS.map((c) => c.key);
  for (const k of ["stunned", "restrained", "poisoned", "prone"]) {
    expect(keys).toContain(k);
  }
  // Every condition key resolves and has a label.
  for (const c of CONDITIONS) {
    expect(CONDITION_BY_KEY[c.key]).toBe(c);
    expect(c.label.length).toBeGreaterThan(0);
  }
});

test("custom presets are single-spec custom modifiers with valid modes", () => {
  for (const p of CUSTOM_PRESETS) {
    expect(p.spec).toBeDefined();
    expect(["bonus", "override", "advantage", "disadvantage"]).toContain(
      p.spec.mode,
    );
  }
});

test("saveAbilityToZh maps the recipe English save keys to the zh ability keys", () => {
  expect(saveAbilityToZh("dex")).toBe("敏捷");
  expect(saveAbilityToZh("STR")).toBe("力量");
  expect(saveAbilityToZh("con")).toBe("體質");
  expect(saveAbilityToZh("wis")).toBe("感知");
  expect(saveAbilityToZh("int")).toBe("智力");
  expect(saveAbilityToZh("cha")).toBe("魅力");
  expect(saveAbilityToZh("")).toBe("");
  expect(saveAbilityToZh("foo")).toBe("");
});

test("advantageFor scopes save advantage to one ability (Restrained DEX only)", () => {
  const restrained = CONDITION_BY_KEY["restrained"].specs;
  // Restrained disadvantages DEX saves but not WIS saves.
  expect(advantageFor(restrained, "save", "敏捷")).toBe("disadvantage");
  expect(advantageFor(restrained, "save", "感知")).toBe("none");
  // An unscoped query asks "the save state in general" — a DEX-only
  // disadvantage does not answer it, so it must NOT count. This assertion was
  // inverted before: the old "generic view" counted every scoped spec, which
  // read fine as a display summary ("any save affected?") but was the same
  // default the math paths use — so a scoped spec silently applied to every
  // ability. The display reading has no callers; the math reading is the one
  // that ships.
  expect(advantageFor(restrained, "save")).toBe("none");
});

test("autoFailFor detects Stunned's STR/DEX auto-fail and leaves other abilities alone", () => {
  const stunned = CONDITION_BY_KEY["stunned"].specs;
  expect(autoFailFor(stunned, "save", "力量")).toBe(true);
  expect(autoFailFor(stunned, "save", "敏捷")).toBe(true);
  expect(autoFailFor(stunned, "save", "感知")).toBe(false);
  expect(autoFailFor(stunned, "save", "魅力")).toBe(false);
});

test("combineAdv merges sources with 5e cancellation", () => {
  expect(combineAdv("advantage", "none")).toBe("advantage");
  expect(combineAdv("none", "disadvantage")).toBe("disadvantage");
  // Actor advantage + target attackAgainst disadvantage → cancel.
  expect(combineAdv("advantage", "disadvantage")).toBe("none");
  expect(combineAdv("advantage", "advantage", "disadvantage")).toBe("none");
  expect(combineAdv("none", "none")).toBe("none");
});

test("Stunned bundles STR/DEX auto-fail + attacks-against advantage + cantAct", () => {
  const stunned = CONDITION_BY_KEY["stunned"];
  expect(stunned.cantAct).toBe(true);
  expect(stunned.resistAllDamage).toBeUndefined();
  expect(advantageFor(stunned.specs, "attackAgainst")).toBe("advantage");
  expect(autoFailFor(stunned.specs, "save", "力量")).toBe(true);
  expect(autoFailFor(stunned.specs, "save", "敏捷")).toBe(true);
});

test("Paralyzed and Unconscious auto-fail STR/DEX and grant attacks-against advantage", () => {
  for (const key of ["paralyzed", "unconscious"] as const) {
    const c = CONDITION_BY_KEY[key];
    expect(c.cantAct).toBe(true);
    expect(autoFailFor(c.specs, "save", "力量")).toBe(true);
    expect(autoFailFor(c.specs, "save", "敏捷")).toBe(true);
    expect(advantageFor(c.specs, "attackAgainst")).toBe("advantage");
  }
});

test("Petrified resists all damage and auto-fails STR/DEX", () => {
  const petrified = CONDITION_BY_KEY["petrified"];
  expect(petrified.resistAllDamage).toBe(true);
  expect(petrified.cantAct).toBe(true);
  expect(autoFailFor(petrified.specs, "save", "力量")).toBe(true);
  expect(autoFailFor(petrified.specs, "save", "敏捷")).toBe(true);
  expect(advantageFor(petrified.specs, "attackAgainst")).toBe("advantage");
});

test("Blinded/Invisible model both own-attack and attacks-against adv/dis", () => {
  const blinded = CONDITION_BY_KEY["blinded"];
  expect(advantageFor(blinded.specs, "attack")).toBe("disadvantage");
  expect(advantageFor(blinded.specs, "attackAgainst")).toBe("advantage");
  const invisible = CONDITION_BY_KEY["invisible"];
  expect(advantageFor(invisible.specs, "attack")).toBe("advantage");
  expect(advantageFor(invisible.specs, "attackAgainst")).toBe("disadvantage");
});

test("hasResistAll / hasCantAct scan active conditions on a combatant", () => {
  const stunned: Effect = {
    type: "condition", conditionKey: "stunned", label: "Stunned",
    specs: CONDITION_BY_KEY["stunned"].specs, active: true,
  };
  const petrified: Effect = {
    type: "condition", conditionKey: "petrified", label: "Petrified",
    specs: CONDITION_BY_KEY["petrified"].specs, active: true,
  };
  const poisoned: Effect = {
    type: "condition", conditionKey: "poisoned", label: "Poisoned",
    specs: CONDITION_BY_KEY["poisoned"].specs, active: true,
  };
  expect(hasCantAct([stunned])).toBe(true);
  expect(hasCantAct([poisoned])).toBe(false);
  expect(hasResistAll([petrified])).toBe(true);
  expect(hasResistAll([stunned])).toBe(false);
  // Toggled off → contributes nothing.
  expect(hasCantAct([{ ...stunned, active: false }])).toBe(false);
  expect(hasResistAll([{ ...petrified, active: false }])).toBe(false);
});
