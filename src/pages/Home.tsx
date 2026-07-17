import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../api";
import { useT } from "../i18n";
import { LanguageSwitch } from "../components/LanguageSwitch";
import { SOURCE_URL } from "../lib/source";

type Created = { playerToken: string; dmToken: string };
type CopyTarget = "player" | "dm";
type CopyStatus = { target: CopyTarget; succeeded: boolean } | null;

/**
 * Landing page: a DM creates a Game and receives two URLs — a secret DM URL
 * (Backstage) and a shareable player URL (Frontstage). No login.
 */
export function Home() {
  const t = useT();
  const create = useMutation(api.games.create);
  // Public-demo flag (design D1/D7). Undefined while loading — the banner is a
  // warning, so it appears once the server confirms it, never on a guess.
  const deployment = useQuery(api.games.getDeploymentMode, {}) as
    | { playgroundMode: boolean }
    | undefined;
  const [created, setCreated] = useState<Created | null>(null);
  const [busy, setBusy] = useState(false);
  const [copyStatus, setCopyStatus] = useState<CopyStatus>(null);

  const origin = window.location.origin;
  const playerUrl =
    created === null ? "" : `${origin}/play/${created.playerToken}`;
  const dmUrl =
    created === null
      ? ""
      : `${origin}/dm/${created.playerToken}/${created.dmToken}`;

  const copyUrl = async (target: CopyTarget, url: string) => {
    try {
      if (!navigator.clipboard?.writeText) {
        throw new Error("Clipboard API unavailable");
      }
      await navigator.clipboard.writeText(url);
      setCopyStatus({ target, succeeded: true });
    } catch {
      setCopyStatus({ target, succeeded: false });
    }
  };

  return (
    <main className="wt wt-home">
      <section className="wt-panel wt-home-card" aria-labelledby="home-title">
        <div className="wt-home-lang">
          <LanguageSwitch />
        </div>
        <h1 id="home-title" className="wt-panel-title wt-home-title">
          D&amp;D Combat Toolkit
        </h1>
        <p className="wt-home-lede">{t.home.lede}</p>

        {deployment?.playgroundMode === true && (
          <aside className="wt-home-playground" role="note">
            <strong>{t.home.playgroundTitle}</strong>
            <p>{t.home.playgroundBanner}</p>
          </aside>
        )}

        {created === null ? (
          <button
            className="wt-home-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const result = (await create({})) as Created;
                setCreated(result);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? t.home.creating : t.home.createGame}
          </button>
        ) : (
          <div className="wt-home-links">
            <p className="wt-home-created" role="status">
              {t.home.created}
            </p>

            <section className="wt-home-url-card" aria-labelledby="player-url-title">
              <div>
                <h2 id="player-url-title">{t.home.playerUrlTitle}</h2>
                <a className="wt-home-url" href={playerUrl}>
                  {playerUrl}
                </a>
              </div>
              <button
                className="wt-home-copy"
                onClick={() => void copyUrl("player", playerUrl)}
                aria-label="copy Player URL"
              >
                {copyStatus?.target === "player"
                  ? copyStatus.succeeded
                    ? t.home.copied
                    : t.home.copyFailed
                  : t.home.copy}
              </button>
            </section>

            <section className="wt-home-url-card wt-home-dm-url" aria-labelledby="dm-url-title">
              <div>
                <h2 id="dm-url-title">{t.home.dmUrlTitle}</h2>
                <a className="wt-home-url" href={dmUrl}>
                  {dmUrl}
                </a>
              </div>
              <button
                className="wt-home-copy"
                onClick={() => void copyUrl("dm", dmUrl)}
                aria-label="copy DM URL"
              >
                {copyStatus?.target === "dm"
                  ? copyStatus.succeeded
                    ? t.home.copied
                    : t.home.copyFailed
                  : t.home.copy}
              </button>
              <p className="wt-home-warning">
                <strong>{t.home.secrecyLabel}</strong>
                {t.home.secrecyWarning}
              </p>
            </section>
          </div>
        )}

        {/* Onboarding (design D7): two URLs and no accounts means nothing in
            the app ever tells a first-time DM what the next move is. */}
        <section className="wt-home-guide" aria-labelledby="home-guide-title">
          <h2 id="home-guide-title">{t.home.guideTitle}</h2>
          <ol>
            <li>{t.home.guideStep1}</li>
            <li>{t.home.guideStep2}</li>
            <li>{t.home.guideStep3}</li>
          </ol>
        </section>

        {/* AGPL §13 binds whoever modifies and serves this, not us running our
            own code — but a fork inherits this link and complies by editing one
            constant, instead of having to invent the mechanism. */}
        <footer className="wt-home-foot">
          <span>{t.home.licenseNote}</span>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
            {t.home.sourceLink}
          </a>
        </footer>
      </section>
    </main>
  );
}
