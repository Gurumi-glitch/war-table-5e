import { test, expect } from "vitest";
import { desktopOverride } from "./GameBoard";

/** The `?desktop` URL override that lets the TTS tablet (narrow viewport)
 *  opt into the full War Table grid instead of the stacked mobile layout. */

test("no param → responsive behavior unchanged", () => {
  expect(desktopOverride("")).toEqual({ force: false });
  expect(desktopOverride("?foo=1")).toEqual({ force: false });
});

test("bare ?desktop forces the grid without zoom", () => {
  expect(desktopOverride("?desktop")).toEqual({ force: true });
});

test("?desktop=0.8 forces the grid and zooms out", () => {
  expect(desktopOverride("?desktop=0.8")).toEqual({ force: true, zoom: 0.8 });
});

test("out-of-range or junk zoom values force without zoom", () => {
  expect(desktopOverride("?desktop=0.3")).toEqual({ force: true });
  expect(desktopOverride("?desktop=2")).toEqual({ force: true });
  expect(desktopOverride("?desktop=abc")).toEqual({ force: true });
});
