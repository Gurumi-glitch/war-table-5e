import { queryGeneric as query, mutationGeneric as mutation } from "convex/server";
import { v } from "convex/values";
import { BOARD_LAYOUT, DICE_SIDES, DICE_TYPES, rollDie, generateToken, byInitiative, type DieType } from "./diceHelpers";
import { effectiveNumber, expandSpecs, type EffectiveNumber } from "./modifiers";
import type { EffectView } from "./effects";
import type { RecipeView } from "./recipes";
import type { ResourceView } from "./resources";
import type { EnemyFields } from "./enemyFields";
import { isPlaygroundMode } from "./cardGuards";

/**
 * The role a client holds for a Game, derived from the URL token. The DM URL
 * carries the secret `dmToken`; the player URL does not. The backend — not the
 * UI — decides the role and withholds DM-only fields accordingly (ADR-0002,
 * PRD US6).
 */
export type Role = "dm" | "player";

/**
 * A combatant as projected to a given role. `dmNotes` is present only for the
 * DM; Frontstage never receives it (backend-enforced). `effects` (Conditions +
 * custom Modifiers) and `effectiveAc` are shared — visible to everyone — and
 * computed on the fly from active effects (never stored, issue #5).
 */
export type CombatantView = {
  _id: string;
  _creationTime: number;
  gameId: string;
  // Live link to a global character card (issue #9), or null. For a linked PC
  // the hp/maxHp/ac below are the CHARACTER's live values, and effects/
  // recipes/resources include the character-owned rows.
  characterId: string | null;
  name: string;
  kind: "pc" | "npc" | "enemy";
  color: string;
  /** HP — null for player-view of enemy/npc (stats hidden). */
  hp: number | null;
  maxHp: number | null;
  /** 臨時生命值 (PHB p.198) — null for player-view of enemy/npc. Not capped by
   * maxHp. Optional only so older test fixtures validate; the projection always
   * sets it at runtime. */
  tempHp?: number | null;
  ac: number | null;
  initiative: number;
  notes: string;
  dmNotes?: string;
  alive: boolean;
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  order: number;
  // Conditions/custom Modifiers on this combatant (issue #5).
  effects: EffectView[];
  /** Effective AC — null when ac is null. */
  effectiveAc: EffectiveNumber | null;
  // The linked character card's per-ability saves (issue #9), or null when
  // unlinked. Drives the save bonus auto-fill + per-ability save math in the
  // Confirm preview (Stunned auto-fail, Restrained DEX disadv, …). {key=zh ability}
  saves: { key: string; prof: boolean; total: number }[] | null;
  // Damage-type modifiers (issue #7): R/V/I lists — null for hidden combatants.
  resist: string[] | null;
  vuln: string[] | null;
  immune: string[] | null;
  /** Curated-condition immunity keys (⚠ warn on apply) — null when hidden. */
  conditionImmune: string[] | null;
  // Known Action recipes (issue #7) — null for hidden combatants.
  recipes: RecipeView[] | null;
  // Resource pools (issue #7 minimal) — null for hidden combatants.
  resources: ResourceView[] | null;
  /**
   * Per-instance 敵人庫 stat-block snapshot (spawn deep copy, ADR-0002),
   * editable from the on-field enemy editor. DM-only like dmNotes: the key is
   * absent for players; null for combatants without one (hand-added / PC).
   */
  statBlock?: EnemyFields | null;
};

/** A die on the shared Dice Board as projected to a role (shared, not DM-only). */
export type DiceView = {
  _id: string;
  _creationTime: number;
  gameId: string;
  type: DieType;
  value: number;
  order: number;
  claimedBy: string | null;
};

/**
 * An active Batch battle run (issue #8): the queue snapshot (initiative order
 * at start) and whose Confirm is next. Shared — both roles see the run.
 */
export type BatchRunView = {
  /** Optional only for old test fixtures / pre-migration game documents. */
  runId?: string;
  turnIds: string[];
  turnIndex: number;
};

/** Full Game state as seen by a given role (Frontstage omits DM-only fields). */
export type GameState = {
  role: Role;
  playerToken: string;
  note: string;
  counter: number;
  dmNote: string;
  round: number;
  currentTurnId: string | null;
  // Active Batch battle run, or null in the normal flow (issue #8).
  batchRun: BatchRunView | null;
  /**
   * Whether this deployment is the public playground (prep-public-release /
   * design D1). Read-only display state: the UI uses it to show read-only card
   * hints, never to decide an outcome — every playground rule is enforced
   * server-side, so faking this only changes the faker's own screen.
   */
  playgroundMode: boolean;
  combatants: CombatantView[];
  dice: DiceView[];
};

/**
 * Resolve which Game and role a token-bearing client may access. Throws if the
 * player token does not match a Game. Returns `role: "dm"` only when the
 * secret DM token matches. Exported so dice/combatant/log modules can resolve a
 * game by player token (all gameplay buttons are open to either role).
 */
export async function resolveGame(
  db: any,
  playerToken: string,
  dmToken?: string,
): Promise<{ game: any; role: Role }> {
  const game = await db
    .query("games")
    .withIndex("byPlayerToken", (q: any) => q.eq("playerToken", playerToken))
    .unique();
  if (game === null) {
    throw new Error("Game not found");
  }
  const role: Role =
    dmToken !== undefined && dmToken === game.dmToken ? "dm" : "player";
  return { game, role };
}

/** Require a DM token; throw if it does not authorize DM powers for the Game. */
async function requireDm(
  db: any,
  playerToken: string,
  dmToken: string,
): Promise<any> {
  const { game, role } = await resolveGame(db, playerToken, dmToken);
  if (role !== "dm") {
    throw new Error("DM token required");
  }
  return game;
}

/**
 * Deployment mode, with no Game in hand (prep-public-release / design D1).
 * Everywhere else the flag rides `getGameMeta`, but the home page is where a
 * visitor lands BEFORE any Game exists, and the wipe warning has to reach them
 * there — that is the whole point of the warning.
 *
 * Still a single source of truth: the same server-side env read as every
 * enforcement path, not a second `VITE_` flag that a deployment could set
 * inconsistently (and whose failure mode is a demo that silently stops warning
 * people before it deletes their characters).
 */
export const getDeploymentMode = query({
  args: {},
  handler: async () => ({ playgroundMode: isPlaygroundMode() }),
});

export const create = mutation({
  args: {},
  handler: async (ctx) => {
    const playerToken = generateToken();
    const dmToken = generateToken();
    const gameId = await ctx.db.insert("games", {
      playerToken,
      dmToken,
      note: "",
      counter: 0,
      dmNote: "",
      round: 0,
      currentTurnId: undefined,
    });
    // Seed the Dice Board: one row per slot in BOARD_LAYOUT, pre-rolled and
    // unclaimed. Shared across all combatants (Slice 3 / PRD US14).
    for (const type of DICE_TYPES) {
      for (let i = 0; i < BOARD_LAYOUT[type]; i++) {
        await ctx.db.insert("dice", {
          gameId,
          type,
          value: rollDie(DICE_SIDES[type]),
          order: i,
        });
      }
    }
    return { playerToken, dmToken };
  },
});

/**
 * Project the game-level fields for a role: role, playerToken, note/counter/
 * round/turn/batchRun, and the DM-only dmNote (withheld from Frontstage). Reads
 * only the `games` doc, so a `getGameMeta` subscription re-runs only on
 * note/counter/round/turn/batchRun writes — not on every dice claim or
 * combatant edit (concurrency split for 7 concurrent editors).
 */
function projectMeta(game: any, role: Role) {
  return {
    role,
    playerToken: game.playerToken,
    note: game.note,
    counter: game.counter,
    round: game.round,
    currentTurnId: game.currentTurnId ?? null,
    batchRun:
      game.batchRun === undefined
        ? null
        : { ...game.batchRun, runId: game.batchRun.runId ?? "legacy" },
    playgroundMode: isPlaygroundMode(),
    // DM-only field: withheld from Frontstage by the backend.
    dmNote: role === "dm" ? game.dmNote : "",
  };
}

/**
 * Project the shared Dice Board, sorted by board type then stable `order`.
 * Reads only `dice`, so a `getDice` subscription re-runs only on dice writes
 * (claims, rerolls, batch rolls — the highest-churn path in combat) and NOT on
 * combatant/effect/recipe changes.
 */
async function projectDice(db: any, game: any): Promise<DiceView[]> {
  const dice = await db
    .query("dice")
    .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
    .collect();
  // Dice grouped by board type order, then stable `order` within type. Shared
  // (not DM-only) → same projection for both roles.
  const typeRank = new Map<string, number>(
    DICE_TYPES.map((t, i) => [t, i]),
  );
  const sortedDice = [...dice].sort(
    (a: any, b: any) =>
      (typeRank.get(a.type) ?? 99) - (typeRank.get(b.type) ?? 99) ||
      a.order - b.order,
  );
  return sortedDice.map((d: any) => ({
    _id: d._id,
    _creationTime: d._creationTime,
    gameId: d.gameId,
    type: d.type,
    value: d.value,
    order: d.order,
    claimedBy: d.claimedBy ?? null,
  }));
}

/**
 * Project the combatant list for a role: live-link character projection
 * (hp/maxHp/ac on the card), character-owned children merged with combatant-
 * owned ones, and on-the-fly effective AC. Reads combatants + effects + recipes
 * + resources + linked character docs, so a `getCombatants` subscription re-runs
 * only on those — isolated from dice/note churn.
 */
async function projectCombatants(
  db: any,
  game: any,
  role: Role,
): Promise<CombatantView[]> {
  const combatants = await db
    .query("combatants")
    .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
    .collect();
  const effects = await db
    .query("effects")
    .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
    .collect();
  const recipes = await db
    .query("recipes")
    .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
    .collect();
  const resources = await db
    .query("resources")
    .withIndex("byGame", (q: any) => q.eq("gameId", game._id))
    .collect();

  // Highest initiative first; ties broken by insertion order (stable).
  const sorted = [...combatants].sort(byInitiative);

  // Group child rows by combatant (one byGame query each → lookup maps).
  const groupBy = (rows: any[]) => {
    const map = new Map<string, any[]>();
    for (const r of rows) {
      const list = map.get(r.combatantId) ?? [];
      list.push(r);
      map.set(r.combatantId, list);
    }
    return map;
  };
  const effectsByCombatant = groupBy(effects);
  const recipesByCombatant = groupBy(recipes);
  const resourcesByCombatant = groupBy(resources);

  // Live link (issue #9): a linked PC's hp/maxHp/ac live on its character
  // card, and its character-owned effects/recipes/resources join the
  // (legacy) combatant-owned ones. The byGame groupings above only see
  // combatant-owned rows — character rows carry no gameId.
  //
  // Prefetch every linked character doc + its character-owned children IN
  // PARALLEL, then group in memory. The prior loop awaited 4 queries per
  // linked combatant sequentially (24 sequential round-trips for a 6-PC
  // party) — the dominant cost of every refresh. Parallelizing drops it to a
  // handful of concurrent rounds, and the per-combatant loop below does zero
  // awaits (map lookups only).
  const charIds = [
    ...new Set(
      (sorted as any[])
        .map((c) => c.characterId)
        .filter((id): id is string => id !== undefined),
    ),
  ];
  const charDocs = new Map<string, any>(
    (await Promise.all(charIds.map((id) => db.get(id as any)))).map(
      (d, i) => [charIds[i], d] as const,
    ),
  );
  const fetchCharChildren = async (table: string) => {
    const rows = await Promise.all(
      charIds.map((id) =>
        db
          .query(table as any)
          .withIndex("byCharacter", (q: any) => q.eq("characterId", id))
          .collect(),
      ),
    );
    const map = new Map<string, any[]>();
    charIds.forEach((id, i) => map.set(id, rows[i]));
    return map;
  };
  const [effectsByCharacter, recipesByCharacter, resourcesByCharacter] =
    await Promise.all([
      fetchCharChildren("effects"),
      fetchCharChildren("recipes"),
      fetchCharChildren("resources"),
    ]);

  const combatantViews: CombatantView[] = [];
  for (const c of sorted as any[]) {
    const character =
      c.characterId !== undefined
        ? (charDocs.get(c.characterId) ?? null)
        : null;
    const charKids = (map: Map<string, any[]>) =>
      c.characterId !== undefined
        ? (map.get(c.characterId) ?? [])
        : [];

    const cEffects = [
      ...(effectsByCombatant.get(c._id) ?? []),
      ...charKids(effectsByCharacter),
    ];
    const effectViews: EffectView[] = cEffects.map((e: any) => ({
      _id: e._id,
      _creationTime: e._creationTime,
      // Character-owned rows are projected onto the linked combatant.
      combatantId: e.combatantId ?? c._id,
      type: e.type,
      conditionKey: e.conditionKey ?? null,
      label: e.label,
      specs: e.specs,
      active: e.active,
    }));
    const baseHp = character?.hp ?? c.hp;
    const baseMaxHp = character?.maxHp ?? c.maxHp;
    const baseAc = character?.ac ?? c.ac;
    // 臨時生命值 lives on the stat carrier (linked PC → character card); absent
    // on older docs → 0. Not capped by maxHp (PHB p.198).
    const baseTempHp = character?.tempHp ?? c.tempHp ?? 0;
    // Effective AC = base + active bonuses (or override), computed on the fly
    // from the combatant's active effects (never stored). Issue #5.
    const effectiveAc = effectiveNumber(
      baseAc,
      expandSpecs(cEffects as any),
      "ac",
    );
    // Per-ability saves live on the linked character card (null when unlinked).
    const saves = (character?.saves as
      | { key: string; prof: boolean; total: number }[]
      | undefined) ?? null;
    const cRecipes = [
      ...(recipesByCombatant.get(c._id) ?? []),
      ...charKids(recipesByCharacter),
    ];
    const recipeViews: RecipeView[] = cRecipes.map(
      (r: any) => ({
        _id: r._id,
        _creationTime: r._creationTime,
        combatantId: r.combatantId ?? c._id,
        name: r.name,
        hitType: r.hitType,
        attackMod: r.attackMod,
        damageDice: r.damageDice,
        damageMod: r.damageMod,
        damageType: r.damageType,
        dc: r.dc,
        saveAbility: r.saveAbility,
        critImmune: r.critImmune,
        resourceId: r.resourceId ?? null,
        resourceCost: r.resourceCost,
        multiTarget: r.multiTarget,
        appliesMods: r.appliesMods ?? [],
        extraRolls: r.extraRolls ?? [],
      }),
    );
    const cResources = [
      ...(resourcesByCombatant.get(c._id) ?? []),
      ...charKids(resourcesByCharacter),
    ];
    const resourceViews: ResourceView[] = cResources.map((r: any) => ({
      _id: r._id,
      _creationTime: r._creationTime,
      combatantId: r.combatantId ?? c._id,
      label: r.label,
      current: r.current,
      max: r.max,
      icon: r.icon,
      color: r.color,
    }));
    // Players don't see enemy/npc stats — strip hp/ac/resist/recipes/resources.
    // Linked PCs always show their own stats (characterId is set).
    const isSecret =
      role === "player" && c.kind !== "pc" && c.characterId === undefined;
    const view: CombatantView = {
      _id: c._id,
      _creationTime: c._creationTime,
      gameId: c.gameId,
      characterId: c.characterId ?? null,
      name: c.name,
      kind: c.kind,
      color: c.color,
      hp: isSecret ? null : baseHp,
      maxHp: isSecret ? null : baseMaxHp,
      tempHp: isSecret ? null : baseTempHp,
      ac: isSecret ? null : baseAc,
      initiative: c.initiative,
      notes: c.notes,
      alive: c.alive,
      actionUsed: c.actionUsed,
      bonusUsed: c.bonusUsed,
      reactionUsed: c.reactionUsed,
      order: c.order,
      effects: effectViews,
      effectiveAc: isSecret ? null : effectiveAc,
      saves: isSecret ? null : saves,
      resist: isSecret ? null : (c.resist ?? []),
      vuln: isSecret ? null : (c.vuln ?? []),
      immune: isSecret ? null : (c.immune ?? []),
      conditionImmune: isSecret ? null : (c.conditionImmune ?? []),
      recipes: isSecret ? null : recipeViews,
      resources: isSecret ? null : resourceViews,
    };
    // DM-only fields: withheld from Frontstage by the backend.
    if (role === "dm") {
      view.dmNotes = c.dmNotes;
      view.statBlock = c.statBlock ?? null;
    }
    combatantViews.push(view);
  }
  return combatantViews;
}

/**
 * Game-level fields only (concurrency split). Re-runs only on game-doc writes
 * (note/counter/round/turn/batchRun), isolating note typing and turn advances
 * from the combatant projection.
 */
export const getGameMeta = query({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
  },
  handler: async (ctx, { playerToken, dmToken }) => {
    const { game, role } = await resolveGame(ctx.db, playerToken, dmToken);
    return projectMeta(game, role);
  },
});

/**
 * Dice Board only (concurrency split). Re-runs only on dice writes — the
 * highest-churn path (claims, rerolls, batch rolls) — so 7 editors claiming
 * dice no longer re-run the combatant projection.
 */
export const getDice = query({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, { playerToken }) => {
    const { game } = await resolveGame(ctx.db, playerToken);
    return projectDice(ctx.db, game);
  },
});

/**
 * Combatant list only (concurrency split). Re-runs only on combatant/effect/
 * recipe/resource/character writes, isolated from dice and note churn.
 */
export const getCombatants = query({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
  },
  handler: async (ctx, { playerToken, dmToken }) => {
    const { game, role } = await resolveGame(ctx.db, playerToken, dmToken);
    return projectCombatants(ctx.db, game, role);
  },
});

/**
 * Full Game state (combined). Kept as a thin wrapper over projectMeta /
 * projectDice / projectCombatants so the existing test call sites keep working
 * unchanged. The frontend subscribes to the three granular queries instead, so
 * this runs only in tests in practice — no prod re-run cost. The three helpers
 * run concurrently here.
 */
export const getGameState = query({
  args: {
    playerToken: v.string(),
    dmToken: v.optional(v.string()),
  },
  handler: async (ctx, { playerToken, dmToken }) => {
    const { game, role } = await resolveGame(ctx.db, playerToken, dmToken);
    const [meta, dice, combatants] = await Promise.all([
      projectMeta(game, role),
      projectDice(ctx.db, game),
      projectCombatants(ctx.db, game, role),
    ]);
    const state: GameState = {
      ...meta,
      dice,
      combatants,
    };
    return state;
  },
});

// Re-exported so DM-gated combatant mutations can share the helper without a
// circular import through combatants.ts.
export { requireDm };

/**
 * Edit the shared note. Either role may edit shared state — this proves
 * realtime sync flows both ways (a player's edit reaches the DM and vice
 * versa). No DM token required.
 */
export const setNote = mutation({
  args: {
    playerToken: v.string(),
    note: v.string(),
  },
  handler: async (ctx, { playerToken, note }) => {
    const game = await resolveGame(ctx.db, playerToken).then((r) => r.game);
    await ctx.db.patch(game._id, { note });
  },
});

/** Increment the shared counter from either role. */
export const incrementCounter = mutation({
  args: {
    playerToken: v.string(),
  },
  handler: async (ctx, { playerToken }) => {
    const game = await resolveGame(ctx.db, playerToken).then((r) => r.game);
    await ctx.db.patch(game._id, { counter: game.counter + 1 });
  },
});

/** Set the DM-only note. Requires the DM token (DM-only edit enforced). */
export const setDmNote = mutation({
  args: {
    playerToken: v.string(),
    dmToken: v.string(),
    dmNote: v.string(),
  },
  handler: async (ctx, { playerToken, dmToken, dmNote }) => {
    const game = await requireDm(ctx.db, playerToken, dmToken);
    await ctx.db.patch(game._id, { dmNote });
  },
});
