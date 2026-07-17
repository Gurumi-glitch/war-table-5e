import { test, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MarkdownErrorBoundary, SafeMarkdown } from "./SafeMarkdown";

/** A child that always throws in render — stands in for react-markdown
 *  blowing up on an old browser (missing built-in API mid-render). */
function Bomb(): never {
  throw new Error("markdown chain exploded");
}

test("SafeMarkdown renders GFM markdown normally", () => {
  render(<SafeMarkdown>{"**bold** and ~~struck~~"}</SafeMarkdown>);
  expect(screen.getByText("bold").tagName).toBe("STRONG");
  expect(screen.getByText("struck").tagName).toBe("DEL");
});

test("MarkdownErrorBoundary degrades to raw text when rendering throws", () => {
  // React logs the caught error — silence it for a clean test run.
  const spy = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <MarkdownErrorBoundary raw={"# raw source text"}>
      <Bomb />
    </MarkdownErrorBoundary>,
  );
  spy.mockRestore();
  const fallback = screen.getByTestId("markdown-fallback");
  expect(fallback).toHaveTextContent("# raw source text");
});
