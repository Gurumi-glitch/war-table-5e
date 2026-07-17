import type { CombatantView } from "../../convex/games";
import { ColorSwatch } from "./ColorSwatch";
import { useT } from "../i18n";

type Props = {
  combatants: CombatantView[];
  currentTurnId: string | null;
  round: number;
};

/**
 * Lite initiative as the War Table's top ribbon (issue #9 step 5): one pill per
 * combatant in turn order (the projection sorts by initiative desc), the
 * current turn glowing ember. Horizontal scroll absorbs the 6v20 case. The DM
 * drives advancement via the Next-turn button beside the ribbon (GameShell);
 * there is still no rigid turn engine. Successor of the old InitiativeOrder
 * list — same "initiative order" landmark.
 */
export function TurnRibbon({ combatants, currentTurnId, round }: Props) {
  const t = useT();
  return (
    <section aria-label="initiative order" className="wt-ribbon">
      <span className="wt-pill wt-round-pill" title={t.combat.roundTitle}>
        R{round}
      </span>
      {combatants.length === 0 ? (
        <span style={{ color: "var(--dim)", fontSize: "0.8em" }}>
          {t.batch.noCombatants}
        </span>
      ) : (
        combatants.map((c) => (
          <span
            key={c._id}
            className={`wt-pill wt-initiative-pill${c._id === currentTurnId ? " current" : ""}${c.alive ? "" : " down"}`}
            title={`${c.name} · ${t.combat.init} ${c.initiative}${c.alive ? "" : ` · ${t.combat.down}`}`}
          >
            <ColorSwatch color={c.color} />
            <span className="wt-pill-name" title={c.name}>
              {c.name}
            </span>
            <span className="wt-pill-init">{c.initiative}</span>
          </span>
        ))
      )}
    </section>
  );
}
