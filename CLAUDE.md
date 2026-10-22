# DDG Greenlight — working rules

Greenlight checks software against defence and safety standards and fixes it.
Target users are security and assurance teams at defence primes.

## Non-negotiables
- **Checking never uses AI.** The engine (`lib/greenlight-engine`) is deterministic:
  same input → same findings, same scores, same report. No model calls in any
  check, score, classification or verification path. AI is used only in the
  remediation step ("Fix it with Claude"), and the re-check after a fix is the
  same deterministic engine.
- **Never commit credentials.** Names only, in `.env.example`.
- **Product copy never says "Claude Code".** Say "Fix it with Claude" / "Powered by Claude".
- **Standards text:** clause numbers and paraphrased titles only; never reproduce
  ISO, EUROCAE or other licensed standard text.
- **Feed strings and user content** render via `textContent`/escaping, never `innerHTML`.
- Fixes open a pull request; nothing is ever auto-merged.

## How work happens
- Claude writes all code. Replit is only used to pull from GitHub, hold secrets
  and publish. Never author code on Replit.
- Dependencies cannot be installed in the authoring container; GitHub Actions
  (`.github/workflows/ci.yml`) is the authority for typecheck, tests and build.
- Commits end with the session trailers (see git log). PRs via `gh api` (REST).
- Replit sync: fetch and merge `origin/main`, no rebase, keep Replit's config.

## Layout
- `artifacts/greenlight` React/Vite UI · `artifacts/api-server` Express API
- `lib/greenlight-engine` the engine (plain JS, node:test)
- `lib/db` Drizzle/Postgres · `lib/api-spec` OpenAPI → `lib/api-zod`, `lib/api-client-react` (generated; run codegen, don't hand-edit)
