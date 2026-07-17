import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import "./ResourcePip.css";
import { headerFor } from "../lib/resourceLabels";
import { ICON_KEYS, ResourceIcon, pipColsForMax } from "../lib/resourceIcons";
import type { ResourceView } from "../../convex/resources";

/**
 * BG3-style resource pips (docs/DESIGN.md, docs/plans/resource-pips-build-plan.md).
 * One `ResourceTile` per resource, slot levels included — no merged/shared
 * frame for any group (reverted from an earlier "merged slot table" draft
 * per user feedback, prototype/NOTES.md follow-up 5).
 */

export type PipState = "available" | "armed" | "spent";

const COLOR_SWATCHES = [
  "#d4a24e", // ember gold (theme default)
  "#a32638", // blood red
  "#5aa9c4", // teal
  "#8a6fd1", // violet
  "#7fae5a", // moss green
  "#c98a3e", // amber
];

export function pipStateAt(index: number, current: number, armed: number): PipState {
  if (index >= current) return "spent";
  if (index < armed) return "armed";
  return "available";
}

/**
 * Clicking pip `i` arms up through `i` (armedCount = i+1) unless that pip is
 * already the top of the armed range, in which case it drops back to `i`.
 */
export function nextArmedCount(currentArmed: number, clickedIndex: number): number {
  return currentArmed <= clickedIndex ? clickedIndex + 1 : clickedIndex;
}

/** One pip. Renders a plain filled square for the default "square" icon,
 * otherwise a tinted glyph from the built-in icon set. Non-interactive once
 * spent — you can't re-arm a pip you don't have. */
export function ResourcePip({
  state,
  icon,
  color,
  onClick,
  ariaLabel,
}: {
  state: PipState;
  icon: string;
  color: string;
  onClick?: () => void;
  ariaLabel: string;
}) {
  const interactive = state !== "spent";
  const isSquare = icon === "square" || !icon;
  return (
    <button
      type="button"
      className={`rpip rpip--${state}`}
      onClick={interactive ? onClick : undefined}
      disabled={!interactive}
      aria-label={ariaLabel}
      aria-pressed={state === "armed"}
    >
      {isSquare ? (
        <span className="rpip__square" style={{ background: state === "spent" ? undefined : color }} aria-hidden="true" />
      ) : (
        <ResourceIcon icon={icon} color={state === "spent" ? "currentColor" : color} size={22} />
      )}
    </button>
  );
}

/**
 * One resource's full tile: icon glyph (flavor) + header caption (Roman
 * numeral for a parsed slot level, else the label) + the real pip grid.
 * Fold collapses to icon + header only. A gear button (+ right-click
 * shortcut) opens an icon/color popover in place, for in-combat convenience
 * without leaving the board (DESIGN.md "Where the picker lives", entry 2).
 */
export function ResourceTile({
  resource,
  armedCount,
  onArmedCountChange,
  defaultColor,
  onUpdateResource,
}: {
  resource: ResourceView;
  armedCount: number;
  onArmedCountChange: (n: number) => void;
  defaultColor: string;
  onUpdateResource?: (resourceId: string, patch: { icon?: string; color?: string | null }) => void;
}) {
  const [folded, setFolded] = useState(false);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);

  const color = resource.color ?? defaultColor;
  const icon = resource.icon ?? "square";
  const cols = pipColsForMax(resource.max);

  const openMenuFromGear = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setMenu({ x: rect.left, y: rect.bottom + 4 });
  };

  const openMenuFromContext = (e: React.MouseEvent) => {
    e.preventDefault();
    setMenu({ x: e.clientX, y: e.clientY });
  };

  const clickPip = (i: number) => onArmedCountChange(nextArmedCount(armedCount, i));

  return (
    <div
      className="rtile"
      style={{ width: folded ? undefined : `${cols * 35 + 22}px` }}
      onContextMenu={onUpdateResource ? openMenuFromContext : undefined}
    >
      <button className="rtile__fold" aria-label={`${folded ? "expand" : "fold"} ${resource.label}`} onClick={() => setFolded((v) => !v)}>
        {folded ? "▶" : "▼"}
      </button>
      {onUpdateResource && (
        <button className="rtile__gear" aria-label={`customize ${resource.label} pip`} onClick={openMenuFromGear}>
          ⚙
        </button>
      )}
      <div className="rtile__icon" aria-hidden="true">
        {icon === "square" ? <span className="rtile__icon-square" style={{ background: color }} /> : <ResourceIcon icon={icon} color={color} size={26} />}
      </div>
      <div className="rtile__label">{headerFor(resource.label)}</div>
      {!folded && (
        <div className="rtile__pips" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
          {Array.from({ length: resource.max }, (_, i) => (
            <ResourcePip
              key={i}
              state={pipStateAt(i, resource.current, armedCount)}
              icon={icon}
              color={color}
              onClick={() => clickPip(i)}
              ariaLabel={`${resource.label} pip ${i + 1} of ${resource.max}`}
            />
          ))}
        </div>
      )}
      {menu && onUpdateResource && (
        <PipStylePopover
          x={menu.x}
          y={menu.y}
          resource={resource}
          onUpdateResource={onUpdateResource}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function PipStylePopover({
  x,
  y,
  resource,
  onUpdateResource,
  onClose,
}: {
  x: number;
  y: number;
  resource: ResourceView;
  onUpdateResource: (resourceId: string, patch: { icon?: string; color?: string | null }) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    // Bubble phase: the popover's own onClick calls stopPropagation, so a
    // click inside it never reaches this listener; any other click closes it.
    const onDocClick = () => onClose();
    window.addEventListener("keydown", onEsc);
    document.addEventListener("click", onDocClick);
    return () => {
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("click", onDocClick);
    };
  }, [onClose]);

  // Portaled to <body>: the tile sits inside board panels whose stacking
  // context traps this fixed-position popup below later siblings (the Dice
  // Board painted over its bottom half). Outside every stacking context it
  // always layers on top. Safe outside `.wt` — every rule in ResourcePip.css
  // carries theme-matched fallback colors.
  return createPortal(
    <div className="rtile-popover" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <p className="rtile-popover__hint">{resource.label} pip style</p>
      <IconGridPicker value={resource.icon ?? "square"} onChange={(icon) => onUpdateResource(resource._id, { icon })} />
      <div className="rtile-popover__colors">
        {COLOR_SWATCHES.map((c) => (
          <button
            key={c}
            data-active={resource.color === c}
            style={{ background: c }}
            onClick={() => onUpdateResource(resource._id, { color: c })}
            aria-label={`color ${c}`}
          />
        ))}
      </div>
      <button className="rtile-popover__reset" onClick={() => onUpdateResource(resource._id, { icon: "square", color: null })}>
        Reset to default
      </button>
    </div>,
    document.body,
  );
}

/** Shared scrollable grid of every built-in icon (~40+), used by both the
 * board's gear popover and the character sheet's icon-picker button. */
export function IconGridPicker({ value, onChange }: { value: string; onChange: (icon: string) => void }) {
  return (
    <div className="icon-grid">
      {ICON_KEYS.map((key) => (
        <button
          key={key}
          type="button"
          data-active={value === key}
          onClick={() => onChange(key)}
          aria-label={`icon ${key}`}
          title={key}
        >
          {key === "square" ? <span className="icon-grid__square" /> : <ResourceIcon icon={key} color="#e8d9b0" size={26} />}
        </button>
      ))}
    </div>
  );
}

/**
 * Character-sheet icon-picker button (DESIGN.md "Where the picker lives",
 * entry 1): shows the current icon tinted by `color`; clicking opens the
 * same scrollable icon grid the board popover uses, closing on an outside
 * click or Escape.
 */
export function ResourceIconPickerButton({
  icon,
  color,
  onChange,
  ariaLabel,
}: {
  icon: string;
  color: string;
  onChange: (icon: string) => void;
  ariaLabel: string;
}) {
  // Screen position of the open popover (anchored to the button), or null
  // when closed — portaled like PipStylePopover, since the sheet window's
  // overflow used to clip the absolutely-positioned grid at the sheet edge.
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const open = menu !== null;

  useEffect(() => {
    if (!open) return;
    const onEsc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(null);
    const onDocClick = () => setMenu(null);
    window.addEventListener("keydown", onEsc);
    document.addEventListener("click", onDocClick);
    return () => {
      window.removeEventListener("keydown", onEsc);
      document.removeEventListener("click", onDocClick);
    };
  }, [open]);

  return (
    <span style={{ display: "inline-block" }}>
      <button
        type="button"
        className="ricon-btn"
        aria-label={ariaLabel}
        onClick={(e) => {
          e.stopPropagation();
          const rect = e.currentTarget.getBoundingClientRect();
          setMenu((v) => (v ? null : { x: rect.left, y: rect.bottom + 2 }));
        }}
      >
        {icon === "square" ? <span className="ricon-btn__square" style={{ background: color }} /> : <ResourceIcon icon={icon} color={color} size={16} />}
      </button>
      {menu &&
        createPortal(
          <div className="ricon-popover" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
            <IconGridPicker
              value={icon}
              onChange={(key) => {
                onChange(key);
                setMenu(null);
              }}
            />
          </div>,
          document.body,
        )}
    </span>
  );
}
