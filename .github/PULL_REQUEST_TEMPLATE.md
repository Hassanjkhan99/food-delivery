<!--
Title must follow Conventional Commits, e.g. "feat(api): add wallet top-up".
Every commit must be signed off (DCO): git commit -s. See CONTRIBUTING.md.
-->

## What & why

<!-- What does this change do, and why? Link the issue. -->

Closes #

## Type

- [ ] feat
- [ ] fix
- [ ] docs
- [ ] refactor / perf
- [ ] chore / build / ci

## Checklist

- [ ] Commits are signed off (DCO `Signed-off-by`) and follow Conventional Commits
- [ ] `pnpm typecheck` passes
- [ ] `pnpm lint` passes
- [ ] `pnpm build` passes
- [ ] I did **not** copy AGPL (core) code into `packages/shared` (Apache-2.0)

## Tests

<!-- What did you add/run? Unit, smoke script (which one?), manual steps. -->

## Screenshots / recordings

<!-- Required for any user-facing UI change. Delete if N/A. -->

## Migrations

- [ ] No schema change
- [ ] Prisma schema changed — migration included and **additive-only**
      (never `prisma migrate dev` against shared DBs; note if it is `--create-only`)
- [ ] GraphQL schema changed — regenerated SDL (`apps/api`) and web types
      (`apps/web` codegen), both committed

## Sensitive areas (CODEOWNERS)

- [ ] This PR touches payments / ledger / admin+payment GraphQL / order state
      machine / fees — I have requested the owning reviewers and added extra tests
- [ ] N/A

## Security

- [ ] This PR does **not** disclose a vulnerability (those go through SECURITY.md, never a public PR)
