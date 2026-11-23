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

**Objaw:** na górze strony widać „Tryb offline: backend Convex nie jest skonfigurowany”, a zapis notatek i podsumowanie są wyłączone.

**Przyczyna:** aplikacja nie ma `VITE_CONVEX_URL`, więc nie tworzy klienta Convex. To zamierzony tryb startowy, nie błąd: dzięki niemu starter działa bez konta, a smoke e2e nie potrzebuje sieci.

**Co zrobić:**

- Lokalnie: `npm run dev` (uruchamia `convex dev`, który zapisuje `CONVEX_DEPLOYMENT` i `VITE_CONVEX_URL` w `.env.local`). Bez konta: `CONVEX_AGENT_MODE=anonymous npx convex dev --once` albo ustawienie tej zmiennej przed `npm run dev`.
- Po wdrożeniu: baner na produkcji znaczy, że build powstał bez adresu Convex. Zajrzyj do [deployment.md](deployment.md) (strażnik w `deploy.yml` i zakaz ustawiania `VITE_CONVEX_URL` w Vercelu).
- Sprawdź, że `.env.local` nie ma pustego `VITE_CONVEX_URL=` po ręcznej edycji. Pusta wartość oznacza „offline”.

## `npx convex codegen` wymaga skonfigurowanego deploymentu

**Objaw:** po dodaniu pliku w `convex/` `npx convex codegen` pyta o logowanie albo kończy się błędem o braku deploymentu, a `npm run codegen:check` pokazuje różnicę w `convex/_generated/`.

**Przyczyna:** generowanie kodu Convex łączy się z deploymentem (typy zależą od schematu). Bez `CONVEX_DEPLOYMENT` w `.env.local` nie ma do czego się połączyć.

**Co zrobić:** skonfiguruj deployment (`npx convex dev --once`, lokalnie bez konta: `CONVEX_AGENT_MODE=anonymous npx convex dev --once`), potem `npx convex codegen` i `npm run codegen:check`. Wygenerowane pliki są w repozytorium, więc commituj je razem ze zmianą w `convex/`. Zmiany w `convex/` nie idą równolegle z innymi zmianami w tym katalogu (patrz [development-workflow.md](development-workflow.md)).

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
