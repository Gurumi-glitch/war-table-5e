import type { EnemyView } from "../../convex/enemies";

/**
 * Shared enemy-search matcher (design D2 / improve-scene-ux). One matcher is
 * used by BOTH the enemy database panel (`EnemyDbPanel`) and the map piece
 * enemy picker (`AddPieceForm`), so the two filters can never drift apart.
 *
 * Rule: the query is lowercased and split on whitespace into terms; an enemy
 * matches only when EVERY term appears somewhere in its searchable text
 * (name/type/theme/role, joined). An empty query matches everything.
 */
export type EnemySearchable = Pick<
  EnemyView,
  "nameZh" | "nameEn" | "creatureType" | "themeTags" | "role"
>;

/** Split a raw query into lowercased search terms (whitespace-delimited). */
export function enemySearchTerms(query: string): string[] {
  return query.trim().toLowerCase().split(/\s+/).filter(Boolean);
}

/** True when the enemy matches the query (whitespace-tokenized AND search). */
export function enemyMatchesQuery(
  enemy: EnemySearchable,
  query: string,
): boolean {
  const terms = enemySearchTerms(query);
  if (terms.length === 0) return true;
  const hay =
    `${enemy.nameZh} ${enemy.nameEn} ${enemy.creatureType} ${enemy.themeTags} ${enemy.role}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}
