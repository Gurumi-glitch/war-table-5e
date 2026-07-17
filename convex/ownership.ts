/**
 * Dual-ownership helpers (issue #9). Child rows (recipes / resources /
 * effects) belong EITHER to a combatant (gameId + combatantId — deleted with
 * it, per-Game) OR to a global character (characterId only — campaign state,
 * persists across Games). A combatant with `characterId` set is "linked": its
 * children live on the character, and its hp/maxHp/ac live on the character
 * doc (the combatant's copies are the join-time snapshot, ignored by readers).
 *
 * No Convex runtime imports — pure functions over `db` + docs, so every
 * backend module can use them without circular imports.
 */

/** The table names that support dual ownership. */
export type ChildTable = "recipes" | "resources" | "effects";

/**
 * The owner fields to stamp on a new child row for this combatant: the linked
 * character when there is one, else the combatant itself.
 */
export function childOwner(combatant: any): {
  gameId?: string;
  combatantId?: string;
  characterId?: string;
} {
  if (combatant.characterId !== undefined) {
    return { characterId: combatant.characterId };
  }
  return { gameId: combatant.gameId, combatantId: combatant._id };
}

/** Whether a child row belongs to this combatant (directly or via its link). */
export function childBelongsTo(row: any, combatant: any): boolean {
  if (row.combatantId !== undefined) {
    return row.combatantId === combatant._id;
  }
  return (
    row.characterId !== undefined &&
    row.characterId === combatant.characterId
  );
}

/**
 * All child rows of `table` belonging to a combatant: its own rows plus (when
 * linked) the character's rows. Legacy combatant-owned rows on a linked PC are
 * included too — merging both paths is skew-/migration-safe.
 */
export async function fetchChildren(
  db: any,
  table: ChildTable,
  combatant: any,
): Promise<any[]> {
  const own = await db
    .query(table)
    .withIndex("byCombatant", (q: any) => q.eq("combatantId", combatant._id))
    .collect();
  if (combatant.characterId === undefined) {
    return own;
  }
  const inherited = await db
    .query(table)
    .withIndex("byCharacter", (q: any) =>
      q.eq("characterId", combatant.characterId),
    )
    .collect();
  return [...own, ...inherited];
}

/**
 * The doc that carries a combatant's campaign stats (hp / maxHp / ac): the
 * linked character, or the combatant itself. Re-fetched from the db so the
 * carrier is fresh within a multi-write mutation (e.g. two hits on the same
 * target in one Confirm). Falls back to the combatant if the character was
 * deleted out from under the link.
 */
export async function statCarrier(db: any, combatant: any): Promise<any> {
  if (combatant.characterId !== undefined) {
    const character = await db.get(combatant.characterId);
    if (character !== null) return character;
  }
  return await db.get(combatant._id);
}
