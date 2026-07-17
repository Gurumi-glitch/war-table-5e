import { test, expect } from "vitest";
import { newGame, newTestClient, type BackendClient } from "./testHelper";
import { create as createGame } from "../convex/games";
import {
  create as createMap,
  remove as removeMap,
  setActive,
  updateGrid,
  list as listMaps,
} from "../convex/maps";
import { create as createPiece, list as listPieces } from "../convex/pieces";


/**
 * Store a throwaway image blob and return its `_storage` id. edge-runtime's
 * `Blob` doesn't implement `.arrayBuffer()`, which convex-test's `storage.store`
 * calls to hash the content — patch it so the store succeeds in the test VM.
 */
async function storageId(t: BackendClient): Promise<string> {
  return await t.run(async (ctx: any) => {
    const blob = new Blob(["img"]);
    (blob as any).arrayBuffer = async () => new TextEncoder().encode("img").buffer;
    return await ctx.storage.store(blob);
  });
}

/** Whether a stored blob still exists (via the `_storage` system table). */
async function blobExists(t: BackendClient, id: string): Promise<boolean> {
  return await t.run(
    async (ctx: any) => (await ctx.db.system.get(id)) !== null,
  );
}

test("DM creates a map; it lists with resolved fields", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "城堡大廳",
    imageStorageId: img,
    cols: 32,
    rows: 18,
  });
  const { maps, activeMapId } = await t.query(listMaps, { playerToken, dmToken });
  expect(maps).toHaveLength(1);
  expect(maps[0]._id).toBe(mapId);
  expect(maps[0].name).toBe("城堡大廳");
  expect(maps[0].cols).toBe(32);
  expect(maps[0].rows).toBe(18);
  expect(activeMapId).toBeNull();
});

test("non-DM cannot create a map", async () => {
  const { t, playerToken } = await newGame();
  const img = await storageId(t);
  await expect(
    t.mutation(createMap, {
      playerToken,
      dmToken: "wrong",
      name: "x",
      imageStorageId: img,
      cols: 16,
      rows: 9,
    }),
  ).rejects.toThrow("DM token required");
});

test("non-DM cannot remove / setActive / updateGrid", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "m",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await expect(
    t.mutation(removeMap, { playerToken, dmToken: "no", mapId }),
  ).rejects.toThrow("DM token required");
  await expect(
    t.mutation(setActive, { playerToken, dmToken: "no", mapId }),
  ).rejects.toThrow("DM token required");
  await expect(
    t.mutation(updateGrid, { playerToken, dmToken: "no", mapId, cols: 1, rows: 1 }),
  ).rejects.toThrow("DM token required");
});

test("setActive sets the pointer; deleting the active map clears it", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "m",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await t.mutation(setActive, { playerToken, dmToken, mapId });
  let listed = await t.query(listMaps, { playerToken, dmToken });
  expect(listed.activeMapId).toBe(mapId);

  await t.mutation(removeMap, { playerToken, dmToken, mapId });
  listed = await t.query(listMaps, { playerToken, dmToken });
  expect(listed.activeMapId).toBeNull();
  expect(listed.maps).toHaveLength(0);
});

test("updateGrid changes cols/rows in place", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "m",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await t.mutation(updateGrid, { playerToken, dmToken, mapId, cols: 48, rows: 27 });
  const { maps } = await t.query(listMaps, { playerToken, dmToken });
  expect(maps[0].cols).toBe(48);
  expect(maps[0].rows).toBe(27);
});

test("switching the active map leaves pieces untouched", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapA = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "A",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  const mapB = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "B",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await t.mutation(setActive, { playerToken, dmToken, mapId: mapA });
  // A piece placed on map A's board.
  const pieceId = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "地精",
    color: "#f00",
    location: { kind: "board", mapId: mapA, row: 3, col: 4 },
  });

  await t.mutation(setActive, { playerToken, dmToken, mapId: mapB });

  const pieces = await t.query(listPieces, { playerToken, dmToken });
  const p = pieces.find((x: any) => x._id === pieceId);
  expect(p).toBeDefined();
  // Still on map A at the same cell — no deletion, no auto-migration to B.
  expect(p.location).toEqual({ kind: "board", mapId: mapA, row: 3, col: 4 });
});

test("deleting a map frees its image blob and un-strands its pieces", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "地牢",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  // A piece on this map's board, and one already in backstage.
  const onBoard = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "怪",
    color: "#f00",
    location: { kind: "board", mapId, row: 2, col: 5 },
  });
  const inBackstage = await t.mutation(createPiece, {
    playerToken,
    sourceType: "none",
    label: "旁",
    color: "#0f0",
    location: { kind: "backstage", x: 10, y: 20 },
  });

  expect(await blobExists(t, img)).toBe(true);
  await t.mutation(removeMap, { playerToken, dmToken, mapId });

  // Image blob is gone.
  expect(await blobExists(t, img)).toBe(false);

  const pieces = await t.query(listPieces, { playerToken, dmToken });
  // The board piece is relocated to the backstage holding pen, still present.
  expect(pieces.find((x: any) => x._id === onBoard).location).toEqual({
    kind: "backstage",
    x: 50,
    y: 50,
  });
  // The already-backstage piece is untouched.
  expect(pieces.find((x: any) => x._id === inBackstage).location).toEqual({
    kind: "backstage",
    x: 10,
    y: 20,
  });
});

test("cross-Game deletion is rejected before any mutation (issue #12)", async () => {
  // Two independent Games with their own player/DM tokens.
  const t = newTestClient();
  const gameA = await t.mutation(createGame, {});
  const gameB = await t.mutation(createGame, {});

  // In Game B: a map with a stored image, made active, with a piece on it.
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
    name: "B的地圖",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await t.mutation(setActive, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
    mapId,
  });
  const pieceId = await t.mutation(createPiece, {
    playerToken: gameB.playerToken,
    sourceType: "none",
    label: "怪",
    color: "#f00",
    location: { kind: "board", mapId, row: 1, col: 2 },
  });

  expect(await blobExists(t, img)).toBe(true);

  // Game A's DM tries to delete Game B's map — must be rejected.
  await expect(
    t.mutation(removeMap, {
      playerToken: gameA.playerToken,
      dmToken: gameA.dmToken,
      mapId,
    }),
  ).rejects.toThrow("Map not found");

  // Game B's map still exists and remains active.
  const listed = await t.query(listMaps, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
  });
  expect(listed.maps).toHaveLength(1);
  expect(listed.maps[0]._id).toBe(mapId);
  expect(listed.activeMapId).toBe(mapId);

  // Image blob survived the rejected deletion.
  expect(await blobExists(t, img)).toBe(true);

  // Piece remains on its original cell.
  const pieces = await t.query(listPieces, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
  });
  const p = pieces.find((x: any) => x._id === pieceId);
  expect(p.location).toEqual({ kind: "board", mapId, row: 1, col: 2 });
});

test("cross-Game activation is rejected before any mutation (issue #13)", async () => {
  const t = newTestClient();
  const gameA = await t.mutation(createGame, {});
  const gameB = await t.mutation(createGame, {});

  const img = await storageId(t);
  const mapA = await t.mutation(createMap, {
    playerToken: gameA.playerToken,
    dmToken: gameA.dmToken,
    name: "A的地圖",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await t.mutation(setActive, {
    playerToken: gameA.playerToken,
    dmToken: gameA.dmToken,
    mapId: mapA,
  });
  const mapB = await t.mutation(createMap, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
    name: "B的地圖",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });

  // Game A's DM tries to activate Game B's map — must be rejected.
  await expect(
    t.mutation(setActive, {
      playerToken: gameA.playerToken,
      dmToken: gameA.dmToken,
      mapId: mapB,
    }),
  ).rejects.toThrow("Map not found");

  // Game A's active map is unchanged.
  const listedA = await t.query(listMaps, {
    playerToken: gameA.playerToken,
    dmToken: gameA.dmToken,
  });
  expect(listedA.activeMapId).toBe(mapA);

  // Game B's map still exists and is unchanged.
  const listedB = await t.query(listMaps, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
  });
  expect(listedB.maps).toHaveLength(1);
  expect(listedB.maps[0]._id).toBe(mapB);
  expect(listedB.activeMapId).toBeNull();
});

test("cross-Game grid update is rejected before any mutation (issue #13)", async () => {
  const t = newTestClient();
  const gameA = await t.mutation(createGame, {});
  const gameB = await t.mutation(createGame, {});

  const img = await storageId(t);
  const mapB = await t.mutation(createMap, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
    name: "B的地圖",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });

  // Game A's DM tries to update Game B's map dimensions — must be rejected.
  await expect(
    t.mutation(updateGrid, {
      playerToken: gameA.playerToken,
      dmToken: gameA.dmToken,
      mapId: mapB,
      cols: 1,
      rows: 1,
    }),
  ).rejects.toThrow("Map not found");

  // Game B's map dimensions are unchanged.
  const listedB = await t.query(listMaps, {
    playerToken: gameB.playerToken,
    dmToken: gameB.dmToken,
  });
  expect(listedB.maps[0].cols).toBe(16);
  expect(listedB.maps[0].rows).toBe(9);
});

test("missing map returns the same generic error for activation and grid update (issue #13)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "m",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  await t.mutation(removeMap, { playerToken, dmToken, mapId });

  await expect(
    t.mutation(setActive, { playerToken, dmToken, mapId }),
  ).rejects.toThrow("Map not found");
  await expect(
    t.mutation(updateGrid, { playerToken, dmToken, mapId, cols: 1, rows: 1 }),
  ).rejects.toThrow("Map not found");
});

test("deleting a missing map returns the same generic error (issue #12)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const mapId = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "m",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  // First deletion succeeds.
  await t.mutation(removeMap, { playerToken, dmToken, mapId });
  // Re-deleting the now-missing same-Game map returns the same generic error
  // as a foreign map — no distinction between missing and foreign.
  await expect(
    t.mutation(removeMap, { playerToken, dmToken, mapId }),
  ).rejects.toThrow("Map not found");
});

test("create stores natural image dimensions; list projects them (null on legacy)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const img = await storageId(t);
  const withDims = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "有尺寸",
    imageStorageId: img,
    cols: 32,
    rows: 18,
    imageWidth: 1920,
    imageHeight: 1080,
  });
  const withoutDims = await t.mutation(createMap, {
    playerToken,
    dmToken,
    name: "無尺寸",
    imageStorageId: img,
    cols: 16,
    rows: 9,
  });
  const { maps } = await t.query(listMaps, { playerToken, dmToken });
  const a = maps.find((x: any) => x._id === withDims);
  const b = maps.find((x: any) => x._id === withoutDims);
  expect(a.imageWidth).toBe(1920);
  expect(a.imageHeight).toBe(1080);
  expect(b.imageWidth).toBeNull();
  expect(b.imageHeight).toBeNull();
});
