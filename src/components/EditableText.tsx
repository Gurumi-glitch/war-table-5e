import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";

type Props = {
  value: string;
  onSave: (next: string) => void;
  ariaLabel: string;
  placeholder?: string;
  /** Multiline textarea when true; single-line input otherwise. */
  multiline?: boolean;
  rows?: number;
  size?: number;
};

/**
 * A text field that commits on an explicit Save click instead of on every
 * keystroke. Per-keystroke mutations break when typing fast (the field
 * re-syncs mid-keystroke and text gets mangled), so notes hold a local draft
 * and only hit the backend when the user presses Save.
 *
 * Remote updates still arrive in realtime: a `baseRef` tracks the last
 * server-synced value, and the field adopts an incoming change whenever the
 * draft still matches that base (i.e. the user isn't mid-edit). While the user
 * is editing, their draft is preserved rather than clobbered.
 */
export function EditableText({
  value,
  onSave,
  ariaLabel,
  placeholder,
  multiline = false,
  rows = 2,
  size,
}: Props) {
  const t = useT();
  const [draft, setDraft] = useState(value);
  const baseRef = useRef(value);

  useEffect(() => {
    if (value === baseRef.current) return;
    // Server value changed since we last synced. Adopt it only if the user
    // hasn't been editing (draft still equals the old base).
    if (draft === baseRef.current) setDraft(value);
    baseRef.current = value;
  }, [value, draft]);

  const dirty = draft !== baseRef.current;

  const common = {
    value: draft,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setDraft(e.target.value),
    "aria-label": ariaLabel,
    placeholder,
  };

  return (
    <span style={{ display: "inline-flex", flexDirection: "column", gap: "0.15em" }}>
      {multiline ? (
        <textarea {...common} rows={rows} />
      ) : (
        <input {...common} size={size} />
      )}
      <span>
        <button
          onClick={() => onSave(draft)}
          disabled={!dirty}
          aria-label={`save ${ariaLabel}`}
        >
          Save
        </button>
        {dirty && (
          <span
            style={{ marginLeft: "0.4em", color: "#b45309" }}
            title={t.board.unsavedChanges}
          >
            ●
          </span>
        )}
      </span>
    </span>
  );
}
