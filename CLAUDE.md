# CLAUDE.md

Rules for AI agents (and humans) working in this repo. The design lives in
[specs/starter-architecture.md](specs/starter-architecture.md); user-facing docs (Polish) are in `docs/`
and the README. This file does not repeat them, it says what you must do and never do.

## Docs

- [README.md](README.md): setup and overview. [CONTRIBUTING.md](CONTRIBUTING.md): team rules.
- [docs/architecture.md](docs/architecture.md): structure and how to add a feature.
- [docs/development-workflow.md](docs/development-workflow.md): daily flow, lanes, hooks.
- [docs/testing.md](docs/testing.md): test layers and commands.
- [docs/ai-providers.md](docs/ai-providers.md): provider paths and env.
- [docs/github-issues-workflow.md](docs/github-issues-workflow.md): issues, branches, PRs.
- [docs/deployment.md](docs/deployment.md): Convex + Vercel deploy.
- [docs/troubleshooting.md](docs/troubleshooting.md): common failures.
- [SETUP_PROMPT.md](SETUP_PROMPT.md): first-run prompt for an agent.

## Overview

A hackathon starter: Vite + React + TypeScript + Tailwind frontend, Convex backend, one example
feature ("notes") with an AI summarize action. A team of ~5 builds an MVP in 24 h, often with
several parallel lanes (git worktrees).

## Language

Talk to the user in the language they write in (usually Polish). Code, comments, commit messages,
PR titles/descriptions and this file stay in English. README and `docs/` are Polish.

## Stack

- Node 24 (`.nvmrc`), npm only (no yarn/pnpm). Exact version pins (`.npmrc` has `save-exact`, `engine-strict`).
- React 19, react-router, Tailwind 4, TypeScript 6 (strict), Zod at every boundary (env, AI responses, forms).
- Convex (database, queries, mutations, actions). Vitest + Testing Library + `convex-test`, Playwright smoke.

## Structure

- `src/features/<name>/feature.tsx`: default export self-registers the route. Everything for a feature lives here.
- `convex/<name>/{tables,queries,mutations,actions}.ts`: backend of a feature; the generated API is `api.<name>.queries.*`.
- `convex/ai/`: provider layer (`AIProvider` interface, mock, OpenAI-compatible adapter).
- `src/app/`, `src/lib/`, `src/components/ui/`, `convex/lib/`, `convex/ai/`: shared code (hot files, full list in `.github/hot-files.txt`).
- `scripts/`: lane, overlap, codegen-check, hot-files check. `.github/`: CI, deploy, hot-files list.

## Principles

- Features add files, they do not edit shared ones.
- Prefer a vetted, maintained library over hand-written generic code. Never add a dependency
  without checking its maintenance, license and size, and never install one inside a feature
  branch: a new dependency is a contract PR (see below).
- Validate at boundaries with Zod; keep secrets out of the frontend bundle.
- Keep changes small and reviewable. Do not refactor what you were not asked to touch.

## Conventions

- Comments are minimal: only a non-obvious _why_, a workaround, or a gotcha. No comments restating
  code, no section banners, no change history. Remove such noise in code you touch.
- Every non-trivial change ships with tests. Formatting is Prettier, linting ESLint; do not hand-format.
- Conventional Commits: `feat:`, `fix:`, `chore:`, `refactor:`, `test:`, `ci:`, `docs:`.
- Files are UTF-8, LF line endings. Scripts must work on Windows, macOS and Linux (Node `.mjs`, no Bash-only).

## Verify before you say "done"

`npm run verify` is the PR CI job: `format:check`, `lint`, `typecheck`, `test:coverage`, `build`,
`test:e2e`. Run it before every commit/PR and report its real result. If something cannot run,
say so instead of claiming it passed.

## Testing

- Unit/component: Vitest + Testing Library (`npm test`, `npm run test:coverage`).
- Backend: `convex-test` next to the code (`convex/<name>/*.test.ts`).
- e2e: Playwright smoke in offline mode (`--mode e2e`, `.env.e2e`). Never export `VITE_CONVEX_URL`
  in the shell; the e2e run fails fast when it is set.
- Tests never need network or a live model; stub `fetch` for AI adapters.
- Details: [docs/testing.md](docs/testing.md).

## Convex

- Local backend without an account: `CONVEX_AGENT_MODE=anonymous npx convex dev --once`.
  Cloud lanes (`npm run lane:new`) need a logged-in Convex CLI; `--local` lanes do not.
- After adding or removing a file under `convex/`, regenerate (`npx convex codegen` with a
  configured deployment) and run `npm run codegen:check`. `convex/_generated/` is committed.
  Such changes never run in parallel with other `convex/` file changes.
- Schema changes are additive only.

## AI provider rules

- The provider is chosen only by Convex env: `npx convex env set AI_PROVIDER <mock|openai-compatible>`.
  `mock` is the default and the demo safety net; keep it working.
- Never put AI keys in `VITE_*` variables or `.env.local`. Keys go to Convex env only.
- No automatic fallback between real providers; failures return typed errors and the UI stays usable.
- Details: [docs/ai-providers.md](docs/ai-providers.md).

## Git and GitHub workflow

- Details: [docs/github-issues-workflow.md](docs/github-issues-workflow.md).
- Task source is GitHub Issues: `gh issue view <n> --comments`. Acceptance criteria are the checklist in the issue body; when done, comment the result on the issue. Use `gh` only; `gh auth login` is the only auth path.
- Branch: `feat|fix|chore/<n>-<slug>`. Never push to `main`; always branch + PR.
- Every PR body contains `Closes #<n>`. Rebase on `origin/main` before opening a PR.
- Never create or close issues, change labels/milestones, or assign issues to yourself without
  asking. Comments are fine. The human claims issues.
- Review: a separate Claude reviewer subagent checks the diff against the acceptance criteria;
  request GitHub Copilot review once per PR as a final pass.

## Parallel work and hot files

- Run `npm run overlap` before starting and before a PR; it lists files other PRs/lanes also change.
- Hot files are listed in `.github/hot-files.txt` (including `convex/*/tables.ts`, `convex/schema.ts`,
  `package.json`, `.github/**`, `CLAUDE.md`). They change only in a small contract-first PR.
  CI fails a PR mixing hot and non-hot files unless the PR template line
  `- [ ] Zmiana plików wspólnych uzgodniona z zespołem` is ticked (then "Re-run failed jobs").
- On any hot-file overlap or edit you did not plan, stop and ask the human.

## Changing the architecture

Do not change structure, dependencies or contracts ad hoc. Propose it in an issue or PR comment,
get the team's agreement, update [specs/starter-architecture.md](specs/starter-architecture.md) in a
contract PR, then build on it.

## Light hackathon mode

For a feature: write a one-page spec in `specs/<feature>.md` (scope, acceptance criteria) →
implement it in `src/features/<name>/` + `convex/<name>/` → have a separate reviewer subagent
check the diff against the acceptance criteria → `npm run verify` → PR. Skip ceremony for
small fixes.

## Security

- No secrets in the repo, logs or frontend bundle; only `VITE_*` reaches the browser, so no secret gets that prefix.
- Never read or print `.env.local` or other `.env.*` files except `.env.example` and `.env.e2e`.
- There is no authentication in the starter: add it before storing anything real.
- CI runs gitleaks; do not commit anything that resembles a key.
