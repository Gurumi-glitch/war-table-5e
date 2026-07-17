import { useState } from "react";
import type { BatchRunView, CombatantView, DiceView } from "../../convex/games";
import type { BattleDraftView } from "../../convex/battleDrafts";
import { draftSlotKey } from "../lib/battleDrafts";
import { ColorSwatch } from "./ColorSwatch";
import { useT } from "../i18n";
import {
  ConfirmSession,
  type BattleDraftPatch,
  type ConfirmEffect,
  type RecipeConfirm,
} from "./ConfirmPanel";
import type { ResourceHandlers } from "./CombatantSheet";

/** Handlers for the Batch battle run (issue #8). */
export type BatchHandlers = {
  onStartBatchRun?: (combatantIds: string[]) => void;
  onAdvanceBatchTurn?: () => void;
  onEndBatchRun?: () => void;
};

type Props = BatchHandlers & {
  batchRun: BatchRunView | null;
  // Already sorted by initiative (the projection sorts).
  combatants: CombatantView[];
  dice: DiceView[];
  onConfirm: (
    actingCombatantId: string | null,
    effectText: string,
    effects: ConfirmEffect[],
  ) => void;
  onConfirmRecipe: (payload: RecipeConfirm) => void;
  onSetClaim: (dieId: string, claimedBy: string | null) => void;
  /** Resource pip icon/color overrides (DESIGN.md board entry point). Absent = no gear button on the pips. */
  onUpdateResource?: ResourceHandlers["onUpdateResource"];
  drafts?: BattleDraftView[];
  onPatchDraft?: (scope: "normal" | "batch", actorId: string, runId: string | undefined, patch: BattleDraftPatch) => void;
};

/**
 * Batch battle (issue #8): an optional mode where one fresh Batch roll serves a
 * run of consecutive turns — everyone Claims and Confirms in initiative order
 * from the same board, with batch rerolls locked until the run ends. With no
 * run active this renders a collapsed start form (pick the run's combatants —
 * e.g. all players before the boss); with a run active every run member gets
 * their own actor-bound Confirm session right here (current runner expanded,
 * the rest collapsible) — prep them in parallel, confirm down the queue, no
 * re-driving the shared Confirm dropdown per turn. The run guides, never
 * gatekeeps: out-of-order Confirms are allowed and simply don't advance the
 * queue (ADR-0002).
 */
export function BatchBattlePanel({
  batchRun,
  combatants,
  dice,
  onConfirm,
  onConfirmRecipe,
  onSetClaim,
  onStartBatchRun,
  onAdvanceBatchTurn,
  onEndBatchRun,
  onUpdateResource,
  drafts,
  onPatchDraft,
}: Props) {
  const t = useT();
  if (batchRun !== null) {
    return (
      <ActiveRun
        batchRun={batchRun}
        combatants={combatants}
        dice={dice}
        onConfirm={onConfirm}
        onConfirmRecipe={onConfirmRecipe}
        onSetClaim={onSetClaim}
        onAdvanceBatchTurn={onAdvanceBatchTurn}
        onEndBatchRun={onEndBatchRun}
        onUpdateResource={onUpdateResource}
        drafts={drafts}
        onPatchDraft={onPatchDraft}
      />
    );
  }

  return (
    <section aria-label="batch battle" className="wt-panel wt-batch">
      <details>
        <summary>
          <strong>{t.batch.title}</strong>
        </summary>
        <div>
          <p className="wt-batch-summary">{t.batch.intro}</p>
          <StartRunForm combatants={combatants} onStartBatchRun={onStartBatchRun} />
        </div>
      </details>
    </section>
  );
}

/**
 * The active-run view: the queue with one actor-bound Confirm session per
 * member. It also chains previews: each session reports its predicted HP
 * deltas, and every LATER session's preview computes against HP as it will be
 * once the earlier pending turns land (so a heal after pending damage shows
 * the real number). Predictions are preview-only and cleared the moment that
 * session Confirms — the server state takes over from there.
 */
function ActiveRun({
  batchRun,
  combatants,
  dice,
  onConfirm,
  onConfirmRecipe,
  onSetClaim,
  onAdvanceBatchTurn,
  onEndBatchRun,
  onUpdateResource,
  drafts = [],
  onPatchDraft,
}: {
  batchRun: BatchRunView;
  combatants: CombatantView[];
  dice: DiceView[];
  onConfirm: Props["onConfirm"];
  onConfirmRecipe: Props["onConfirmRecipe"];
  onSetClaim: Props["onSetClaim"];
  onAdvanceBatchTurn?: () => void;
  onEndBatchRun?: () => void;
  onUpdateResource?: Props["onUpdateResource"];
  drafts?: BattleDraftView[];
  onPatchDraft?: Props["onPatchDraft"];
}) {
  const t = useT();
  const byId = new Map(combatants.map((c) => [c._id, c]));
  // Each session's predicted HP deltas (actor id → combatant id → delta).
  const [predictions, setPredictions] = useState<
    Record<string, Record<string, number>>
  >({});
  const setPrediction = (actorId: string, deltas: Record<string, number>) =>
    setPredictions((prev) => {
      if (JSON.stringify(prev[actorId] ?? {}) === JSON.stringify(deltas)) {
        return prev;
      }
      return { ...prev, [actorId]: deltas };
    });
  const clearPrediction = (actorId: string) =>
    setPredictions((prev) => {
      if (!(actorId in prev)) return prev;
      const next = { ...prev };
      delete next[actorId];
      return next;
    });

  const [folded, setFolded] = useState(false);

  const statusOf = (i: number) =>
    i < batchRun.turnIndex ? "done" : i === batchRun.turnIndex ? "current" : "pending";

  // Pending deltas from earlier queue positions that haven't resolved yet
  // (done turns are on the server already, or were skipped — either way they
  // don't count as pending).
  const offsetsFor = (i: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (let j = 0; j < i; j++) {
      if (statusOf(j) === "done") continue;
      const p = predictions[batchRun.turnIds[j]];
      if (!p) continue;
      for (const [cid, d] of Object.entries(p)) {
        out[cid] = (out[cid] ?? 0) + d;
      }
    }
    return out;
  };

  return (
    <section aria-label="batch battle run" className="wt-panel wt-batch wt-batch-active">
      <h2
        className="wt-panel-title wt-clickable"
        onClick={() => setFolded((f) => !f)}
        title={folded ? t.combat.unfold : t.combat.fold}
      >
        {t.batch.titleActive}
        <span className="wt-fold-mark">{folded ? "▸" : "▾"}</span>
      </h2>
      {folded ? null : (
        <>
      <p>{t.batch.runNote}</p>
      <ol>
        {batchRun.turnIds.map((id, i) => {
          const c = byId.get(id);
          const status = statusOf(i);
          return (
            <li key={id}>
              <details open={status === "current"}>
                <summary
                  style={{
                    cursor: "pointer",
                    fontWeight: status === "current" ? "bold" : "normal",
                    textDecoration: status === "done" ? "line-through" : "none",
                    opacity: status === "done" ? 0.6 : 1,
                  }}
                >
                  {c && <ColorSwatch color={c.color} />}
                  {c?.name ?? t.batch.removed}
                  {status === "current" && t.batch.confirmsNext}
                  {status === "done" && " ✓"}
                </summary>
                {c && (
                  <div
                    style={{
                      margin: "0.3em 0 0.8em 0",
                      padding: "0.2em 0.6em",
                      border: "1px solid #ddd",
                      borderRadius: "4px",
                    }}
                  >
                    <ConfirmSession
                      actorId={id}
                      dice={dice}
                      combatants={combatants}
                      hpOffsets={offsetsFor(i)}
                      onPreviewDeltas={(deltas) => setPrediction(id, deltas)}
                      onConfirm={(acting, text, effects) => {
                        clearPrediction(id);
                        onConfirm(acting, text, effects);
                      }}
                      onConfirmRecipe={(payload) => {
                        clearPrediction(id);
                        onConfirmRecipe(payload);
                      }}
                      onSetClaim={onSetClaim}
                      onUpdateResource={onUpdateResource}
                      draft={drafts.find((draft) => draft.slotKey === draftSlotKey("batch", id, batchRun.runId))}
                      onPatchDraft={(actorId, patch) => onPatchDraft?.("batch", actorId, batchRun.runId, patch)}
                    />
                  </div>
                )}
              </details>
            </li>
          );
        })}
      </ol>
      <button onClick={onAdvanceBatchTurn}>{t.batch.skipTurn}</button>{" "}
      <button onClick={onEndBatchRun}>{t.batch.endRun}</button>
        </>
      )}
    </section>
  );
}

/**
 * The start form, isolated so its checkbox state stays local (same pattern as
 * AddCombatantForm). Default selection = every living combatant; the DM
 * unchecks whoever sits the run out (e.g. the boss). Queue order is initiative
 * order regardless of check order — the backend sorts.
 */
function StartRunForm({
  combatants,
  onStartBatchRun,
}: {
  combatants: CombatantView[];
  onStartBatchRun?: (combatantIds: string[]) => void;
}) {
  const t = useT();
  // id → checked override; unset = default (alive combatants are in).
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const isChecked = (c: CombatantView) => overrides[c._id] ?? c.alive;
  const selected = combatants.filter(isChecked).map((c) => c._id);

  return (
    <div>
      <p>{t.batch.startNote}</p>
      {combatants.length === 0 ? (
        <p>{t.batch.noCombatants}</p>
      ) : (
        <ul style={{ listStyle: "none", paddingLeft: 0 }}>
          {combatants.map((c) => (
            <li key={c._id}>
              <label>
                <input
                  type="checkbox"
                  checked={isChecked(c)}
                  onChange={(e) =>
                    setOverrides({ ...overrides, [c._id]: e.target.checked })
                  }
                  aria-label={`include ${c.name} in run`}
                />{" "}
                <ColorSwatch color={c.color} />
                {c.name} ({t.combat.init} {c.initiative}){!c.alive && <em>{t.batch.down}</em>}
              </label>
            </li>
          ))}
        </ul>
      )}
      <button
        onClick={() => onStartBatchRun?.(selected)}
        disabled={selected.length === 0}
      >
        Start run (fresh Batch roll)
      </button>
    </div>
  );
}
