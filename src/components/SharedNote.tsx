import { useState } from "react";
import { useT } from "../i18n";

type Props = {
  note: string;
  counter: number;
  onSetNote: (note: string) => void;
  onIncrement: () => void;
};

/**
 * The minimal shared editable state that proves realtime sync in both
 * directions: either role may edit the note or bump the counter, and every
 * client sees the update. (Slice 1's sync proof; kept in later slices.)
 */
export function SharedNote({ note, counter, onSetNote, onIncrement }: Props) {
  const t = useT();
  const [draft, setDraft] = useState(note);

  return (
    <section aria-label="shared board">
      <p>
        Counter: <strong data-testid="counter">{counter}</strong>{" "}
        <button onClick={onIncrement}>+1</button>
      </p>
      <label style={{ display: "block" }}>
        Note
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          rows={10}
          style={{ width: "100%", boxSizing: "border-box", resize: "vertical" }}
        />
      </label>
      <div>
        <button onClick={() => onSetNote(draft)}>{t.board.saveNote}</button>
        <span style={{ marginLeft: "1em" }} data-testid="note">
          {note}
        </span>
      </div>
    </section>
  );
}
