import { test, expect } from "vitest";
import { LIBRARY, WEAPONS, SPELLS, toRecipeDraft } from "../convex/recipeLibrary";
import type { LibraryEntry } from "../convex/recipeLibrary";

/**
 * The weapons + spells database is generated from the PHB 2014 reference CSVs
 * (issue #7). These tests pin the count + the mapping rules for representative
 * entries across every hit type / special case, so a regen that drifts the
 * mapping is caught.
 */

const byId = (id: string): LibraryEntry => {
  const e = LIBRARY.find((x) => x.id === id);
  if (!e) throw new Error(`missing library entry ${id}`);
  return e;
};

test("database has every SRD weapon + spell", () => {
  expect(WEAPONS.length).toBe(37);
  expect(SPELLS.length).toBe(319);
  expect(LIBRARY.length).toBe(356);
  // ids are unique
  const ids = new Set(LIBRARY.map((e) => e.id));
  expect(ids.size).toBe(LIBRARY.length);
});

test("every entry has a name, kind, and valid hit type", () => {
  for (const e of LIBRARY) {
    expect(e.name.length).toBeGreaterThan(0);
    expect(e.kind === "weapon" || e.kind === "spell").toBe(true);
    expect(["attack", "save", "automatic"]).toContain(e.hitType);
  }
});

test("weapons map to attack recipes with dice + physical damage type", () => {
  const club = byId("weapon_club");
  expect(club.hitType).toBe("attack");
  expect(club.damageDice).toEqual([{ type: "d4", count: 1 }]);
  expect(club.damageType).toBe("bludgeoning");
  expect(club.critImmune).toBe(false);
  expect(club.multiTarget).toBe("none");
  expect(club.attackMod).toBe(0); // DM enters STR/PB

  const dagger = byId("weapon_dagger");
  expect(dagger.damageType).toBe("piercing");
  expect(dagger.ref.properties).toContain("Thrown");

  const longsword = byId("weapon_longsword");
  expect(longsword.damageDice).toEqual([{ type: "d8", count: 1 }]);
  expect(longsword.damageType).toBe("slashing");
  expect(longsword.ref.versatile).toBe("1d10");
});

test("spell attacks can crit; the d10 force cantrip maps correctly", () => {
  const eb = byId("spell_eldritch_blast");
  expect(eb.hitType).toBe("attack");
  expect(eb.damageDice).toEqual([{ type: "d10", count: 1 }]);
  expect(eb.damageType).toBe("force");
  expect(eb.critImmune).toBe(false); // spell attacks CAN crit
  expect(eb.ref.level).toBe(0); // cantrip
});

test("save spells never crit, take save ability + AoE flag", () => {
  const fb = byId("spell_fireball");
  expect(fb.hitType).toBe("save");
  expect(fb.saveAbility).toBe("dex");
  // base-dice heuristic: "1d6|8d6" → 8d6 is the base, not the upcast step
  expect(fb.damageDice).toEqual([{ type: "d6", count: 8 }]);
  expect(fb.damageType).toBe("fire");
  expect(fb.critImmune).toBe(true); // saves never crit
  expect(fb.multiTarget).toBe("aoe");
  expect(fb.ref.level).toBe(3);
  expect(fb.ref.concentration).toBe(false);

  const sacred = byId("spell_sacred_flame");
  // cantrip scaling "1d8|2d8|3d8|4d8" → first tier (1d8)
  expect(sacred.damageDice).toEqual([{ type: "d8", count: 1 }]);
  expect(sacred.hitType).toBe("save");
  expect(sacred.saveAbility).toBe("dex");
  expect(sacred.ref.level).toBe(0);
});

test("Magic Missile is force/darts/critImmune with the +1 per dart", () => {
  const mm = byId("spell_magic_missile");
  expect(mm.hitType).toBe("automatic");
  expect(mm.damageType).toBe("force");
  expect(mm.critImmune).toBe(true);
  expect(mm.multiTarget).toBe("darts");
  expect(mm.damageDice).toEqual([{ type: "d4", count: 1 }]);
  expect(mm.damageMod).toBe(1); // "1d4+1" → +1 per dart
});

test("healing spells route to automatic + healing type, capped dice", () => {
  const cw = byId("spell_cure_wounds");
  expect(cw.hitType).toBe("automatic");
  expect(cw.damageType).toBe("healing");
  expect(cw.damageDice).toEqual([{ type: "d8", count: 1 }]);
  expect(cw.critImmune).toBe(true);
  expect(cw.ref.level).toBe(1);
});

test("toRecipeDraft strips reference metadata", () => {
  const fb = byId("spell_fireball");
  const draft = toRecipeDraft(fb);
  expect(draft).toEqual({
    name: "Fireball",
    hitType: "save",
    attackMod: 0,
    damageDice: [{ type: "d6", count: 8 }],
    damageMod: 0,
    damageType: "fire",
    dc: 0,
    saveAbility: "dex",
    critImmune: true,
    resourceCost: 0,
    multiTarget: "aoe",
    appliesMods: [],
    extraRolls: [],
  });
  // no ref leaked
  expect((draft as unknown as { ref?: unknown }).ref).toBeUndefined();
});

test("buff spells carry pre-seeded appliesMods; Shield is a pure buff (no dice, no heal)", () => {
  const shield = byId("spell_shield");
  expect(shield.hitType).toBe("automatic");
  expect(shield.damageDice).toEqual([]); // no dice — it's a buff, not damage/heal
  expect(shield.damageType).toBe(""); // NOT mislabeled "healing"
  expect(shield.appliesMods).toEqual([
    { stat: "ac", mode: "bonus", value: 5, note: expect.any(String), direction: "self" },
  ]);

  const sof = byId("spell_shield_of_faith");
  expect(sof.appliesMods[0]).toMatchObject({ stat: "ac", mode: "bonus", value: 2 });

  const haste = byId("spell_haste");
  expect(haste.appliesMods[0]).toMatchObject({ stat: "ac", mode: "bonus", value: 2 });

  const ts = byId("spell_true_strike");
  expect(ts.appliesMods[0]).toMatchObject({ stat: "attack", mode: "advantage", value: 0 });
});

test("self-range buffs direct every spec at the caster; targeted buffs stay on targets (PHB p.275/p.284)", () => {
  // Shield (range: Self) and True Strike (the CASTER gains the advantage)
  // must carry direction:"self" on every row — without it the chip lands on
  // the confirmed enemy target, inverting the spell.
  for (const id of ["spell_shield", "spell_true_strike"]) {
    for (const m of byId(id).appliesMods) {
      expect(m.direction, `${id} spec should be self-directed`).toBe("self");
    }
  }
  // Shield of Faith targets "a creature of your choice" — legacy targets flow.
  for (const m of byId("spell_shield_of_faith").appliesMods) {
    expect(m.direction).toBeUndefined();
  }
});

test("flat-amount heal is curated: Heal restores 70 (PHB p.250); full-heal spells stay manual", () => {
  const heal = byId("spell_heal");
  expect(heal.hitType).toBe("automatic");
  expect(heal.damageDice).toEqual([]); // PHB gives a fixed 70, no dice
  expect(heal.damageType).toBe("healing");
  expect(heal.damageMod).toBe(70);
  // Blinded/deafened/disease removal stays manual — surfaced in the note.
  expect(heal.ref.note).toContain("70");

  // Mass Heal is a 700-point pool split freely — no single number to bake in:
  // zero effect + manual guidance (healing type + forceDamage). Power Word Heal
  // used to be asserted alongside it; it is not in the SRD, so an SRD-sourced
  // library legitimately has no such entry.
  const massHeal = byId("spell_mass_heal");
  expect(massHeal.damageType).toBe("");
  expect(massHeal.damageMod).toBe(0);
  expect(massHeal.ref.note).toContain("healing");
  expect(LIBRARY.find((e) => e.id === "spell_power_word_heal")).toBeUndefined();
});

test("temp-HP spells grant tempHp rows to the caster, never healing (PHB p.198)", () => {
  const falseLife = byId("spell_false_life");
  expect(falseLife.hitType).toBe("automatic");
  expect(falseLife.damageType).toBe(""); // temp HP, not healing
  // The 1d4+4 grant lives on the tempHp row, NOT the main damage fields —
  // leftover dice/mod there would resolve as untyped damage at Confirm.
  expect(falseLife.damageDice).toEqual([]);
  expect(falseLife.damageMod).toBe(0);
  expect(falseLife.appliesMods).toEqual([
    {
      stat: "tempHp",
      mode: "bonus",
      value: 4,
      dice: [{ type: "d4", count: 1 }],
      direction: "self",
      note: expect.any(String),
    },
  ]);

  // Armor of Agathys is a warlock spell outside the SRD — not in an
  // SRD-sourced library, so there is nothing to curate.
  expect(LIBRARY.find((e) => e.id === "spell_armor_of_agathys")).toBeUndefined();

  // Aid & Heroes' Feast raise the hp MAXIMUM — no tempHp row (wrong
  // mechanism); zero effect + manual guidance in the note.
  // (The retired CSV misspelled this id as `spell_heros_feast`; the SRD's own
  // index spells it correctly, so the id changed with the source.)
  for (const id of ["spell_aid", "spell_heroes_feast"]) {
    const e = byId(id);
    expect(e.appliesMods).toEqual([]);
    expect(e.ref.note).toContain("maxHp");
  }
});

test("curated combat buffs the engine can express: Blur, Faerie Fire, Invisibility, Magic Weapon", () => {
  // Blur (PHB p.219): attacks against YOU have disadvantage → self.
  expect(byId("spell_blur").appliesMods).toEqual([
    expect.objectContaining({ stat: "attackAgainst", mode: "disadvantage", direction: "self" }),
  ]);

  // Faerie Fire (PHB p.239): attacks against the failed-save TARGETS have advantage.
  expect(byId("spell_faerie_fire").appliesMods).toEqual([
    expect.objectContaining({ stat: "attackAgainst", mode: "advantage", direction: "targets" }),
  ]);

  // Invisibility (p.254) / Greater Invisibility (p.246): the invisible TARGET
  // attacks with advantage and is attacked with disadvantage.
  for (const id of ["spell_invisibility", "spell_greater_invisibility"]) {
    expect(byId(id).appliesMods, id).toEqual([
      expect.objectContaining({ stat: "attack", mode: "advantage", direction: "targets" }),
      expect.objectContaining({ stat: "attackAgainst", mode: "disadvantage", direction: "targets" }),
    ]);
  }

  // Magic Weapon (p.257): +1 attack (the +1 damage stays manual — noted).
  expect(byId("spell_magic_weapon").appliesMods).toEqual([
    expect.objectContaining({ stat: "attack", mode: "bonus", value: 1, direction: "targets" }),
  ]);
});

test("dice-bonus and AC-set buffs get value:0 note-only reminder chips (math untouched)", () => {
  // Bless/Bane/Guidance/Resistance (+/-1d4: no dice-bonus mode) and Mage
  // Armor/Barkskin (AC-set: override is min-wins, would LOWER a high AC) stay
  // out of the math — but a value:0 bonus row makes them a visible,
  // toggleable chip instead of silently doing nothing.
  for (const id of [
    "spell_bless",
    "spell_bane",
    "spell_guidance",
    "spell_resistance",
    "spell_mage_armor",
    "spell_barkskin",
  ]) {
    const mods = byId(id).appliesMods;
    expect(mods.length, id).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m.mode, id).toBe("bonus");
      expect(m.value, id).toBe(0);
      expect(m.note, `${id} needs the manual instruction`).toBeTruthy();
    }
  }
});

test("damage spells have no pre-seeded appliesMods", () => {
  expect(byId("spell_fireball").appliesMods).toEqual([]);
  expect(byId("spell_eldritch_blast").appliesMods).toEqual([]);
  expect(byId("weapon_longsword").appliesMods).toEqual([]);
});

test("multi-target distribution looks sane", () => {
  const aoe = SPELLS.filter((s) => s.multiTarget === "aoe");
  const darts = SPELLS.filter((s) => s.multiTarget === "darts");
  expect(aoe.length).toBeGreaterThan(5); // Fireball, Cone of Cold, …
  expect(darts).toEqual([expect.objectContaining({ id: "spell_magic_missile" })]);
});

test("the library is a PRESET: nothing downstream re-derives a spell's numbers", () => {
  // #33's lesson, generalized. A library entry is a starting point that gets
  // COPIED onto a recipe and stays editable — so no engine, UI, or seed may
  // encode what a given spell "should" do. If the DM edits Magic Missile's
  // per-dart modifier to 0, it must be 0.
  const mm = byId("spell_magic_missile");
  // Per dart, not per volley: Confirm multiplies by dart count, so the entry
  // carries 1d4+1 (three darts → 3d4+3 = SRD RAW). Baking the volley in would
  // total the same on one target and make the darts unsplittable.
  expect(mm.damageDice).toEqual([{ type: "d4", count: 1 }]);
  expect(mm.damageMod).toBe(1);
  expect(mm.multiTarget).toBe("darts");

  // toRecipeDraft hands the numbers over wholesale — the recipe owns them from
  // that point, and nothing keeps a link back to the library entry.
  const draft = toRecipeDraft(mm);
  expect(draft.damageMod).toBe(1);
  expect(draft.damageDice).toEqual([{ type: "d4", count: 1 }]);
  expect((draft as unknown as { id?: unknown }).id).toBeUndefined();

  // An edited copy is just data: no field ties it back to Magic Missile.
  const edited = { ...draft, damageMod: 0, multiTarget: "none" as const };
  expect(edited.damageMod).toBe(0);
});
