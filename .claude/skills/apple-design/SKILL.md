---
name: apple-design
description: Build clean, calm, accessible UI in the spirit of Apple's design principles, using this repo's Tailwind classes and shared components. Use when creating or restyling any screen, form, list or component in src/.
---

# Apple-inspired UI for this starter

Principles only. No Apple branding, logos, SF fonts or copied interfaces. Reuse `src/components/ui/*` (`Button`, `Card`, `Input`) before writing new markup; extend them in a contract PR, not inside a feature.

## Hierarchy

- One primary action per view. Use the indigo `Button` for it; for secondary actions, prefer a quieter style (plain text or outlined); the repo has no such variant yet, so add one to `Button` in a contract PR rather than inline.
- Make importance visible through size and weight first, color second: `text-2xl font-bold tracking-tight` (`text-3xl` on landing pages) for the page title, `text-sm font-medium` for labels, `text-slate-600` for secondary text.
- Group related things in a `Card`; do not nest cards.

## Typography

- Stay on the system font stack Tailwind ships. Use three to four sizes per screen (`text-sm`, `text-base`, `text-xl`/`text-2xl`).
- Body copy `text-slate-900`, supporting copy `text-slate-600`. Never go lighter than `slate-600` on white (contrast).
- Keep line length readable: content sits in `max-w-3xl`.

## Spacing

- Use the 4 px Tailwind scale only, and prefer a few repeated values: `gap-2`/`space-y-2` inside a component, `gap-4`/`p-4` between components, `p-8` around a page.
- Generous whitespace beats borders. Separate with space before adding a divider.

## Consistent components

- Radii: `rounded-md` for controls, `rounded-lg` for cards. Borders `border-slate-200`/`slate-300`, shadow `shadow-sm` at most.
- One accent color (`indigo-600`, hover `indigo-700`). Status colors only for status: `red-700` errors, `amber` warnings.
- Same behaviour everywhere: a disabled control looks `opacity-50` with `cursor-not-allowed`.

## Accessibility (match what the repo already does)

- Visible keyboard focus on every interactive element: `focus-visible:outline-2 focus-visible:outline-indigo-600` (add `outline-offset-2` on buttons).
- Real elements: `button` for actions, `a`/`NavLink` for navigation, a `label` for every input, landmarks with `aria-label` (`nav`, `section`).
- Async work: `aria-busy` on the trigger, `aria-disabled` while loading (keeps it focusable; guard the handler too), results announced in a `role="status" aria-live="polite"` region, with `sr-only` text for state changes.
- Never rely on color alone; pair it with text. Aim for WCAG AA contrast (4.5:1 body text).
- Keep UI copy consistent with the app language (Polish).

## Responsive

- Mobile first: write the base layout for a narrow screen, add `sm:`/`md:` only where it changes.
- Fluid widths (`w-full`, `max-w-3xl mx-auto`), not fixed pixels. Controls are 36 px high (`py-2 text-sm`, as in `Button` and `Input`); on touch-first screens use `py-2.5` or more for a larger target.
- Test at a phone width before calling it done.

## Restrained motion

- Motion explains a change (appear, expand, progress); it never decorates. Use `transition-colors` or `transition-opacity` at `duration-150`/`200`.
- No bouncing, parallax or looping animation.
- Respect reduced motion: use `motion-safe:` for anything that moves, or `motion-reduce:transition-none`. Spinners need a text alternative.

## Detail

- Every list or async view has an empty, loading and error state, written as helpful sentences.
- Align to a shared left edge, keep icon and text baselines level, and check hover, focus, disabled and offline states before finishing.
- Remove anything that does not earn its place.
