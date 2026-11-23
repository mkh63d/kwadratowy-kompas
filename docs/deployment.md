# Wdrożenie: Convex i Vercel

Backend (Convex) i frontend (Vercel) wdraża jeden workflow: `.github/workflows/deploy.yml`. Uruchamia się po każdym pushu na `main` (czyli po scaleniu PR) oraz ręcznie przez `workflow_dispatch`. Najpierw woła ten sam `ci.yml` co PR (job `verify`), a dopiero potem wdraża.

> Starter jest zielony, zanim ktokolwiek założy konta. Bez sekretów job `deploy` kończy się sukcesem i pisze w podsumowaniu „Deploy skipped” z listą brakujących sekretów. Nic się wtedy nie wdraża.

## Jak to działa

```mermaid
flowchart LR
  push[push na main] --> verify[verify: ci.yml]
  verify --> creds{4 sekrety są?}
  creds -- nie --> skip[Deploy skipped, job zielony]
  creds -- tak --> pull[vercel pull]
  pull --> cvx["convex deploy --cmd 'vercel build --prod'"]
  cvx --> guard[strażnik: URL Convex w buildzie]
  guard --> dep[vercel deploy --prebuilt --prod]
```

Kroki workflow po sprawdzeniu sekretów:

1. `npx vercel pull --yes --environment=production` pobiera konfigurację projektu.
2. `npx convex deploy --cmd "npx vercel build --prod" --cmd-url-env-var-name VITE_CONVEX_URL` wdraża funkcje Convex i uruchamia build Vercela z `VITE_CONVEX_URL` ustawionym na adres produkcyjnego deploymentu ([Convex: Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel), [Convex CLI](https://docs.convex.dev/cli)).
3. Strażnik wyciąga nazwę deploymentu z klucza `CONVEX_DEPLOY_KEY` i szuka `<nazwa>.convex.cloud` w `.vercel/output/static`. Brak trafienia kończy job błędem. Dokumentacja nie opisuje, czy wstrzyknięty `VITE_CONVEX_URL` wygrywa z wartością pobraną przez `vercel pull`, więc workflow sprawdza wynik zamiast wierzyć, że zadziałało.
4. `npx vercel deploy --prebuilt --prod` wysyła gotowy build ([Vercel: GitHub Actions](https://vercel.com/kb/guide/how-can-i-use-github-actions-with-vercel)).

Sekrety trafiają tylko do kroków, które ich potrzebują (każdy krok ma własny blok `env`), a wersje narzędzi (`vercel@65.16.0`) i akcji są przypięte.

## Szybka droga: `npm run setup:deploy`

W repozytorium utworzonym z szablonu jedna komenda przygotowuje wdrożenia:

```bash
npm run setup:deploy -- --dry-run   # pokazuje plan, niczego nie zmienia
npm run setup:deploy                # wykonuje
npm run setup:deploy -- --protect   # dodatkowo ochrona main
```

Wcześniej zaloguj się w trzech narzędziach: `gh auth login`, `npx convex login` i `npx vercel@65.16.0 login`. Skrypt:

1. sprawdza logowania i odmawia pracy na repozytorium-szablonie;
2. tworzy projekt Convex (o ile `.env.local` nie ma jeszcze wdrożenia w chmurze) i produkcyjny klucz `CONVEX_DEPLOY_KEY`. Uwaga: `convex dev --once --configure new` nadpisuje `CONVEX_DEPLOYMENT` i `VITE_CONVEX_URL` w `.env.local`, więc lokalne `npm run dev` przestaje używać backendu lokalnego lub anonimowego i łączy się z nowym wdrożeniem deweloperskim w chmurze, a `npm run dev:frontend` przestaje działać offline z mockiem. Gdy `.env.local` wskazuje już projekt w chmurze o slugu innym niż nazwa repozytorium (slug nadaje serwer, więc może się różnić nawet w Twoim własnym projekcie), skrypt pyta, czy go użyć (przy `--yes`, `--dry-run` albo nieznanym slugu przerywa). Wdrożenia produkcyjnego Convex skrypt sam nie zakłada: jeśli `token create --prod` się nie powiedzie, utwórz je ręcznie (`npx convex deployment create --type prod --default` albo w panelu) i uruchom skrypt ponownie;
3. tworzy projekt Vercel o nazwie repozytorium, jeśli go nie ma, łączy z nim katalog (`vercel link`; nieaktualny `.vercel/project.json` łączy ponownie) i czyta `orgId` oraz `projectId`;
4. prosi o token Vercel w ukrytym polu. Utworzysz go w vercel.com > Account Settings > Tokens. To jedyna wartość, którą wklejasz;
5. tworzy środowisko `production` i wpisuje cztery sekrety przez stdin;
6. z `--protect` zakłada ruleset dla `main` zgodny z sekcją „Ochrona gałęzi” niżej (bez `--protect` wypisuje tylko komendę).

Klucze i token żyją wyłącznie w pamięci i trafiają do `gh secret set` przez stdin: nie ma ich w argumentach, logach, plikach ani komunikatach błędów. Każdy krok pomija się, jeśli jest już zrobiony, więc komendę można uruchomić ponownie. `--yes` wyłącza pytanie o potwierdzenie, a przy niezgodnym projekcie Convex przerywa zamiast pytać. Skrypt niczego nie wdraża: pierwszy deploy uruchomisz sam (`gh workflow run deploy.yml`, podgląd `gh run watch`). Zmienne backendu ustaw osobno, np. `npx convex env set AI_PROVIDER mock --prod`.

Skrypt zawsze używa środowiska `production`, a trybu z sekretami na poziomie repozytorium nie ma. Wymaga więc repozytorium publicznego albo płatnego planu (sekcja „Plany darmowe”). W prywatnym repozytorium na Free może zatrzymać się dopiero na zakładaniu środowiska, już po utworzeniu projektów Convex i Vercel. Wtedy dokończ ręcznie według listy niżej, z sekretami na poziomie repozytorium. Przerwany lub nieudany przebieg mógł zostawić niewykorzystany produkcyjny klucz wdrożeniowy Convex; możesz go unieważnić w panelu Convex.

Repozytorium-szablon nie ma sekretów i nie powinno ich mieć: jego job `deploy` kończy się zielono z komunikatem „Deploy skipped”. Sekrety dostaje dopiero kopia utworzona z szablonu. Ruleset z `--protect` zawiera merge queue, a ta według sekcji „Plany darmowe” wymaga repozytorium należącego do organizacji. Strony GitHuba o kolejce nie podają tego wprost, więc na koncie osobistym `--protect` może się skończyć błędem 422 (skrypt podpowie wtedy ręczną konfigurację). Ruleset, który już obejmuje `main`, skrypt zostawia w spokoju; reguł na poziomie organizacji nie zakłada.

Poniższa lista to ścieżka ręczna, na wypadek gdyby skrypt nie zadziałał.

## Lista na pierwsze wdrożenie (ręcznie)

### 1. Convex: projekt produkcyjny i klucz

1. Zaloguj się: `npx convex login`, utwórz projekt (np. przez `npx convex dev`, który zapisze `CONVEX_DEPLOYMENT` w `.env.local`).
2. W [panelu Convex](https://dashboard.convex.dev/) otwórz deployment **produkcyjny**, wejdź na stronę _Deployment Settings_, kartę _General_, i kliknij _Generate Production Deploy Key_. Przy ustawianiu uprawnień klucza włącz `deployment:deploy` ([Convex: Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel)).
3. Klucz ma postać `prod:<nazwa-deploymentu>|<token>`. Użyj klucza produkcyjnego, nie deweloperskiego: `convex deploy` z kluczem deweloperskim wdroży funkcje na deployment deweloperski, a nie na produkcję, więc front dostałby adres złego backendu.
4. Ustaw zmienne backendu na deploymentcie produkcyjnym (nie ma ich w `.env.local` ani w GitHubie): `npx convex env set AI_PROVIDER mock --prod`. Pełna lista i ścieżki dostawców: [ai-providers.md](ai-providers.md). `mock` jest bezpieczną wartością domyślną na demo.

### 2. Vercel: projekt i trzy identyfikatory

1. Załóż projekt w Vercel z tego repozytorium (framework Vite; `vercel.json` jest w repo) albo utwórz go z CLI.
2. W katalogu repozytorium: `npx vercel link`. Powstaje `.vercel/project.json` z `orgId` i `projectId` (katalog `.vercel` jest ignorowany przez Git).
3. `orgId` to `VERCEL_ORG_ID`, `projectId` to `VERCEL_PROJECT_ID`. Token (`VERCEL_TOKEN`) tworzysz w ustawieniach konta Vercel.
4. **Nie ustawiaj `VITE_CONVEX_URL` w zmiennych projektu Vercel.** Wartość wstrzykuje `npx convex deploy` przy buildzie. Zmienna w projekcie mogłaby ją przykryć i zbudować front przeciw złemu backendowi (dokładnie przed tym chroni strażnik).
5. `vercel.json` ma `"git": { "deploymentEnabled": false }`, więc integracja Vercela z GitHubem nie wdraża drugi raz. Zostaje tylko wdrożenie z Actions.

### 3. GitHub: środowisko `production` i sekrety

Utwórz środowisko `production` (Settings > Environments) i dodaj w nim cztery sekrety:

| Sekret              | Skąd                                    | Wartość                 |
| ------------------- | --------------------------------------- | ----------------------- |
| `CONVEX_DEPLOY_KEY` | Convex, Production deploy key           | `prod:<nazwa>\|<token>` |
| `VERCEL_TOKEN`      | Vercel, ustawienia konta, Tokens        | token                   |
| `VERCEL_ORG_ID`     | `.vercel/project.json` po `vercel link` | `orgId`                 |
| `VERCEL_PROJECT_ID` | `.vercel/project.json` po `vercel link` | `projectId`             |

Opcjonalnie dojdzie piąty, `SENTRY_AUTH_TOKEN`, oraz zmienne `SENTRY_ORG` i `SENTRY_PROJECT` (sekcja o Sentry niżej).

Sekrety dodane do środowiska widzi tylko job z `environment: production`, czyli `deploy`. Gdy ustawisz je na poziomie repozytorium, też zadziałają. Środowisko pozwala dodać reguły ochronne (np. zatwierdzenie wdrożenia), ale patrz ograniczenia planów niżej.

### 4. Pierwszy deploy

1. Scal PR do `main` albo uruchom workflow ręcznie: Actions > Deploy > Run workflow.
2. W logu jobu `deploy` sprawdź, że krok „Verify build targets the production Convex deployment” pokazał `Found <nazwa>.convex.cloud in build output`.
3. Otwórz adres z Vercela i sprawdź, że baner „Tryb offline” się **nie** pojawia. Jeśli się pojawia, front zbudował się bez `VITE_CONVEX_URL`.

## Plany darmowe: co działa, a co nie

Starter ma działać na darmowych planach. Trzeba znać ich granice, bo część zabezpieczeń z tego dokumentu ich wymaga:

- **Środowiska GitHuba i ochrona gałęzi** na planie Free są dostępne tylko w **publicznych** repozytoriach ([Environments](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-deployments/managing-environments-for-deployment), [Protected branches](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches)). W repozytorium prywatnym na Free `environment: production` nadal się wykona, ale nie dostaniesz reguł ochronnych, a sekrety środowiska mogą być niedostępne. W takim razie trzymaj sekrety na poziomie repozytorium.
- **Merge queue** wymaga repozytorium należącego do **organizacji** (na Free: publicznego) ([Managing a merge queue](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)). W repozytorium osobistym kolejki nie włączysz.
- **Vercel Hobby** jest przeznaczony do użytku niekomercyjnego i nie ma współpracy zespołowej ([Hobby plan](https://vercel.com/docs/plans/hobby)). Integracja Git na Hobby nie wdraża prywatnych repozytoriów organizacji. Dlatego wdrażamy przez CLI z Actions, a wdrożenia z Gita są wyłączone w `vercel.json`. **Wdrożenie przez CLI z repozytorium organizacji na Hobby nie zostało jeszcze zweryfikowane.** Jeśli Vercel je odrzuci, potrzebny będzie plan Pro albo repozytorium na koncie osobistym.

## Ochrona gałęzi `main`

Settings > Branches (albo Rulesets) > reguła dla `main`. Ustawienia dokładnie takie:

- wymagany PR (bez wymaganej liczby zatwierdzeń, bo zespół jest mały);
- wymagany check **`gate`**, i tylko on. `gate` zbiera wyniki `verify`, `secrets` i `hot-files`, a działa też na `merge_group`, więc kolejka go widzi;
- **wymagana merge queue**;
- scalanie wyłącznie przez **squash**;
- zakaz force push;
- reguła dla **dokładnej** nazwy `main`, bez wildcardu. Merge queue nie działa z regułą wzorcową ([dokumentacja](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue)).

Jeśli `gate` nie pojawia się na liście checków, workflow `ci.yml` musiał zadziałać co najmniej raz na PR. Check, który „wisi” jako Expected, zwykle oznacza literówkę w nazwie albo brak triggera `merge_group`.

Ograniczenia planów (wyżej) dotyczą także tej sekcji: bez publicznego repozytorium albo organizacji reguły ochronne i kolejka są niedostępne, a dyscyplinę trzeba utrzymać umową w zespole ([CONTRIBUTING.md](../CONTRIBUTING.md)).

## Podglądy Vercel (preview) są wyłączone

Przy `deploymentEnabled: false` żaden PR nie dostaje podglądu. Jeśli zespół ich potrzebuje:

1. W panelu Convex otwórz stronę _Settings_ **projektu** (nie deploymentu) i kliknij _Generate Preview Deploy Key_. W Vercel dodaj w _Environment Variables_ zmienną `CONVEX_DEPLOY_KEY` z tym kluczem i w polu _Environment_ odznacz wszystko poza _Preview_ ([Convex: Using Convex with Vercel](https://docs.convex.dev/production/hosting/vercel)). Klucz produkcyjny w Preview oznaczałby, że każdy PR wdraża na produkcyjny backend.
2. W Vercel (_Settings > Build & Development settings > Build Command_) ustaw komendę builda `npx convex deploy --cmd 'npm run build'`, żeby każdy podgląd dostał własny deployment Convex.
3. Usuń `"git": { "deploymentEnabled": false }` z `vercel.json`. Ten plik jest wspólny (hot file), więc zmiana idzie osobnym małym PR-em uzgodnionym z zespołem. Po tej zmianie Vercel zacznie też wdrażać `main` z Gita, drugi raz obok workflow, więc ustal, które z dwóch wdrożeń zostaje.

Nie ustawiaj `VITE_CONVEX_URL` w Vercelu także tutaj.

## Sentry (opcjonalnie)

Front ma wbudowaną, ale wyłączoną domyślnie obsługę Sentry (`@sentry/react`, kod w `src/lib/sentry.ts`). Bez `VITE_SENTRY_DSN` biblioteka nie jest nawet pobierana: ładuje się dynamicznym `import()` dopiero wtedy, gdy adres jest ustawiony, więc domyślna paczka się nie powiększa. Testy e2e i CI nie mają DSN-a: `.env.e2e` zeruje `VITE_SENTRY_DSN`, więc DSN z `.env.local` nie wysyła zdarzeń z lokalnych `npm run test:e2e` ani `npm run verify`.

### Włączenie we froncie

1. W Sentry utwórz projekt (platforma React) i skopiuj jego DSN.
2. `VITE_SENTRY_DSN`: wpisz DSN lokalnie w `.env.local` albo, dla produkcji, w zmiennych projektu Vercel (środowisko Production). To nie jest sekret, trafia do paczki frontu. Pusta wartość wyłącza Sentry.
3. Środowisko w Sentry to tryb Vite (`production` na Vercelu), a release to SHA commita: workflow `deploy.yml` ustawia `VITE_COMMIT_SHA` w kroku buildu.

### Mapy źródłowe (opcjonalnie)

Dzięki nim stack trace w Sentry pokazuje kod źródłowy zamiast zminifikowanego. Wtyczka `@sentry/vite-plugin` działa tylko wtedy, gdy podczas buildu jest ustawiony `SENTRY_AUTH_TOKEN`. Bez niego `vite.config.ts` zachowuje się dokładnie jak wcześniej.

| Nazwa               | Rodzaj          | Wartość                                           |
| ------------------- | --------------- | ------------------------------------------------- |
| `SENTRY_AUTH_TOKEN` | sekret GitHuba  | token organizacji z uprawnieniem do wgrywania map |
| `SENTRY_ORG`        | zmienna GitHuba | slug organizacji w Sentry                         |
| `SENTRY_PROJECT`    | zmienna GitHuba | slug projektu w Sentry                            |

Sekret dodajesz tam, gdzie pozostałe (sekcja 3), a zmienne w _Settings > Secrets and variables > Actions > Variables_. Token dostaje wyłącznie krok buildu w `deploy.yml`. Po wysłaniu pliki `*.map` są usuwane z `dist`, więc nie trafiają na Vercel i nikt ich nie pobierze z publicznego adresu.

Nieudane wgranie map (zły token, organizacja albo projekt) **nie przerywa deployu**: wtyczka tylko loguje błąd, a strona działa dalej, tyle że stack trace w Sentry będzie zminifikowany. Po pierwszym deployu poszukaj w logu kroku buildu linii `[sentry-vite-plugin]`.

### Co jest wycinane przed wysyłką

Sentry SDK 11 domyślnie zbiera prawie wszystko (dane użytkownika i jego adres IP, ciasteczka, nagłówki, ciała żądań i odpowiedzi, parametry zapytań, wejścia i wyjścia AI). Dlatego `initSentry` wyłącza każde z tych źródeł jawnie w opcji `dataCollection` (wysyłany jest tylko nagłówek `User-Agent`; test pilnuje całej listy), a dodatkowo hooki `beforeSend` i `beforeBreadcrumb` usuwają ze zdarzeń:

- ciała żądań i odpowiedzi oraz ciasteczka;
- wartości pod kluczami pasującymi do `prompt`, `apiKey`, `token`, `authorization`, `password`, `secret`, `cookie`, `credential`, do `ai` jako osobnego członu nazwy (`ai`, `aiResponse`, `AI_API_KEY`, `openAiKey`; `email` czy `detail` zostają) oraz klucze `messages`, `content`, `text`, `summary` i `note`;
- wartości takich parametrów w adresach URL i zapytaniach, również we fragmencie po `#`; w treści komunikatów (i w `Referer`) to samo dotyczy każdej pary `?klucz=wartość`, `&klucz=wartość`, `;klucz=wartość` i `#klucz=wartość`, także w adresach względnych (`/api/notes?token=...`), w `//host/...` i w gołych ciągach `a=1&apiKey=...`;
- w treści komunikatów dodatkowo: wszystko po `Bearer ` oraz reszta linii po `prompt:`, `token=`, `password:` i podobnych (`apiKey`, `authorization`, `secret`, `credential`, `cookie`);
- wszystkie breadcrumbs z konsoli, bo logi mogą zawierać prompty albo odpowiedzi modelu.

**Komunikaty błędów lecą do Sentry prawie tak, jak je rzucisz.** Filtr rozpoznaje tylko pary `klucz=wartość` z wrażliwym kluczem po `?`, `&`, `;` lub `#`, `Bearer <token>` i fragmenty typu `prompt: ...` lub `token=...` (resztę takiej linii zastępuje), a w błędach walidacji Convex ucina tekst od linii `Value:`, bo tam wraca odrzucona wartość. Komunikaty dłuższe niż 8192 znaki są ucinane przed filtrowaniem (ogon znika, nie jest wysyłany). Gołe słowa bez klucza (`Invalid token abc123`, cytowany prompt) zostają. Dowolnego tekstu użytkownika wstawionego do `throw new Error(...)` nie da się rozpoznać, więc nie wkładaj tam promptów ani treści notatek.

Zasady są pokryte testami w `src/lib/sentry.test.ts`. Jeśli dodajesz do zdarzeń własne dane (`Sentry.setContext` i podobne), trzymaj je pod kluczami, które filtr rozpoznaje, albo rozszerz wyrażenie w `sentry.ts`.

### Backend (Convex)

Backend nie wymaga zmian w kodzie. Convex ma własną integrację z Sentry, ale **tylko w planie Pro**: w panelu otwórz _Deployment Settings > Integrations_, wybierz kartę Sentry i podaj DSN osobnego projektu Sentry z platformą **Node.js**. Convex dodaje do zdarzeń tagi `func`, `func_type`, `func_runtime`, `request_id`, `server_name`, `environment` oraz `user` (`tokenIdentifier` zalogowanego użytkownika, gdy funkcja jest uwierzytelniona; starter nie ma jeszcze logowania, ale po jego dodaniu te dane trafią do Sentry) ([Convex: Exception reporting](https://docs.convex.dev/production/integrations/exception-reporting)). Filtr z frontu tu nie działa, więc w akcjach AI nie wkładaj promptów do komunikatów błędów.

## Kontenery i GHCR (później)

Starter nie używa Dockera: Vercel buduje front, a Convex hostuje backend. Gdyby później pojawiła się usługa wymagająca kontenera (np. własny serwer modelu albo worker), obraz dałoby się publikować w GitHub Container Registry. Wystarczy osobny workflow z uprawnieniem `packages: write`, logowaniem do `ghcr.io` tokenem `GITHUB_TOKEN` i krokiem `docker build` oraz `docker push`, uruchamiany po zielonym `verify`. Do tego czasu nic z tego nie jest potrzebne i niczego nie dodajemy na zapas.

## Zobacz też

- [troubleshooting.md](troubleshooting.md): typowe błędy.
- [ai-providers.md](ai-providers.md): zmienne Convex dla dostawców AI.
- [github-issues-workflow.md](github-issues-workflow.md): gałęzie, PR-y i kolejka scalania.
