import type { CombatantView } from "../../convex/games";
import type { EffectiveNumber } from "../../convex/modifiers";

/**
 * Default any combatant-view fields a stale/older backend might omit, so a
 * backend/frontend version skew never white-screens the UI — the app degrades
 * gracefully (empty lists / base AC) instead of reading `undefined.map` /
 * `.join` / `.find` and crashing.
 *
 * Fields added in #5 (`effects`, `effectiveAc`) and #7 (`recipes`, `resources`,
 * `resist`, `vuln`, `immune`) are all defaulted here. The `CombatantView` type
 * marks them required, but a deployment running older code returns them as
 * `undefined` at runtime — the `??` defaults cover that. This is exactly the
 * skew that white-screened prod when Vercel deployed the #7 frontend before the
 * Convex prod backend caught up.
 */
export function normalizeCombatant(c: CombatantView): CombatantView {
  const ac = c.ac ?? 0;
  const defaultAc: EffectiveNumber = {
    base: ac,
    bonus: 0,
    override: null,
    value: ac,
  };
  return {
    ...c,
    characterId: c.characterId ?? null,
    resist: c.resist ?? [],
    vuln: c.vuln ?? [],
    immune: c.immune ?? [],
    effects: c.effects ?? [],
    recipes: c.recipes ?? [],
    resources: c.resources ?? [],
    effectiveAc: c.effectiveAc ?? defaultAc,
  };
}
