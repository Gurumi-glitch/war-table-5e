import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ShellWindow } from "./ShellWindow";
import type { CardWindow } from "./CharacterCardWindow";

/**
 * Issue #16 — pointer/touch drag hardening. Covers the three defects called
 * out for the window head: a pointercancel (touch gesture interrupted by the
 * browser) must clear the drag state exactly like pointerup does, and a
 * fold/close button click inside the drag handle must not arm a drag first.
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

function setup(overrides: Partial<CardWindow> = {}) {
  const onDrag = vi.fn();
  const onFocus = vi.fn();
  const onFold = vi.fn();
  const onClose = vi.fn();
  render(
    <ShellWindow
      title="共用板"
      win={{ ...win, ...overrides }}
      onDrag={onDrag}
      onFocus={onFocus}
      onFold={onFold}
      onClose={onClose}
    >
      <div>body</div>
    </ShellWindow>,
  );
  return { onDrag, onFocus, onFold, onClose };
}

test("dragging the head calls onDrag with the pointer-relative position", () => {
  const { onDrag } = setup();
  const head = screen.getByText("共用板").parentElement as HTMLElement;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(40, 70); // dx=90,dy=80 from (100-10,100-20); 130-90,150-80
});

test("pointercancel clears the drag state so a later move is a no-op", () => {
  const { onDrag } = setup();
  const head = screen.getByText("共用板").parentElement as HTMLElement;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerCancel(head, { pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

test("pointerdown on the fold button does not arm a drag", () => {
  const { onDrag } = setup();
  const foldBtn = screen.getByRole("button", { name: "fold 共用板" });
  fireEvent.pointerDown(foldBtn, { clientX: 100, clientY: 100, pointerId: 1 });
  const head = screen.getByText("共用板").parentElement as HTMLElement;
  fireEvent.pointerMove(head, { clientX: 130, clientY: 150, pointerId: 1 });
  expect(onDrag).not.toHaveBeenCalled();
});

// Issue #25 — dragging a window's title bar past the viewport edge must
// clamp, not strand the window off-screen.
test("dragging past the top clamps the title bar to the viewport top", () => {
  const { onDrag } = setup();
  const head = screen.getByText("共用板").parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  outer.getBoundingClientRect = () =>
    ({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200 }) as DOMRect;
  head.getBoundingClientRect = () =>
    ({ width: 300, height: 30, left: 0, top: 0, right: 300, bottom: 30 }) as DOMRect;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 100, clientY: -500, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(10, 0);
});

test("dragging sideways stops once half the window width hangs off the edge", () => {
  const { onDrag } = setup();
  Object.defineProperty(window, "innerWidth", { value: 1000, configurable: true });
  const head = screen.getByText("共用板").parentElement as HTMLElement;
  const outer = head.parentElement as HTMLElement;
  outer.getBoundingClientRect = () =>
    ({ width: 300, height: 200, left: 0, top: 0, right: 300, bottom: 200 }) as DOMRect;
  head.getBoundingClientRect = () =>
    ({ width: 300, height: 30, left: 0, top: 0, right: 300, bottom: 30 }) as DOMRect;
  fireEvent.pointerDown(head, { clientX: 100, clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(head, { clientX: 5000, clientY: 100, pointerId: 1 });
  expect(onDrag).toHaveBeenCalledWith(1000 - 150, 20);
});
