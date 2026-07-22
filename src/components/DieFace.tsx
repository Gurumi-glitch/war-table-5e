import { useEffect, useRef, useState } from "react";
import { DICE_SIDES, type DieType } from "../../convex/diceHelpers";

type UseTumbleOptions = {
  /** When the incoming value equals this ref, skip the tumble and settle immediately. */
  skipRef?: React.MutableRefObject<number | null>;
};

/**
 * Tumble a die value when it changes because of a roll (batch, single reroll,
 * type reroll). Manual edits can mark themselves in `skipRef` to settle without
 * rolling. Reduced-motion users always see an immediate value change.
 */
export function useTumble(
  value: number,
  sides: number,
  { skipRef }: UseTumbleOptions = {},
) {
  const [shown, setShown] = useState(value);
  const [tumbling, setTumbling] = useState(false);

  useEffect(() => {
    if (value === shown) return;
    // ponytail: same-value race skips one tumble, harmless
    if (skipRef && skipRef.current !== null && skipRef.current === value) {
      skipRef.current = null;
      setShown(value);
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setShown(value);
      return;
    }
    setTumbling(true);
    let step = 0;
    const id = window.setInterval(() => {
      step += 1;
      setShown(1 + Math.floor(Math.random() * sides));
      if (step >= 10) {
        window.clearInterval(id);
        setShown(value);
        setTumbling(false);
      }
    }, 60);
    return () => window.clearInterval(id);
    // `shown` is intentionally omitted: it is derived inside the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, sides, skipRef]);

  return { shown, tumbling };
}

type TumbleNumberProps = {
  value: number | null;
  sides: number;
  className?: string;
  fallback?: string;
};

/**
 * A plain numeric display that tumbles when its value changes. Used by the
 * Scene flavor-dice panel; absent an input, there is no "manual edit" path to
 * skip the roll.
 */
export function TumbleNumber({
  value,
  sides,
  className,
  fallback = "—",
}: TumbleNumberProps) {
  const { shown, tumbling } = useTumble(value ?? 0, sides);
  if (value === null) return <span className={className}>{fallback}</span>;
  return (
    <span className={`${className ?? ""}${tumbling ? " tumbling" : ""}`}>
      {shown}
    </span>
  );
}

type Props = {
  value: number;
  type: DieType;
  onChange: (value: number) => void;
  ariaLabel: string;
  title?: string;
};

/**
 * One hex die face. Its value tumbles whenever the server value changes,
 * unless the change came from this input (tracked via `skipRef`).
 */
export function DieFace({ value, type, onChange, ariaLabel, title }: Props) {
  const skipRef = useRef<number | null>(null);
  const { shown, tumbling } = useTumble(value, DICE_SIDES[type], { skipRef });
  return (
    <span className={`wt-die${tumbling ? " tumbling" : ""}`} title={title}>
      <input
        type="number"
        value={shown}
        readOnly={tumbling}
        onChange={(e) => {
          if (e.target.value === "") return;
          const n = Number(e.target.value);
          if (Number.isNaN(n)) return;
          skipRef.current = n;
          onChange(n);
        }}
        aria-label={ariaLabel}
      />
    </span>
  );
}
