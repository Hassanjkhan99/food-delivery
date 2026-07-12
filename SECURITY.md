# Security Policy

Herald sits in the money flow (double-entry ledger, card tokenization, payouts,
refunds). We take vulnerabilities seriously and ask you to report them privately.

## Reporting a vulnerability

**Do not open a public GitHub issue, discussion, or pull request for a security
problem.** Public disclosure before a fix puts real orders and money at risk.

Instead, use one of these private channels:

1. **Preferred:** GitHub → repository **Security** tab → **Report a vulnerability**
   (Private Vulnerability Reporting / GitHub Security Advisories).
2. **Email:** security@herald.example (replace with a monitored inbox before public
   launch). Encrypt sensitive details if possible.

Please include:

- affected component(s) and version / commit,
- a description and impact assessment,
- reproduction steps or a proof of concept,
- any suggested remediation.

## Our commitment (target SLA)

| Stage | Target |
| ----- | ------ |
| Acknowledge receipt | within **2 business days** |
| Triage + severity assessment | within **5 business days** |
| Fix or mitigation for critical issues | within **30 days** of triage |
| Coordinated disclosure | after a fix ships, by mutual agreement |

These are goals, not contractual guarantees, and may flex for complex issues. We will
keep you updated on progress.

## Scope

In scope: this repository's code (`apps/*`, `packages/*`) and its default configuration.

Especially sensitive areas (see [`.github/CODEOWNERS`](./.github/CODEOWNERS)):

- payment services — `apps/api/src/services/payments/**`
- the double-entry ledger — `apps/api/src/services/ledgerService.ts`
- admin & payment GraphQL — `apps/api/src/schema/{admin,payment}*.ts`
- the order state machine — `packages/shared/src/orderStateMachine.ts`
- any tax / compliance code

Out of scope: third-party dependencies (report upstream), the intentionally **mock**
payment provider used in development, and findings that require a compromised developer
machine or already-privileged admin account.

## Safe harbor

We will not pursue or support legal action against researchers who act in good faith,
follow this policy, avoid privacy violations and service disruption, and give us
reasonable time to remediate before any disclosure.
