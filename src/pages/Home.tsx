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
  // Demo-only copy must wait for the backend PLAYGROUND_MODE gate. Undefined
  // while loading is intentionally treated as private/self-hosted: no guessing.
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

  const createGame = async () => {
    setBusy(true);
    try {
      const result = (await create({})) as Created;
      setCreated(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="wt wt-home-ledger">
      <div className="wt-home-ledger-layout">
        <aside className="wt-home-ledger-rail" aria-label="War Table 5e">
          <div className="wt-home-ledger-rail-top">
            <span className="wt-home-ledger-mark">❖ WAR TABLE</span>
            <LanguageSwitch className="wt-home-ledger-language" />
          </div>

          <p className="wt-home-ledger-eyebrow">{t.home.eyebrow}</p>
          <h1>War Table 5e</h1>
          <p>{t.home.noLogin}</p>

          {created === null ? (
            <button
              className="wt-home-ledger-create"
              disabled={busy}
              onClick={() => void createGame()}
            >
              {busy ? t.home.creating : t.home.createGame}
            </button>
          ) : (
            <p className="wt-home-ledger-ready" role="status">
              {t.home.created}
            </p>
          )}

          {deployment?.playgroundMode === true && (
            <aside className="wt-home-ledger-playground" role="note">
              <strong>{t.home.playgroundTitle}</strong>
              <p>{t.home.playgroundBanner}</p>
            </aside>
          )}

          <nav aria-label={t.home.journeyTitle}>
            <a href="#home-start">01 · {t.home.journeyTitle}</a>
            <a href="#home-roles">02 · {t.home.rolesTitle}</a>
            <a href="#home-loop">03 · {t.home.loopTitle}</a>
            <a href="#home-features">04 · {t.home.featuresTitle}</a>
            <a href="#home-authority">05 · {t.home.manualTitle}</a>
          </nav>

          <footer>
            <span>{t.home.licenseNote}</span>
            <a href={SOURCE_URL} target="_blank" rel="noreferrer noopener">
              {t.home.sourceLink}
            </a>
          </footer>
        </aside>

        <article className="wt-home-ledger-content">
          <header className="wt-home-ledger-hero">
            <span>CAMPAIGN OPERATIONS / COMBAT STATE</span>
            <h2>{t.home.title}</h2>
            <p>{t.home.lede}</p>
            <strong>{t.home.linkModel}</strong>
          </header>

          {created !== null && (
            <section className="wt-home-ledger-section wt-home-ledger-links" aria-labelledby="home-links-title">
              <div className="wt-home-ledger-section-number">00</div>
              <div>
                <h2 id="home-links-title">{t.home.created}</h2>
                <div className="wt-home-ledger-credentials">
                  <section aria-labelledby="player-url-title">
                    <div>
                      <h3 id="player-url-title">{t.home.playerUrlTitle}</h3>
                      <a className="wt-home-ledger-url" href={playerUrl}>
                        {playerUrl}
                      </a>
                    </div>
                    <button
                      className="wt-home-ledger-copy"
                      onClick={() => void copyUrl("player", playerUrl)}
                      aria-label={t.home.copyPlayerAria}
                      aria-live="polite"
                    >
                      {copyStatus?.target === "player"
                        ? copyStatus.succeeded
                          ? t.home.copied
                          : t.home.copyFailed
                        : t.home.copy}
                    </button>
                  </section>

                  <section className="wt-home-ledger-dm-url" aria-labelledby="dm-url-title">
                    <div>
                      <h3 id="dm-url-title">{t.home.dmUrlTitle}</h3>
                      <a className="wt-home-ledger-url" href={dmUrl}>
                        {dmUrl}
                      </a>
                    </div>
                    <button
                      className="wt-home-ledger-copy"
                      onClick={() => void copyUrl("dm", dmUrl)}
                      aria-label={t.home.copyDmAria}
                      aria-live="polite"
                    >
                      {copyStatus?.target === "dm"
                        ? copyStatus.succeeded
                          ? t.home.copied
                          : t.home.copyFailed
                        : t.home.copy}
                    </button>
                    <p>
                      <strong>{t.home.secrecyLabel}</strong>
                      {t.home.secrecyWarning}
                    </p>
                  </section>
                </div>
              </div>
            </section>
          )}

          <section id="home-start" className="wt-home-ledger-section">
            <div className="wt-home-ledger-section-number">01</div>
            <div>
              <p className="wt-home-ledger-kicker">{t.home.fieldProcedure}</p>
              <h2>{t.home.journeyTitle}</h2>
              <ol className="wt-home-ledger-procedure">
                {t.home.journey.map((step) => (
                  <li key={step.label}>
                    <span>{step.label}</span>
                    <div>
                      <h3>{step.title}</h3>
                      <p>{step.body}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </section>

          <section id="home-roles" className="wt-home-ledger-section">
            <div className="wt-home-ledger-section-number">02</div>
            <div>
              <p className="wt-home-ledger-kicker">{t.home.accessModel}</p>
              <h2>{t.home.rolesTitle}</h2>
              <div className="wt-home-ledger-roles">
                <article>
                  <span>PLAYER</span>
                  <h3>{t.home.playerRoleTitle}</h3>
                  <p>{t.home.playerRoleBody}</p>
                  <strong>{t.home.playerTrust}</strong>
                </article>
                <article className="wt-home-ledger-role-dm">
                  <span>DM</span>
                  <h3>{t.home.dmRoleTitle}</h3>
                  <p>{t.home.dmRoleBody}</p>
                </article>
              </div>
            </div>
          </section>

          <section id="home-loop" className="wt-home-ledger-section">
            <div className="wt-home-ledger-section-number">03</div>
            <div>
              <p className="wt-home-ledger-kicker">{t.home.resolutionPipeline}</p>
              <h2>{t.home.loopTitle}</h2>
              <p>{t.home.loopLede}</p>
              <div className="wt-home-ledger-loop">
                {t.home.combatLoop.map((step) => (
                  <article key={step.label}>
                    <b>{step.label}</b>
                    <h3>{step.title}</h3>
                    <p>{step.body}</p>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section id="home-features" className="wt-home-ledger-section">
            <div className="wt-home-ledger-section-number">04</div>
            <div>
              <p className="wt-home-ledger-kicker">{t.home.toolkitIndex}</p>
              <h2>{t.home.featuresTitle}</h2>
              <dl className="wt-home-ledger-index">
                {t.home.features.map((feature) => (
                  <div key={feature.title}>
                    <dt>{feature.title}</dt>
                    <dd>{feature.body}</dd>
                  </div>
                ))}
              </dl>
            </div>
          </section>

          <section id="home-authority" className="wt-home-ledger-section wt-home-ledger-authority">
            <div className="wt-home-ledger-section-number">05</div>
            <div>
              <p className="wt-home-ledger-kicker">{t.home.tableAuthority}</p>
              <h2>{t.home.manualTitle}</h2>
              <p>{t.home.manualBody}</p>
              <div>
                <article>
                  <h3>{t.home.realtimeTitle}</h3>
                  <p>{t.home.realtimeBody}</p>
                </article>
                <article>
                  <h3>{t.home.limitsTitle}</h3>
                  <p>{t.home.limitsBody}</p>
                </article>
              </div>
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
