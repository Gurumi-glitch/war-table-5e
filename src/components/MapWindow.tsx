import { MapBoard } from "./MapBoard";
import { useT } from "../i18n";
import { ResizableWindow } from "./ResizableWindow";
import type { CardWindow } from "./CharacterCardWindow";

/**
 * Floating, resizable 地圖 window launched from 戰爭桌 (war-table-map-window /
 * task 9.2-9.3). Mounts the SAME interactive `MapBoard` used by the full-page
 * section — piece movement, creation/deletion, and the flavor dice board all
 * work here without a separate read-only rendering.
 *
 * The drag-to-move header + edge/corner resize chrome is the shared
 * `ResizableWindow` (fix-map-review-findings / design D6): a MIN_W/MIN_H floor,
 * and resizing from the left/top edge anchors the opposite edge by moving the
 * window origin (owned by the parent's window manager). This window keeps its
 * exact prior look via inline style hooks.
 */
export type MapWindowProps = {
  playerToken: string;
  dmToken?: string;
  win: CardWindow;
  onDrag: (x: number, y: number) => void;
  onFocus: () => void;
  onFold: () => void;
  onClose: () => void;
};

const MIN_W = 320;
const MIN_H = 240;

export function MapWindow({
  playerToken,
  dmToken,
  win,
  onDrag,
  onFocus,
  onFold,
  onClose,
}: MapWindowProps) {
  const t = useT();
  return (
    <ResizableWindow
      win={win}
      onDrag={onDrag}
      onFocus={onFocus}
      onFold={onFold}
      onClose={onClose}
      minWidth={MIN_W}
      minHeight={MIN_H}
      defaultSize={{
        w: Math.min(680, window.innerWidth - 24),
        h: Math.min(520, window.innerHeight - 120),
      }}
      className="mw-card"
      style={{
        position: "fixed",
        background: "#140f1c",
        border: "1px solid #4f3a63",
        boxShadow: "0 8px 30px rgba(0,0,0,0.6)",
      }}
      headClassName="mw-head"
      headStyle={{
        display: "flex",
        alignItems: "center",
        gap: "0.4em",
        padding: "0.35em 0.5em",
        background: "#1c1526",
        borderBottom: "1px solid #3a2a4a",
        color: "#ece4f5",
        cursor: "move",
        touchAction: "none",
      }}
      titleStyle={{ flex: 1, fontWeight: 700, letterSpacing: "0.05em" }}
      title={`🗺 ${t.shell.map}`}
      foldLabel="fold map window"
      closeLabel="close map window"
      bodyStyle={{ flex: "1 1 auto", minHeight: 0, overflow: "hidden" }}
    >
      <MapBoard playerToken={playerToken} dmToken={dmToken} />
    </ResizableWindow>
  );
}
