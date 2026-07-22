import { useRef, type ReactNode } from "react";
import type { CardWindow } from "./CharacterCardWindow";
import { clampedDragPos } from "./windowState";

type Props = {
  title: string;
  win: CardWindow;
  onDrag: (x: number, y: number) => void;
  onFocus: () => void;
  onFold: () => void;
  onClose: () => void;
  children: ReactNode;
};

/**
 * A floating dark-leather window of the War Table shell (共用板 / DM surface) —
 * same drag/fold/z behavior as the parchment CharacterCardWindow, but themed
 * with the shell (rendered INSIDE `.wt` so its contents inherit the gothic
 * element styling). Drag by the title bar via pointer capture.
 */
export function ShellWindow({
  title,
  win,
  onDrag,
  onFocus,
  onFold,
  onClose,
  children,
}: Props) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  return (
    <div
      className="wt-window"
      style={{ left: win.x, top: win.y, zIndex: win.z }}
      onPointerDown={onFocus}
      aria-label={`window ${title}`}
    >
      <div
        className="wt-window-head"
        onPointerDown={(e) => {
          if ((e.target as HTMLElement).closest("button")) return;
          drag.current = { dx: e.clientX - win.x, dy: e.clientY - win.y };
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (drag.current) {
            const { x, y } = clampedDragPos(e, drag.current);
            onDrag(x, y);
          }
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
      >
        <span className="wt-window-title">{title}</span>
        <button onClick={onFold} aria-label={`fold ${title}`}>
          {win.folded ? "▾" : "▴"}
        </button>
        <button onClick={onClose} aria-label={`close ${title}`}>
          ×
        </button>
      </div>
      <div className={`wt-window-fold${win.folded ? "" : " is-open"}`}>
        <div className="wt-window-fold-inner">
          <div className="wt-window-body">{children}</div>
        </div>
      </div>
    </div>
  );
}
