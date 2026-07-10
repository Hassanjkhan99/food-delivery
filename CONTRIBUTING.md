# Contributing to KhaanaDo

Thanks for your interest in improving KhaanaDo. This document covers how we branch,
commit, sign off, and license contributions. Please read it before opening a pull
request.

> **Status note:** KhaanaDo is not yet accepting outside contributions publicly. The
> processes below are the ones we intend to run once the repository is opened (see the
> timing caution in [`NOTICE`](./NOTICE)). Internal contributors follow them today.

## Code of Conduct

This project adheres to the [Contributor Covenant](./CODE_OF_CONDUCT.md). By
participating, you are expected to uphold it. Report unacceptable behavior to the
contact listed there.

## Licensing & file headers

KhaanaDo is a **dual-licensed monorepo** — read [`NOTICE`](./NOTICE) for the exact
boundary. In short:

| Area | License | SPDX identifier |
| ---- | ------- | --------------- |
| Core: `apps/api`, `apps/web`, `packages/db`, `packages/config` | GNU AGPL-3.0-or-later | `AGPL-3.0-or-later` |
| SDK / shareable lib: `packages/shared` | Apache License 2.0 | `Apache-2.0` |

By submitting a contribution you agree it is licensed under the license of the area you
are touching. **Do not copy code from an AGPL area into `packages/shared`** — that would
relicense copyleft code as Apache-2.0. Keep `packages/shared` pure and framework-free
(no Prisma, no Next, no Yoga/Pothos, no DB access) so it can stay under Apache-2.0.

### SPDX header convention

Add a two-line SPDX header to the top of **new** source files you author. This makes the
per-file license machine-readable and survives copy/paste better than a bare LICENSE
file. Use the comment syntax of the file's language.

Core files (`apps/**`, `packages/db/**`, `packages/config/**`):

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (c) 2026 KhaanaDo contributors
```

SDK files (`packages/shared/**`):

```ts
// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026 KhaanaDo contributors
```

Headers are guidance, not a hard CI gate today. Do not mass-rewrite existing files just
to add headers; add them as you touch files. Generated files (codegen output, Prisma
client, `*.generated.*`) are exempt.

## Branch strategy

- `master` is the protected, always-releasable trunk. Never push directly.
- Cut a topic branch from the current integration tip. Name it
  `<type>/<issue-number>-<slug>`, e.g. `feat/128-wallet-topup`, `fix/32-oss-governance`,
  `docs/40-security-policy`. `<type>` matches the Conventional Commits type below.
- Open a **draft** PR early. Keep branches short-lived and rebased on the base branch.
- Squash-or-rebase on merge; keep history linear. Delete the branch after merge.

## Conventional Commits

Commit messages (and PR titles) follow
[Conventional Commits 1.0.0](https://www.conventionalcommits.org/):

```
<type>(<optional scope>): <description>

<optional body>

<optional footer(s)>
```

Allowed `type`s: `feat`, `fix`, `docs`, `refactor`, `perf`, `test`, `build`, `ci`,
`chore`, `revert`. Reference the issue in the body or footer (`Closes #32`). Breaking
changes use a `!` after the type/scope (`feat(api)!: …`) and a `BREAKING CHANGE:` footer.

## Developer Certificate of Origin (DCO)

We require the [Developer Certificate of Origin](./DCO.txt) instead of a CLA. Every
commit must be **signed off**, certifying you have the right to submit it under the
project's license. Add the trailer with `git commit -s`:

```
Signed-off-by: Jane Doe <jane@example.com>
```

The name and email must be your real identity and match your Git author. If a commit is
missing the trailer, add it and amend/rebase before review:

```bash
git commit --amend -s          # last commit
git rebase --signoff <base>    # a range of commits
```

PRs whose commits are not all signed off will be blocked from merge.

## Before you open a PR

Run the same gates CI runs, from the repo root:

```bash
pnpm typecheck     # tsc --noEmit across the workspace
pnpm lint          # eslint
pnpm build         # turbo build
pnpm exec prettier --check "**/*.{ts,tsx,json,md,yml}" --ignore-path .gitignore  # format gate
```

If you changed the GraphQL schema, regenerate and commit the SDL + web types
(`apps/api` `print-schema`, `apps/web` `graphql-codegen`). If you changed the Prisma
schema, include a migration. Fill out the PR template completely (tests, screenshots,
migrations). See [`SECURITY.md`](./SECURITY.md) for reporting vulnerabilities — **do not**
open a public issue or PR for a security problem.

## Areas that need extra care

Changes under the paths guarded by [`CODEOWNERS`](./.github/CODEOWNERS) — payments, the
double-entry ledger, admin/payment GraphQL, the order state machine, and tax/compliance
code — touch real-money and regulatory behavior. Expect required review from the owning
team and a higher bar for tests.
