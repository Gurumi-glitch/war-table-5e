import { test, expect, vi, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { clampWindowPos, useWindowSet } from "./windowState";

/**
 * Issue #25 — floating windows must never be draggable fully off-screen.
 * clampWindowPos is the precise per-drag clamp (real measured winW/headH);
 * useWindowSet additionally clamps conservatively on spawn (open cascade)
 * and on browser resize, where the real DOM size isn't known.
 */

const ORIGINAL_W = window.innerWidth;
const ORIGINAL_H = window.innerHeight;

function setViewport(width: number, height: number) {
  Object.defineProperty(window, "innerWidth", {
    value: width,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(window, "innerHeight", {
    value: height,
    configurable: true,
    writable: true,
  });
}

afterEach(() => {
  setViewport(ORIGINAL_W, ORIGINAL_H);
  vi.useRealTimers();
});

// --- clampWindowPos ---------------------------------------------------------

test("clampWindowPos leaves an in-bounds position untouched", () => {
  setViewport(1000, 800);
  expect(clampWindowPos(100, 100, 300, 30)).toEqual({ x: 100, y: 100 });
});

test("clampWindowPos: top has zero tolerance", () => {
  setViewport(1000, 800);
  expect(clampWindowPos(100, -50, 300, 30)).toEqual({ x: 100, y: 0 });
});

test("top edge wins when the viewport is shorter than the title bar", () => {
  setViewport(800, 20);
  expect(clampWindowPos(100, 500, 200, 32).y).toBe(0);
});

test("clampWindowPos: bottom stops when the drag bar hits the viewport edge", () => {
  setViewport(1000, 800);
  expect(clampWindowPos(100, 5000, 300, 30)).toEqual({ x: 100, y: 800 - 30 });
});

test("clampWindowPos: left allows up to 50% of the window width to overflow", () => {
  setViewport(1000, 800);
  expect(clampWindowPos(-5000, 100, 300, 30)).toEqual({ x: -150, y: 100 });
});

test("clampWindowPos: right allows up to 50% of the window width to overflow", () => {
  setViewport(1000, 800);
  expect(clampWindowPos(5000, 100, 300, 30)).toEqual({ x: 1000 - 150, y: 100 });
});

// --- useWindowSet: open() cascade -------------------------------------------

test("open() spawns the first window at origin when origin is on-screen", () => {
  setViewport(1000, 800);
  const zTop = { current: 20 };
  const { result } = renderHook(() => useWindowSet<"a">(zTop, { x: 80, y: 70 }));
  act(() => result.current.open("a"));
  expect(result.current.wins.a).toMatchObject({ x: 80, y: 70 });
});

test("open() clamps every cascade window's origin into a small viewport", () => {
  setViewport(200, 150);
  const zTop = { current: 20 };
  const { result } = renderHook(() =>
    useWindowSet<"a" | "b" | "c">(zTop, { x: 700, y: 90 }),
  );
  act(() => result.current.open("a"));
  act(() => result.current.open("b"));
  act(() => result.current.open("c"));
  for (const id of ["a", "b", "c"] as const) {
    const w = result.current.wins[id]!;
    expect(w.x).toBeGreaterThanOrEqual(0);
    expect(w.x).toBeLessThanOrEqual(200);
    expect(w.y).toBeGreaterThanOrEqual(0);
    expect(w.y).toBeLessThanOrEqual(150);
  }
});

// --- useWindowSet: resize sweep ---------------------------------------------

test("shrinking the browser window pulls a stranded window back into reach", () => {
  vi.useFakeTimers();
  setViewport(1000, 800);
  const zTop = { current: 20 };
  const { result } = renderHook(() => useWindowSet<"a">(zTop, { x: 80, y: 70 }));
  act(() => result.current.open("a"));
  act(() => result.current.drag("a", 900, 700));

  setViewport(300, 200);
  act(() => {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(150);
  });

  const w = result.current.wins.a!;
  expect(w.x).toBeLessThanOrEqual(300);
  expect(w.y).toBeLessThanOrEqual(200);
});

test("resize sweep leaves an already-on-screen window untouched", () => {
  vi.useFakeTimers();
  setViewport(1000, 800);
  const zTop = { current: 20 };
  const { result } = renderHook(() => useWindowSet<"a">(zTop, { x: 80, y: 70 }));
  act(() => result.current.open("a"));
  act(() => result.current.drag("a", 200, 150));

  act(() => {
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(150);
  });

  expect(result.current.wins.a).toMatchObject({ x: 200, y: 150 });
});

test("the resize listener is removed on unmount", () => {
  const zTop = { current: 20 };
  const removeSpy = vi.spyOn(window, "removeEventListener");
  const { unmount } = renderHook(() => useWindowSet<"a">(zTop, { x: 80, y: 70 }));
  unmount();
  expect(removeSpy.mock.calls.some(([type]) => type === "resize")).toBe(true);
  removeSpy.mockRestore();
});
