// Local CI runner — mirrors .github/workflows/ci.yml so the exact same gates can be
// run on a developer machine for fast pre-push feedback (no waiting on a hosted run).
//
// Usage:
//   node scripts/ci-local.mjs          # FAST gates: prep + format + typecheck + lint (~1 min)
//   node scripts/ci-local.mjs --build  # also run the full production build (turbo build) — slow
//   node scripts/ci-local.mjs --e2e    # also run the Playwright e2e job (embedded PG + dev servers)
//   node scripts/ci-local.mjs --all    # everything (build + e2e) — the full ci.yml mirror
//   pnpm ci        # fast gates       pnpm ci:build  # + build       pnpm ci:all  # + build + e2e
//
// Mirrors ci.yml, but the slow jobs are opt-in so the common pre-merge check is quick:
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
    DATABASE_URL: "postgresql://fd:fd@localhost:5455/fooddelivery",
    SESSION_SECRET: "ci-secret-not-real-0000000000000000",
    NEXT_PUBLIC_API_URL: "http://localhost:4000/graphql",
    E2E_WEB_URL: "http://localhost:3000",
    E2E_API_URL: "http://localhost:4000/graphql",
    OTP_RATE_LIMIT_PER_HOUR: "1000",
  };
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
  bg("node", ["e2e/scripts/ci-db.mjs"]);
  if (!(await waitFor("http://localhost:5455", 60, { tcp: true }))) {
    console.error(`${C.red}✖ e2e: Postgres never came up on :5455${C.reset}`);
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

/** Poll a URL (HTTP GET, or a TCP connect when {tcp:true}) until it responds or times out. */
async function waitFor(url, tries, { tcp = false } = {}) {
  for (let i = 0; i < tries; i++) {
    try {
      if (tcp) {
        const { hostname, port } = new URL(url);
        await new Promise((res, rej) => {
          const s = net.connect(Number(port), hostname, () => {
            s.end();
            res();
          });
          s.on("error", rej);
        });
        return true;
      }
      const r = await fetch(url);
      if (r.ok) return true;
    } catch {}
    await sleep(2000);
  }
  return false;
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
