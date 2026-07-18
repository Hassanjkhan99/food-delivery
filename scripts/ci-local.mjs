// Local CI runner — mirrors the static gates of .github/workflows/ci.yml so they can be
// run on a developer machine for fast pre-push feedback (no waiting on a hosted run).
//
// Usage (note: `pnpm ci` is a pnpm BUILTIN — clean-install — so this is `ci:local`):
//   node scripts/ci-local.mjs          # FAST gates: install + prep + format + typecheck + lint
//   node scripts/ci-local.mjs --build  # also run the full production build (turbo build) — slow
//   pnpm ci:local     pnpm ci:build
//
// Mirrors ci.yml's build/typecheck-lint/format jobs (the slow `build` is opt-in so the
// common check stays quick):
//   install:        pnpm install --frozen-lockfile  (surfaces lockfile drift, like every CI job)
//   format:         prettier --check "**/*.{ts,tsx,json,md,yml}" --ignore-path .gitignore
//   typecheck-lint: db build -> api+web codegen -> pnpm typecheck -> pnpm lint
//   build (--build):    ... -> pnpm build          (full Next production build; cold ~2-4 min)
//
// The e2e job is intentionally NOT orchestrated here — it needs an embedded PG cluster and
// two dev servers on fixed ports, which is fragile to reproduce safely on a dev box. Run it
// on hosted CI (it's a job in ci.yml) or manually: boot a DB, `pnpm --filter @fd/e2e e2e`.
import { spawn } from "node:child_process";

const WITH_BUILD = process.argv.includes("--build");
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

  summary();
  console.log(`\n${C.green}Local CI gates passed.${C.reset}`);
  if (!WITH_BUILD) {
    console.log(
      `${C.dim}Skipped (opt-in): build — run 'pnpm ci:build'. (e2e runs on hosted CI.)${C.reset}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
