// Local CI runner — mirrors .github/workflows/ci.yml so the exact same gates can be
// run on a developer machine for fast pre-push feedback (no waiting on a hosted run).
//
// Usage (note: `pnpm ci` is a pnpm BUILTIN — clean-install — so this is `ci:local`):
//   node scripts/ci-local.mjs          # FAST gates: install + prep + format + typecheck + lint
//   node scripts/ci-local.mjs --build  # also run the full production build (turbo build) — slow
//   node scripts/ci-local.mjs --e2e    # also run the Playwright e2e job (embedded PG + dev servers)
//   node scripts/ci-local.mjs --all    # everything (build + e2e) — the full ci.yml mirror
//   pnpm ci:local     pnpm ci:build     pnpm ci:all
//
// Mirrors ci.yml, but the slow jobs are opt-in so the common pre-merge check is quick:
//   install:        pnpm install --frozen-lockfile  (catches lockfile drift, like every CI job)
//   format:         prettier --check "**/*.{ts,tsx,json,md,yml}" --ignore-path .gitignore
//   typecheck-lint: db build -> api+web codegen -> pnpm typecheck -> pnpm lint
//   build (--build):    ... -> pnpm build      (full Next production build; cold ~2-4 min)
//   e2e (--e2e):        embedded PG (ci-db) -> start api+web -> playwright  (continue-on-error in CI)
//
// The shared prep (db build + codegen — needed for typecheck/lint/build) runs once up front.
import { spawn } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
import net from "node:net";

const WITH_E2E = process.argv.includes("--e2e") || process.argv.includes("--all");
const WITH_BUILD = process.argv.includes("--build") || process.argv.includes("--all");
const WIN = process.platform === "win32";
const C = {
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  dim: "\x1b[2m",
  reset: "\x1b[0m",
};

/** Run a command to completion, streaming output. Resolves the exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    // shell:true lets `pnpm`/`prettier` resolve on Windows (.cmd shims) and POSIX alike.
    const child = spawn(cmd, args, { stdio: "inherit", shell: WIN, ...opts });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

const results = [];
/** Run a named gate; abort the whole run on first failure (like a red CI job). */
async function gate(name, cmd, args, opts) {
  const t0 = Date.now();
  console.log(`\n${C.cyan}▶ ${name}${C.reset} ${C.dim}(${cmd} ${args.join(" ")})${C.reset}`);
  const code = await run(cmd, args, opts);
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  results.push({ name, ok: code === 0, secs });
  if (code !== 0) {
    console.error(`${C.red}✖ ${name} failed (exit ${code})${C.reset}`);
    summary();
    process.exit(1);
  }
  console.log(`${C.green}✔ ${name} (${secs}s)${C.reset}`);
}

function summary() {
  console.log(`\n${C.cyan}── local CI summary ──${C.reset}`);
  for (const r of results) {
    const mark = r.ok ? `${C.green}✔${C.reset}` : `${C.red}✖${C.reset}`;
    console.log(`  ${mark} ${r.name} ${C.dim}(${r.secs}s)${C.reset}`);
  }
}

async function main() {
  // Surface lockfile drift like every hosted CI job — but NON-fatal: a locked/partial local
  // node_modules (e.g. Windows file locks while an embedded DB is running) shouldn't block the
  // useful gates, and hosted CI runs the authoritative `pnpm install --frozen-lockfile`.
  {
    const t0 = Date.now();
    console.log(
      `\n${C.cyan}▶ install (frozen)${C.reset} ${C.dim}(pnpm install --frozen-lockfile)${C.reset}`,
    );
    const code = await run("pnpm", ["install", "--frozen-lockfile"]);
    if (code === 0) {
      console.log(
        `${C.green}✔ install (frozen) (${((Date.now() - t0) / 1000).toFixed(0)}s)${C.reset}`,
      );
    } else {
      console.warn(
        `${C.dim}⚠ install (frozen) failed — check for lockfile drift (hosted CI enforces it); continuing with existing node_modules.${C.reset}`,
      );
    }
  }

  // Shared prerequisite: @fd/web imports the gitignored @/graphql/generated, produced by
  // web codegen, which needs api's schema.graphql, which needs the generated Prisma client.
  await gate("prep: db build", "pnpm", ["--filter", "@fd/db", "build"]);
  await gate("prep: api codegen", "pnpm", ["--filter", "@fd/api", "codegen"]);
  await gate("prep: web codegen", "pnpm", ["--filter", "@fd/web", "codegen"]);

  // format job
  await gate("format", "pnpm", [
    "exec",
    "prettier",
    "--check",
    "**/*.{ts,tsx,json,md,yml}",
    "--ignore-path",
    ".gitignore",
  ]);

  // typecheck-lint job
  await gate("typecheck", "pnpm", ["typecheck"]);
  await gate("lint", "pnpm", ["lint"]);

  // build job (opt-in: slow cold production build). --log-order=stream so turbo doesn't
  // buffer everything behind its TUI and look hung.
  if (WITH_BUILD) await gate("build", "pnpm", ["build", "--", "--log-order=stream"]);

  if (WITH_E2E) await e2e();

  summary();
  const skipped = [!WITH_BUILD && "build", !WITH_E2E && "e2e"].filter(Boolean);
  console.log(`\n${C.green}Local CI gates passed.${C.reset}`);
  if (skipped.length) {
    console.log(
      `${C.dim}Skipped (opt-in): ${skipped.join(", ")} — run 'pnpm ci:all' for the full mirror.${C.reset}`,
    );
  }
}

/**
 * Playwright e2e job (non-blocking in CI: continue-on-error). Boots the embedded PG
 * cluster, starts the api + web dev servers against it, waits for both ports, runs
 * Playwright, then tears everything down. Heavier + environment-sensitive; run when
 * you want the full pass. Note: needs :3000 and :4000 free (stop any local dev server).
 */
async function e2e() {
  const env = {
    ...process.env,
    // CI=true makes e2e/playwright.config.ts use workers:1 (seeded-OTP logins conflict
    // under parallel workers), retries, and forbidOnly — matching the hosted e2e job.
    CI: "true",
    DATABASE_URL: "postgresql://fd:fd@localhost:5455/fooddelivery",
    SESSION_SECRET: "ci-secret-not-real-0000000000000000",
    NEXT_PUBLIC_API_URL: "http://localhost:4000/graphql",
    E2E_WEB_URL: "http://localhost:3000",
    E2E_API_URL: "http://localhost:4000/graphql",
    OTP_RATE_LIMIT_PER_HOUR: "1000",
  };

  // ci-db uses the shared port 5455 (scripts/pg.mjs). If a developer's persistent `pnpm db`
  // is already on it, the ephemeral cluster can't bind — and the TCP wait below would
  // happily connect to that real DB, so e2e would run against (and mutate) it. Refuse to
  // start unless 5455 is free.
  if (await portInUse(5455)) {
    console.error(
      `${C.red}✖ e2e: port 5455 is already in use — stop your local 'pnpm db' first so the ephemeral cluster is used, not your persistent one.${C.reset}`,
    );
    results.push({ name: "e2e", ok: false, secs: "0" });
    summary();
    process.exit(1);
  }
  const spawned = [];
  const bg = (cmd, args) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: WIN, env });
    spawned.push(child);
    return child;
  };
  const stopAll = () =>
    spawned.forEach((c) => {
      try {
        c.kill();
      } catch {}
    });

  console.log(`\n${C.cyan}▶ e2e: playwright install${C.reset}`);
  await run("pnpm", ["--filter", "@fd/e2e", "exec", "playwright", "install", "chromium"]);

  console.log(`${C.cyan}▶ e2e: embedded Postgres (ci-db)${C.reset}`);
  const db = bg("node", ["e2e/scripts/ci-db.mjs"]);
  let dbExited = false;
  db.on("exit", () => {
    dbExited = true;
  });
  // Wait for the ephemeral cluster to bind — but bail if the child dies first (e.g. it
  // couldn't bind), rather than falsely "connecting" to some other server later.
  let dbReady = false;
  for (let i = 0; i < 60 && !dbExited; i++) {
    if (await portInUse(5455)) {
      dbReady = true;
      break;
    }
    await sleep(2000);
  }
  if (!dbReady) {
    console.error(
      `${C.red}✖ e2e: ephemeral Postgres never came up on :5455 (ci-db exited?)${C.reset}`,
    );
    stopAll();
    results.push({ name: "e2e", ok: false, secs: "0" });
    summary();
    process.exit(1);
  }

  console.log(`${C.cyan}▶ e2e: starting api + web${C.reset}`);
  bg("pnpm", ["--filter", "@fd/api", "dev"]);
  bg("pnpm", ["--filter", "@fd/web", "dev"]);
  const apiUp = await waitFor("http://localhost:4000/graphql?query=%7B__typename%7D", 90);
  const webUp = await waitFor("http://localhost:3000", 90);
  if (!apiUp || !webUp) {
    console.error(`${C.red}✖ e2e: dev servers never bound (:3000/:4000 free?)${C.reset}`);
    stopAll();
    results.push({ name: "e2e", ok: false, secs: "0" });
    summary();
    process.exit(1);
  }

  const t0 = Date.now();
  const code = await run("pnpm", ["--filter", "@fd/e2e", "e2e"], { env });
  results.push({ name: "e2e", ok: code === 0, secs: ((Date.now() - t0) / 1000).toFixed(0) });
  stopAll();
  // e2e is continue-on-error in CI, so a failure here is reported but doesn't hard-fail.
  if (code !== 0)
    console.error(`${C.red}✖ e2e failed (non-blocking, mirrors CI continue-on-error)${C.reset}`);
}

/** Poll an HTTP URL until it responds 2xx or times out. */
async function waitFor(url, tries) {
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

/** True if something is already listening on localhost:port. */
function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect(port, "localhost");
    s.on("connect", () => {
      s.end();
      resolve(true);
    });
    s.on("error", () => resolve(false));
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
