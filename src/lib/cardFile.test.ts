import { expect, test } from "vitest";
import type { CharacterView } from "../../convex/characters";
import { zhTW } from "../i18n/locales/zh-TW";
import { en } from "../i18n/locales/en";
import {
  CARD_FILE_FORMAT,
  buildCardFile,
  blankCardFields,
  cardErrorMessage,
  toPortableCard,
} from "./cardFile";

/**
 * Card export/import (design D4). The stakes: a demo visitor's exported file
 * is the ONLY copy of their character once the demo is wiped, so anything this
 * module drops is gone for good.
 */

function card(overrides: Partial<CharacterView> = {}): CharacterView {
  return {
    _id: "ch1",
    _creationTime: 1700000000,
    portraitUrl: null,
    seedKey: "some_seeded_card",
    player: "測試玩家",
    nameZh: "測試角色",
    nameEn: "TestHero",
    race: "蓮花半身人",
    classesText: "聖騎士 1",
    level: 1,
    alignment: "混亂善良",
    statusText: "正常",
    hp: 12,
    maxHp: 12,
    tempHp: 0,
    ac: 15,
    acFormula: "鎖子甲 + 盾牌",
    speedText: "25呎",
    initBonus: 0,
    pb: 2,
    abilities: [{ key: "力量", score: 16, mod: 3 }],
    spellcastingAbility: "魅力",
    spellAttack: 5,
    spellDc: 13,
    passivePerception: 13,
    attackText: "命中 +5",
    saves: [{ key: "力量", prof: true, total: 5 }],
    skills: [{ key: "運動", ability: "力量", prof: "proficient", total: 5 }],
    toolsText: "皮匠工具",
    goldText: "15 金幣",
    refs: [{ title: "聖療", body: "治療能量池" }],
    classRules: ["每長休一次"],
    story: "示範用的角色故事。",
    resources: [
      { _id: "res1", _creationTime: 0, combatantId: "ch1", label: "聖療池", current: 3, max: 5 },
    ],
    recipes: [
      {
        _id: "rec1",
        _creationTime: 0,
        combatantId: "ch1",
        name: "聖療",
        hitType: "automatic",
        attackMod: 0,
        damageDice: [],
        damageMod: 5,
        damageType: "healing",
        dc: 0,
        saveAbility: "",
        critImmune: true,
        resourceId: "res1",
        resourceCost: 1,
        multiTarget: "none",
        appliesMods: [],
        extraRolls: [],
      },
    ],
    effects: [
      {
        _id: "eff1",
        _creationTime: 0,
        combatantId: "ch1",
        type: "custom",
        conditionKey: null,
        label: "蘑菇詛咒",
        specs: [{ stat: "ac", mode: "bonus", value: -1 }],
        active: true,
      },
    ],
    ...overrides,
  };
}

test("an exported card drops database identity and the seed marker", () => {
  const portable = toPortableCard(card());
  for (const key of ["_id", "_creationTime", "seedKey"]) {
    expect(portable).not.toHaveProperty(key);
  }
});

test("an exported card carries its recipes, resources, and effects", () => {
  // The card file is the only form a card takes outside the database, so this
  // is the difference between a backup and a stat block. A Paladin without
  // 聖療 and its pool is not the character that was exported.
  const portable = toPortableCard(card()) as Record<string, any>;
  expect(portable.resources).toHaveLength(1);
  expect(portable.recipes).toHaveLength(1);
  expect(portable.effects).toHaveLength(1);
  expect(portable.resources[0]).toEqual({ label: "聖療池", current: 3, max: 5 });
});

test("exported children carry no database ids", () => {
  const portable = toPortableCard(card()) as Record<string, any>;
  for (const row of [...portable.resources, ...portable.recipes, ...portable.effects]) {
    for (const key of ["_id", "_creationTime", "combatantId", "characterId", "resourceId"]) {
      expect(row).not.toHaveProperty(key);
    }
  }
});

test("a recipe's pool link survives as the pool's label, not its id", () => {
  // Ids are meaningless in another deployment; the label is what makes the
  // link portable — and readable to someone opening the file.
  const portable = toPortableCard(card()) as Record<string, any>;
  expect(portable.recipes[0].resourceKey).toBe("聖療池");
});

test("a recipe with no pool exports no key at all", () => {
  const portable = toPortableCard(
    card({
      recipes: [{ ...card().recipes[0], resourceId: null }],
    }),
  ) as Record<string, any>;
  expect(portable.recipes[0]).not.toHaveProperty("resourceKey");
});

test("tempHp is exported (combat writes it to the card)", () => {
  const portable = toPortableCard(card({ tempHp: 4 })) as Record<string, any>;
  expect(portable.tempHp).toBe(4);
});

test("an exported card keeps every field the player filled in", () => {
  const portable = toPortableCard(card());
  // The whole point of Export is that nothing about the character is lost —
  // spot-check one field from each section of the sheet.
  expect(portable.nameZh).toBe("測試角色");
  expect(portable.abilities).toEqual([{ key: "力量", score: 16, mod: 3 }]);
  expect(portable.saves).toEqual([{ key: "力量", prof: true, total: 5 }]);
  expect(portable.refs).toEqual([{ title: "聖療", body: "治療能量池" }]);
  expect(portable.classRules).toEqual(["每長休一次"]);
  expect(portable.story).toBe("示範用的角色故事。");
  expect(portable.spellDc).toBe(13);
});

test("the envelope is what the server's import customs expects", () => {
  const file = buildCardFile([card(), card({ nameZh: "第二張" })]);
  expect(file.format).toBe(CARD_FILE_FORMAT);
  expect(file.version).toBe(2);
  expect(file.cards).toHaveLength(2);
  expect(Date.parse(file.exportedAt)).not.toBeNaN();
});

test("a blank card opens with consistent derived values, not zeros", () => {
  const fields = blankCardFields(zhTW) as Record<string, any>;
  expect(fields.abilities).toHaveLength(6);
  expect(fields.abilities.every((a: any) => a.score === 10 && a.mod === 0)).toBe(
    true,
  );
  expect(fields.level).toBe(1);
  expect(fields.pb).toBe(2);
  // Save/skill templates are pre-built, so the sheet reads right on first open
  // instead of waiting for a Recalc the user doesn't know to press.
  expect(fields.saves).toHaveLength(6);
  expect(fields.skills.length).toBeGreaterThan(0);
  expect(fields.nameZh).toBe(zhTW.card.newCardName);
});

test("a blank card is named in the creator's language", () => {
  expect((blankCardFields(en) as Record<string, unknown>).nameZh).toBe(
    en.card.newCardName,
  );
});

test("each customs rejection maps to its own localized explanation", () => {
  const cases = [
    ["card.fieldTooLong", zhTW.cardErrors.fieldTooLong],
    ["card.cardTooLarge", zhTW.cardErrors.cardTooLarge],
    ["card.badEnvelope", zhTW.cardErrors.badEnvelope],
    ["card.seedReadOnly", zhTW.cardErrors.seedReadOnly],
  ] as const;
  for (const [code, expected] of cases) {
    expect(cardErrorMessage({ data: { code } }, zhTW)).toBe(expected);
  }
});

test("rejections are rendered in the reader's language, not the server's", () => {
  const err = { data: { code: "card.seedReadOnly" } };
  expect(cardErrorMessage(err, en)).toBe(en.cardErrors.seedReadOnly);
  expect(cardErrorMessage(err, zhTW)).toBe(zhTW.cardErrors.seedReadOnly);
});

test("a size rejection points at the way out, not just the wall", () => {
  // The limit only exists because someone pasted a huge table; the message has
  // to tell them where the table should live instead.
  expect(cardErrorMessage({ data: { code: "card.fieldTooLong" } }, en)).toMatch(
    /external doc/i,
  );
  expect(cardErrorMessage({ data: { code: "card.seedReadOnly" } }, en)).toMatch(
    /export/i,
  );
});

test("an unrecognized failure still says something", () => {
  // Silence looks exactly like success, and the next thing the user does after
  // a save they think worked is close the tab.
  for (const err of [
    new Error("network down"),
    { data: { code: "card.somethingNewer" } },
    { data: "not an object" },
    undefined,
    null,
  ]) {
    expect(cardErrorMessage(err, zhTW)).toBe(zhTW.cardErrors.unknown);
  }
});
