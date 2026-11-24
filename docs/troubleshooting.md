# Rozwiązywanie problemów

Typowe awarie od instalacji po deploy. Każdy wpis: objaw, przyczyna, co zrobić.

## Antywirus lub proxy przechwytuje TLS

**Objaw:** `npm ci`, `npx convex dev` albo `npx playwright install` kończą się błędem w rodzaju `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`, `SELF_SIGNED_CERT_IN_CHAIN` albo `unable to verify the first certificate`.

**Przyczyna:** program antywirusowy lub firmowy proxy podmienia certyfikaty HTTPS własnym. Node.js nie ufa jego urzędowi certyfikacji, bo nie ma go na swojej liście.

**Co zrobić:** wyeksportuj certyfikat główny tego urzędu do pliku `.pem` i wskaż go Node'owi zmienną `NODE_EXTRA_CA_CERTS` ([dokumentacja Node.js](https://nodejs.org/api/cli.html#node_extra_ca_certsfile)). Zmienna **dodaje** certyfikaty do wbudowanych, niczego nie zastępuje.

PowerShell (tylko bieżąca sesja):

```powershell
$env:NODE_EXTRA_CA_CERTS = "C:\certs\antivirus-root.pem"
npm ci
```

macOS i Linux:

```bash
export NODE_EXTRA_CA_CERTS=/ścieżka/do/antivirus-root.pem
```

Jeśli plik nie istnieje albo nie da się go wczytać, Node nie przerywa pracy, tylko wypisuje ostrzeżenie w rodzaju `Warning: Ignoring extra certs from ..., load failed` i jedzie dalej bez dodatkowych certyfikatów. Błąd TLS wraca wtedy dokładnie ten sam, więc przy takim ostrzeżeniu sprawdź ścieżkę (bezwzględną, bez cudzysłowów w samej wartości).

Zmienna dotyczy procesów Node'a. Playwright pobiera przeglądarki własnym kodem w Node, więc ją respektuje; narzędzia spoza Node'a (np. `git`) mają własne ustawienia.

Nie wyłączaj weryfikacji TLS (`NODE_TLS_REJECT_UNAUTHORIZED=0`, `npm config set strict-ssl false`). To zdejmuje ochronę ze wszystkich połączeń, w tym tych z kluczami.

## PowerShell: `$env:X=''` usuwa zmienną

**Objaw:** po `$env:VITE_CONVEX_URL = ''` zmienna „znika”, a skrypt, który ją sprawdza, zachowuje się, jakby jej nigdy nie było.

**Przyczyna:** w PowerShellu przypisanie pustego ciągu do `$env:NAZWA` **usuwa** zmienną środowiskową, zamiast ustawić ją na pusty tekst. To dotyczy tylko powłoki; w pliku `.env` pusta wartość (`VITE_CONVEX_URL=`) jest normalna i znaczy „nieustawione”.

**Co zrobić:** żeby usunąć zmienną, napisz to wprost:

```powershell
Remove-Item Env:VITE_CONVEX_URL -ErrorAction SilentlyContinue
```

## Windows: ścieżki i końce linii

**Końce linii.** Repozytorium wymusza LF (`.gitattributes`: `* text=auto eol=lf`), a Prettier też zapisuje LF. Jeśli `npm run format:check` zgłasza prawie każdy plik, a edytor zapisuje CRLF:

1. Ustaw w edytorze LF dla tego repozytorium (VS Code: `"files.eol": "\n"`).
2. `git config core.autocrlf false` w tym repozytorium, żeby Git nie dokładał CRLF przy checkoutcie.
3. Napraw pliki: `npm run format`, potem `git status`, żeby zobaczyć, co się zmieniło.

Pliki mają być w UTF-8 bez BOM. Polecenia PowerShella `Set-Content` i `Out-File` w Windows PowerShell 5.1 mogą dodać BOM albo zapisać w stronie kodowej systemu; do zapisu plików używaj edytora.

**Ścieżki.** Skrypty w `scripts/` to Node (`.mjs`) i działają na Windowsie, macOS i Linuksie. Trzy typowe pułapki:

- Bardzo długa ścieżka (pod `node_modules`) przekracza 260 znaków: sklonuj repozytorium blisko korzenia dysku (`C:\src\...`) albo włącz długie ścieżki w Windows i Gicie (`git config --global core.longpaths true`).
- W komendach używaj ukośników `/` albo cudzysłowów wokół ścieżek ze spacjami.
- Zapis `VAR=wartość komenda` działa tylko w Bashu. W PowerShellu: `$env:VAR = "wartość"; komenda`.

## Zajęte porty

**Objaw:** `Error: Port 5173 is already in use` przy `npm run dev` albo `npm run dev:frontend`, a w CI `npm run test:e2e` zgłasza taki sam błąd dla portu podglądu (4173). Lokalnie jest inaczej: Playwright ma `reuseExistingServer: !isCI`, więc jeśli coś już słucha na porcie podglądu, test **użyje tego procesu** zamiast budować własny. Gdy to stary albo cudzy serwer, smoke test sprawdzi nie tę aplikację, co trzeba. Przy dziwnych wynikach e2e zatrzymaj proces na porcie 4173 i uruchom test jeszcze raz.

**Przyczyna:** Vite ma `strictPort: true`, więc zamiast po cichu wybrać następny wolny port, kończy się błędem. Dzięki temu adres, który wpisujesz w przeglądarkę albo który zna test e2e, zawsze jest właściwy. Port zajmuje zwykle drugi `npm run dev` (inna ścieżka robocza, inny agent) albo zapomniany proces.

**Co zrobić:**

- Znajdź proces. PowerShell: `Get-NetTCPConnection -LocalPort 5173 | Select-Object OwningProcess`, potem `Stop-Process -Id <PID>`. macOS i Linux: `lsof -i :5173`.
- Albo zmień porty dla tego katalogu w `.env.local`:

  ```
  PORT=5180
  PREVIEW_PORT=4180
  ```

  `PORT` to serwer deweloperski, `PREVIEW_PORT` podgląd, na którym działa e2e. Zmienna z powłoki ma pierwszeństwo przed `.env.local`. Ścieżki tworzone przez `npm run lane:new` dostają własne porty automatycznie.

## Baner „Tryb offline”: Convex nie jest skonfigurowany

**Objaw:** na górze strony widać „Tryb offline: backend Convex nie jest skonfigurowany”, a funkcje, które potrzebują backendu, nie działają.

**Przyczyna:** aplikacja nie ma `VITE_CONVEX_URL`, więc nie tworzy klienta Convex. To zamierzony tryb startowy, nie błąd: dzięki niemu starter działa bez konta, a smoke e2e nie potrzebuje sieci.

**Co zrobić:**

- Lokalnie: `npm run dev` (uruchamia `convex dev`, który zapisuje `CONVEX_DEPLOYMENT` i `VITE_CONVEX_URL` w `.env.local`). Bez konta: dopisz do `.env.local` linię `CONVEX_AGENT_MODE=anonymous` i uruchom `npx convex dev --once` (przepis w [README](../README.md#lokalny-backend-convex)). Zostaw tę linię w pliku: zmienna ustawiona tylko w powłoce znika, a wtedy `npm run dev` z zalogowanym CLI proponuje podlinkowanie deploymentu do chmury z domyślną odpowiedzią „tak”.
- Po wdrożeniu: baner na produkcji znaczy, że build powstał bez adresu Convex. Zajrzyj do [deployment.md](deployment.md) (strażnik w `deploy.yml` i zakaz ustawiania `VITE_CONVEX_URL` w Vercelu).
- Sprawdź, że `.env.local` nie ma pustego `VITE_CONVEX_URL=` po ręcznej edycji. Pusta wartość oznacza „offline”.

## `npx convex codegen` wymaga skonfigurowanego deploymentu

**Objaw:** po dodaniu pliku w `convex/` `npx convex codegen` pyta o logowanie albo kończy się błędem o braku deploymentu, a `npm run codegen:check` pokazuje różnicę w `convex/_generated/`.

**Przyczyna:** generowanie kodu Convex łączy się z deploymentem (typy zależą od schematu). Bez `CONVEX_DEPLOYMENT` w `.env.local` nie ma do czego się połączyć.

**Co zrobić:** skonfiguruj deployment (`npx convex dev --once`; lokalnie bez konta najpierw dopisz do `.env.local` linię `CONVEX_AGENT_MODE=anonymous`, patrz [README](../README.md#lokalny-backend-convex)), potem `npx convex codegen` i `npm run codegen:check`. Wygenerowane pliki są w repozytorium, więc commituj je razem ze zmianą w `convex/`. Zmiany w `convex/` nie idą równolegle z innymi zmianami w tym katalogu (patrz [development-workflow.md](development-workflow.md)).

## `lane:new --local`: „Cannot create a deployment in anonymous mode”

**Objaw:** `npm run lane:new -- <osoba> <nr-issue> <slug> --local` tworzy worktree i robi `npm ci`, a potem kończy się błędem ``Cannot create a deployment in anonymous mode. Run `npx convex login` and configure a project first.``, a skrypt dodaje ``… deployment create local --select` failed (exit 1).``

**Przyczyna:** starsza wersja skryptu tworzyła deployment lokalny komendą `npx convex deployment create local`, a CLI Convex 1.50 odrzuca ją w trybie anonimowym (`CONVEX_AGENT_MODE=anonymous`).

**Co zrobić:**

- Zaktualizuj gałąź: obecny `lane:new --local` używa `npx convex dev --once` i nie wymaga `npx convex login`.
- Worktree z nieudanej próby już istnieje, więc ponowne `lane:new` zgłosi, że katalog istnieje. Najprościej go usunąć (`npm run lane:rm -- <nr-issue>-<slug> --force`, potem `git branch -D feat/<nr-issue>-<slug>`) i uruchomić `lane:new` jeszcze raz: skrypt sam pilnuje, żeby deployment powstał lokalnie, pod własną nazwą i na własnych portach.
- Jeśli wolisz dokończyć go ręcznie:
  1. Sprawdź, że w powłoce nie jest ustawiona żadna z `CONVEX_DEPLOYMENT`, `CONVEX_DEPLOY_KEY`, `CONVEX_DEPLOYMENT_TOKEN`, `CONVEX_SELF_HOSTED_URL`, `CONVEX_SELF_HOSTED_ADMIN_KEY`, `CONVEX_AGENT_MODE` ani `CONVEX_ALLOW_ANONYMOUS=false`. Inaczej CLI użyje wskazanego w nich deploymentu, także w chmurze, albo (przy `CONVEX_AGENT_MODE=anonymous`) nazwie deployment `anonymous-agent`, jak w każdej innej ścieżce. Skrypt nie zapisuje `CONVEX_AGENT_MODE` w `.env.local` nieudanej ścieżki, więc nie dopisuj tej linii przed krokiem 4.
  2. Odczytaj numer ścieżki N z `npm run lane:list`. Obecny skrypt zapisuje `PORT` i `PREVIEW_PORT` od razu po utworzeniu worktree, więc ścieżka ma już w tabeli `PORT` = `5173 + N`. Jeśli w kolumnie `PORT` jest `-` (starsza wersja skryptu), wybierz N, którego nie używa żadna ścieżka. Porty Convex to `3210 + 2N` i `3211 + 2N`.
  3. W katalogu ścieżki uruchom `npm ci`, jeśli to on się nie udał. Potem uruchom CLI z wejściem, które nie jest terminalem (wtedy wybiera tryb anonimowy, nawet gdy jest zalogowane, i nie zadaje pytań). Bash: `npx convex dev --once --local-cloud-port <3210+2N> --local-site-port <3211+2N> < /dev/null`. PowerShell: `cmd /c "npx convex dev --once --local-cloud-port <3210+2N> --local-site-port <3211+2N> < NUL"`.
  4. Dopisz do `.env.local` linię `CONVEX_AGENT_MODE=anonymous`, a jeśli w kroku 2 kolumna `PORT` miała `-`, także `PORT=<5173+N>` i `PREVIEW_PORT=<4173+N>`. Bez `CONVEX_AGENT_MODE` `npm run dev` z zalogowanym CLI zaproponuje podlinkowanie ścieżki do chmury z domyślną odpowiedzią „tak” (patrz [development-workflow.md](development-workflow.md)).
  5. Sprawdź wynik w `npm run lane:list`: ścieżka ma mieć swoje porty i `anonymous:anonymous-<katalog worktree>`.
- Nie loguj się do Convex tylko po to, żeby obejść ten błąd: deployment lokalny nie potrzebuje konta.

## Dwie ścieżki `--local` walczą o backend Convex

**Objaw:** `npm run dev` w ścieżce lokalnej kończy się błędem `A local backend is still running on port 3210. Please stop it and run this command again.`, albo ścieżka nagle łączy się z backendem na innym porcie niż wcześniej (kolumna `CONVEX PORTS` w `npm run lane:list` się zmieniła).

**Przyczyna:**

- Ścieżki utworzone przed wprowadzeniem osobnych portów mają deployment `anonymous:anonymous-agent` na porcie `3210`. Dwie takie ścieżki mają tę samą nazwę i ten sam port, więc druga uznaje backend pierwszej za swój, czeka 5 sekund i się poddaje.
- CLI przy `npm run dev` próbuje najpierw portów zapisanych w `.convex/local/default/config.json`. Jeśli któryś jest zajęty (inny program, zapomniany backend), CLI bez ostrzeżenia bierze pierwszy wolny port od `3210` i zapisuje go jako nowy port ścieżki. Może to być port przydzielony innej, akurat zatrzymanej ścieżce.

**Co zrobić:**

- Starą ścieżkę `anonymous-agent` usuń i utwórz od nowa: wypchnij albo zapisz zmiany, potem `npm run lane:rm -- <nr-issue>-<slug> --force`, `git branch -D feat/<nr-issue>-<slug>` i `npm run lane:new -- … --local`. Dane lokalnego deploymentu przepadają razem z worktree.
- Gdy port się przesunął, zatrzymaj proces na porcie ścieżki (`Get-NetTCPConnection -LocalPort <port> | Select-Object OwningProcess`, macOS i Linux: `lsof -i :<port>`) i przywróć jej porty jednorazowo: w katalogu ścieżki `npx convex dev --once --local-cloud-port <API> --local-site-port <site>` z portami ścieżki (`3210 + 2N`, `3211 + 2N`). CLI zapisze je znowu w `config.json` i `.env.local`.

## `lane:new --local`: „…anonymous-convex-backend-state… exists”

**Objaw:** `npm run lane:new -- … --local` kończy się od razu, jeszcze przed `git worktree add`, komunikatem `<katalog domowy>/.convex/anonymous-convex-backend-state/anonymous-<katalog worktree> exists, and the Convex CLI would reuse that old deployment for this lane.`

**Przyczyna:** starsze wersje CLI Convex trzymały deploymenty anonimowe w katalogu domowym. CLI 1.50 nadal woli taki katalog, jeśli ma tę samą nazwę co nowy deployment, a w worktree nie ma jeszcze `.convex/local/default/config.json`. Ścieżka korzystałaby wtedy ze starych danych spoza worktree, a `lane:rm` by ich nie usunęło.

**Co zrobić:** jeśli stare dane nie są potrzebne, przenieś albo usuń wskazany katalog i uruchom `lane:new` jeszcze raz. Możesz też wybrać inny slug.

## Playwright: brakuje przeglądarek

**Objaw:** `npm run test:e2e` (a więc też `npm run verify`) kończy się błędem `Executable doesn't exist at ...` z podpowiedzią `npx playwright install`.

**Przyczyna:** `npm ci` instaluje bibliotekę Playwright, ale nie pobiera przeglądarki Chromium.

**Co zrobić:**

```bash
npx playwright install chromium
```

Na Linuksie (też w kontenerze) dodaj `--with-deps`, żeby doinstalować pakiety systemowe. Za antywirusem przechwytującym TLS pobieranie może się nie udać: zajrzyj wyżej do `NODE_EXTRA_CA_CERTS`.

## `VITE_CONVEX_URL` wyeksportowane w powłoce psuje `test:e2e`

**Objaw:** `npm run test:e2e` od razu kończy się komunikatem „VITE_CONVEX_URL is set in your shell; shell variables beat .env.e2e…”.

**Przyczyna:** zmienne z powłoki wygrywają z plikami `.env*`. Smoke e2e musi działać w trybie offline (`.env.e2e` zeruje adres), a ustawiona zmienna uruchomiłaby go z prawdziwym backendem. Konfiguracja Playwrighta przerywa świadomie.

**Co zrobić:** usuń zmienną z sesji.

```powershell
Remove-Item Env:VITE_CONVEX_URL -ErrorAction SilentlyContinue
```

```bash
unset VITE_CONVEX_URL
```

Sama obecność `VITE_CONVEX_URL` w `.env.local` nie przeszkadza: e2e buduje front we własnym trybie (`--mode e2e`), gdzie `.env.e2e` ma pierwszeństwo. Nie eksportuj tej zmiennej na stałe (profil PowerShella, `.bashrc`, zmienne systemowe).

## `engine-strict` i zła wersja Node'a

**Objaw:** `npm ci` kończy się błędem `EBADENGINE` albo „Unsupported engine”, np. `Required: {"node":">=24.15.0 <25"}`.

**Przyczyna:** repozytorium wymaga Node 24 (`.nvmrc`, pole `engines`), a `.npmrc` ma `engine-strict=true`, więc npm odmawia instalacji na innej wersji zamiast ostrzegać.

**Co zrobić:** przełącz wersję menedżerem i sprawdź.

```bash
nvm install 24 && nvm use 24     # nvm (macOS, Linux)
fnm use 24                       # fnm (także Windows)
node -v                          # v24.x
```

Nie wyłączaj `engine-strict` ani nie instaluj z `--engine-strict=false`: różne wersje Node'a to źródło trudnych do znalezienia różnic między laptopami a CI. Jeśli `fnm use` nic nie zmienia w nowej karcie terminala, upewnij się, że menedżer jest zainicjowany w profilu powłoki (`fnm env --use-on-cd`).

## npm 11: komunikat o `allowScripts` i esbuild

**Objaw:** podczas `npm ci` npm 11 wypisuje uwagę, że skrypty instalacyjne pakietu (zwykle `esbuild`) nie zostały uruchomione i trzeba je dopuścić przez `allowScripts`.

**Przyczyna:** prawdopodobnie nowsze wersje npm nie uruchamiają domyślnie skryptów instalacyjnych zależności. Dokładne brzmienie komunikatu i zachowanie zależy od wersji npm; nie opieramy się tu na dokumentacji, tylko na obserwacji przy instalacji.

**Co zrobić:** zwykle nic. W tym repozytorium komunikat nie blokował buildu, testów ani e2e. Nie dopisuj `allowScripts` ani nie zmieniaj `.npmrc` z powodu tej uwagi (`.npmrc` jest wspólnym plikiem).

## Deploy: „Deploy skipped”

**Objaw:** workflow `Deploy` jest zielony, ale na Vercelu nic się nie zmieniło, a w podsumowaniu jobu jest „Deploy skipped”.

**Przyczyna:** brakuje któregoś z czterech sekretów (`CONVEX_DEPLOY_KEY`, `VERCEL_TOKEN`, `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`). Lista brakujących jest w podsumowaniu. Uzupełnij je według [deployment.md](deployment.md).

## Deploy: strażnik nie znalazł adresu Convex

**Objaw:** krok „Verify build targets the production Convex deployment” kończy się błędem `<nazwa>.convex.cloud not found in .vercel/output/static`.

**Przyczyna:** build nie dostał adresu produkcyjnego deploymentu. Najczęściej `CONVEX_DEPLOY_KEY` nie jest kluczem produkcyjnym (`prod:...`) albo `VITE_CONVEX_URL` jest ustawione w projekcie Vercel i przykrywa wartość z `convex deploy`. Usuń tę zmienną w Vercelu i użyj klucza produkcyjnego.

## Gdy nic z tego nie pomaga

Zbierz: wersję Node'a (`node -v`), system, dokładny tekst błędu i komendę, która go wywołała. Dopisz je do issue (szablon „bug report”), zanim ktoś zacznie zgadywać.
