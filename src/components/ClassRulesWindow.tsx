import { SafeMarkdown } from "./SafeMarkdown";
import { ResizableWindow } from "./ResizableWindow";
import "./CharacterCardWindow.css";
import type { CharacterView } from "../../convex/characters";
import type { CardWindow } from "./CharacterCardWindow";
import { useT } from "../i18n";

/**
 * A lightweight, READ-ONLY floating tab that shows just one character's
 * 職業特殊規則 (class special rules) — the homebrew-rules block from the full
 * character card, rendered as Markdown (preview only, never editable here).
 * Opened by the ❓ button on a linked PC's combatant frame so the DM/players
 * can pop the rules text next to the combat without dragging out the whole
 * 900px sheet. Draggable / foldable / z-layerable, mirroring
 * CharacterCardWindow's parchment chrome; renders OUTSIDE `.wt` so it keeps the
 * light parchment look. Edits still happen on the full card.
 *
 * The drag + edge/corner resize chrome is the shared `ResizableWindow`
 * (fix-map-review-findings / design D6); this window keeps its exact prior look
 * via the `.ccw-*` class hooks.
 */
export type ClassRulesWindowProps = {
  character: CharacterView;
  win: CardWindow;
  onDrag: (x: number, y: number) => void;
  onFocus: () => void;
  onFold: () => void;
  onClose: () => void;
};

const MIN_W = 240;
const MIN_H = 140;

export function ClassRulesWindow({
  character: c,
  win,
  onDrag,
  onFocus,
  onFold,
  onClose,
}: ClassRulesWindowProps) {
  const t = useT();
  const rules = (c.classRules ?? []).filter((r) => r.trim() !== "");

  return (
    <ResizableWindow
      win={win}
      onDrag={onDrag}
      onFocus={onFocus}
      onFold={onFold}
      onClose={onClose}
      minWidth={MIN_W}
      minHeight={MIN_H}
      defaultSize={{
        w: Math.min(440, window.innerWidth - 16),
        h: Math.min(380, window.innerHeight - 120),
      }}
      className="ccw-card ccw-rules"
      headClassName="ccw-head"
      titleClassName="ccw-title"
      title={`❓ ${t.terms.displayName(c.nameZh, c.nameEn)} · ${t.card.classRules}`}
      buttonClassName="ccw-btn"
      foldLabel="fold class rules"
      closeLabel="close class rules"
      bodyClassName="ccw-body"
      bodyStyle={{ flex: "1 1 auto", minHeight: 0, maxHeight: "none" }}
    >
      {rules.length === 0 ? (
        <p style={{ margin: 0, color: "#6b5636" }}>{t.card.noClassRules}</p>
      ) : (
        <div className="ccw-class-rules">
          {rules.map((body, i) => (
            <div key={i} className="ccw-class-rule">
              <div className="ccw-ref-body ccw-md">
                <SafeMarkdown>{body}</SafeMarkdown>
              </div>
            </div>
          ))}
        </div>
      )}
    </ResizableWindow>
  );
}
