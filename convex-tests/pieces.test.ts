import { test, expect } from "vitest";
import { newGame, type BackendClient } from "./testHelper";
import { create as createPiece, move as movePiece, remove as removePiece, updateLabel, updatePortrait, list as listPieces } from "../convex/pieces";


async function storageId(t: BackendClient): Promise<string> {
  return await t.run(async (ctx: any) => {
    const blob = new Blob(["p"]);
    (blob as any).arrayBuffer = async () => new TextEncoder().encode("p").buffer;
    return await ctx.storage.store(blob);
  });
}

/** Whether a stored blob still exists (via the `_storage` system table). */
async function blobExists(t: BackendClient, id: string): Promise<boolean> {
  return await t.run(
    async (ctx: any) => (await ctx.db.system.get(id)) !== null,
  );
}

/** Insert a minimal character directly and return its id + name. */
async function makeCharacter(t: BackendClient, nameZh: string): Promise<string> {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("characters", {
      player: "P",
      nameZh,
      nameEn: "Hero",
      race: "人類",
      classesText: "戰士",
      level: 1,
      alignment: "中立",
      statusText: "",
      hp: 10,
      maxHp: 10,
      ac: 12,
      acFormula: "",
      speedText: "30",
      initBonus: 0,
      pb: 2,
      abilities: [],
      attackText: "",
      toolsText: "",
      goldText: "",
      refs: [],
      story: "",
    }),
  );
}

/** Insert a minimal enemy template directly and return its id. */
async function makeEnemy(t: BackendClient, nameZh: string): Promise<string> {
  return await t.run(async (ctx: any) =>
    ctx.db.insert("enemies", {
      source: "custom",
      nameZh,
      nameEn: "Ghoul",
      symbol: "",
      role: "",
      themeTags: "",
      size: "中型",
      creatureType: "不死",
      temperament: "",
      threatTier: 1,
      ac: 12,
      hpMax: 22,
      hpFormula: "",
      speedText: "30",
      abilities: [],
      saveBonuses: [],
      skills: [],
      senses: "",
      passivePerception: 10,
      languages: "",
      damageResistances: "",
      damageVulnerabilities: "",
      damageImmunities: "",
      conditionImmunities: "",
      traits: [],
      actions: [],
      bonusActions: [],
      reactions: [],
      legendaryActions: [],
      tactics: "",
      encounterNotes: "",
    }),
  );
}

test("ad-hoc piece creation is open (no DM token) and defaults to backstage", async () => {
  const { t, playerToken } = await newGame();
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "無名棋",
    color: "#0af",
  });
  const pieces = await t.query(listPieces, { playerToken });
  const p = pieces.find((x: any) => x._id === pieceId);
  expect(p.sourceType).toBe("none");
  expect(p.label).toBe("無名棋");
  expect(p.location.kind).toBe("backstage");
});

test("character-linked creation is open and snapshots the name", async () => {
  const { t, playerToken } = await newGame();
  const charId = await makeCharacter(t, "伊蓮娜");
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "character",
    characterId: charId,
    color: "#0af",
  });
  const pieces = await t.query(listPieces, { playerToken });
  const p = pieces.find((x: any) => x._id === pieceId);
  expect(p.label).toBe("伊蓮娜");
  expect(p.sourceType).toBe("character");
});

test("enemy-linked creation is DM-gated", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const enemyId = await makeEnemy(t, "食屍鬼");
  // Player (no/invalid dmToken) is rejected.
  await expect(
    t.mutation(createPiece, {
      playerToken,
      sourceType: "enemy",
      enemyId,
      color: "#f00",
    }),
  ).rejects.toThrow("DM token required");
  // DM succeeds and the name is snapshotted.
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    dmToken,
    sourceType: "enemy",
    enemyId,
    color: "#f00",
  });
  const pieces = await t.query(listPieces, { playerToken, dmToken });
  expect(pieces.find((x: any) => x._id === pieceId).label).toBe("食屍鬼");
});

test("move and remove are open to any caller", async () => {
  const { t, playerToken } = await newGame();
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "棋",
    color: "#fff",
  });
  await t.mutation(movePiece, {
    playerToken,
    pieceId,
    location: { kind: "backstage", x: 12, y: 80 },
  });
  let pieces = await t.query(listPieces, { playerToken });
  expect(pieces.find((x: any) => x._id === pieceId).location).toEqual({
    kind: "backstage",
    x: 12,
    y: 80,
  });
  await t.mutation(removePiece, { playerToken, pieceId });
  pieces = await t.query(listPieces, { playerToken });
  expect(pieces.find((x: any) => x._id === pieceId)).toBeUndefined();
});

test("editing the source Character after creation does not change the piece (snapshot, not live link)", async () => {
  const { t, playerToken } = await newGame();
  const charId = await makeCharacter(t, "原名");
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "character",
    characterId: charId,
    color: "#0af",
  });
  // Rename the character afterwards.
  await t.run(async (ctx: any) => ctx.db.patch(charId, { nameZh: "改名" }));
  const pieces = await t.query(listPieces, { playerToken });
  expect(pieces.find((x: any) => x._id === pieceId).label).toBe("原名");
});

test("updateLabel and updatePortrait override the piece's own fields", async () => {
  const { t, playerToken } = await newGame();
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "old",
    color: "#000",
  });
  await t.mutation(updateLabel, { playerToken, pieceId, label: "new", color: "#123" });
  const portrait = await storageId(t);
  await t.mutation(updatePortrait, { playerToken, pieceId, portraitStorageId: portrait });
  const pieces = await t.query(listPieces, { playerToken });
  const p = pieces.find((x: any) => x._id === pieceId);
  expect(p.label).toBe("new");
  expect(p.color).toBe("#123");
  expect(p.portraitUrl).not.toBeNull();
});

test("deleting a piece frees its portrait blob", async () => {
  const { t, playerToken } = await newGame();
  const portrait = await storageId(t);
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "棋",
    color: "#000",
    portraitStorageId: portrait,
  });
  expect(await blobExists(t, portrait)).toBe(true);
  await t.mutation(removePiece, { playerToken, pieceId });
  expect(await blobExists(t, portrait)).toBe(false);
});

test("replacing a portrait frees the old blob; clearing frees the current one", async () => {
  const { t, playerToken } = await newGame();
  const first = await storageId(t);
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "棋",
    color: "#000",
    portraitStorageId: first,
  });
  const second = await storageId(t);
  await t.mutation(updatePortrait, {
    playerToken,
    pieceId,
    portraitStorageId: second,
  });
  expect(await blobExists(t, first)).toBe(false);
  expect(await blobExists(t, second)).toBe(true);
  // Clearing (omit id) frees the current blob too.
  await t.mutation(updatePortrait, { playerToken, pieceId });
  expect(await blobExists(t, second)).toBe(false);
});

test("re-setting the same portrait id does not delete its blob", async () => {
  const { t, playerToken } = await newGame();
  const portrait = await storageId(t);
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "棋",
    color: "#000",
    portraitStorageId: portrait,
  });
  await t.mutation(updatePortrait, {
    playerToken,
    pieceId,
    portraitStorageId: portrait,
  });
  expect(await blobExists(t, portrait)).toBe(true);
});
