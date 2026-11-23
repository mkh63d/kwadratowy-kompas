# Setup prompt

Paste this into Claude Code on day one, in the repo root. You are the team's first agent on a
24-hour hackathon: five people, parallel lanes, one demo at the end.

---

You are starting a hackathon project on top of this starter. Work through the steps below in
order. Do not write product code until step 10.

## Ground rule: do not rewrite the starter

The architecture is decided and tested. Do **not** replace or restructure: the stack (Vite, React,
TypeScript, Tailwind, Convex), the Convex layout (`convex/<name>/{tables,queries,mutations,actions}.ts`),
the AI provider layer in `convex/ai/`, the CI workflows, or the hot-file rule in
`.github/hot-files.txt`. Extend it through new feature folders (`src/features/<name>/`,
`convex/<name>/`). If you think something shared must change, stop and propose it in an issue or PR
comment first (see "Changing the architecture" in `CLAUDE.md`).

## Steps

1. **Read the rules.** Read [CLAUDE.md](CLAUDE.md) and [CONTRIBUTING.md](CONTRIBUTING.md) fully. They
   win over anything in this prompt.
2. **Inspect the repository.** Read [README.md](README.md), `package.json`, `src/`, `convex/`,
   `scripts/`, `.github/`, and the docs: [docs/architecture.md](docs/architecture.md),
   [docs/development-workflow.md](docs/development-workflow.md), [docs/testing.md](docs/testing.md),
   [docs/ai-providers.md](docs/ai-providers.md),
   [docs/github-issues-workflow.md](docs/github-issues-workflow.md),
   [docs/deployment.md](docs/deployment.md), [docs/troubleshooting.md](docs/troubleshooting.md).
   Look at the example `notes` feature end to end: it is the template for every new feature.
3. **Understand the product and the challenge.** Ask the team **at most 3 questions, batched in one
   `AskUserQuestion` call** (for example: what is the challenge and who is the user, what must the
   demo show, which AI behavior is required). For anything unanswered, write down the assumption
   you are making and keep going. Do not ask more.
4. **Identify existing infrastructure.** State what is already working and reusable: Convex
   backend, deploy to Vercel, `mock` and `openai-compatible` AI providers, `npm run seed`, lanes
   (`npm run lane:new`), CI, `npm run verify`. Check whether a Convex deployment is configured
   with `npm run codegen:check` or by asking the human, and say what is missing. Never run
   `npx convex dev --once` as a check (without a login it starts the interactive flow); use
   `CONVEX_AGENT_MODE=anonymous npx convex dev --once` only to create a local backend.
5. **Write the initial product spec.** Create `specs/<product>.md`: problem, user, scope,
   out of scope, assumptions, and acceptance criteria. One page.
6. **Propose a simple architecture.** Describe the new features as folders on top of the starter:
   which `src/features/<name>/` and `convex/<name>/` they need, which tables, which AI actions.
   Mark every change to a hot file explicitly; there should be as few as possible (ideally one
   contract PR up front).
7. **Identify the critical tasks.** Break the spec into small tasks, each a single reviewable change
   with its own acceptance criteria and the files it touches. Mark which can run in parallel
   (disjoint file lists, checked with `npm run overlap`) and which are sequential. Propose them as
   GitHub issues; the team creates and claims them, you do not.
8. **Prepare the time-boxed MVP plan with a cut line.**

   | By hour | Milestone                                                                     |
   | ------- | ----------------------------------------------------------------------------- |
   | 3       | Skeleton deployed (Convex + Vercel), feature folders created, seed data loads |
   | 12      | MVP complete: the demo path works end to end with the `mock` provider         |
   | 20      | Feature freeze. Only polish, bug fixes, and the demo from here                |
   | 24      | Submission                                                                    |

   Order tasks so the demo path lands first. Everything that does not fit before hour 12 goes
   below the cut line and is dropped, not rushed.

9. **Identify integration risks.** At minimum: the real AI provider (Bielik / PLLuM) being
   unreachable or slow, Convex schema changes colliding between lanes, hot-file conflicts,
   env vars missing on Vercel or Convex, and the demo network. For each, give the mitigation and
   the owner.
10. **Stop and wait for confirmation.** Present the spec, architecture, tasks, plan and risks.
    Start implementing **only after the team confirms the plan**. Then work one task at a time
    on its own branch (`feat|fix|chore/<n>-<slug>`), with tests, and run `npm run verify` before
    every PR.

## Demo plan

Plan the demo from the start, not at hour 22.

- **Seed data.** Extend the seed (`npm run seed`) so a fresh deployment shows a realistic,
  non-empty app in one command.
- **Demo script.** Write `specs/demo-script.md`: a 3-minute click path, what to say at each
  step, and the exact data it uses. Rehearse it on the deployed URL, not on localhost.
- **Safety net.** `AI_PROVIDER=mock` is the default and must keep working
  (`npx convex env set AI_PROVIDER mock`). If Bielik / PLLuM is unreachable, switch to `mock` and
  keep demoing. There is no automatic fallback between real providers; the switch is a decision
  you make.
- **Fallbacks.** Besides `AI_PROVIDER=mock`, keep a local anonymous backend
  (`CONVEX_AGENT_MODE=anonymous npx convex dev --once`, then `npm run seed`) ready for the demo.
  Offline mode (`.env.e2e`) only proves the page still loads: adding notes and summarizing are
  disabled there, so it is not a demo.

## Commands

```
npm run dev            # Convex + Vite
npm run seed           # demo data
npm run lane:new       # new parallel worktree
npm run overlap        # files other lanes/PRs also change
npm run verify         # the PR CI job: format, lint, typecheck, tests, build, e2e
```
