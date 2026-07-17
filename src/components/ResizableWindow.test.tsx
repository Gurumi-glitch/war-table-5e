import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { ResizableWindow } from "./ResizableWindow";
import type { CardWindow } from "./CharacterCardWindow";

/**
 * Issue #16 — pointer/touch drag hardening, shared window chrome. Covers the
 * header drag (same defects as ShellWindow/CharacterCardWindow) plus the
 * edge/corner resize handles' window-level pointermove/pointerup listeners,
 * which must also unhook on pointercancel AND on unmount (map switch / window
 * closed by another connected client) — otherwise the next unrelated pointer
 * press-move-release anywhere resumes the stale resize.
 */

const win: CardWindow = { x: 10, y: 20, z: 1, folded: false };

// A later test overrides window.innerWidth to exercise the clamp (issue
// #25) — restore it so that mutation can't leak into whichever test
// happens to run next in this file.
const ORIGINAL_INNER_WIDTH = window.innerWidth;
afterEach(() => {
  Object.defineProperty(window, "innerWidth", {
    value: ORIGINAL_INNER_WIDTH,
    configurable: true,
  });
});

function setup() {
  const onDrag = vi.fn();
  const onFocus = vi.fn();
  const onFold = vi.fn();
  const onClose = vi.fn();
  render(
    <ResizableWindow
      win={win}
      onDrag={onDrag}
      onFocus={onFocus}
      onFold={onFold}
      onClose={onClose}
      title="地圖"
      minWidth={100}
      minHeight={100}
      defaultSize={{ w: 400, h: 300 }}
      headClassName="mw-head"
      foldLabel="fold map window"
      closeLabel="close map window"
    >
      <div>body</div>
    </ResizableWindow>,
  );
  return { onDrag, onFocus, onFold, onClose };
}

test("pointercancel on the header clears the drag state", () => {
  const { onDrag } = setup();
  const head = screen.getByText("地圖").parentElement as HTMLElement;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerCancel(head, { pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

test("pointerdown on the fold button does not arm a header drag", () => {
  const { onDrag } = setup();
  const foldBtn = screen.getByRole("button", { name: "fold map window" });
  fireEvent.pointerDown(foldBtn, { clientX: 100, clientY: 100, pointerId: 1 });
  const head = screen.getByText("地圖").parentElement as HTMLElement;
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

test("pointercancel during a resize removes the window listeners (no stray move)", () => {
  const { onDrag } = setup();
  const grip = document.querySelectorAll('[aria-hidden="true"]')[0] as HTMLElement;
  fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerCancel(window, { pointerId: 1 });
  // A later, totally unrelated pointermove anywhere on window must not resize.
  fireEvent.pointerMove(window, { clientX: 500, clientY: 500, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

test("starting a second resize before the first ends still cleans up both (no leaked listeners)", () => {
  // A single-slot cleanup ref that's naively overwritten by the second
  // startResize call would leak the FIRST resize's window listeners forever
  // (the unmount effect only ever runs the LAST-assigned cleanup). Assert
  // every added pointer listener is eventually removed — under the bug, the
  // first resize's 3 listeners are added but never removed.
  const dragTypes = new Set(["pointermove", "pointerup", "pointercancel"]);
  const addSpy = vi.spyOn(window, "addEventListener");
  const removeSpy = vi.spyOn(window, "removeEventListener");
  const onDrag = vi.fn();
  const { unmount } = render(
    <ResizableWindow
      win={win}
      onDrag={onDrag}
      onFocus={vi.fn()}
      onFold={vi.fn()}
      onClose={vi.fn()}
      title="地圖"
      minWidth={100}
      minHeight={100}
      defaultSize={{ w: 400, h: 300 }}
      headClassName="mw-head"
      foldLabel="fold map window"
      closeLabel="close map window"
    >
      <div>body</div>
    </ResizableWindow>,
  );
  const grips = document.querySelectorAll('[aria-hidden="true"]');
  fireEvent.pointerDown(grips[0] as HTMLElement, { clientX: 100, clientY: 100, pointerId: 1 });
  // A second grip grabbed (second touch point) before the first resize ends.
  fireEvent.pointerDown(grips[1] as HTMLElement, { clientX: 200, clientY: 200, pointerId: 2 });
  unmount();
  const added = addSpy.mock.calls.filter(([type]) => dragTypes.has(type as string)).length;
  const removed = removeSpy.mock.calls.filter(([type]) => dragTypes.has(type as string)).length;
  expect(removed).toBe(added);
  addSpy.mockRestore();
  removeSpy.mockRestore();
  cleanup();
});

// Issue #25 — dragging a resizable window's header past the viewport edge
// must clamp using its LIVE (possibly resized) dimensions, not strand it.
test("dragging past the top clamps the header to the viewport top", () => {
  const { onDrag } = setup();
  const head = screen.getByText("地圖").parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  outer.getBoundingClientRect = () =>
    ({ width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300 }) as DOMRect;
  head.getBoundingClientRect = () =>
    ({ width: 400, height: 30, left: 0, top: 0, right: 400, bottom: 30 }) as DOMRect;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 100, clientY: -500, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(10, 0);
});

test("dragging sideways stops once half the window width hangs off the edge", () => {
  const { onDrag } = setup();
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  const head = screen.getByText("地圖").parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  outer.getBoundingClientRect = () =>
    ({ width: 400, height: 300, left: 0, top: 0, right: 400, bottom: 300 }) as DOMRect;
  head.getBoundingClientRect = () =>
    ({ width: 400, height: 30, left: 0, top: 0, right: 400, bottom: 30 }) as DOMRect;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 5000, clientY: 100, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(1000 - 200, 20);
});

// Issue #25 follow-up 2 — resize grips that move the window origin
// (top/left) must clamp it too, not just the header drag. Right/bottom
// grips never move the origin so they need no clamp.
test("pulling the top grip far above the viewport clamps y and keeps the bottom edge anchored", () => {
  const { onDrag } = setup();
  const head = screen.getByText("地圖").parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  head.getBoundingClientRect = () =>
    ({ width: 400, height: 30, left: 0, top: 0, right: 400, bottom: 30 }) as DOMRect;
  const topGrip = document.querySelectorAll('[aria-hidden="true"]')[0] as HTMLElement;
  fireEvent.pointerDown(topGrip, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 100, clientY: -600, pointerId: 1 });

  expect(onDrag.mock.calls.every(([, y]) => y >= 0)).toBe(true);
  expect(onDrag).toHaveBeenCalledWith(10, 0);
  const [, drawnY] = onDrag.mock.calls[onDrag.mock.calls.length - 1];
  const h = parseFloat(outer.style.height);
  expect(drawnY + h).toBe(20 + 300); // bottom edge (oy+sh) unchanged
});

test("pulling the left grip far past the edge clamps x and keeps the right edge anchored", () => {
  const { onDrag } = setup();
  const head = screen.getByText("地圖").parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  head.getBoundingClientRect = () =>
    ({ width: 400, height: 30, left: 0, top: 0, right: 400, bottom: 30 }) as DOMRect;
  const leftGrip = document.querySelectorAll('[aria-hidden="true"]')[2] as HTMLElement;
  fireEvent.pointerDown(leftGrip, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: -5000, clientY: 100, pointerId: 1 });

  expect(onDrag).toHaveBeenCalledWith(-2750, 20);
  const [drawnX] = onDrag.mock.calls[onDrag.mock.calls.length - 1];
  const w = parseFloat(outer.style.width);
  expect(drawnX + w).toBe(10 + 400); // right edge (ox+sw) unchanged
});

test("the right grip alone still never calls onDrag (origin doesn't move, no clamp needed)", () => {
  const { onDrag } = setup();
  const rightGrip = document.querySelectorAll('[aria-hidden="true"]')[3] as HTMLElement;
  fireEvent.pointerDown(rightGrip, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(window, { clientX: 5000, clientY: 100, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

test("unmounting mid-resize removes the window listeners", () => {
  const onDrag = vi.fn();
  const { unmount } = render(
    <ResizableWindow
      win={win}
      onDrag={onDrag}
      onFocus={vi.fn()}
      onFold={vi.fn()}
      onClose={vi.fn()}
      title="地圖"
      minWidth={100}
      minHeight={100}
      defaultSize={{ w: 400, h: 300 }}
      headClassName="mw-head"
      foldLabel="fold map window"
      closeLabel="close map window"
    >
      <div>body</div>
    </ResizableWindow>,
  );
  const grip = document.querySelectorAll('[aria-hidden="true"]')[0] as HTMLElement;
  fireEvent.pointerDown(grip, { clientX: 100, clientY: 100, pointerId: 1 });
  unmount();
  fireEvent.pointerMove(window, { clientX: 500, clientY: 500, pointerId: 1 });
  fireEvent.pointerUp(window, { clientX: 500, clientY: 500, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
  cleanup();
});
