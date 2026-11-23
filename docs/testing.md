# Testy

Testy nie potrzebują sieci ani żywego modelu: adaptery AI testujemy z podstawionym `fetch`, a
backend przez `convex-test`. Cały zestaw z CI uruchamiasz lokalnie jedną komendą:

```bash
npm run verify   # format:check, lint, typecheck, test:coverage, build, test:e2e
```

## Warstwy

| Warstwa                                         | Narzędzie                             | Gdzie                                     | Środowisko                             |
| ----------------------------------------------- | ------------------------------------- | ----------------------------------------- | -------------------------------------- |
| Jednostkowe (logika, schematy Zod, adaptery AI) | Vitest                                | `src/**/*.test.ts`, `convex/**/*.test.ts` | jsdom (`src`), edge-runtime (`convex`) |
| Komponentowe                                    | Vitest + Testing Library + user-event | `src/**/*.test.tsx`                       | jsdom                                  |
| Integracyjne backendu                           | Vitest + `convex-test`                | `convex/**/*.test.ts`                     | `edge-runtime`                         |
| Skrypty pomocnicze                              | Vitest                                | `scripts/**/*.test.ts`                    | node                                   |
| E2E smoke                                       | Playwright (tylko Chromium)           | `e2e/`                                    | zbudowana aplikacja                    |

`vitest.config.ts` ma trzy projekty: `frontend` (jsdom), `backend` (edge-runtime) i `scripts`
(node). Jeden `npm test` uruchamia wszystkie.

## Komendy

| Komenda                            | Co robi                                                   |
| ---------------------------------- | --------------------------------------------------------- |
| `npm test`                         | wszystkie testy Vitest, jednorazowo                       |
| `npm run test:watch`               | Vitest w trybie nasłuchu                                  |
| `npm run test:coverage`            | testy z pokryciem (v8)                                    |
| `npm run test:e2e`                 | Playwright: buduje pakiet w trybie `e2e` i go serwuje     |
| `npx vitest run --project backend` | tylko jeden projekt                                       |
| `npx vitest run convex/notes`      | tylko pliki pasujące do ścieżki                           |
| `npx playwright install chromium`  | jednorazowo: przeglądarka dla e2e (w CI robi to workflow) |

## Raporty JSON

Agenci i skrypty czytają wyniki z plików, a nie z konsoli:

- `reports/vitest.json`: wynik Vitest,
- `reports/playwright.json`: wynik Playwright,
- `coverage/` (`coverage-summary.json`, `lcov.info`): pokrycie,
- `playwright-report/` (HTML, tylko lokalnie, nie w CI) i `test-results/`: ślady i zrzuty.

Wszystkie te katalogi są w `.gitignore`. CI wysyła `reports/` i `coverage/` jako artefakty. Każdy
worktree ma własne raporty, więc ścieżki ich nie nadpisują.

## Testy e2e i tryb offline

Smoke test ma dać ten sam wynik na laptopie, na którym działało `npx convex dev` (ono zapisuje
prawdziwy `VITE_CONVEX_URL` do `.env.local`), i w CI, gdzie `.env.local` nie ma. Vite wczytuje
`.env.local` w każdym trybie, ale **pliki trybu mają pierwszeństwo przed ogólnymi**, a zmienne
powłoki biją wszystko ([Vite: env i tryby](https://vite.dev/guide/env-and-mode)). Dlatego:

- Playwright buduje aplikację w osobnym trybie: `vite build --mode e2e --outDir dist-e2e`, a potem
  serwuje ją przez `vite preview --mode e2e --outDir dist-e2e --strictPort`.
- Zacommitowany `.env.e2e` ustawia `VITE_CONVEX_URL=` (pustą). Przykrywa to `.env.local`, a
  `src/lib/env.ts` traktuje pustą wartość jak brak. Test zawsze widzi tryb offline: baner
  „Tryb offline”, nawigację i walidację formularza, bez backendu.
- Port podglądu to `PREVIEW_PORT` (domyślnie `4173`, w ścieżkach inny). Zajęty port to błąd, nie
  cicha zmiana (`strictPort`).

**Nie eksportuj `VITE_CONVEX_URL` w powłoce.** Zmienna powłoki bije `.env.e2e`, więc test
cicho przeszedłby w tryb online. Dlatego `playwright.config.ts` przerywa od razu z komunikatem
`VITE_CONVEX_URL is set in your shell…`. Wyczyść zmienną:

```bash
unset VITE_CONVEX_URL            # bash, zsh
```

```powershell
Remove-Item Env:VITE_CONVEX_URL  # PowerShell
```

W PowerShellu `$env:VITE_CONVEX_URL=''` też usuwa zmienną, ale `Remove-Item` jest czytelniejsze. Pełny test e2e na prawdziwym backendzie Convex jest poza zakresem startera
(to kolejny krok, gdy produkt się ustabilizuje).

## Testy backendu: `convex-test`

`convex-test` uruchamia funkcje Convex w pamięci, bez chmury
([dokumentacja](https://docs.convex.dev/testing/convex-test)):

```ts
import { convexTest } from "convex-test";
import schema from "../schema";

const modules = import.meta.glob("/convex/**/*.*s");

const t = convexTest(schema, modules);
```

Glob musi być **absolutny względem korzenia repo** (`"/convex/**/*.*s"`), taki sam we wszystkich
plikach testowych. Wzorzec względny, np. `"./**/*.ts"`, zależy od położenia pliku testu i gubi
moduły z innych katalogów, a wtedy `api.*` nie znajdzie funkcji. Projekt `backend` w
`vitest.config.ts` wbudowuje `convex-test` (`server.deps.inline`).

Ograniczenia, o których warto pamiętać ([źródło](https://docs.convex.dev/testing/convex-test)):

- treść komunikatów błędów różni się od produkcyjnej, więc nie porównuj ich co do litery,
- limity rozmiaru i czasu nie są egzekwowane,
- format ID różni się od produkcyjnego,
- funkcje działają w mocku `edge-runtime`, a nie w prawdziwym środowisku Convex, więc część
  wbudowanych API może zachowywać się inaczej,
- wyszukiwanie pełnotekstowe jest uproszczone, więc kolejność wyników (trafność) może być inna,
- test nie zastąpi próby na prawdziwym deploymencie, np. przed demo.

Adaptery AI testujemy bez sieci: `vi.stubGlobal("fetch", …)` i odpowiedzi z fixture’ów. Domyślny
dostawca `mock` jest deterministyczny, więc nie potrzeba żadnych kluczy.

## Pokrycie

Pokrycie (v8) jest liczone przy `npm run test:coverage` i generuje `coverage/`. Na starcie **nie ma
progu**: arbitralny próg na początku nic nie mówi o jakości. Gdy produkt się ustabilizuje,
dodaj progi w `vitest.config.ts`:

```ts
coverage: {
  provider: "v8",
  reportsDirectory: "coverage",
  reporter: ["text-summary", "lcov", "json-summary"],
  thresholds: { lines: 70, functions: 70, branches: 60, statements: 70 },
},
```

Wtedy `test:coverage` (a więc `verify` i CI) kończy się błędem poniżej progu. Podnoś go stopniowo,
zaczynając od liczby bliskiej obecnej. `vitest.config.ts` to plik wspólny, więc zmiana idzie w
małym PR-ze kontraktowym.

## Skanowanie sekretów lokalnie (gitleaks)

CI skanuje historię narzędziem [gitleaks](https://github.com/gitleaks/gitleaks) (v8.30.1, licencja
MIT). To binarka w Go, a nie pakiet npm, więc `npm run verify` jej nie uruchamia. Lokalnie
pobierz wydanie z [strony wydań](https://github.com/gitleaks/gitleaks/releases/tag/v8.30.1) dla
swojego systemu, **sprawdź sumę kontrolną** z pliku `gitleaks_8.30.1_checksums.txt` i dopiero
potem uruchom:

```bash
sha256sum -c --ignore-missing gitleaks_8.30.1_checksums.txt   # Linux
grep gitleaks_8.30.1_darwin_arm64.tar.gz gitleaks_8.30.1_checksums.txt | shasum -a 256 -c   # macOS (Apple Silicon)
```

```powershell
(Get-FileHash .\gitleaks_8.30.1_windows_x64.zip -Algorithm SHA256).Hash   # porównaj z plikiem sum
```

```bash
gitleaks git --redact --verbose .
```

`--redact` ukrywa wartości sekretów w wyniku. Gdy gitleaks coś znajdzie, **unieważnij
klucz** u dostawcy. Sam nowy commit go nie usuwa, bo sekret zostaje w historii.
