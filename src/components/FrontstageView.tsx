import { GameShell } from "./GameShell";
import type { GameBoardProps } from "./GameBoard";

type Props = GameBoardProps;

/**
 * Frontstage (player) projection of the Shared Board. Receives only the state
 * the backend chose to send — DM-only fields (`dmNote`, combatant `dmNotes`)
 * are withheld by the backend, not hidden here. Renders the same War Table
 * shell as Backstage (open to either role); the DM's 🗝 drawer is the sole
 * thing omitted here.
 */
export function FrontstageView(props: Props) {
  return (
    <main aria-label="frontstage">
      <GameShell {...props} />
    </main>
  );
}
