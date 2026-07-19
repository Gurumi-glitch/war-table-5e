import { test, expect } from "vitest";
import schema from "../convex/schema";
import { newGame } from "./testHelper";
import {
  create as createCharacter,
  importCards,
  list as listCharacters,
  CARD_FIELD_KEYS,
  CHILD_KEYS,
  CARD_FILE_FORMAT,
  REQUIRED_CARD_DEFAULTS,
} from "../convex/characters";
import { add as addRecipe } from "../convex/recipes";
import { add as addResource } from "../convex/resources";
import { addCustomModifier } from "../convex/effects";
import { joinBattle } from "../convex/characters";
import { toPortableCard } from "../src/lib/cardFile";

/**
 * THE card guarantee: a `.dndcard.json` is a complete card.
 *
 * Since the private seed left the repo, this file is the only form a character
 * takes outside the database — a backup, a move between deployments, and the
 * only way a demo visitor keeps anything. A field that silently fails to
 * round-trip is not a cosmetic bug: it is a character's spell list, their
 * class rules, or their story, gone, discovered only when someone tries to
 * restore and has to rewrite it from memory.
 *
 * Two kinds of test here, because a one-time audit rots:
 *
 *  1. STRUCTURAL — the schema is introspected and compared against the export
 *     whitelist. Add a column to `characters` (or to a child table) and forget
 *     the file format, and these fail immediately. This is the test that would
 *     have caught `tempHp`, which was writable by combat for months while being
 *     absent from the card view and therefore un-exportable.
 *
 *  2. BEHAVIORAL — a card with every field populated goes through the REAL
 *     path the Export button uses (`list` → `toPortableCard`) and the REAL
 *     import mutation, and must come back byte-identical.
 */

// Owner columns are plumbing, never card content: they say WHERE a row lives,
// and a file's rows are re-homed on import by definition.
const OWNER_KEYS = ["gameId", "combatantId", "characterId"];

/** The fields a table declares, minus the ones a card file must never carry. */
function schemaFields(table: string, exclude: string[]): string[] {
  const validator = (schema as any).tables[table].validator;
  return Object.keys(validator.fields)
    .filter((f) => !exclude.includes(f))
    .sort();
}

// ── 1. Structural: the file format covers every column that exists ──────────

test("every characters column is carried by the card file", () => {
  // `seedKey` is deliberately dropped (design D3: an exported card is yours,
  // not the demo's furniture); `gameId` is playground plumbing (D2).
  expect(schemaFields("characters", ["seedKey", "gameId"])).toEqual(
    [...CARD_FIELD_KEYS].sort(),
  );
});

test("every recipes column is carried by the card file", () => {
  // `resourceId` is excluded because the file links pools by label
  // (`resourceKey`) — ids are meaningless in another deployment.
  expect(schemaFields("recipes", [...OWNER_KEYS, "resourceId"])).toEqual(
    [...CHILD_KEYS.recipes].sort(),
  );
});

test("every resources column is carried by the card file", () => {
  expect(schemaFields("resources", OWNER_KEYS)).toEqual(
    [...CHILD_KEYS.resources].sort(),
  );
});

test("every effects column is carried by the card file", () => {
  expect(schemaFields("effects", OWNER_KEYS)).toEqual(
    [...CHILD_KEYS.effects].sort(),
  );
});

test("every required characters column has an import default", () => {
  // A file exported before a required column existed doesn't carry it; the
  // import must fill it rather than die in the schema validator. Add a
  // required column without extending REQUIRED_CARD_DEFAULTS and this fails.
  const validator = (schema as any).tables.characters.validator;
  const required = Object.keys(validator.fields).filter(
    (f) => validator.fields[f].isOptional !== "optional",
  );
  expect(required.length).toBeGreaterThan(0);
  for (const f of required) {
    expect(REQUIRED_CARD_DEFAULTS, `default for required field: ${f}`).toHaveProperty(f);
  }
});

// ── 2. Behavioral: a fully-populated card survives the real export path ─────

/**
 * Content chosen to break a naive round-trip: real Markdown (headings, bold,
 * lists, tables, code fences), hard newlines, CJK, quotes, emoji, backslashes.
 * The card renders `refs` bodies and `classRules` through SafeMarkdown, so the
 * preview is identical iff the string is identical — byte-exactness IS the
 * "preview doesn't break" guarantee.
 */
const MARKDOWN = `# 牧師：鮮血領域
*Blood Domain*

鮮血領域的牧師將血液視為**生命、犧牲與靈魂**之間的神聖媒介。

## 領域法術

| 等級 | 法術 |
| --- | --- |
| 1 | 造成傷害、治療真言 |
| 3 | 靜默、詭影術 |

- 第一項：血之聯結
- 第二項：\`1d8\` 額外傷害
  - 巢狀項目

> 引用區塊
> 第二行

\`\`\`
不該被 markdown 解析的區塊 **不要粗體**
\`\`\`

反斜線 \\ 與引號 " ' 與 emoji 🩸 與 <html> & 符號`;

/** Every card field set to a distinctive, non-default value. */
function fullCardFields() {
  return {
    player: "測試玩家",
    nameZh: "完整角色",
    nameEn: "Full Character",
    race: "蓮花半身人（小型）",
    classesText: "聖騎士：復仇之誓 (1)\n牧師：鮮血領域 (0，未啟用)",
    level: 3,
    alignment: "混亂善良",
    statusText: "中毒",
    hp: 7,
    maxHp: 12,
    tempHp: 4,
    ac: 18,
    acFormula: "鎖子甲 16 + 盾牌 2",
    speedText: "25呎",
    initBonus: 2,
    pb: 2,
    abilities: [
      { key: "力量", score: 16, mod: 3 },
      { key: "敏捷", score: 10, mod: 0 },
      { key: "體質", score: 14, mod: 2 },
      { key: "智力", score: 8, mod: -1 },
      { key: "感知", score: 16, mod: 3 },
      { key: "魅力", score: 12, mod: 1 },
    ],
    spellcastingAbility: "魅力",
    spellAttack: 4,
    spellDc: 12,
    passivePerception: 10,
    // 攻擊 · 熟練 · 財產 — the section the card shows under one header but
    // stores as three separate fields.
    attackText: "武器命中 +5 ・ 法術命中 +4",
    saves: [{ key: "魅力", prof: true, total: 3 }],
    skills: [{ key: "運動", ability: "力量", prof: "expertise", total: 7 }],
    savesText: "（棄用欄位，仍須保留）",
    skillsText: "（棄用欄位，仍須保留）",
    toolsText: "護甲：輕甲、中甲、重甲、盾牌；工具：皮匠工具；語言：通用語、半身人語",
    goldText: "15 金幣",
    // 法術 與 特性 — long-form Markdown reference sections.
    refs: [
      { title: "法術", body: MARKDOWN },
      { title: "神聖感知", body: "直到下回合結束…\n\n第二段落。" },
      { title: "空白段落", body: "" },
    ],
    // 職業特殊規則 — Markdown, previewed per block.
    classRules: [MARKDOWN, "第二條規則\n\n- 一\n- 二"],
    // 角色故事
    story: "逃離沼澤的騎士；詛咒正在侵蝕身體。\n\n第二段。",
  };
}

/** Build a card with every field AND every kind of child row populated. */
async function seedFullCard(t: any, playerToken: string) {
  const characterId = await t.mutation(createCharacter, {
    playerToken,
    fields: fullCardFields(),
  });
  await t.mutation(addResource, {
    playerToken,
    characterId,
    label: "聖療池",
    max: 5,
    current: 3,
  });
  await t.mutation(addRecipe, {
    playerToken,
    characterId,
    recipe: {
      name: "聖療：治療",
      hitType: "automatic",
      attackMod: 0,
      damageDice: [{ type: "d8", count: 2 }],
      damageMod: 5,
      damageType: "healing",
      dc: 0,
      saveAbility: "",
      critImmune: true,
      resourceCost: 1,
      multiTarget: "none",
      appliesMods: [{ stat: "ac", mode: "bonus", value: 5, note: "護盾" }],
      extraRolls: [
        {
          label: "氣勢",
          usage: "roleplay",
          dice: [{ type: "d6", count: 1 }],
          damageMod: 0,
          damageType: "",
        },
      ],
    },
  });
  // A character-owned effect can ONLY be made through a linked combatant:
  // `addCustomModifier` takes a combatantId, and ownership.childOwner then
  // stamps the row onto the CARD (which is why it outlives the Game — and why
  // the card file has to carry it).
  const combatantId = await t.mutation(joinBattle, { playerToken, characterId });
  await t.mutation(addCustomModifier, {
    playerToken,
    combatantId,
    label: "蘑菇詛咒",
    specs: [{ stat: "ac", mode: "bonus", value: -1, note: "鬼婆" }],
  });
  return characterId;
}

/** Link a card's recipe to its pool, the way the card editor does. */
async function linkPool(t: any, playerToken: string, characterId: string) {
  const [card] = await t.query(listCharacters, { playerToken });
  await t.run(async (ctx: any) => {
    await ctx.db.patch(card.recipes[0]._id, {
      resourceId: card.resources[0]._id,
    });
  });
}

test("a pre-rename export (dnd-combat-toolkit-character) is still accepted", async () => {
  // Files exported before the project rename carry the old discriminator.
  // Verified 2026-07-19 against all six real prod-backup-2026-07-16 cards;
  // this inline minimal card is the committable stand-in for那批私人檔案.
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: {
      format: "dnd-combat-toolkit-character",
      version: 1,
      exportedAt: "2026-07-16T00:00:00.000Z",
      cards: [{ nameZh: "舊版匯出", nameEn: "Legacy", hp: 10, maxHp: 10 }],
    },
  });
  const cards = await t.query(listCharacters, { playerToken });
  expect(cards.some((c: any) => c.nameZh === "舊版匯出")).toBe(true);
});

test("a fully-populated card survives export → import byte-identically", async () => {
  const { t, playerToken } = await newGame();
  const characterId = await seedFullCard(t, playerToken);
  await linkPool(t, playerToken, characterId);

  // The REAL export path: what the ⬇ Export button serializes.
  const [original] = await t.query(listCharacters, { playerToken });
  const file = {
    format: CARD_FILE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    // Through JSON, exactly as a downloaded file would be.
    cards: [JSON.parse(JSON.stringify(toPortableCard(original as any)))],
  };

  await t.mutation(importCards, { playerToken, envelope: file });
  const cards = await t.query(listCharacters, { playerToken });
  const restored = cards.find((c: any) => c._id !== original._id)!;

  // Every card field identical — enumerated from the whitelist itself, so a
  // new field is covered the day it is added rather than the day someone
  // remembers to extend this test.
  for (const key of CARD_FIELD_KEYS) {
    expect(restored[key], `card field: ${key}`).toEqual(original[key]);
  }
});

test("Markdown in 法術/特性, 職業特殊規則 and 角色故事 round-trips exactly", async () => {
  const { t, playerToken } = await newGame();
  await seedFullCard(t, playerToken);
  const [original] = await t.query(listCharacters, { playerToken });

  await t.mutation(importCards, {
    playerToken,
    envelope: {
      format: CARD_FILE_FORMAT,
      version: 1,
      cards: [JSON.parse(JSON.stringify(toPortableCard(original as any)))],
    },
  });
  const restored = (await t.query(listCharacters, { playerToken })).find(
    (c: any) => c._id !== original._id,
  )!;

  // SafeMarkdown renders the preview from these strings, so identical strings
  // mean an identical preview. Headings, tables, fences, newlines, emoji.
  expect(restored.refs[0].body).toBe(MARKDOWN);
  expect(restored.classRules[0]).toBe(MARKDOWN);
  expect(restored.story).toBe(original.story);
  expect(restored.refs).toEqual(original.refs);
  expect(restored.classRules).toEqual(original.classRules);
  // Not merely equal — the exact newline structure the preview depends on.
  expect(restored.refs[0].body.split("\n")).toEqual(MARKDOWN.split("\n"));
  expect(restored.refs[2].body).toBe("");
});

test("攻擊 · 熟練 · 財產 round-trips (three fields under one card heading)", async () => {
  const { t, playerToken } = await newGame();
  await seedFullCard(t, playerToken);
  const [original] = await t.query(listCharacters, { playerToken });

  await t.mutation(importCards, {
    playerToken,
    envelope: {
      format: CARD_FILE_FORMAT,
      version: 1,
      cards: [JSON.parse(JSON.stringify(toPortableCard(original as any)))],
    },
  });
  const restored = (await t.query(listCharacters, { playerToken })).find(
    (c: any) => c._id !== original._id,
  )!;

  expect(restored.attackText).toBe(original.attackText);
  expect(restored.toolsText).toBe(original.toolsText);
  expect(restored.goldText).toBe(original.goldText);
});

test("a card's recipes, pools and effects survive with their linkage", async () => {
  const { t, playerToken } = await newGame();
  const characterId = await seedFullCard(t, playerToken);
  await linkPool(t, playerToken, characterId);
  const [original] = await t.query(listCharacters, { playerToken });

  await t.mutation(importCards, {
    playerToken,
    envelope: {
      format: CARD_FILE_FORMAT,
      version: 1,
      cards: [JSON.parse(JSON.stringify(toPortableCard(original as any)))],
    },
  });
  const restored = (await t.query(listCharacters, { playerToken })).find(
    (c: any) => c._id !== original._id,
  )!;

  const strip = (rows: any[], drop: string[]) =>
    rows.map((r) =>
      Object.fromEntries(
        Object.entries(r).filter(([k]) => !drop.includes(k)),
      ),
    );
  const ids = ["_id", "_creationTime", "combatantId", "resourceId"];
  expect(strip(restored.resources, ids)).toEqual(strip(original.resources, ids));
  expect(strip(restored.recipes, ids)).toEqual(strip(original.recipes, ids));
  expect(strip(restored.effects, ids)).toEqual(strip(original.effects, ids));

  // The pool link points at the RESTORED card's own pool, not the original's.
  expect(restored.recipes[0].resourceId).toBe(restored.resources[0]._id);
  expect(restored.recipes[0].resourceId).not.toBe(original.recipes[0].resourceId);
});
