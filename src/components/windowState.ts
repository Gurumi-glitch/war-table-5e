import { useEffect, useState, type MutableRefObject } from "react";
import type { CardWindow } from "./CharacterCardWindow";

// Issue #25 — a stranded window (title bar dragged/resized/spawned off the
// viewport) has nothing left to grab. MIN_VISIBLE_* is the minimal grabbable
// strip kept on-screen where the real DOM size isn't known yet (spawn
// cascade, browser-resize sweep); RESIZE_DEBOUNCE_MS throttles the sweep.
const MIN_VISIBLE_W = 80;
const MIN_VISIBLE_H = 40;
const RESIZE_DEBOUNCE_MS = 100;

/**
 * Precise drag-time clamp given the window's live measured size: the title
 * bar can never go above the viewport (top, zero tolerance); up to half the
 * window's width may hang off the left/right; the window may sink until its
 * title bar reaches the viewport bottom, never past it.
 */
export function clampWindowPos(
  x: number,
  y: number,
  winW: number,
  headH: number,
): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, -winW / 2), window.innerWidth - winW / 2),
    // Top wins when it conflicts with the bottom bound (headH > innerHeight,
    // a squashed/embedded viewport): a bar pushed above the top is
    // unrecoverable, one pushed past the bottom is merely inconvenient.
    y: Math.max(0, Math.min(y, window.innerHeight - headH)),
  };
}

/**
 * Measure the dragged window from its title-bar element and return the
 * clamped drag position. `e.currentTarget` must be the title bar (a direct
 * child of the position:fixed window root — true for all three drag heads).
 */
export function clampedDragPos(
  e: { clientX: number; clientY: number; currentTarget: HTMLElement },
  offset: { dx: number; dy: number },
): { x: number; y: number } {
  const head = e.currentTarget;
  const winW = head.parentElement?.getBoundingClientRect().width ?? 0;
  const headH = head.getBoundingClientRect().height;
  return clampWindowPos(e.clientX - offset.dx, e.clientY - offset.dy, winW, headH);
}

/** Conservative clamp for when the window's real size isn't known yet —
 *  keeps a minimal grabbable strip on-screen rather than a precise edge. */
function clampConservative(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.min(Math.max(x, 0), Math.max(0, window.innerWidth - MIN_VISIBLE_W)),
    y: Math.min(Math.max(y, 0), Math.max(0, window.innerHeight - MIN_VISIBLE_H)),
  };
}

/**
 * Shared floating-window primitive: open creates or focuses one keyed instance;
 * focus bumps z; drag/fold/close mutate only that keyed window. The caller owns
 * zTop so multiple logical window sets can share one stacking order.
 */
export function useWindowSet<Key extends string>(
  zTop: MutableRefObject<number>,
  origin: { x: number; y: number },
) {
  const [wins, setWins] = useState<Partial<Record<Key, CardWindow>>>({});

  const open = (id: Key) =>
    setWins((ws) => {
      const existing = ws[id];
      if (existing !== undefined) {
        return { ...ws, [id]: { ...existing, z: ++zTop.current, folded: false } };
      }
      const n = Object.keys(ws).length;
      const { x, y } = clampConservative(origin.x + n * 36, origin.y + n * 28);
      return {
        ...ws,
        [id]: { x, y, z: ++zTop.current, folded: false },
      };
    });

  const focus = (id: Key) =>
    setWins((ws) =>
      ws[id] === undefined
        ? ws
        : { ...ws, [id]: { ...ws[id], z: ++zTop.current } },
    );

  const drag = (id: Key, x: number, y: number) =>
    setWins((ws) =>
      ws[id] === undefined ? ws : { ...ws, [id]: { ...ws[id], x, y } },
    );

  const fold = (id: Key) =>
    setWins((ws) =>
      ws[id] === undefined
        ? ws
        : { ...ws, [id]: { ...ws[id], folded: !ws[id].folded } },
    );

  const close = (id: Key) =>
    setWins((ws) => {
      if (ws[id] === undefined) return ws;
      const next = { ...ws };
      delete next[id];
      return next;
    });

  // Shrinking the browser window can strand a window that was fine at the
  // old viewport size — sweep every entry back into reach on resize.
  // Debounced since resize fires continuously while dragging the OS window
  // edge; each of the five window sets carries its own listener.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const sweep = () => {
      setWins((ws) => {
        let changed = false;
        const next = { ...ws };
        for (const key of Object.keys(ws) as Key[]) {
          const w = ws[key];
          if (w === undefined) continue;
          const { x, y } = clampConservative(w.x, w.y);
          if (x !== w.x || y !== w.y) {
            next[key] = { ...w, x, y };
            changed = true;
          }
        }
        return changed ? next : ws;
      });
    };
    const onResize = () => {
      clearTimeout(timer);
      timer = setTimeout(sweep, RESIZE_DEBOUNCE_MS);
    };
    window.addEventListener("resize", onResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", onResize);
    };
  }, []);

  return { wins, open, focus, drag, fold, close };
}

