# Ocena: Orfeliny/Hackathon-template jako baza Kompasu

Sprawdzone 2026-11-23 (repo publiczne, MIT, ostatni push 2026-11-18).

## Co to jest

Starter: **Vite + React 19 + TypeScript + Tailwind 4, Convex, Vercel**, Node 24, npm. Zawiera jedną przykładową funkcję („notatki” z akcją AI) i komplet narzędzi do pracy zespołu z agentami.

## Co pasuje do Kompasu (bierzemy)

| Element szablonu                                                                                                                       | Dlaczego się przyda                                                                    |
| -------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Convex + Vercel + workflow `deploy.yml` + `npm run setup:deploy`                                                                       | Dokładnie nasz wybrany backend i hosting, z gotowym wdrożeniem z GitHub Actions        |
| Struktura funkcji: `convex/<nazwa>/{tables,queries,mutations,actions}.ts` + `src/features/<nazwa>/feature.tsx` (sama rejestruje trasę) | Funkcje dodają pliki, a nie edytują wspólnych. Idealne pod równoległe zadania w falach |
| **Najpierw kontrakt, potem funkcja** (PR z `tables.ts` + linią w `schema.ts`, dopiero potem PR z logiką)                               | To jest nasz „contract.md przed falą”, wymuszony przez CI                              |
| `hot-files.txt` + `npm run overlap` + blokada w CI PR-ów mieszających pliki wspólne ze zwykłymi                                        | Chroni przed agentami wchodzącymi sobie w drogę                                        |
| **Lanes** (`npm run lane:new`): worktree + własne porty + **własny deployment Convex** na zadanie                                      | Gotowe środowisko dla każdego codera w orkiestracji                                    |
| `convex/ai/`: interfejs `AIProvider` z `generateStructuredOutput` (Zod), dostawca `mock`, typowane błędy                               | Ekstrakcja AI wpina się jako nowy dostawca; testy bez sieci i bez kosztów              |
| `npm run verify` (format, lint, typecheck, pokrycie, build, e2e), `convex-test`, Playwright                                            | Gotowy pełny zestaw testów, wymagany przez Twoje zasady                                |
| `CLAUDE.md`, `.claude/skills/spec-driven-development`, szablony issue i PR, dokumentacja po polsku                                     | Zgodne z naszym procesem (spec, recenzent per zmiana, Copilot)                         |
| Licencja MIT                                                                                                                           | Zgodna z AGPL: kod z szablonu może wejść do projektu AGPL, z zachowaniem noty MIT      |

## Co trzeba zmienić lub dodać

1. **Frontend to Vite (SPA), a nie Next.js.** Rezygnujemy z Next.js. Skutki:
   - **MCP** jako funkcja Vercela (`api/mcp.ts`) albo HTTP action Convexa. W trybie bezstanowym to zwykły POST, więc obie drogi działają.
   - **SEO i podglądy linków** (Open Graph przy udostępnianiu wpisu na LinkedInie czy Facebooku). SPA zwraca jeden pusty HTML dla wszystkich adresów, więc podgląd każdego wpisu wygląda tak samo. Potrzebna mała funkcja Vercela, która dla `/w/<slug>` zwraca meta tagi wpisu, plus sitemap. To osobne, małe zadanie.
2. **Model AI:** decyzja z 2026-11-24 brzmi „nie musi być Claude”, więc warstwa AI szablonu zostaje bez zmian (`openai-compatible` + `mock`). Model wybieramy zmienną środowiskową po teście na zestawie 0.3.
3. **Układ repo.** Szablon to jedna aplikacja w katalogu głównym, a jego skrypty (lanes, overlap, CI) zakładają ten układ. Wciśnięcie go do `apps/kompas` w monorepo oznacza przerabianie narzędzi. Prościej:
   - **Kompas = nowe repo utworzone z szablonu** („Use this template”).
   - Landing zostaje w `Kwadrat-strona` (i tak jest statyczny, osobny projekt Vercela).
   - wa-worker jako `workers/whatsapp/` w repo Kompasu, z własnym `package.json`, poza buildem Vite.
   - **To odwraca decyzję „przerabiamy obecne repo na monorepo”.**
4. **Usunąć elementy hackathonowe:** przykład `notes`, „light hackathon mode”, `SETUP_PROMPT.md` dostosować do Kompasu.
5. **Sentry** jest w zależnościach. Bez ustawionego DSN nic nie wysyła. Decyzja, czy go używać, później.
6. **Plan Convex Free:** każdy lane to osobny deployment. Limit planu darmowego to 40 deploymentów, a przy ~5 agentach naraz to wystarcza.

## Wpływ na plan

- Fala 1: zamiast „monorepo w obecnym repo” → „repo Kompasu z szablonu + czyszczenie + dostawca Anthropic (kontrakt)”. Landing tylko przenosimy na Vercel.
- Fala 2: kontrakty jako PR-y według reguły szablonu (`tables.ts` + `schema.ts`). Pliki wspólne (`convex/lib/` z opakowaniami uprawnień i przełącznikami) też tutaj.
- Fala 3: dochodzi zadanie „SEO/OG dla stron wpisów + sitemap”. MCP jako funkcja Vercela.
- Orkiestracja (§8): każdy coder dostaje lane (`npm run lane:new`), a `npm run overlap` jest częścią handoffu H3 i H4.

## Rekomendacja

**Bierzemy szablon.** Zgadza się z wybranym stosem (Convex + Vercel) i daje gotowe to, co w planie trzeba by było dopiero zbudować: kontrakty, ochronę plików wspólnych, środowisko per zadanie, CI, wdrożenie i warstwę AI z mockiem. Kosztem jest rezygnacja z Next.js (do dorobienia małe zadanie SEO/OG) i osobne repo dla Kompasu.
