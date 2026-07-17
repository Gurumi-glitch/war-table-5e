import { useRef, useState } from "react";
import type { CharacterView } from "../../convex/characters";
import { useT } from "../i18n";
import { cardErrorMessage } from "../lib/cardFile";

export type CharactersPanelProps = {
  /** Global character cards; undefined while the query loads. */
  characters: CharacterView[] | undefined;
  onSeedCharacters: () => void;
  /** Throw a character into the current Game as a linked combatant (Q7). */
  onJoinBattle?: (characterId: string) => void;
  /** Character ids already linked to a combatant in THIS Game. */
  inBattleCharacterIds?: ReadonlySet<string>;
  /** Open (or focus) a character's floating card window (issue #9 step 4). */
  onOpenCard?: (characterId: string) => void;
  /** Create a blank card and open its editor (character-creation spec). */
  onNewCard?: () => Promise<void> | void;
  /** Import cards from a parsed `.dndcard.json` envelope (design D4). */
  onImportCards?: (envelope: unknown) => Promise<void>;
};

/**
 * The Characters strip (issue #9): a slim bar listing the global character
 * cards shared by every Game. Click a card to open its floating parchment
 * window (where the full sheet, draft+Save, and Join-battle live).
 *
 * The sample-cards button shows until the sample cards are actually THERE —
 * i.e. no card carries a `seedKey` — not merely until the table is non-empty.
 * Those differ the moment anyone makes or imports a card of their own, and the
 * table-empty version stranded them: one import and the samples could never be
 * loaded again. (The mutation is idempotent by seedKey, so an extra click is
 * harmless either way.)
 *
 * New card / Import (prep-public-release) live here rather than on the home
 * page: a card is always made inside a Game, which is what gives the server a
 * Game to stamp it with on the public demo (design D2).
 */
export function CharactersPanel({
  characters,
  onSeedCharacters,
  inBattleCharacterIds,
  onOpenCard,
  onNewCard,
  onImportCards,
}: CharactersPanelProps) {
  const t = useT();
  const fileInput = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  // Undefined while loading: offering to seed before we know what's there
  // would flash the button on every open.
  const hasSampleCards = characters?.some((c) => c.seedKey !== null) ?? true;

  const importFile = async (file: File) => {
    setError(null);
    let envelope: unknown;
    try {
      envelope = JSON.parse(await file.text());
    } catch {
      // Unparseable JSON is the same user mistake as a valid JSON that isn't
      // ours — they picked the wrong file — so say the same thing.
      setError(t.cardErrors.badEnvelope);
      return;
    }
    try {
      await onImportCards?.(envelope);
    } catch (err) {
      setError(cardErrorMessage(err, t));
    }
  };

  return (
    <section aria-label="characters" className="wt-panel" style={{ flex: "none" }}>
      <h2 className="wt-panel-title">{t.card.panelTitle}</h2>
      <div style={{ padding: "0.4em 0.55em" }}>
        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            alignItems: "center",
            gap: "0.35em",
            marginBottom: characters?.length === 0 ? 0 : "0.4em",
          }}
        >
          <button onClick={() => void onNewCard?.()} title={t.card.newCardTitle}>
            {t.card.newCard}
          </button>
          <button
            onClick={() => fileInput.current?.click()}
            title={t.card.importCardTitle}
          >
            {t.card.importCard}
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            aria-label="import character card file"
            style={{ display: "none" }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset first: picking the same file twice in a row fires no
              // change event otherwise, so a retry after an error looks dead.
              e.target.value = "";
              if (file !== undefined) void importFile(file);
            }}
          />
          {!hasSampleCards && (
            <button onClick={onSeedCharacters} title={t.card.seedButton}>
              {t.card.seedButton}
            </button>
          )}
        </div>
        {error !== null && (
          <p role="alert" className="wt-card-error">
            {error}
          </p>
        )}
        {characters === undefined ? (
          <p style={{ margin: 0 }}>{t.common.loading}</p>
        ) : characters.length === 0 ? null : (
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: "none",
              display: "flex",
              flexWrap: "wrap",
              gap: "0.35em",
            }}
          >
            {characters.map((c) => {
              const inBattle = inBattleCharacterIds?.has(c._id) ?? false;
              return (
                <li key={c._id}>
                  <button
                    onClick={() => onOpenCard?.(c._id)}
                    title={`${c.player} · ${c.classesText.split("\n")[0]} · HP ${c.hp}/${c.maxHp} · AC ${c.ac}`}
                    style={
                      inBattle
                        ? {
                            border: "1px solid #4e6e4e",
                            background: "rgba(78, 110, 78, 0.25)",
                            color: "#cfe3cf",
                          }
                        : undefined
                    }
                  >
                    📜 {t.terms.displayName(c.nameZh, c.nameEn)}
                    {inBattle && <small style={{ color: "inherit" }}> ⚔</small>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
