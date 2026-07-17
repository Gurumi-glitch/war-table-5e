import { test, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ResourcePip, ResourceTile, nextArmedCount, pipStateAt } from "./ResourcePip";
import type { ResourceView } from "../../convex/resources";

test("pipStateAt: available below current, spent at/above current, armed within the armed count", () => {
  expect(pipStateAt(0, 2, 0)).toBe("available");
  expect(pipStateAt(1, 2, 0)).toBe("available");
  expect(pipStateAt(2, 2, 0)).toBe("spent"); // L2 slot with current 2, max 3 — index 2 unavailable
  expect(pipStateAt(0, 2, 1)).toBe("armed");
});

test("nextArmedCount: clicking pip i arms up through i, or drops back to i if already at the top", () => {
  expect(nextArmedCount(0, 0)).toBe(1);
  expect(nextArmedCount(0, 2)).toBe(3);
  expect(nextArmedCount(3, 2)).toBe(2); // clicking the top of the armed range disarms down to it
});

test("ResourcePip: spent pips are non-interactive and not clickable", () => {
  const onClick = vi.fn();
  render(<ResourcePip state="spent" icon="square" color="#5aa9c4" onClick={onClick} ariaLabel="test pip" />);
  const btn = screen.getByLabelText("test pip");
  expect(btn).toBeDisabled();
  fireEvent.click(btn);
  expect(onClick).not.toHaveBeenCalled();
});

test("ResourcePip: available/armed pips are clickable and reflect aria-pressed", () => {
  const onClick = vi.fn();
  const { rerender } = render(<ResourcePip state="available" icon="square" color="#5aa9c4" onClick={onClick} ariaLabel="test pip" />);
  const btn = screen.getByLabelText("test pip");
  expect(btn).not.toBeDisabled();
  expect(btn).toHaveAttribute("aria-pressed", "false");
  fireEvent.click(btn);
  expect(onClick).toHaveBeenCalledTimes(1);

  rerender(<ResourcePip state="armed" icon="square" color="#5aa9c4" onClick={onClick} ariaLabel="test pip" />);
  expect(screen.getByLabelText("test pip")).toHaveAttribute("aria-pressed", "true");
});

function makeResource(overrides: Partial<ResourceView> = {}): ResourceView {
  return {
    _id: "r1",
    _creationTime: 0,
    combatantId: "c1",
    label: "L1 slots",
    current: 2,
    max: 2,
    ...overrides,
  };
}

test("ResourceTile: header shows a Roman numeral for a parsed slot level, else the label", () => {
  const { rerender } = render(
    <ResourceTile resource={makeResource({ label: "L2 slots" })} armedCount={0} onArmedCountChange={() => {}} defaultColor="#5aa9c4" />,
  );
  expect(screen.getByText("II")).toBeInTheDocument();

  rerender(
    <ResourceTile resource={makeResource({ label: "Ki", max: 3 })} armedCount={0} onArmedCountChange={() => {}} defaultColor="#5aa9c4" />,
  );
  expect(screen.getByText("Ki")).toBeInTheDocument();
});

test("ResourceTile: clicking an available pip reports the new armed count", () => {
  const onArmedCountChange = vi.fn();
  render(
    <ResourceTile
      resource={makeResource({ max: 3, current: 3 })}
      armedCount={0}
      onArmedCountChange={onArmedCountChange}
      defaultColor="#5aa9c4"
    />,
  );
  fireEvent.click(screen.getByLabelText("L1 slots pip 2 of 3"));
  expect(onArmedCountChange).toHaveBeenCalledWith(2);
});

test("ResourceTile: fold hides the pip grid, showing only the icon + header", () => {
  render(<ResourceTile resource={makeResource()} armedCount={0} onArmedCountChange={() => {}} defaultColor="#5aa9c4" />);
  expect(screen.getByLabelText("L1 slots pip 1 of 2")).toBeInTheDocument();
  fireEvent.click(screen.getByLabelText("fold L1 slots"));
  expect(screen.queryByLabelText("L1 slots pip 1 of 2")).not.toBeInTheDocument();
  expect(screen.getByText("I")).toBeInTheDocument(); // header stays visible
  fireEvent.click(screen.getByLabelText("expand L1 slots"));
  expect(screen.getByLabelText("L1 slots pip 1 of 2")).toBeInTheDocument();
});

test("ResourceTile: no onUpdateResource prop means no gear button (board pips can be read-only for icon/color)", () => {
  render(<ResourceTile resource={makeResource()} armedCount={0} onArmedCountChange={() => {}} defaultColor="#5aa9c4" />);
  expect(screen.queryByLabelText("customize L1 slots pip")).not.toBeInTheDocument();
});

test("ResourceTile: gear button opens a popover; picking an icon/color calls onUpdateResource with this resource's id", () => {
  const onUpdateResource = vi.fn();
  render(
    <ResourceTile
      resource={makeResource()}
      armedCount={0}
      onArmedCountChange={() => {}}
      defaultColor="#5aa9c4"
      onUpdateResource={onUpdateResource}
    />,
  );
  fireEvent.click(screen.getByLabelText("customize L1 slots pip"));
  fireEvent.click(screen.getByLabelText("icon flame"));
  expect(onUpdateResource).toHaveBeenCalledWith("r1", { icon: "flame" });

  fireEvent.click(screen.getByLabelText("color #a32638"));
  expect(onUpdateResource).toHaveBeenCalledWith("r1", { color: "#a32638" });
});

test("ResourceTile: reset to default clears both icon and color", () => {
  const onUpdateResource = vi.fn();
  render(
    <ResourceTile
      resource={makeResource({ icon: "flame", color: "#a32638" })}
      armedCount={0}
      onArmedCountChange={() => {}}
      defaultColor="#5aa9c4"
      onUpdateResource={onUpdateResource}
    />,
  );
  fireEvent.click(screen.getByLabelText("customize L1 slots pip"));
  fireEvent.click(screen.getByText("Reset to default"));
  expect(onUpdateResource).toHaveBeenCalledWith("r1", { icon: "square", color: null });
});
