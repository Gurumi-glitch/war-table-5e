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
 * Usage:
 *   CONVEX_DEMO_DEPLOY_KEY='<demo project prod deploy key>' npm run deploy:demo
 *
 * Optional but recommended — pin the expected target so a wrong key is caught
 * before it deploys rather than after:
 *   CONVEX_DEMO_DEPLOYMENT='<demo deployment name>'
 *
 * Both belong in `.env.local` (gitignored) or a password manager. Deployment
 * names are deliberately absent from this file: it ships in a public repo, and
 * a deployment name is an address for the live table.
 */
import { spawnSync } from "node:child_process";

const key = process.env.CONVEX_DEMO_DEPLOY_KEY;

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
const target = (key.split("|")[0] ?? "").replace(/^prod:/, "");
const expected = process.env.CONVEX_DEMO_DEPLOYMENT;

// An allowlist, not a denylist of known-dangerous names: this catches ANY wrong
// target — a stale key, a typo, another project entirely — instead of only the
// one deployment someone thought to name. It also keeps deployment names out of
// this file, which is public.
if (expected !== undefined && target !== expected) {
  console.error(`
✗ That key points at "${target}", but CONVEX_DEMO_DEPLOYMENT expects "${expected}".

  Refusing to deploy. Check which key you pasted — deploying the demo to the
  wrong deployment is how the live table gets overwritten.
`);
  process.exit(1);
}

console.log(`Deploying Convex functions to: ${target}`);
if (expected === undefined) {
  console.log(
    "  (Set CONVEX_DEMO_DEPLOYMENT in .env.local to have this verified for you.)",
  );
}

const result = spawnSync("npx", ["convex", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, CONVEX_DEPLOY_KEY: key },
});
process.exit(result.status ?? 1);
