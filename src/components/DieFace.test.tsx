import { test, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { DieFace } from "./DieFace";

afterEach(() => {
  vi.useRealTimers();
});

test("DieFace displays the current value", () => {
  render(
    <DieFace
      value={14}
      type="d20"
      onChange={() => {}}
      ariaLabel="d20 value"
    />,
  );
  expect(screen.getByLabelText("d20 value")).toHaveValue(14);
});

test("DieFace tumbles to a new value after a roll", async () => {
  vi.useFakeTimers();
  const { rerender } = render(
    <DieFace
      value={14}
      type="d20"
      onChange={() => {}}
      ariaLabel="d20 value"
    />,
  );
  expect(screen.getByLabelText("d20 value")).toHaveValue(14);

  rerender(
    <DieFace
      value={9}
      type="d20"
      onChange={() => {}}
      ariaLabel="d20 value"
    />,
  );
  await act(async () => {
    vi.advanceTimersByTime(600);
  });
  expect(screen.getByLabelText("d20 value")).toHaveValue(9);
});

test("manual edits skip the tumble", () => {
  vi.useFakeTimers();
  const values: number[] = [];
  render(
    <DieFace
      value={14}
      type="d20"
      onChange={(n) => values.push(n)}
      ariaLabel="d20 value"
    />,
  );
  fireEvent.change(screen.getByLabelText("d20 value"), {
    target: { value: "9" },
  });
  expect(values).toEqual([9]);
  vi.advanceTimersByTime(600);
  expect(screen.getByLabelText("d20 value")).toHaveValue(14);
});
