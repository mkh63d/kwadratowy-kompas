---
name: spec-driven-development
description: Work from a short written spec instead of coding straight away. Use when starting any feature or non-trivial change in this repo; skip it for small fixes.
---

# Spec-driven development (light hackathon mode)

Write the spec first, then build exactly what it says. The spec lives in `specs/<feature>.md` and fits on one page.

## The 10 steps

1. **Understand the request.** Restate it in two sentences. Read the linked issue (`gh issue view <n> --comments`).
2. **Inspect the existing architecture.** Read `CLAUDE.md`, `specs/starter-architecture.md` and the closest existing feature (`src/features/notes`, `convex/notes`). Run `npm run overlap`.
3. **Identify missing information.** List unknowns. Ask the human at most 3 questions, batched in one message; for the rest write down an assumption and continue.
4. **Create or update the specification** in `specs/<feature>.md` (template below).
5. **Define acceptance criteria** as `- [ ]` items, each checkable by a test or a command.
6. **Break the work into tasks.** Small steps, each touching a known list of files; mark any hot file (`.github/hot-files.txt`), which needs a separate contract PR.
7. **Implement incrementally.** One implementer, one task at a time, in `src/features/<name>/` and `convex/<name>/`. Add tests with the code.
8. **Run relevant tests** after every task, not only at the end.
9. **Verify acceptance criteria.** Start a separate reviewer subagent that sees only the diff and the spec and checks each criterion. Fix what it finds, then run `npm run verify` and report the real result.
10. **Document important decisions.** Update the spec (decisions, changed assumptions) and put the summary and `Closes #<n>` in the PR.

## One-page spec template

```markdown
# <Feature>

## Goal

One or two sentences.

## Scope

- In: ...
- Out: ...

## Assumptions

- ...

## Tasks

1. <task> (files: ...)

## Acceptance criteria

- [ ] ...
```

## Rules

- No implementation before the spec has acceptance criteria. If the request changes, change the spec first.
- Do not change structure, dependencies or contracts inside a feature; propose it as described in `CLAUDE.md`.
- Keep it light: no extra agents, no long documents. A small fix needs no spec.
- Never mark a criterion done without evidence (test, command output or a reviewer note).
