/// <reference types="vite/client" />
import { convexTest } from "convex-test";
import schema from "../convex/schema";
import { create } from "../convex/games";
import { add as addCombatant } from "../convex/combatants";
import { setDieClaim, setDieValue } from "../convex/dice";
import type { DieType } from "../convex/dice";

/**
 * `convex-test` discovers Convex modules via `import.meta.glob`, which only
 * works when Vite transforms the call site. This file lives OUTSIDE `convex/`
 * (in `convex-tests/`) on purpose: Convex's deployment analyzer loads every
 * module under `convex/`, and `import.meta` is unsupported there, so test
 * infrastructure must not live in the deployed directory.
 *
 * The glob must include `_generated/` so `convex-test` can locate the modules
 * root — that is why `convex/_generated/api.ts` exists.
 *
 * Each call returns a fresh in-memory backend, so tests are isolated.
 */
const modules = import.meta.glob("../convex/**/*.ts");

type TestClient = ReturnType<typeof convexTest>;

/**
 * Relaxed backend-seam client. The generic builders (`mutationGeneric`/
 * `queryGeneric`) we use without codegen produce `RegisteredMutation`/
 * `RegisteredQuery` values that `convex-test` accepts at runtime but whose
 * TypeScript types don't line up with `FunctionReference` (they would, with
 * generated code). We loosen the types here so test call sites stay clean;
 * runtime behavior is unchanged.
 */
export type BackendClient = {
  mutation: (fn: any, args?: unknown) => Promise<any>;
  query: (fn: any, args?: unknown) => Promise<any>;
  run: (fn: (ctx: any) => Promise<any>) => Promise<any>;
};

export function newTestClient(): BackendClient {
  const t: TestClient = convexTest(schema, modules);
  return {
    mutation: (fn, args) => t.mutation(fn, args as any) as Promise<any>,
    query: (fn, args) => t.query(fn, args as any) as Promise<any>,
    run: (fn) => t.run(fn as any) as Promise<any>,
  };
}

/** A fresh backend with one empty Game. The default starting point for a test. */
export async function newGame() {
  const t = newTestClient();
  const { playerToken, dmToken } = await t.mutation(create, {});
  return { t, playerToken, dmToken };
}

/** `newGame` plus the standard two combatants most engine tests act on. */
export async function newGameWithCombatants() {
  const game = await newGame();
  const hero = await game.t.mutation(addCombatant, {
    playerToken: game.playerToken,
    name: "Hero", kind: "pc", maxHp: 30, ac: 16, initiative: 10, notes: "",
  });
  const gob = await game.t.mutation(addCombatant, {
    playerToken: game.playerToken,
    name: "Goblin", kind: "enemy", maxHp: 20, ac: 12, initiative: 8, notes: "",
  });
  return { ...game, hero, gob };
}

/**
 * Set and claim dice of `type` for a combatant, taking them from an already
 * fetched `state`. Values are applied in order to the first `values.length`
 * dice of that type.
 */
export async function claimDice(
  t: BackendClient,
  playerToken: string,
  state: any,
  combatantId: string,
  type: DieType,
  values: number[],
) {
  const oftype = state.dice.filter((d: any) => d.type === type).slice(0, values.length);
  for (let i = 0; i < oftype.length; i++) {
    await t.mutation(setDieValue, { playerToken, dieId: oftype[i]._id, value: values[i] });
    await t.mutation(setDieClaim, { playerToken, dieId: oftype[i]._id, claimedBy: combatantId });
  }
}
