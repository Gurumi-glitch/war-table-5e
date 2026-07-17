import type { GameState } from "../../convex/games";
import { GameShell } from "./GameShell";
import type { GameBoardProps } from "./GameBoard";
import { EditableText } from "./EditableText";

type Props = GameBoardProps & {
  state: GameState;
  dmUrls: { playerUrl: string; dmUrl: string };
  onSetDmNote: (dmNote: string) => void;
};

/**
 * Backstage (DM) projection: the full state including DM-only fields. The
 * gameplay controls live in the shared GameShell (open to either role);
 * the DM-only distinction is the 🗝 drawer content passed here — the secret DM
 * note and the shareable URLs. Manual override always wins.
 */
export function BackstageView({
  state,
  dmUrls,
  onSetDmNote,
  ...board
}: Props) {
  return (
    <main aria-label="backstage">
      <GameShell
        state={state}
        {...board}
        dmPanel={
          <>
            <details>
              <summary>Game links</summary>
              <p>
                Player URL (Frontstage):{" "}
                <code data-testid="player-url">{dmUrls.playerUrl}</code>
              </p>
              <p>
                DM URL (secret — Backstage):{" "}
                <code data-testid="dm-url">{dmUrls.dmUrl}</code>
              </p>
            </details>
            <section aria-label="dm notes">
              <h2>DM Notes (secret)</h2>
              <EditableText
                value={state.dmNote}
                onSave={onSetDmNote}
                ariaLabel="dm note"
                multiline
                rows={10}
              />
            </section>
          </>
        }
      />
    </main>
  );
}
