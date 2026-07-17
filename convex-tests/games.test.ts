import { test, expect } from "vitest";
import { newGame } from "./testHelper";
import { create, getGameState, setNote, incrementCounter, setDmNote } from "../convex/games";

test("create returns a game with a player token and a secret DM token", async () => {
  const { t, playerToken, dmToken } = await newGame();

  expect(typeof playerToken).toBe("string");
  expect(playerToken.length).toBeGreaterThan(0);
  expect(typeof dmToken).toBe("string");
  expect(dmToken.length).toBeGreaterThan(0);
  expect(playerToken).not.toBe(dmToken);
});

test("getGameState with the DM token resolves role 'dm' and returns dmNote", async () => {
  const { t, playerToken, dmToken } = await newGame();
  const state = await t.query(getGameState, { playerToken, dmToken });

  expect(state.role).toBe("dm");
  expect(state).toHaveProperty("dmNote");
  expect(typeof state.dmNote).toBe("string");
});

test("getGameState with only the player token withholds dmNote (backend-enforced)", async () => {
  const { t, playerToken, dmToken } = await newGame();
  // DM sets a secret note.
  await t.mutation(setDmNote, { playerToken, dmToken, dmNote: "trap here" });

  // Player queries — dmNote must be absent/empty, never the secret.
  const playerState = await t.query(getGameState, { playerToken });
  expect(playerState.role).toBe("player");
  expect(playerState.dmNote).toBe("");

  // A wrong DM token is treated as a player too.
  const wrongState = await t.query(getGameState, {
    playerToken,
    dmToken: "not-the-secret",
  });
  expect(wrongState.role).toBe("player");
  expect(wrongState.dmNote).toBe("");
});

test("shared note and counter sync from either role and are visible to both", async () => {
  const { t, playerToken, dmToken } = await newGame();

  // Player edits the shared note; DM observes it.
  await t.mutation(setNote, { playerToken, note: "hello from player" });
  let dmState = await t.query(getGameState, { playerToken, dmToken });
  expect(dmState.note).toBe("hello from player");

  // DM increments the shared counter; player observes it.
  await t.mutation(incrementCounter, { playerToken });
  await t.mutation(incrementCounter, { playerToken });
  const playerState = await t.query(getGameState, { playerToken });
  expect(playerState.counter).toBe(2);
  expect(playerState.note).toBe("hello from player");
});

test("setDmNote requires the DM token", async () => {
  const { t, playerToken, dmToken } = await newGame();

  // Without the DM token, the edit is rejected.
  await expect(
    t.mutation(setDmNote, { playerToken, dmNote: "sneak" }),
  ).rejects.toThrow(/DM token/);
  await expect(
    t.mutation(setDmNote, { playerToken, dmToken: "wrong", dmNote: "sneak" }),
  ).rejects.toThrow(/DM token/);

  // With the correct DM token, it persists and is visible only to the DM.
  await t.mutation(setDmNote, { playerToken, dmToken, dmNote: "real secret" });
  const dmState = await t.query(getGameState, { playerToken, dmToken });
  expect(dmState.dmNote).toBe("real secret");
});
