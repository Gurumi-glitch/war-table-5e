import { test, expect, afterEach, vi } from "vitest";
import { newGame } from "./testHelper";
import { create as createGame, getGameState } from "../convex/games";
import {
  create as createCharacter,
  update as updateCharacter,
  remove as removeCharacter,
  list as listCharacters,
  importCards,
  seedAll,
  CARD_FILE_FORMAT,
} from "../convex/characters";
import { MAX_CARD_BYTES, MAX_FIELD_CHARS } from "../convex/cardGuards";

/**
 * Backend-seam tests for prep-public-release: the `PLAYGROUND_MODE` flag and
 * the card-write customs. The load-bearing property is that the flag's DEFAULT
 * (unset) leaves every pre-existing behavior exactly as it was — a self-hoster
 * who configures nothing must get the friend-group table, not the demo.
 */

/** Run the backend with `PLAYGROUND_MODE=true` for this test. */
function playground() {
  vi.stubEnv("PLAYGROUND_MODE", "true");
}

afterEach(() => {
  vi.unstubAllEnvs();
});

/** Minimal valid card fields; override what a test is about. */
function charFields(overrides: Record<string, unknown> = {}) {
  return {
    player: "訪客",
    nameZh: "測試角色",
    nameEn: "Test",
    race: "人類",
    classesText: "戰士 1",
    level: 1,
    alignment: "中立",
    statusText: "正常",
    hp: 10,
    maxHp: 10,
    ac: 12,
    acFormula: "皮甲",
    speedText: "30呎",
    initBonus: 0,
    pb: 2,
    abilities: [{ key: "力量", score: 10, mod: 0 }],
    attackText: "",
    toolsText: "",
    goldText: "",
    refs: [],
    story: "",
    ...overrides,
  };
}

/** The envelope shape a frontend export produces (design D4). */
function envelope(cards: Record<string, unknown>[]) {
  return {
    format: CARD_FILE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    cards,
  };
}

// ── The safe default: no flag = the behavior that shipped before ────────────

test("flag unset: created cards are global and visible from every Game", async () => {
  const { t, playerToken } = await newGame();
  const other = await t.mutation(createGame, {});
  await t.mutation(createCharacter, { playerToken, fields: charFields() });

  // Visible from the Game that made it AND from an unrelated Game — the
  // cross-Game campaign continuity the friend group's table depends on.
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(1);
  expect(
    await t.query(listCharacters, { playerToken: other.playerToken }),
  ).toHaveLength(1);
});

test("flag unset: seeded cards stay editable (the game table's six cards)", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(seedAll, { playerToken });
  const [seeded] = await t.query(listCharacters, { playerToken });
  expect(seeded.seedKey).not.toBeNull();

  await t.mutation(updateCharacter, {
    playerToken,
    characterId: seeded._id,
    patch: { statusText: "中毒" },
  });
  const after = await t.query(listCharacters, { playerToken });
  expect(after.find((c: any) => c._id === seeded._id).statusText).toBe("中毒");
});

test("flag unset: getGameState reports playgroundMode false", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.playgroundMode).toBe(false);
});

// ── Playground: stamping + isolation ───────────────────────────────────────

test("playground: a visitor's card is confined to the Game that made it", async () => {
  playground();
  const { t, playerToken } = await newGame();
  const other = await t.mutation(createGame, {});
  await t.mutation(createCharacter, {
    playerToken,
    fields: charFields({ nameZh: "訪客A的卡" }),
  });

  const mine = await t.query(listCharacters, { playerToken });
  expect(mine.map((c: any) => c.nameZh)).toEqual(["訪客A的卡"]);
  // Visitor B, in their own Game, never sees it.
  expect(
    await t.query(listCharacters, { playerToken: other.playerToken }),
  ).toHaveLength(0);
});

test("playground: unstamped demo cards stay visible from every Game", async () => {
  const { t, playerToken } = await newGame();
  // Seeded before the flag flips (as the demo deployment does).
  await t.mutation(seedAll, { playerToken });
  const seededCount = (await t.query(listCharacters, { playerToken })).length;

  playground();
  const other = await t.mutation(createGame, {});
  await t.mutation(createCharacter, { playerToken, fields: charFields() });

  // Visitor B sees every demo card, and none of visitor A's.
  const theirs = await t.query(listCharacters, {
    playerToken: other.playerToken,
  });
  expect(theirs).toHaveLength(seededCount);
  expect(theirs.every((c: any) => c.seedKey !== null)).toBe(true);
  // A sees the demo cards plus their own.
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(
    seededCount + 1,
  );
});

test("playground: getGameState reports playgroundMode true", async () => {
  playground();
  const { t, playerToken, dmToken } = await newGame();
  const state = await t.query(getGameState, { playerToken, dmToken });
  expect(state.playgroundMode).toBe(true);
});

// ── Playground: seeded cards are read-only ─────────────────────────────────

test("playground: scribbling on a demo card is refused, card unchanged", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(seedAll, { playerToken });
  const [seeded] = await t.query(listCharacters, { playerToken });
  const before = seeded.statusText;

  playground();
  await expect(
    t.mutation(updateCharacter, {
      playerToken,
      characterId: seeded._id,
      patch: { statusText: "我到此一遊" },
    }),
  ).rejects.toThrow(/card\.seedReadOnly/);
  await expect(
    t.mutation(removeCharacter, { playerToken, characterId: seeded._id }),
  ).rejects.toThrow(/card\.seedReadOnly/);

  const after = await t.query(listCharacters, { playerToken });
  expect(after.find((c: any) => c._id === seeded._id).statusText).toBe(before);
});

test("playground: a visitor's own card stays editable", async () => {
  playground();
  const { t, playerToken } = await newGame();
  const id = await t.mutation(createCharacter, {
    playerToken,
    fields: charFields(),
  });
  await t.mutation(updateCharacter, {
    playerToken,
    characterId: id,
    patch: { nameZh: "改過名" },
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.nameZh).toBe("改過名");
});

// ── Size customs: all three write paths ────────────────────────────────────

const hugeField = "魔".repeat(MAX_FIELD_CHARS + 1);

test("create refuses an oversized field", async () => {
  const { t, playerToken } = await newGame();
  await expect(
    t.mutation(createCharacter, {
      playerToken,
      fields: charFields({ refs: [{ title: "狂野魔法", body: hugeField }] }),
    }),
  ).rejects.toThrow(/card\.fieldTooLong/);
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("update refuses an oversized field; the card keeps its content", async () => {
  const { t, playerToken } = await newGame();
  const id = await t.mutation(createCharacter, {
    playerToken,
    fields: charFields({ story: "原本的故事" }),
  });
  await expect(
    t.mutation(updateCharacter, {
      playerToken,
      characterId: id,
      patch: { story: hugeField },
    }),
  ).rejects.toThrow(/card\.fieldTooLong/);
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.story).toBe("原本的故事");
});

test("update refuses a patch that would push the whole card over the limit", async () => {
  const { t, playerToken } = await newGame();
  // Ten fat-but-legal ref sections, then one more that tips the card over.
  const section = (i: number) => ({
    title: `法術 ${i}`,
    body: "a".repeat(MAX_FIELD_CHARS),
  });
  const id = await t.mutation(createCharacter, {
    playerToken,
    fields: charFields({
      refs: Array.from({ length: 9 }, (_, i) => section(i)),
    }),
  });
  await expect(
    t.mutation(updateCharacter, {
      playerToken,
      characterId: id,
      patch: { refs: Array.from({ length: 11 }, (_, i) => section(i)) },
    }),
  ).rejects.toThrow(/card\.cardTooLarge/);
});

test("a real-length spell list saves fine (the limits are invisible in real use)", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(createCharacter, {
    playerToken,
    fields: charFields({
      refs: [{ title: "法術", body: "火球術 3環 8d6 火焰傷害。".repeat(300) }],
    }),
  });
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(1);
});

// ── Import customs ─────────────────────────────────────────────────────────

test("import: a legal one-card file creates the character", async () => {
  const { t, playerToken } = await newGame();
  const ids = await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields({ nameZh: "匯入來的" })]),
  });
  expect(ids).toHaveLength(1);
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.nameZh).toBe("匯入來的");
});

test("import: a multi-card file creates every card", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([
      charFields({ nameZh: "甲" }),
      charFields({ nameZh: "乙" }),
      charFields({ nameZh: "丙" }),
    ]),
  });
  const cards = await t.query(listCharacters, { playerToken });
  expect(cards.map((c: any) => c.nameZh).sort()).toEqual(["丙", "乙", "甲"]);
});

test("import: a file that isn't ours is refused, nothing written", async () => {
  const { t, playerToken } = await newGame();
  for (const bad of [
    { hello: "world" },
    { format: "some-other-tool", version: 1, cards: [charFields()] },
    { format: CARD_FILE_FORMAT, version: 1 },
    { format: CARD_FILE_FORMAT, version: 1, cards: [] },
    { format: CARD_FILE_FORMAT, version: 1, cards: ["not a card"] },
    null,
  ]) {
    await expect(
      t.mutation(importCards, { playerToken, envelope: bad }),
    ).rejects.toThrow(/card\.badEnvelope/);
  }
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("import: a hand-edited file cannot smuggle in seedKey or unknown fields", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([
      { ...charFields(), seedKey: "some_seeded_card", cheatMode: true },
    ]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  // Card exists; the smuggled fields did not survive customs.
  expect(card.seedKey).toBeNull();
  expect((card as any).cheatMode).toBeUndefined();
  await t.run(async (ctx: any) => {
    const doc = await ctx.db.get(card._id);
    expect(doc.seedKey).toBeUndefined();
    expect(doc.cheatMode).toBeUndefined();
  });
});

test("import: a claimed seedKey does not make the card read-only on the playground", async () => {
  playground();
  const { t, playerToken } = await newGame();
  // The scenario the strip protects against: forging a seedKey to make an
  // unremovable card on a public demo.
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([{ ...charFields(), seedKey: "some_seeded_card" }]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  await t.mutation(removeCharacter, { playerToken, characterId: card._id });
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("import: hp above maxHp is clamped to maxHp", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields({ hp: 999, maxHp: 20 })]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.hp).toBe(20);
});

test("import: negative hp is clamped to 0", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields({ hp: -5, maxHp: 20 })]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.hp).toBe(0);
});

test("import: an oversized file is refused and no card lands", async () => {
  const { t, playerToken } = await newGame();
  await expect(
    t.mutation(importCards, {
      playerToken,
      envelope: envelope([
        charFields({ refs: [{ title: "巨表", body: hugeField }] }),
      ]),
    }),
  ).rejects.toThrow(/card\.fieldTooLong/);
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("import: one bad card rolls the whole file back", async () => {
  const { t, playerToken } = await newGame();
  await expect(
    t.mutation(importCards, {
      playerToken,
      envelope: envelope([
        charFields({ nameZh: "好卡" }),
        charFields({ nameZh: "壞卡", story: hugeField }),
      ]),
    }),
  ).rejects.toThrow(/card\.fieldTooLong/);
  // An import lands whole or not at all — no half-imported party.
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("import: a card missing required fields is refused, nothing written", async () => {
  const { t, playerToken } = await newGame();
  const { nameZh, ...incomplete } = charFields();
  await expect(
    t.mutation(importCards, { playerToken, envelope: envelope([incomplete]) }),
  ).rejects.toThrow();
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("playground: imported cards are stamped like created ones", async () => {
  playground();
  const { t, playerToken } = await newGame();
  const other = await t.mutation(createGame, {});
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields()]),
  });
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(1);
  expect(
    await t.query(listCharacters, { playerToken: other.playerToken }),
  ).toHaveLength(0);
});

test("flag unset: imported cards are global (self-host behavior)", async () => {
  const { t, playerToken } = await newGame();
  const other = await t.mutation(createGame, {});
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields()]),
  });
  expect(
    await t.query(listCharacters, { playerToken: other.playerToken }),
  ).toHaveLength(1);
});

test("MAX_CARD_BYTES measures bytes, not characters (the cards are Chinese)", () => {
  // Guards the encoder choice: 300k Chinese characters is ~900KB of storage,
  // so a character-counted limit would let a card 3x the intended size land.
  expect(new TextEncoder().encode("魔").length).toBe(3);
  expect(MAX_CARD_BYTES).toBeLessThan(MAX_FIELD_CHARS * 3 * 10);
});

// ── Round-trip fidelity: the file IS the card ──────────────────────────────
// Since the private seed left the repo, an exported file is the only copy of a
// card outside the database. Anything these tests don't cover is data a wipe
// destroys for good.

test("import restores a card's resources, recipes, and effects", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([
      {
        ...charFields({ nameZh: "聖騎士" }),
        resources: [{ label: "聖療池", current: 3, max: 5 }],
        recipes: [
          {
            name: "聖療",
            hitType: "automatic",
            attackMod: 0,
            damageDice: [],
            damageMod: 5,
            damageType: "healing",
            dc: 0,
            saveAbility: "",
            critImmune: true,
            resourceKey: "聖療池",
            resourceCost: 1,
            multiTarget: "none",
            appliesMods: [],
          },
        ],
        effects: [
          {
            type: "custom",
            conditionKey: null,
            label: "蘑菇詛咒",
            specs: [{ stat: "ac", mode: "bonus", value: -1 }],
            active: true,
          },
        ],
      },
    ]),
  });

  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.resources).toHaveLength(1);
  expect(card.recipes).toHaveLength(1);
  expect(card.effects).toHaveLength(1);
  expect(card.resources[0].label).toBe("聖療池");
  expect(card.resources[0].current).toBe(3);
  expect(card.recipes[0].name).toBe("聖療");
  expect(card.effects[0].label).toBe("蘑菇詛咒");
});

test("a recipe's pool link is rebound to the NEW pool's id", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([
      {
        ...charFields(),
        resources: [
          { label: "法術位", current: 2, max: 2 },
          { label: "聖療池", current: 5, max: 5 },
        ],
        recipes: [
          {
            name: "聖療", hitType: "automatic", attackMod: 0, damageDice: [],
            damageMod: 5, damageType: "healing", dc: 0, saveAbility: "",
            critImmune: true, resourceKey: "聖療池", resourceCost: 1,
            multiTarget: "none", appliesMods: [],
          },
        ],
      },
    ]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  const pool = card.resources.find((r: any) => r.label === "聖療池");
  // Bound to the right pool — not the first one, not a stale id from the file.
  expect(card.recipes[0].resourceId).toBe(pool._id);
});

test("a recipe naming a pool that isn't in the file keeps the recipe, drops the link", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([
      {
        ...charFields(),
        resources: [],
        recipes: [
          {
            name: "聖療", hitType: "automatic", attackMod: 0, damageDice: [],
            damageMod: 5, damageType: "healing", dc: 0, saveAbility: "",
            critImmune: true, resourceKey: "不存在的池", resourceCost: 1,
            multiTarget: "none", appliesMods: [],
          },
        ],
      },
    ]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  // An unlinked recipe still rolls; silently binding it to the wrong pool, or
  // rejecting the whole character, would both be worse.
  expect(card.recipes).toHaveLength(1);
  expect(card.recipes[0].resourceId).toBeNull();
});

test("import strips ids and unknown keys from children instead of failing", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([
      {
        ...charFields(),
        // A hand-edited file, or one from another deployment: the ids are
        // meaningless here. Convex rejects undeclared fields on insert, so an
        // un-stripped stray key would fail the whole import.
        resources: [
          { _id: "stale", _creationTime: 1, characterId: "other", combatantId: "x",
            label: "聖療池", current: 5, max: 5, bogus: true },
        ],
        recipes: [],
        effects: [],
      },
    ]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.resources).toHaveLength(1);
  expect(card.resources[0].label).toBe("聖療池");
});

test("a card file with no children at all still imports", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields({ nameZh: "只有卡面" })]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.nameZh).toBe("只有卡面");
  expect(card.resources).toEqual([]);
  expect(card.recipes).toEqual([]);
});

test("tempHp survives the round-trip", async () => {
  const { t, playerToken } = await newGame();
  await t.mutation(importCards, {
    playerToken,
    envelope: envelope([charFields({ tempHp: 4 })]),
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.tempHp).toBe(4);
});

test("oversized children are refused and nothing lands", async () => {
  const { t, playerToken } = await newGame();
  await expect(
    t.mutation(importCards, {
      playerToken,
      envelope: envelope([
        { ...charFields(), resources: [{ label: hugeField, current: 1, max: 1 }] },
      ]),
    }),
  ).rejects.toThrow(/card\.fieldTooLong/);
  // Children are most of a card's bytes — a limit that skipped them isn't one.
  expect(await t.query(listCharacters, { playerToken })).toHaveLength(0);
});

test("cards exported before the rename still import (the backups must not rot)", async () => {
  const { t, playerToken } = await newGame();
  // A file a table already has on disk carries the old discriminator. Renaming
  // the project must not turn its own backups into "this isn't a card file".
  await t.mutation(importCards, {
    playerToken,
    envelope: {
      format: "dnd-combat-toolkit-character",
      version: 1,
      exportedAt: "2026-07-16T00:00:00.000Z",
      cards: [charFields({ nameZh: "舊格式匯出的卡" })],
    },
  });
  const [card] = await t.query(listCharacters, { playerToken });
  expect(card.nameZh).toBe("舊格式匯出的卡");
});

test("a genuinely foreign file is still refused after the rename", async () => {
  const { t, playerToken } = await newGame();
  await expect(
    t.mutation(importCards, {
      playerToken,
      envelope: { format: "some-other-tool-character", version: 1, cards: [charFields()] },
    }),
  ).rejects.toThrow(/card\.badEnvelope/);
});
