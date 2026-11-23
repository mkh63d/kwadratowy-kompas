# Issues, gałęzie i PR-y

GitHub Issues to jedyne źródło zadań, dla ludzi i dla agentów AI. Bez Jiry i bez dodatkowego serwera
MCP: wystarczy `gh` (GitHub CLI). Jedyna ścieżka logowania to `gh auth login`, a żadne dane
dostępowe nie trafiają do repozytorium. Zasady zespołu są w [CONTRIBUTING.md](../CONTRIBUTING.md).

## Siedem kroków

Jedno zadanie to jedno issue, jedna gałąź, jeden PR.

1. **Przeczytaj issue razem z komentarzami.**

   ```bash
   gh issue view 12 --comments
   ```

2. **Przeczytaj kryteria akceptacji.** To lista `- [ ]` w treści issue. Są definicją „zrobione”.
3. **Obejrzyj kontekst:** pasujące pliki w `specs/` i kod, którego dotyczy zadanie. Sprawdź, czy ktoś
   inny nie rusza tych samych plików: `npm run overlap`.
4. **Zaimplementuj na gałęzi** `feat/<nr>-<slug>` (albo `fix/`, `chore/`):

   ```bash
   git fetch origin
   git switch -c feat/12-login origin/main
   ```

   Przy kilku równoległych zadaniach użyj ścieżki (`npm run lane:new -- <osoba> 12 login`), która
   robi osobny worktree z własnymi portami i deploymentem. Szczegóły:
   [development-workflow.md](development-workflow.md).

5. **Uruchom `npm run verify`** i popraw wszystko, co czerwone. Podaj prawdziwy wynik, a jeśli
   czegoś nie dało się uruchomić, napisz to wprost.
6. **Otwórz PR** z `Closes #<nr>` w opisie, po rebase na `origin/main`:

   ```bash
   git fetch origin && git rebase origin/main
   git push -u origin feat/12-login
   cp .github/pull_request_template.md pr-body.md   # uzupełnij w edytorze i usuń po użyciu
   gh pr create --title "feat(login): add login form" --body-file pr-body.md
   ```

   W `pr-body.md` wpisz `Closes #12`, podsumowanie i sekcję „Jak to przetestowano”. Zamiast pliku
   możesz użyć `gh pr create --web`, które otwiera formularz z szablonem w przeglądarce. Tytuł PR
   i commity są po angielsku w formacie Conventional Commits.

7. **Napisz w issue komentarz z wynikiem:** co zrobiono i jak sprawdzono.

   ```bash
   gh issue comment 12 --body "PR #34 gotowy. verify zielony, kryteria 1-3 spełnione (testy w convex/login/)."
   ```

Po zielonym checku `gate` i recenzji PR jest scalany squashem; jeśli repo jest w organizacji i kolejka scalania jest włączona, wchodzi przez kolejkę.

## Użyteczne komendy `gh`

```bash
gh issue list --assignee "@me" --state open       # moje otwarte zadania
gh issue list --search "no:assignee label:feat"   # wolne zadania
gh issue view 12 --comments                       # treść i dyskusja
gh pr list --state open                           # kto co robi
gh pr checks                                      # stan CI dla bieżącej gałęzi
gh pr view --comments                             # uwagi recenzentów
```

## Nazwy gałęzi

`feat|fix|chore/<nr>-<slug>`, gdzie `<nr>` to numer issue, a `<slug>` to krótki opis małymi
literami z myślnikami: `feat/12-login`, `fix/31-notes-empty-state`. Gałęzie lane (`lane:new`) są
zawsze `feat/<nr>-<slug>`. PR dla pliku wspólnego dostaje gałąź `chore/<nr>-contract-<slug>` i tytuł
`feat(contract): …`.

## Dobre issue: przykład

Szablony są w `.github/ISSUE_TEMPLATE/`. Pola „Kryteria akceptacji” i „Planowany zakres plików”
są po to, żeby agent wiedział, kiedy skończył, a `npm run overlap` wiedział, czyje pliki się
nakładają.

```markdown
Tytuł: feat: lista zadań z odhaczaniem

## Problem i motywacja

Zespół chce na demo pokazać prostą listę rzeczy do zrobienia, którą da się odhaczać. Dziś w
aplikacji są tylko notatki.

## Proponowane rozwiązanie

Nowa strona „Zadania”: pole do dodania zadania, lista zadań i przełącznik „zrobione” przy każdym.
Dane trzyma nowa tabela Convex, a treść zadania przechodzi walidację Zod, tak jak w notatkach.

## Kryteria akceptacji

- [ ] Nowe zadanie pojawia się na liście po dodaniu.
- [ ] Puste zadanie jest odrzucone z komunikatem walidacji i nie trafia do bazy.
- [ ] Przełącznik oznacza zadanie jako zrobione i zapamiętuje to po odświeżeniu.
- [ ] Testy komponentu i funkcji Convex, `npm run verify` zielony.

## Planowany zakres plików

- `convex/todos/tables.ts` i linia w `convex/schema.ts` (osobny PR kontraktowy, najpierw)
- `convex/todos/queries.ts`, `convex/todos/mutations.ts` i ich testy
- `src/features/todos/**`
```

Co składa się na dobre issue:

- Problem opisany jednym zdaniem, bez rozwiązania w tytule.
- Kryteria, na które da się odpowiedzieć „tak” albo „nie”.
- Lista plików zgodna z tym, co faktycznie się zmieni, z wyraźnie wskazanym PR-em kontraktowym.
- Brak decyzji implementacyjnych, które wykonawca podejmie sam.

Uwaga: `gh issue create` **pomija szablony**, jeśli podasz `--title` i `--body`. Żeby użyć szablonu,
załóż issue w przeglądarce (`gh issue create --web`) albo wklej do `--body` sekcje z szablonu.

## Zasady dla agentów

- Agent **nie zakłada ani nie zamyka issue** i nie zmienia etykiet, milestone'ów ani przypisań bez
  pytania. Rezerwacja (przypisanie) to decyzja człowieka.
- Komentarze wolno pisać zawsze: wynik pracy, pytanie, blokada.
- Do GitHuba służy wyłącznie `gh`. Konfiguracji MCP ani własnych wywołań API agent nie wymyśla.
- Gdy zmiana dotyka plików wspólnych, agent staje i pyta człowieka.
- Pracę sprawdza osobny agent-recenzent względem kryteriów akceptacji z issue. Recenzję GitHub
  Copilot zamawiamy raz na PR, jako ostatni przegląd, a drugi raz tylko wtedy, gdy jej uwagi
  zmieniły kod.
