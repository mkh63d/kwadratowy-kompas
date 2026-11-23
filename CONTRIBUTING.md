# Współpraca w zespole

Zasady dla ludzi i agentów AI pracujących w tym repo. Jak działa kod, opisuje
[docs/architecture.md](docs/architecture.md), a codzienny przepływ pracy
[docs/development-workflow.md](docs/development-workflow.md). Tu są reguły gry: gałęzie, commity, PR-y,
recenzje i praca równoległa.

## Zasady w skrócie

- Nikt nie pushuje bezpośrednio do `main`. Zawsze gałąź i PR.
- Jedno zadanie to jedno issue, jedna gałąź, jeden PR.
- Przed każdym commitem i PR-em uruchom `npm run verify` i podaj prawdziwy wynik.
- Pliki wspólne (hot files) zmienia się tylko w małym PR-ze kontraktowym.
- Nowa zależność npm to też PR kontraktowy, po sprawdzeniu pakietu.

## Zadania i gałęzie

Źródłem zadań są GitHub Issues. Kryteria akceptacji to lista `- [ ]` w treści issue.

- **Przypisanie = rezerwacja.** Issue przypisuje sobie człowiek (nie agent). Zanim ktoś zacznie,
  sprawdza, czy issue nie ma już właściciela.
- Nazwa gałęzi: `feat|fix|chore/<nr>-<slug>`, np. `feat/12-login`, `fix/31-notes-empty-state`.
- Nie twórz, nie zamykaj issue i nie zmieniaj etykiet ani milestone'ów bez uzgodnienia z zespołem.
  Komentować wolno zawsze.
- Po skończeniu napisz w issue komentarz z wynikiem (co zrobione, jak sprawdzone).

Szczegóły: [docs/github-issues-workflow.md](docs/github-issues-workflow.md).

## Commity

[Conventional Commits](https://www.conventionalcommits.org/), po angielsku:

- `feat:` nowa funkcja, `fix:` poprawka błędu, `chore:` porządki i konfiguracja,
- `refactor:`, `test:`, `ci:`, `docs:`.

Przykład: `feat(notes): add summarize button`. Zmiana pliku wspólnego dostaje typ
`feat(contract): …`.

## Przepływ PR

1. `npm run overlap`: sprawdź, czy ktoś inny nie rusza tych samych plików.
2. Pracuj na gałęzi, commituj małymi krokami.
3. `git fetch && git rebase origin/main`, a potem `npm run verify`. Obejmuje on `format:check`,
   `lint`, `typecheck`, `test:coverage`, `build` i `test:e2e`. To ten sam zestaw, który odpala CI.
4. Jeszcze raz `npm run overlap`, potem otwórz PR. Treść PR zawiera `Closes #<nr>`, krótkie
   podsumowanie i opis, jak to przetestowano. Użyj szablonu PR.
5. Poczekaj na zielony check `gate`, uzyskaj recenzję (niżej) i scal PR (jeśli repo jest w organizacji i kolejka jest włączona, przez kolejkę).

Po angielsku piszemy kod, komentarze, commity oraz tytuły i opisy PR. Po polsku są README,
`docs/`, `CONTRIBUTING.md` i szablony PR oraz issue.

## Recenzje

- **Recenzent Claude (osobny subagent)** sprawdza diff względem kryteriów akceptacji z issue. Robi
  to przed otwarciem PR-a i po każdej większej poprawce. To główna recenzja.
- **Copilot** prosimy o recenzję **raz na PR**, jako ostatni przebieg. Drugi raz tylko wtedy, gdy
  jego uwagi zmieniły kod (poprawki samej dokumentacji lub komentarzy się nie liczą), i nigdy więcej
  niż dwa razy. Poprawki sprawdza świeży recenzent Claude.
- Nie wymagamy zatwierdzeń (mały zespół), ale PR nie wchodzi bez zielonego `gate`.

## Ochrona gałęzi `main`

Ustawia ją właściciel repo (Settings → Branches / Rules). Docelowa konfiguracja:

- wymagany PR, bez force push,
- wymagany check **`gate`**,
- **kolejka scalania (merge queue)**: każdy PR jest testowany jeszcze raz na szczycie aktualnego
  `main` razem z PR-ami przed nim, więc dwa osobno zielone PR-y, które się gryzą, nie wejdą oba,
- scalanie wyłącznie **squash** (jeden commit na PR, łatwy revert),
- reguła dla samej gałęzi `main`, bez wildcardów (kolejka scalania nie działa z wzorcem),
- bez wymaganych zatwierdzeń.

Uwaga o planie GitHuba: kolejka scalania działa tylko w repozytoriach należących do organizacji
(publicznych lub na płatnym planie). Ochrona gałęzi na darmowym planie wymaga repozytorium
**publicznego**. W repo prywatnym bez organizacji zostaje sama dyscyplina: PR, zielony `gate`,
squash i rebase przed scaleniem.

## Praca równoległa

Pięć osób, każda z kilkoma ścieżkami (lanes), szybko zaczyna zmieniać te same pliki. Żeby do tego
nie dochodziło:

- **Foldery funkcji.** Funkcja dodaje pliki, nie edytuje cudzych: `src/features/<nazwa>/` (z
  `feature.tsx`, który sam rejestruje trasę) i `convex/<nazwa>/`. Router ani layout nie są ruszane.
- **`npm run overlap`** przed startem i przed PR-em pokazuje pliki zmieniane też w otwartych PR-ach
  i w innych worktree. Przy nakładaniu się na plik wspólny **zatrzymaj się i zapytaj człowieka**.
- **Pliki wspólne** wypisuje [.github/hot-files.txt](.github/hot-files.txt) (m.in. `convex/schema.ts`,
  `convex/*/tables.ts`, `package.json`, `.github/**`, `.claude/**`, `CLAUDE.md`). Zmiana takiego
  pliku idzie w **osobnym małym PR-ze kontraktowym**: gałąź `chore/<nr>-contract-<slug>`, tytuł
  `feat(contract): …`, tylko ta zmiana i jej testy, scalony przed pracą, która jej potrzebuje.
- **Funkcja z backendem to dwa PR-y.** PR 1 (kontrakt): `convex/<nazwa>/tables.ts` plus jedna linia
  w `convex/schema.ts` (i odświeżone `convex/_generated/**`). PR 2 (funkcja): zapytania, mutacje,
  akcje, testy i folder frontendu. Żaden z nich nie wymaga zaznaczenia pola w szablonie PR.
- **Nowa zależność** to też PR kontraktowy (`package.json` i lockfile). Najpierw sprawdź pakiet:
  czy istnieje w rejestrze pod tą nazwą, licencja OSI, czy jest utrzymywany, czy nie ma znanych
  podatności, i krótko uzgodnij z zespołem.
- **Agent** proponuje nową zależność i czeka na zgodę. Nie robi `npm install` w gałęzi funkcji.
- **Schemat tylko addytywnie** w trakcie hackathonu: nowe tabele i nowe pola opcjonalne. Zmiana
  nazwy lub usunięcie pola to zmiana kontraktowa.
- **Krótkie PR-y**: celuj w mniej niż ok. 4 godziny pracy na PR. Co kilka godzin i przed otwarciem
  PR-a: `git fetch && git rebase origin/main`.
- Zmiany w `convex/` (nowy lub usunięty plik) wymagają `npx convex codegen` i `npm run codegen:check`.
  Takie zmiany nie idą równolegle z innymi zmianami plików w `convex/`.

### Gdy zmiana dotyka plików wspólnych razem z innymi

CI odrzuca PR, który miesza pliki wspólne z innymi. Rozdziel go na dwa PR-y. Tylko w naprawdę
drobnym, uzasadnionym przypadku zaznacz w szablonie PR pole:

```text
- [ ] Zmiana plików wspólnych uzgodniona z zespołem
```

Samo zaznaczenie pola nie uruchamia CI ponownie. Po zaznaczeniu kliknij **Re-run failed jobs**.

## Konflikty

- `package-lock.json`: weź wersję z `main` i uruchom `npm install`.
- `convex/_generated/**`: weź dowolną stronę i uruchom `npx convex codegen`.
- Inne konflikty rozwiązuj po rebase na `origin/main`, a potem uruchom `npm run verify`.

## Bezpieczeństwo

- Żadnych sekretów w repo, logach ani w froncie. Do przeglądarki trafiają tylko zmienne `VITE_*`,
  więc sekret nigdy nie dostaje tego prefiksu.
- Klucze AI trafiają wyłącznie do środowiska Convex (`npx convex env set`), nigdy do `.env.local`.
- CI uruchamia gitleaks. Nie commituj niczego, co przypomina klucz.
