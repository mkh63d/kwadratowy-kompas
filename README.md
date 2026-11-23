# HackNation Starter

Starter na 24-godzinny hackathon: Vite + React + TypeScript + Tailwind po stronie frontendu, Convex jako backend i jedna przykładowa funkcja („notatki” z akcją AI do streszczania). Zespół ok. 5 osób pracuje na równoległych ścieżkach (git worktree), a na koniec pokazuje jedno demo.

## Spis treści

- [Nowy hackathon z szablonu](#nowy-hackathon-z-szablonu)
- [Wymagania](#wymagania)
- [Szybki start (tryb offline)](#szybki-start-tryb-offline)
- [Szybki start z Convex](#szybki-start-z-convex)
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

## Nowy hackathon z szablonu

To repozytorium jest szablonem GitHuba. Na każdy hackathon zakładasz własną kopię:

1. Na stronie repozytorium kliknij **Use this template**, utwórz nowe repozytorium i sklonuj je.
2. `npm ci`, potem `npm run dev:frontend`. Całość działa lokalnie z mockiem AI, bez żadnego konta.
3. Gdy potrzebujesz publicznego adresu: `npm run setup:deploy`. Skrypt zakłada projekt Convex i Vercel, a cztery sekrety wdrożeniowe wpisuje do środowiska `production` w GitHubie. Zajmuje to kilka minut. Zanim ruszysz, zaloguj się: `gh auth login`, `npx convex login`, `npx vercel@65.16.0 login`. Sam szablon nigdy nie dostaje sekretów, więc skrypt się na nim zatrzyma.

Podgląd planu bez zmian: `npm run setup:deploy -- --dry-run`. Szczegóły w [docs/deployment.md](docs/deployment.md).

## Wymagania

- Node 24 (wersja w `.nvmrc`; `package.json` wymaga `>=24.15.0 <25`) i npm. Yarn i pnpm nie są używane.
- Git. Do pracy z issue i PR: [GitHub CLI](https://cli.github.com/) (`gh auth login`).
- Konto Convex jest opcjonalne: bez niego aplikacja działa w trybie offline lub z lokalnym backendem.

Wersję z `.nvmrc` ustawisz menedżerem Node, np. [fnm](https://github.com/Schniz/fnm) (`fnm use`) lub nvm (`nvm use`).

## Szybki start (tryb offline)

Bez konta i bez klucza. Aplikacja startuje bez klienta Convex i pokazuje baner „offline”.

```bash
git clone <adres-repozytorium>
cd <katalog-repozytorium>
fnm use   # lub nvm use; zła wersja Node przerwie npm ci
npm ci
npm run dev:frontend
```

Otwórz [http://localhost:5173](http://localhost:5173). Gdy port jest zajęty, Vite zgłasza błąd zamiast po cichu wybrać inny (`strictPort`). Co wtedy zrobić, opisuje [docs/troubleshooting.md](docs/troubleshooting.md).

## Szybki start z Convex

Przykładowe notatki zapisują się w bazie Convex, więc pełne demo potrzebuje backendu. Są dwie drogi.

**A. Lokalny backend bez konta** (najszybciej, nic nie opuszcza maszyny):

```bash
# PowerShell: $env:CONVEX_AGENT_MODE = "anonymous"
CONVEX_AGENT_MODE=anonymous npx convex dev --once
```

Komenda tworzy lokalny deployment i zapisuje `CONVEX_DEPLOYMENT` oraz `VITE_CONVEX_URL` w `.env.local`. Potem `npm run dev` uruchamia Convex i Vite razem. Dane demo załaduje `npm run seed`.

**B. Konto Convex** (współdzielony deployment w chmurze, wymagany dla ścieżek z `npm run lane:new` bez `--local`):

```bash
npx convex login
npm run dev
```

Pierwsze uruchomienie zapyta o projekt i zapisze konfigurację w `.env.local`. Plik jest poza gitem. Nie wpisuj w niego sekretów pod prefiksem `VITE_`, bo trafiają do paczki w przeglądarce.

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
| `npm run seed`                                          | ładuje przykładowe notatki do Convex                             |
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
.github/                           CI, deploy, lista plików wspólnych
```

Zasada: funkcje dodają pliki, nie edytują wspólnych. Nową funkcję dodaje się w dwóch krokach (kontrakt, potem funkcja). Opis krok po kroku: [docs/architecture.md](docs/architecture.md).

## Dostawcy AI

Domyślnie działa `mock`, który jest też siatką bezpieczeństwa na demo. Prawdziwy model (dowolny endpoint zgodny z OpenAI) włącza się przez `AI_PROVIDER=openai-compatible` oraz `AI_BASE_URL`, `AI_MODEL` i `AI_API_KEY` w środowisku Convex. Klucze nigdy nie trafiają do `VITE_*` ani do `.env.local`. Między prawdziwymi dostawcami nie ma automatycznego przełączania.

**Bielik i PLLuM.** Modele polskie podłączamy przez ten sam adapter zgodny z OpenAI. Chmura Convex nie dosięgnie prywatnego adresu WireGuard, więc są trzy drogi: (1) uwierzytelniona brama HTTPS przed modelem, (2) osobny worker w sieci modelu, który tylko wychodzi do Convex, (3) bezpośredni, osiągalny endpoint. Zaimplementowana jest droga 3, drogi 1 i 2 są opisane w dokumentacji. Nigdy nie otwieraj portu modelu do internetu. Licencje PLLuM różnią się między modelami, więc sprawdź kartę modelu. Szczegóły, tryby strukturalne i bezpieczeństwo: [docs/ai-providers.md](docs/ai-providers.md).

## Praca zespołowa i ścieżki (lanes)

Każdy pracuje na osobnej ścieżce: własny worktree, własne porty i własny deployment Convex. Pliki wspólne (lista w `.github/hot-files.txt`) zmienia się tylko w małym PR z kontraktem uzgodnionym z zespołem. Przed startem i przed PR uruchom `npm run overlap`.

```bash
npm run lane:new -- <osoba> <nr-issue> <slug>
npm run lane:list
npm run lane:rm -- <nr-issue>-<slug>
```

CI blokuje PR, który miesza pliki wspólne z innymi, dopóki nie zaznaczysz w opisie PR pola `- [ ] Zmiana plików wspólnych uzgodniona z zespołem` i nie klikniesz „Re-run failed jobs”. Pełny opis, w tym limity darmowego planu Convex i konflikty: [docs/development-workflow.md](docs/development-workflow.md). Zasady zespołu: [CONTRIBUTING.md](CONTRIBUTING.md).

## Testy i `npm run verify`

`npm run verify` uruchamia to samo, co CI na PR: `format:check`, `lint`, `typecheck`, `test:coverage`, `build`, `test:e2e`. Uruchom go przed każdym commitem i PR. Testy nie potrzebują sieci ani żywego modelu. Smoke e2e działa w trybie offline (`.env.e2e`), więc nie eksportuj `VITE_CONVEX_URL` w powłoce. Warstwy testów i komendy: [docs/testing.md](docs/testing.md).

## Git i pull requesty

Zadania pochodzą z GitHub Issues. Gałąź nazywa się `feat|fix|chore/<nr>-<slug>`, commity trzymają format Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`), a na `main` nigdy nie pushujemy: zawsze gałąź i PR. Opis PR zawiera `Closes #<nr>`, a przed PR robisz rebase na `origin/main`. Zasady zespołu: [CONTRIBUTING.md](CONTRIBUTING.md), przebieg krok po kroku: [docs/github-issues-workflow.md](docs/github-issues-workflow.md).

## Praca z agentami AI

Reguły dla agentów (i ludzi) są w [CLAUDE.md](CLAUDE.md). Pierwszego dnia wklej agentowi w katalogu repozytorium [SETUP_PROMPT.md](SETUP_PROMPT.md): przeprowadzi go przez przegląd repo, krótką specyfikację i plan z linią odcięcia. Zadania pochodzą z GitHub Issues, a agent nie zakłada ani nie zamyka issue bez pytania. Przebieg: [docs/github-issues-workflow.md](docs/github-issues-workflow.md). Osobny agent-recenzent sprawdza zmianę względem kryteriów akceptacji, a recenzję GitHub Copilot zamawiamy raz na PR, jako ostatni przegląd.

## Deploy

Backend wdraża Convex, frontend Vercel, a oba kroki uruchamia workflow `.github/workflows/deploy.yml`. W `vercel.json` automatyczne wdrożenia z Gita są wyłączone, więc wdraża tylko workflow.

Domyślna droga to `npm run setup:deploy` (opis w sekcji [Nowy hackathon z szablonu](#nowy-hackathon-z-szablonu)). Ręcznie:

1. Zaimportuj repozytorium jako projekt w Vercel i wykonaj `vercel link`.
2. Dodaj sekrety w środowisku `production` na GitHubie: `CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`. Bez nich workflow niczego nie wdroży i napisze, których brakuje.
3. `VITE_CONVEX_URL` ustawia przy buildzie `npx convex deploy`. Nie wpisuj go w zmiennych projektu Vercel.

Pełna konfiguracja, w tym ochrona gałęzi `main`: [docs/deployment.md](docs/deployment.md).

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

Licencja: [MIT](LICENSE).
