import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { CardWindow } from "./CharacterCardWindow";
import { clampedDragPos, clampWindowPos } from "./windowState";

/**
 * Shared floating-window chrome (fix-map-review-findings / design D6): the
 * positioned card, a drag-to-move header (title + fold + close), and 8 edge/
 * corner resize handles with pointer-captured `startResize`. Owns only the
 * chrome + internal size state; window POSITION (x/y/z/folded) stays owned by
 * the parent's window manager (`useWindowSet`), patched via `onDrag`.
 *
 * Extracted verbatim from the copy-pasted chrome in `MapWindow` /
 * `ClassRulesWindow` — no behavioral change. Both windows keep their exact look
 * by passing their own class/style hooks (one uses inline styles, the other CSS
 * classes); the body content is supplied as `children`.
 *
 * Resizing from the left/top edge anchors the opposite edge by moving the window
 * origin (via `onDrag`), so the far edge stays put while width/height change.
 */
export type ResizableWindowProps = {
  win: CardWindow;
  onDrag: (x: number, y: number) => void;
  onFocus: () => void;
  onFold: () => void;
  onClose: () => void;
  /** Header title content (rendered inside a span with `titleClassName`/`titleStyle`). */
  title: ReactNode;
  minWidth: number;
  minHeight: number;
  defaultSize: { w: number; h: number };
  /** Outer card class / inline style hooks. */
  className?: string;
  style?: CSSProperties;
  /** Header row class / inline style hooks. */
  headClassName?: string;
  headStyle?: CSSProperties;
  /** Title span hooks. */
  titleClassName?: string;
  titleStyle?: CSSProperties;
  /** Fold/close button class + aria-labels. */
  buttonClassName?: string;
  foldLabel?: string;
  closeLabel?: string;
  /** Body wrapper hooks (rendered only when not folded). */
  bodyClassName?: string;
  bodyStyle?: CSSProperties;
  children: ReactNode;
};

/** Which axes a handle grows: [left, right, top, bottom]. */
type Edge = {
  l?: boolean;
  r?: boolean;
  t?: boolean;
  b?: boolean;
  cursor: string;
  style: CSSProperties;
};

const HANDLE = 8; // px thickness of edge grips
const CORNER = 12;
const EDGES: Edge[] = [
  // sides
  { t: true, cursor: "ns-resize", style: { top: 0, left: CORNER, right: CORNER, height: HANDLE } },
  { b: true, cursor: "ns-resize", style: { bottom: 0, left: CORNER, right: CORNER, height: HANDLE } },
  { l: true, cursor: "ew-resize", style: { left: 0, top: CORNER, bottom: CORNER, width: HANDLE } },
  { r: true, cursor: "ew-resize", style: { right: 0, top: CORNER, bottom: CORNER, width: HANDLE } },
  // corners
  { t: true, l: true, cursor: "nwse-resize", style: { top: 0, left: 0, width: CORNER, height: CORNER } },
  { t: true, r: true, cursor: "nesw-resize", style: { top: 0, right: 0, width: CORNER, height: CORNER } },
  { b: true, l: true, cursor: "nesw-resize", style: { bottom: 0, left: 0, width: CORNER, height: CORNER } },
  { b: true, r: true, cursor: "nwse-resize", style: { bottom: 0, right: 0, width: CORNER, height: CORNER } },
];

export function ResizableWindow({
  win,
  onDrag,
  onFocus,
  onFold,
  onClose,
  title,
  minWidth,
  minHeight,
  defaultSize,
  className,
  style,
  headClassName,
  headStyle,
  titleClassName,
  titleStyle,
  buttonClassName,
  foldLabel,
  closeLabel,
  bodyClassName,
  bodyStyle,
  children,
}: ResizableWindowProps) {
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const [size, setSize] = useState(() => defaultSize);
  // Live title-bar height for the resize-grip clamp below — the head's
  // rendered height isn't otherwise available inside startResize's closure.
  const headRef = useRef<HTMLDivElement | null>(null);

  // Cleanup for whichever resize is currently in flight (if any), so an
  // unmount mid-resize (map switch, window closed by another connected
  // client) can't leave window-level listeners dangling to hijack the next
  // unrelated pointer interaction.
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => resizeCleanupRef.current?.(), []);

  // Start a resize from an edge/corner grip. Anchors the opposite edge: growing
  // from the left/top moves the window origin (owned by the parent) so the far
  // edge stays put while width/height change.
  const startResize = (e: React.PointerEvent, edge: Edge) => {
    e.stopPropagation();
    // A second grip grabbed before the first resize ended would otherwise
    // overwrite the ref and leak the first resize's window listeners forever
    // (never torn down by the unmount effect, which only runs the LAST
    // assigned cleanup) — tear down any resize still in flight first.
    resizeCleanupRef.current?.();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const sx = e.clientX;
    const sy = e.clientY;
    const sw = size.w;
    const sh = size.h;
    const ox = win.x;
    const oy = win.y;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - sx;
      const dy = ev.clientY - sy;
      let w = sw;
      let h = sh;
      let x = ox;
      let y = oy;
      if (edge.r) w = Math.max(minWidth, sw + dx);
      if (edge.l) {
        w = Math.max(minWidth, sw - dx);
        x = ox + (sw - w); // keep the right edge fixed
      }
      if (edge.b) h = Math.max(minHeight, sh + dy);
      if (edge.t) {
        h = Math.max(minHeight, sh - dy);
        y = oy + (sh - h); // keep the bottom edge fixed
      }
      // Only the left/top grips move the origin — clamp it so a far pull
      // can't strand the title bar (issue #25 follow-up 2), re-deriving
      // w/h from the clamped origin so the anchored opposite edge doesn't
      // jump when the clamp engages.
      if (edge.t || edge.l) {
        const headH = headRef.current?.getBoundingClientRect().height ?? 0;
        const c = clampWindowPos(x, y, w, headH);
        if (edge.l && c.x !== x) w = Math.max(minWidth, ox + sw - c.x);
        if (edge.t && c.y !== y) h = Math.max(minHeight, oy + sh - c.y);
        x = c.x;
        y = c.y;
      }
      setSize({ w, h });
      if (x !== ox || y !== oy) onDrag(x, y);
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      resizeCleanupRef.current = null;
    };
    const up = (ev: PointerEvent) => {
      (e.target as HTMLElement).releasePointerCapture?.(ev.pointerId);
      cleanup();
    };
    const cancel = () => cleanup();
    resizeCleanupRef.current = cleanup;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
  };

  return (
    <div
      className={className}
      style={{
        left: win.x,
        top: win.y,
        zIndex: win.z,
        width: size.w,
        height: win.folded ? undefined : size.h,
        display: "flex",
        flexDirection: "column",
        ...style,
      }}
      onPointerDown={onFocus}
    >
      <div
        ref={headRef}
        className={headClassName}
        style={headStyle}
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
        <span className={titleClassName} style={titleStyle}>
          {title}
        </span>
        <button
          className={buttonClassName}
          style={{ padding: "0 .5em" }}
          onClick={() => onFold()}
          aria-label={foldLabel}
        >
          {win.folded ? "▾" : "▴"}
        </button>
        <button
          className={buttonClassName}
          style={{ padding: "0 .5em" }}
          onClick={() => onClose()}
          aria-label={closeLabel}
        >
          ×
        </button>
      </div>
      <div className={`wt-window-fold${win.folded ? "" : " is-open"}`}>
        <div className="wt-window-fold-inner">
          <div className={bodyClassName} style={bodyStyle}>
            {children}
          </div>
        </div>
      </div>
      {!win.folded &&
        EDGES.map((edge, i) => (
          <div
            key={i}
            aria-hidden
            onPointerDown={(e) => startResize(e, edge)}
            style={{
              position: "absolute",
              zIndex: 5,
              cursor: edge.cursor,
              touchAction: "none",
              ...edge.style,
            }}
          />
        ))}
    </div>
  );
}
