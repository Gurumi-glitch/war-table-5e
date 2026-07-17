import { useEffect, useState } from "react";
import type { CombatantView, DiceView } from "../../convex/games";
import { DICE_TYPES, type DieType } from "../../convex/diceHelpers";
import { useT } from "../i18n";

type Props = {
  dice: DiceView[];
  combatants: CombatantView[];
  // Batch battle run active (issue #8): batch rolls are locked (the backend
  // enforces it too); single-die reroll + manual entry stay open.
  batchLocked?: boolean;
  onBatchRoll: (types?: DieType[]) => void;
  onSetClaim: (dieId: string, claimedBy: string | null) => void;
  onReroll: (dieId: string) => void;
  onSetValue: (dieId: string, value: number) => void;
  // Bumps (e.g. the combat log's length) whenever a Confirm commits — resets
  // "Claiming for" so it can't silently linger on a previous action's actor
  // (Case 1 Extend: a target's save d20 got claimed to the wrong combatant
  // because the selector was left over from claiming the actor's own dice).
  resetSignal?: number;
  // Called with the new folded state when the dice board is folded/unfolded.
  // GameBoard uses this to grow/shrink the Battle block (ConfirmPanel).
  onFold?: (folded: boolean) => void;
  // When provided, the parent fully controls the folded state.
  folded?: boolean;
};

/**
 * The shared Dice Board — pre-rolled dice grouped by type, refreshed by a
 * Batch roll. Layout matches the reference sheet (手動戰鬥台): one vertical
 * column per die type (dice read top-to-bottom), the seven columns side by
 * side. 25 of each type, 175 dice total.
 *
 * A combatant Claims dice in their Color by clicking the claim toggle; claimed
 * dice of a type are the roll for the pending action. Values are manually
 * editable (override) and any die can be selectively rerolled (PRD US14–US17).
 * All controls are open to either role.
 */
export function DiceBoard({
  dice,
  combatants,
  batchLocked = false,
  onBatchRoll,
  onSetClaim,
  onReroll,
  onSetValue,
  resetSignal,
  onFold,
  folded: controlledFolded,
}: Props) {
  const t = useT();
  const [activeClaimer, setActiveClaimer] = useState<string | null>(null);
  // Internal folded state used when the parent doesn't control it.
  const [internalFolded, setInternalFolded] = useState(false);
  // Use controlled value if provided, otherwise fall back to internal state.
  const folded = controlledFolded ?? internalFolded;
  const setFolded = (next: boolean | ((f: boolean) => boolean)) => {
    const nextVal = typeof next === "function" ? next(folded) : next;
    if (controlledFolded === undefined) setInternalFolded(nextVal);
    onFold?.(nextVal);
  };
  useEffect(() => setActiveClaimer(null), [resetSignal]);
  // Effective claimer: the user's choice, or the first combatant as a
  // default. A removed combatant must not keep receiving claims — the
  // backend rejects the stale id with a throw ("Combatant not found").
  const claimerAlive =
    activeClaimer !== null && combatants.some((c) => c._id === activeClaimer);
  const effective = claimerAlive ? activeClaimer : combatants[0]?._id ?? null;
  const colorOf = new Map(combatants.map((c) => [c._id, c.color]));
  const nameOf = new Map(combatants.map((c) => [c._id, c.name]));

  const toggleClaim = (d: DiceView) => {
    if (effective === null) return;
    onSetClaim(d._id, d.claimedBy === effective ? null : effective);
  };

  return (
    <section
      aria-label="dice board"
      className={folded ? "wt-panel" : "wt-panel wt-fill wt-dice"}
    >
      <h2
        className="wt-panel-title wt-clickable"
        onClick={() => setFolded((f) => !f)}
        title={folded ? t.combat.unfold : t.combat.fold}
      >
        {t.dice.title}
        {batchLocked && <small> {t.dice.lockedNote}</small>}
        <span className="wt-fold-mark">{folded ? "▸" : "▾"}</span>
      </h2>
      {folded ? null : (
        <>
      <div className="wt-panel-body" style={{ flex: "none" }}>
        <button
          onClick={() => onBatchRoll()}
          disabled={batchLocked}
          title={batchLocked ? t.dice.lockedTitle : undefined}
        >
          {t.dice.batchRollAll}
        </button>{" "}
        <label>
          {t.dice.claimingFor}{" "}
          <select
            value={effective ?? ""}
            onChange={(e) => setActiveClaimer(e.target.value || null)}
            aria-label="active claimer"
          >
            {combatants.length === 0 && <option value="">{t.dice.noCombatants}</option>}
            {combatants.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Seven vertical columns, one per die type — dice read top-to-bottom.
       * Inside the War Table this is the panel's scroll region (both axes). */}
      <div className="wt-dice-cols">
        {DICE_TYPES.map((type) => {
          const oftype = dice.filter((d) => d.type === type);
          if (oftype.length === 0) return null;
          return (
            <div key={type} style={{ display: "flex", flexDirection: "column", minWidth: "7em" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "0.3em" }}>
                <strong>{type}</strong>
                <button
                  onClick={() => onBatchRoll([type])}
                  disabled={batchLocked}
                  title={batchLocked ? t.dice.lockedTitle : t.dice.rerollAllOf(type)}
                  aria-label={`reroll all ${type}`}
                >
                  ⟲
                </button>
              </div>
              {oftype.map((d) => {
                const claimColor = d.claimedBy
                  ? colorOf.get(d.claimedBy) ?? "#999"
                  : undefined;
                const claimedByName = d.claimedBy
                  ? nameOf.get(d.claimedBy) ?? "removed combatant"
                  : null;
                // 1-based position within the type column, for unique labels.
                const pos = d.order + 1;
                const claimLabel = claimedByName
                  ? `claim ${type} #${pos} — claimed by ${claimedByName}`
                  : `claim ${type} #${pos}`;
                return (
                  <div
                    key={d._id}
                    data-testid={`die ${type}`}
                    className={`wt-dierow${d.claimedBy ? " claimed" : ""}`}
                    style={{ ["--dcolor" as string]: claimColor }}
                  >
                    {/* The die IS the value input — hex face, editable in place. */}
                    <span className="wt-die" title={d.claimedBy ? t.dice.claimed : undefined}>
                      <input
                        type="number"
                        value={d.value}
                        onChange={(e) => {
                          if (e.target.value === "") return;
                          const n = Number(e.target.value);
                          if (!Number.isNaN(n)) onSetValue(d._id, n);
                        }}
                        aria-label={`${type} #${pos} value`}
                      />
                    </span>
                    <button
                      onClick={() => toggleClaim(d)}
                      title={
                        claimedByName
                          ? t.dice.claimReleaseBy(claimedByName)
                          : t.dice.claimReleaseTitle
                      }
                      aria-label={claimLabel}
                      style={{
                        color: claimColor ?? "var(--dim, #999)",
                        fontWeight: "bold",
                        cursor: effective ? "pointer" : "not-allowed",
                      }}
                    >
                      {d.claimedBy ? "●" : "○"}
                    </button>
                    <button
                      onClick={() => onReroll(d._id)}
                      title={t.dice.reroll}
                      aria-label={`reroll ${type} #${pos}`}
                    >
                      ⟲
                    </button>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
        </>
      )}
    </section>
  );
}
