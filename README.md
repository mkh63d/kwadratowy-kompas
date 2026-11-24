# Kwadratowy Kompas

Kwadratowy Kompas ma zbierać w jednym miejscu to, co dzieje się w Łodzi: dofinansowania, konkursy, hackathony, szkolenia, wydarzenia branżowe i newsy. Docelowo AI wyciąga wpisy ze źródeł, a człowiek (moderator) zatwierdza je przed publikacją. Aplikacja ma działać pod adresem `app.kwadratkreatywny.pl`.

## Stan projektu

Repozytorium jest na etapie szkieletu. Działa strona główna i strona 404, warstwa dostawców AI w backendzie (mock i adapter zgodny z OpenAI) oraz narzędzia zespołu: testy, CI i ścieżki pracy. Zbierania wpisów, moderacji, logowania ani wdrożenia pod docelowym adresem jeszcze nie ma. Plan i specyfikacje kolejnych etapów są w katalogu [specs/](specs/).

## Spis treści

- [Stack](#stack)
- [Wymagania](#wymagania)
- [Szybki start (tryb offline)](#szybki-start-tryb-offline)
- [Lokalny backend Convex](#lokalny-backend-convex)
- [Komendy](#komendy)
- [Struktura repozytorium](#struktura-repozytorium)
- [Dostawcy AI](#dostawcy-ai)
- [Praca zespołowa i ścieżki (lanes)](#praca-zespołowa-i-ścieżki-lanes)
- [Testy i `npm run verify`](#testy-i-npm-run-verify)
- [Git i pull requesty](#git-i-pull-requesty)
- [Praca z agentami AI](#praca-z-agentami-ai)
- [Deploy](#deploy)
- [Problemy](#problemy)
- [Dokumentacja](#dokumentacja)
- [Plan rozwoju](#plan-rozwoju)
- [Licencja](#licencja)

## Stack

- Frontend: Vite + React 19 + TypeScript (strict) + Tailwind 4, wdrażany na Vercel.
- Backend: [Convex](https://www.convex.dev/) (baza, zapytania, mutacje, akcje).
- Walidacja: Zod na każdej granicy (zmienne środowiskowe, odpowiedzi AI, formularze).
- Testy: Vitest + Testing Library, `convex-test`, smoke Playwright.

## Wymagania

- Node 24 (wersja w `.nvmrc`; `package.json` wymaga `>=24.15.0 <25`) i npm. Yarn i pnpm nie są używane.
- Git. Do pracy z issue i PR: [GitHub CLI](https://cli.github.com/) (`gh auth login`).
- Konto Convex nie jest potrzebne do pracy lokalnej: aplikacja działa w trybie offline albo z lokalnym backendem.

Wersję z `.nvmrc` ustawisz menedżerem Node, np. [fnm](https://github.com/Schniz/fnm) (`fnm use`) lub nvm (`nvm use`).

## Szybki start (tryb offline)

Bez konta i bez klucza. Aplikacja startuje bez klienta Convex i pokazuje baner „offline”.

```bash
git clone https://github.com/mkh63d/kwadratowy-kompas.git
cd kwadratowy-kompas
fnm use   # lub nvm use; zła wersja Node przerwie npm ci
npm ci
npm run dev:frontend
```

Otwórz [http://localhost:5173](http://localhost:5173). Gdy port jest zajęty, Vite zgłasza błąd zamiast po cichu wybrać inny (`strictPort`). Co wtedy zrobić, opisuje [docs/troubleshooting.md](docs/troubleshooting.md).

## Lokalny backend Convex

Lokalny backend nie wymaga konta i nic nie opuszcza maszyny:

```bash
# PowerShell: $env:CONVEX_AGENT_MODE = "anonymous"
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```

Komenda tworzy lokalny deployment i zapisuje `CONVEX_DEPLOYMENT` oraz `VITE_CONVEX_URL` w `.env.local`. Potem `npm run dev` uruchamia Convex i Vite razem. Plik `.env.local` jest poza gitem. Nie wpisuj w niego sekretów pod prefiksem `VITE_`, bo trafiają do paczki w przeglądarce.

Konto Convex (`npx convex login`, potem `npm run dev`) i współdzielony deployment w chmurze są potrzebne tylko ścieżkom z `npm run lane:new` bez `--local`.

Plik `.env.example` wymienia wszystkie zmienne i mówi, gdzie każda trafia: do środowiska Convex, do `.env.local` czy do sekretów GitHub. `.env.e2e` służy tylko testom e2e.

Provider AI wybiera się wyłącznie zmienną środowiskową Convex, nie plikiem `.env.local` (domyślnie `mock`, działa bez klucza):

```bash
npx convex env set AI_PROVIDER mock
```

## Komendy

| Komenda                                                 | Co robi                                                          |
| ------------------------------------------------------- | ---------------------------------------------------------------- |
| `npm run dev`                                           | Convex + Vite razem (pełne środowisko)                           |
| `npm run dev:frontend`                                  | sam Vite (offline, dopóki `.env.local` nie ma `VITE_CONVEX_URL`) |
| `npm run build` / `npm run preview`                     | build produkcyjny i jego podgląd                                 |
| `npm run typecheck`, `npm run lint`, `npm run format`   | TypeScript, ESLint, Prettier                                     |
| `npm test`, `npm run test:coverage`, `npm run test:e2e` | testy jednostkowe, pokrycie, smoke Playwright                    |
| `npm run verify`                                        | pełny zestaw jak w CI (patrz niżej)                              |
| `npm run lane:new` / `lane:list` / `lane:rm`            | ścieżki pracy (git worktree + osobny deployment)                 |
| `npm run overlap`                                       | pliki, które zmienia też inny PR lub ścieżka                     |
| `npm run codegen:check`                                 | sprawdza, czy `convex/_generated/` jest aktualny                 |

## Struktura repozytorium

```text
src/features/<nazwa>/feature.tsx   funkcja we froncie (sama rejestruje trasę)
convex/<nazwa>/{tables,queries,mutations,actions}.ts   backend funkcji
convex/ai/                         warstwa dostawców AI (mock, OpenAI-compatible)
src/app/, src/lib/, src/components/ui/, convex/lib/    kod wspólny
scripts/                           lane, overlap, codegen-check, hot-files
specs/                             specyfikacje i plan
.github/                           CI, deploy, lista plików wspólnych
```

Zasada: funkcje dodają pliki, nie edytują wspólnych. Nową funkcję dodaje się w dwóch krokach (kontrakt, potem funkcja). Opis krok po kroku: [docs/architecture.md](docs/architecture.md).

## Dostawcy AI

Domyślnie działa `mock`, który jest też siatką bezpieczeństwa, gdy prawdziwy model zawiedzie. Prawdziwy model (dowolny endpoint zgodny z OpenAI) włącza się przez `AI_PROVIDER=openai-compatible` oraz `AI_BASE_URL`, `AI_MODEL` i `AI_API_KEY` w środowisku Convex. Klucze nigdy nie trafiają do `VITE_*` ani do `.env.local`. Między prawdziwymi dostawcami nie ma automatycznego przełączania.

**Bielik i PLLuM.** Modele polskie podłącza się przez ten sam adapter zgodny z OpenAI. Chmura Convex nie dosięgnie prywatnego adresu WireGuard, więc są trzy drogi: (1) uwierzytelniona brama HTTPS przed modelem, (2) osobny worker w sieci modelu, który tylko wychodzi do Convex, (3) bezpośredni, osiągalny endpoint. Zaimplementowana jest droga 3, drogi 1 i 2 są opisane w dokumentacji. Nigdy nie otwieraj portu modelu do internetu. Licencje PLLuM różnią się między modelami, więc sprawdź kartę modelu. Szczegóły, tryby strukturalne i bezpieczeństwo: [docs/ai-providers.md](docs/ai-providers.md).

## Praca zespołowa i ścieżki (lanes)

Każdy pracuje na osobnej ścieżce: własny worktree, własne porty i własny deployment Convex. Pliki wspólne (lista w `.github/hot-files.txt`) zmienia się tylko w małym PR z kontraktem uzgodnionym z zespołem. Przed startem i przed PR uruchom `npm run overlap`.

```bash
npm run lane:new -- <osoba> <nr-issue> <slug> --local   # lokalny Convex, bez konta
npm run lane:list
npm run lane:rm -- <nr-issue>-<slug>
```

CI blokuje PR, który miesza pliki wspólne z innymi, dopóki nie zaznaczysz w opisie PR pola `- [ ] Zmiana plików wspólnych uzgodniona z zespołem` i nie klikniesz „Re-run failed jobs”. Pełny opis, w tym limity darmowego planu Convex i konflikty: [docs/development-workflow.md](docs/development-workflow.md). Zasady zespołu: [CONTRIBUTING.md](CONTRIBUTING.md).

## Testy i `npm run verify`

`npm run verify` uruchamia to samo, co CI na PR: `format:check`, `lint`, `typecheck`, `test:coverage`, `build`, `test:e2e`. Uruchom go przed każdym commitem i PR. Testy nie potrzebują sieci ani żywego modelu. Smoke e2e działa w trybie offline (`.env.e2e`), więc nie eksportuj `VITE_CONVEX_URL` w powłoce. Warstwy testów i komendy: [docs/testing.md](docs/testing.md).

## Git i pull requesty

Zadania pochodzą z GitHub Issues. Gałąź nazywa się `feat|fix|chore/<nr>-<slug>`, commity trzymają format Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`), a na `main` nigdy nie pushujemy: zawsze gałąź i PR. Opis PR zawiera `Closes #<nr>`, a przed PR robisz rebase na `origin/main`. Zasady zespołu: [CONTRIBUTING.md](CONTRIBUTING.md), przebieg krok po kroku: [docs/github-issues-workflow.md](docs/github-issues-workflow.md).

## Praca z agentami AI

Reguły dla agentów (i ludzi) są w [CLAUDE.md](CLAUDE.md). Zadania pochodzą z GitHub Issues, a agent nie zakłada ani nie zamyka issue bez pytania. Przebieg: [docs/github-issues-workflow.md](docs/github-issues-workflow.md). Osobny agent-recenzent sprawdza zmianę względem kryteriów akceptacji, a recenzję GitHub Copilot zamawiamy raz na PR, jako ostatni przegląd.

## Deploy

Kompas nie jest jeszcze wdrożony. Środowiska (deploymenty Convex, projekt Vercel, sekrety w GitHubie, domena `app.kwadratkreatywny.pl`) to osobny etap planu.

Mechanizm jest w repozytorium: backend wdraża Convex, frontend Vercel, a oba kroki uruchamia workflow `.github/workflows/deploy.yml`. W `vercel.json` automatyczne wdrożenia z Gita są wyłączone, więc wdraża tylko workflow. Bez sekretów `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID` i `VERCEL_PROJECT_ID` w środowisku `production` workflow niczego nie wdroży i napisze, których brakuje. Konfiguracja krok po kroku (skrypt `npm run setup:deploy` albo ręcznie) i ochrona gałęzi `main`: [docs/deployment.md](docs/deployment.md).

### Sentry (opcjonalnie)

Monitoring błędów we froncie jest opcjonalny i domyślnie wyłączony. Zmienna `VITE_SENTRY_DSN` z `.env.example` jest pusta, a pusta oznacza, że Sentry nie jest ani pobierany, ani uruchamiany. Żeby go włączyć, wpisz DSN w `.env.local` (lokalnie) albo w zmiennych projektu Vercel (produkcja). SDK jest skonfigurowane tak, żeby nie zbierać danych użytkownika, adresów IP, ciasteczek ani ciał żądań, a z błędów znikają tokeny, klucze i klucze typu prompt. Treść komunikatów błędów leci prawie bez zmian, więc nie wkładaj do niej danych użytkownika. Mapy źródłowe wgrywa się tylko wtedy, gdy build ma `SENTRY_AUTH_TOKEN`. Backend Convex ma osobną integrację w panelu (plan Pro). Szczegóły, w tym lista wycinanych danych, są w [docs/deployment.md](docs/deployment.md).

## Problemy

Opisane tam: antywirus przechwytujący TLS, ścieżki i końce linii na Windowsie, zajęte porty, brak Convex (baner offline), brakujące przeglądarki Playwright: [docs/troubleshooting.md](docs/troubleshooting.md).

## Dokumentacja

- [docs/architecture.md](docs/architecture.md): struktura i dodawanie funkcji.
- [docs/development-workflow.md](docs/development-workflow.md): codzienna praca, ścieżki, hooki.
- [docs/testing.md](docs/testing.md): warstwy testów i komendy.
- [docs/ai-providers.md](docs/ai-providers.md): dostawcy AI i zmienne.
- [docs/github-issues-workflow.md](docs/github-issues-workflow.md): issues, gałęzie, PR.
- [docs/deployment.md](docs/deployment.md): wdrożenie Convex i Vercel.
- [docs/troubleshooting.md](docs/troubleshooting.md): typowe błędy.
- [CONTRIBUTING.md](CONTRIBUTING.md): zasady zespołu. [CLAUDE.md](CLAUDE.md): reguły dla agentów.

## Plan rozwoju

Funkcje powstają etapami, każda najpierw jako krótka specyfikacja. Plan i specyfikacje są w katalogu [specs/](specs/), a plan przebudowy z raportami badawczymi w [specs/plan-przebudowy.md](specs/plan-przebudowy.md). Opis funkcji trafia do tego README dopiero wtedy, gdy funkcja działa.

## Licencja

Kod projektu jest dostępny na licencji [GNU AGPL-3.0](LICENSE) w wersji 3 lub dowolnej późniejszej (`AGPL-3.0-or-later`).

Projekt powstał z szablonu [Orfeliny/Hackathon-template](https://github.com/Orfeliny/Hackathon-template). Kod pochodzący z szablonu pozostaje objęty także jego oryginalną licencją MIT; jej pełna treść z informacją o prawach autorskich jest w pliku [LICENSE-MIT](LICENSE-MIT).

Licencja nie obejmuje znaków towarowych ani logotypów partnerów. Ich użycie wymaga zgody właścicieli.
