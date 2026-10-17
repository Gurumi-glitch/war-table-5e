import { useState } from "react";
import { useT, type Messages } from "../i18n";
import { renderLogEvent } from "../i18n/renderLogEvent";
import type { CombatLogEntry } from "../../convex/combatLog";

type Props = {
  entries: CombatLogEntry[];
};

/** The entry's summary: localized from the structured event when present (new
 *  rows), otherwise the legacy server-composed string (pre-event rows +
 *  deploy-skew fallback). */
export function summaryOf(e: CombatLogEntry, msg: Messages): string {
  return e.event !== undefined ? renderLogEvent(e.event, msg) : e.rollSummary;
}

/** One log entry as a plain line — shared by the list and the bottom ticker. */
export function logLine(e: CombatLogEntry, msg: Messages): string {
  const parts = [e.actingName];
  const summary = summaryOf(e, msg);
  if (summary) parts.push(`— ${summary}`);
  if (e.effectText) parts.push(`— ${e.effectText}`);
  if (e.effects.length > 0) {
    parts.push(
      `(${e.effects
        .map((eff) => `${eff.name} ${eff.hpDelta >= 0 ? "+" : ""}${eff.hpDelta}`)
        .join(", ")})`,
    );
  }
  return parts.join(" ");
}

/**
 * The append-only combat log — one row per Confirm, most-recent first. Records
 * who acted, the roll summary, the free-text effect, and the HP deltas applied
 * to each target (PRD US48). Read-only on both roles; the log records committed
 * results, not secrets. Lives at the bottom of the War Table's party column.
 */
export function CombatLog({ entries }: Props) {
  const t = useT();
  const [folded, setFolded] = useState(false);
  return (
    <section
      aria-label="combat log"
      className="wt-panel"
      style={{ flex: "none", display: "flex", flexDirection: "column", maxHeight: "24em" }}
    >
      <h2
        className="wt-panel-title wt-clickable"
        data-folded={folded ? "true" : undefined}
        onClick={() => setFolded((f) => !f)}
        title={folded ? t.combat.unfold : t.combat.fold}
      >
        {t.board.logTitle}
        <span className="wt-fold-mark">▸</span>
      </h2>
      <div className={`wt-fold-body${folded ? "" : " is-open"}`}>
        <div className="wt-fold-inner">
          {entries.length === 0 ? (
            <p style={{ padding: "0 0.7em", color: "var(--dim)", fontSize: "0.82em" }}>
              {t.log.noConfirmations}
            </p>
          ) : (
            <div className="wt-scroll">
              <ul className="wt-log">
                {entries.map((e) => (
                  <li key={e._id} data-testid="log entry">
                    <strong>{e.actingName}</strong>
                    {summaryOf(e, t) ? ` — ${summaryOf(e, t)}` : ""}
                    {e.effectText ? ` — ${e.effectText}` : ""}
                    {e.effects.length > 0 && (
                      <em>
                        {" "}
                        ({e.effects
                          .map((eff) => `${eff.name} ${eff.hpDelta >= 0 ? "+" : ""}${eff.hpDelta}`)
                          .join(", ")})
                      </em>
                    )}
                    {e.round > 0 && <span> · {t.log.round(e.round)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
