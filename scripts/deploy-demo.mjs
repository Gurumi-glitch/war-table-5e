/**
 * Deploy the Convex backend to the PUBLIC DEMO project.
 *
 * Why this is a script and not `"deploy:demo": "convex deploy"`:
 * `convex deploy` picks its target from the environment, and with no deploy
 * key it falls back to "this project's default production deployment" — the
 * live table the group actually plays on. A one-line npm script named
 * `deploy:demo` that quietly ships there the moment an env var is missing is a
 * trap, so this fails loudly instead.
 *
 * `convex deploy` has no `--deployment-name` flag (checked against the CLI, not
 * assumed); targeting another project is done with `CONVEX_DEPLOY_KEY`, which
 * is the documented CI path.
 *
 * Usage: put both in `.env.local` (gitignored) and just run `npm run deploy:demo`:
 *   CONVEX_DEMO_DEPLOY_KEY=prod:<demo>|<secret>
 *   CONVEX_DEMO_DEPLOYMENT=<demo deployment name>   # the allowlist guard, below
 * An inline `CONVEX_DEMO_DEPLOY_KEY=… npm run deploy:demo` still overrides.
 *
 * The name is CONVEX_DEMO_DEPLOY_KEY, not CONVEX_DEPLOY_KEY, on purpose: the
 * Convex CLI reads `.env.local` and would honour a bare `CONVEX_DEPLOY_KEY`
 * there, so naming it that would make a plain `npx convex deploy` — the command
 * that deploys the GAME TABLE — silently target the demo instead. The custom
 * name is invisible to the CLI; only this script, which sets CONVEX_DEPLOY_KEY
 * for the demo subprocess alone, ever reads it.
 *
 * Deployment names are deliberately absent from this file: it ships in a public
 * repo, and a deployment name is an address for the live table.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Read our two vars out of `.env.local` so they need not be typed each run.
 * A five-line parser rather than a dotenv dependency: it only has to find two
 * KEY=value lines, and process.env still wins so an inline override works.
 * Absent file = nothing read (the archive dir renames its .env.local away).
 */
function fromEnvLocal(name) {
  if (process.env[name] !== undefined) return process.env[name];
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    for (const line of readFileSync(resolve(root, ".env.local"), "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m && m[1] === name) {
        // Strip a trailing `# comment` — the Convex CLI writes its own
        // deployment lines that way (`dev:foo-1 # team: …`), so a value copied
        // in the same style would otherwise carry the whole comment.
        return m[2].replace(/\s+#.*$/, "").trim().replace(/^["']|["']$/g, "");
      }
    }
  } catch {
    // No .env.local, or unreadable — fall through to undefined.
  }
  return undefined;
}

/** Just the deployment name: drop a `prod:` prefix and any `|secret`. */
const deploymentName = (s) => (s ?? "").replace(/^prod:/, "").split("|")[0];

const key = fromEnvLocal("CONVEX_DEMO_DEPLOY_KEY");

if (!key) {
  console.error(`
✗ CONVEX_DEMO_DEPLOY_KEY is not set — refusing to deploy.

  Without it, 'convex deploy' would target this project's default production
  deployment, which is the live game table. That is not what you asked for.

  Run:
    CONVEX_DEMO_DEPLOY_KEY='<demo prod deploy key>' npm run deploy:demo

  The key is at: Convex dashboard → demo project → Settings → Deploy keys.
`);
  process.exit(1);
}

// A prod deploy key looks like "prod:<deployment-name>|<secret>". Surface which
// deployment is about to be written to: the whole risk here is deploying to the
// wrong project, and the name is the only thing that tells them apart.
const target = deploymentName(key);
// Normalize the pin the same way, so it matches whether it was written as a
// bare name (`notable-snail-281`) or in the CLI's own style (`prod:notable-…`).
const expected = deploymentName(fromEnvLocal("CONVEX_DEMO_DEPLOYMENT"));

// An allowlist, not a denylist of known-dangerous names: this catches ANY wrong
// target — a stale key, a typo, another project entirely — instead of only the
// one deployment someone thought to name. It also keeps deployment names out of
// this file, which is public.
if (expected !== "" && target !== expected) {
  console.error(`
✗ That key points at "${target}", but CONVEX_DEMO_DEPLOYMENT expects "${expected}".

  Refusing to deploy. Check which key you pasted — deploying the demo to the
  wrong deployment is how the live table gets overwritten.
`);
  process.exit(1);
}

console.log(`Deploying Convex functions to: ${target}`);
if (expected === "") {
  console.log(
    "  (Set CONVEX_DEMO_DEPLOYMENT in .env.local to have this verified for you.)",
  );
}

const result = spawnSync("npx", ["convex", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, CONVEX_DEPLOY_KEY: key },
});
process.exit(result.status ?? 1);
