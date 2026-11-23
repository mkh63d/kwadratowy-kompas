# Kwadrat Kreatywny: plan przebudowy (landing + Kompas)

Status: szkic v5, 2026-11-24. Każda fala przed kodem przechodzi przez spec (`/spec-driven-development`).
Raporty: [`research/deploy-koszty.md`](research/deploy-koszty.md) · [`research/discord-integracja.md`](research/discord-integracja.md) · [`research/convex-vs-supabase.md`](research/convex-vs-supabase.md) · [`research/hackathon-template.md`](research/hackathon-template.md)

## Decyzje podjęte

| Temat                  | Decyzja                                                                                                                                                                                                                                                          |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Repozytoria            | **Kompas = nowe repo z szablonu [Orfeliny/Hackathon-template](https://github.com/Orfeliny/Hackathon-template)** (Vite + React + Convex + Vercel). **Landing zostaje w `Kwadrat-strona`**. Ta decyzja zastępuje wcześniejszy pomysł na monorepo                   |
| Licencja               | **AGPL-3.0**, z zachowaną notą MIT dla kodu z szablonu. Znaki towarowe i logotypy partnerów są wyłączone z licencji                                                                                                                                              |
| Backend                | **Convex** (region UE, Irlandia): baza, logowanie, funkcje, crony, scrapery, ingest, wysyłka na Discord                                                                                                                                                          |
| Frontend               | Vite + React (z szablonu) na **Vercelu**. Funkcje Vercela dla `/mcp` i podglądów linków (OG). Vercel Pro w tym miesiącu, potem Hobby (do stycznia Kompas jest niekomercyjny)                                                                                     |
| wa-worker              | **Na początek na Twoim PC** (jak dziś relay). Mikrus później, jeśli PC okaże się zawodny                                                                                                                                                                         |
| Model AI               | **Dowolny, nie musi być Claude.** Warstwa AI z szablonu przyjmuje każdy endpoint zgodny z OpenAI (`AI_BASE_URL`, `AI_MODEL`), a odpowiedź zawsze sprawdza schemat Zod. Model wybieramy po teście na zestawie 0.3                                                 |
| Logowanie              | **E-mail + hasło** jako podstawowe. Discord jako **dodatkowa** opcja (podpięcie konta)                                                                                                                                                                           |
| Moderacja              | Moderatorzy Kwadratu (lista poza repo)                                                                                                                                                                                                                           |
| Klucze                 | Co najmniej dwie osoby z dostępem do wszystkich kont (lista poza repo), wspólny menedżer haseł dla organizacji                                                                                                                                                   |
| Discord                | **Bot REST-only.** Wszystkie kanały (`ogloszenia`, `dofinansowania-i-konkursy`, `szkolenia-i-warsztaty`, `eventy-branzowe`, `newsy`) **są i zostają ogłoszeniowe**                                                                                               |
| StartupywPolsce.pl     | Porozumienie: **promocja w zamian za treści**. Każdy ich wpis ma link do ich społeczności. Moderujemy my. Ich treści **nie wychodzą poza nasze kanały**: bot nigdy ich nie publikuje dalej (crosspost). News przerobiony na wpis o grancie, z atrybucją, jest OK |
| Sponsorzy              | Funkcja na później. Od stycznia (prawdopodobnie) Kwadrat jest formalną organizacją i wtedy rusza plan dla sponsorów                                                                                                                                              |
| Materiały sponsorowane | Każdy oznaczony **tak samo**: „Sponsorowane” (strona, Discord, MCP). Pole `sponsored` w modelu od początku, publikacja dopiero po formalizacji                                                                                                                   |
| Płatne szkolenia       | Nie dodajemy, chyba że są sponsorowane (wtedy z oznaczeniem)                                                                                                                                                                                                     |
| Przełączniki           | Każdy krok przepływu (scraping per źródło, AI, Discord globalnie i per kanał, sponsoring, StartupywPolsce.pl, …) da się wyłączyć z panelu admina (§4.11)                                                                                                         |

---

## 1. Podział

|           | Landing                                                 | Kompas                                                                                |
| --------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Repo      | `Kwadrat-strona` (to repo)                              | nowe repo z szablonu                                                                  |
| Domena    | `kwadratkreatywny.pl` (+ `www`)                         | `app.kwadratkreatywny.pl`                                                             |
| Cel       | Społeczność, nasze spotkania, „dołącz”                  | Co się dzieje w Łodzi: dofinansowania, konkursy, hackathony, szkolenia, eventy, newsy |
| Charakter | Statyczny, przeniesiony na Vercel bez przepisywania     | Aplikacja: Convex + Vite/React                                                        |
| Dane      | Widget „najbliższe spotkania” z publicznego API Kompasu | Źródło prawdy dla wpisów                                                              |

---

## 2. Architektura

```
 [grupa WhatsApp StartupywPolsce.pl] -> wa-worker (Twój PC) ---+
 [formularz „zgłoś wpis”]  ------------------------------------+--> Convex HTTP action /ingest (token)
 [scrapery: Convex cron + action] -----------------------------+         |
                                                                         v
                                        rawItems -> ekstrakcja AI (action, model z env)
                                                                         v
                                        entries (pending) -> kolejka moderacji (na żywo w panelu)
                                                                         |
                                                        publikacja / wyróżnienie (mutacja)
                                                                         |
                          +----------------------+-----------------------+---------------------+
                          v                      v                       v                     v
                   Kompas (Vite/React)    widget na landingu     zaplanowana wysyłka     /api/mcp (funkcja
                   + /api/og (podglądy)                          na Discord (bot)        Vercela, czyta z Convexa)
```

- **Jedno wejście** (`/ingest`) dla WhatsAppa, scraperów i formularza.
- **Wysyłka na Discord jest planowana w tej samej mutacji co publikacja.** Zaplanowanie funkcji w Convexie jest częścią transakcji. Tabela `discordOutbox` służy tylko do pokazania stanu i historii prób w panelu.
- **Crony Convexa:** ponowienia wysyłek, przypomnienia o terminach, wygaszanie `featuredUntil`, scrapery, archiwizacja po terminie.
- **Uprawnienia w kodzie:** każda funkcja publiczna jest opakowana w `publicQuery` / `userMutation` / `moderatorMutation` / `adminMutation`. Funkcja bez opakowania nie przechodzi przez CI.
- **Przełączniki:** każdy krok sprawdza `isEnabled(key)` w miejscu wykonania (§4.11).

### Hosting i koszty

| Element                                            | Gdzie                                                                             | Koszt/mies.                                                                  |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Frontend Kompasu, `/api/mcp`, `/api/og`            | Vercel                                                                            | Pro 20 USD teraz, potem Hobby 0 USD do czasu sponsorów                       |
| Landing                                            | Vercel (osobny projekt)                                                           | 0                                                                            |
| Backend, baza, logowanie, crony, scrapery, Discord | Convex Free, potem **Convex for Open Source** (darmowy Pro z dziennymi backupami) | 0 USD                                                                        |
| wa-worker                                          | Twój PC                                                                           | 0 zł                                                                         |
| E-maile (weryfikacja konta, reset hasła)           | dostawca e-mail, np. Resend (darmowy próg do sprawdzenia)                         | 0 na start                                                                   |
| Model AI                                           | zależnie od wyboru (0.10)                                                         | dla skali: Claude Sonnet 5.5 ≈ 5 USD przy 10 wpisach/dzień, ≈ 27 USD przy 50 |

W Vercel Pro trzeba od razu włączyć **Spend Management** (limit wydatków). Przy sponsorach (styczeń i później) wracamy do decyzji Pro vs przeniesienie.

### Struktura repo Kompasu (według szablonu)

```
src/features/<nazwa>/feature.tsx       funkcja we froncie (sama rejestruje trasę)
convex/<nazwa>/{tables,queries,mutations,actions}.ts
convex/lib/                            opakowania uprawnień, isEnabled(), wspólne helpery   [plik wspólny]
convex/ai/                             warstwa AI z szablonu (mock + OpenAI-compatible)      [plik wspólny]
convex/scrapers/sources/<id>.ts        jeden plik = jedno źródło
convex/http.ts, convex/auth.ts         trasy HTTP (ingest), Convex Auth                     [plik wspólny]
api/mcp.ts, api/og.ts                  funkcje Vercela
workers/whatsapp/                      wa-worker (własny package.json, poza buildem Vite, uruchamiany na PC)
```

Funkcje (features): `entries`, `ingest`, `extraction`, `moderation`, `discord`, `sources`, `programs`, `reviews`, `guide` („Co dalej?”), `switches`, `seo`.

---

## 3. Model danych (tabele Convex, szkic)

- **entries**:
  - typ (`dofinansowanie`, `konkurs`, `hackathon`, `szkolenie`, `event`, `news`, `ogloszenie`)
  - treść: tytuł, streszczenie, treść, organizator, miejsce/online, link, tagi, etap projektu, kwota
  - terminy: `startsAt`/`endsAt`, `deadline`
  - publikacja: `status` (`pending`/`published`/`rejected`/`archived`), `featuredUntil`, **`sponsored`**
  - pochodzenie: `source`, `sourceRef`, **`attribution`**, `programId?`
  - Discord: `discordChannelOverride?`, `discordPing`
- **rawItems**: surowa treść, identyfikator źródła, stan (`waiting_ai`, `processed`, `manual`).
- **sources**: rejestr źródeł z polem `enabled`, ostatnim uruchomieniem i liczbą pozycji. Flaga `noCrosspost` (true dla StartupywPolsce.pl).
- **programs**: inkubatory, akceleratory, hackathony, programy mentorskie. Liczniki do rankingu.
- **reviews / likes**.
- **discordRoutes**: typ/tag → `channelId`, rola do pingu, polityka pingów, `crosspost` (bool).
- **discordPosts**: wpis → `channelId`, `messageId`, `threadId?`, hash treści, pin, przypomnienie.
- **discordOutbox**: stan prób (`pending`/`paused`/`sent`/`failed`/`needs_review`), widoczny w panelu.
- **switches** + **switchLog**: przełączniki i historia zmian.
- **users** (Convex Auth) + **profiles**: rola (`admin`, `moderator`, `user`), opcjonalnie podpięte konto Discord.

Zgodnie z regułą szablonu zmiany schematu są **tylko dodające** (nowe tabele, nowe pola opcjonalne).

---

## 4. Funkcje

### 4.1 Lista i wpisy

Filtry (typ, termin, etap, tagi, wyróżnione), kalendarz eventów, strona wpisu `/w/<slug>`, sekcja **Newsy**, RSS/iCal. Wpisy sponsorowane z widocznym oznaczeniem.

### 4.2 Panel admina

- Kolejka moderacji odświeżana na żywo: surowa treść obok pól od AI.
- Ręczne dodawanie i edycja, archiwizacja, scalanie duplikatów.
- Wyróżnianie, znacznik „sponsorowane”.
- Stan wysyłek na Discorda z przyciskiem „ponów”, stan źródeł, ekran **Przełączniki** (§4.11).

### 4.3 Discord

**Mechanizm:** bot przez REST API, jeden sekret (`DISCORD_BOT_TOKEN`), wywoływany z akcji Convexa. Slash commands później przez HTTP Interactions. Stary webhook relaya zostaje na `#surowe-ogloszenia` do wyłączenia relaya.

**Kanały** (wszystkie ogłoszeniowe, jak dziś):

| Kanał                       | Co trafia                                              | Publikacja dalej (crosspost)            |
| --------------------------- | ------------------------------------------------------ | --------------------------------------- |
| `ogloszenia`                | Wewnętrzne ogłoszenia, tylko ręcznie (bot bez dostępu) | ręcznie, decyzja admina                 |
| `dofinansowania-i-konkursy` | Dofinansowania publiczne, konkursy, hackathony         | tak, przełącznik per kanał              |
| `szkolenia-i-warsztaty`     | Darmowe lub refundowane (płatne tylko sponsorowane)    | tak, przełącznik per kanał              |
| `eventy-branzowe`           | Wszystkie eventy okołostartupowe                       | tak, przełącznik per kanał              |
| `newsy`                     | Newsy, głównie z grupy StartupywPolsce.pl              | **nigdy** dla treści StartupywPolsce.pl |

Na kanale ogłoszeniowym wiadomość trafia do serwerów obserwujących dopiero po opublikowaniu dalej (crosspost). Jeśli bot jej nie opublikuje, zostaje u nas. Na tym opiera się ochrona treści StartupywPolsce.pl: `sources.noCrosspost` blokuje crosspost bez względu na kanał. Uwaga: każdy z uprawnieniami może ręcznie kliknąć „Publish” w Discordzie, więc moderatorzy muszą znać tę zasadę.

Kanały ogłoszeniowe nie mają tagów jak forum, więc status „zamknięte” pokazujemy edycją wiadomości. Dyskusja może się toczyć w wątku pod wiadomością (opcjonalnie, decyzja przy specu).

**Routing:** jeden wpis trafia na jeden kanał.

- Hackathon → konkursy.
- Warsztat na konferencji → szkolenia, jeśli darmowy lub dofinansowany; inaczej eventy.
- News o grancie → zmiana typu, atrybucja i `noCrosspost` zostają.
- Typ bez przypisanego kanału → brak wysyłki i ostrzeżenie w panelu.

**Cykl życia:**

| Zdarzenie                             | Na Discordzie                                                                                                                                                                                                                  |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Publikacja                            | Wiadomość z `nonce` (ochrona przed podwójnym postem), potem crosspost, jeśli dozwolony. Crosspost to osobna akcja w kolejce: limit publikacji na kanał jest niezweryfikowany (~10/h), a porażka crosspostu nie cofa publikacji |
| Edycja                                | Edycja tej samej wiadomości (kopie u obserwujących mogą się nie zaktualizować)                                                                                                                                                 |
| Wyróżnienie                           | Pin + ⭐; unpin po terminie                                                                                                                                                                                                    |
| Termin za 3 dni                       | Odpowiedź do oryginału, raz na wpis, bez crosspostu                                                                                                                                                                            |
| Archiwizacja / odwołanie              | Edycja na „[NIEAKTUALNE]”, szary kolor                                                                                                                                                                                         |
| Wycofanie (błąd, spam, prośba prawna) | Usunięcie wiadomości                                                                                                                                                                                                           |

**Powiadomienia i format:**

- Domyślnie bez pingów. Role opt-in `@dofinansowania`, `@eventy`, `@szkolenia`.
- Jeden embed na wpis: tytuł prowadzi do Kompasu, daty jako `<t:…>`.
- Wpisy sponsorowane z oznaczeniem.
- Wpisy StartupywPolsce.pl z linkiem do ich społeczności i linijką promocyjną.

Checklista konfiguracji serwera: raport B („Admin setup checklist”). Pozycje o zmianie typów kanałów pomijamy, bo wszystkie kanały są już ogłoszeniowe.

### 4.4 WhatsApp (z `whatsapp-discord-relay` → `workers/whatsapp/`)

1. Wysyłka do `/ingest` (HTTP action Convexa) zamiast webhooka Discorda.
2. Tylko nowe wiadomości (`type` w `messages.upsert`) + deduplikacja po id.
3. Imiona i numery nadawców usuwane **przed** wysyłką (RODO).
4. `auth_info/` i `config.json` poza repo; zamiast nich `.env` i `.env.example`.
5. Atrybucja i link do społeczności StartupywPolsce.pl przy każdym wpisie.
6. Na Twoim PC: autostart po restarcie i runbook (instrukcja krok po kroku) „ponowne parowanie przez kod QR”.

### 4.5 Scrapery

Akcje Convexa uruchamiane cronem, jeden plik na źródło (`convex/scrapers/sources/<id>.ts`), wspólny interfejs `fetch() → RawItem[]`. Najpierw RSS/API/iCal, `robots.txt`, HTML czyszczony do tekstu przed AI, alert przy „0 pozycji przez X dni”.

### 4.6 Ekstrakcja AI

- **Warstwa AI z szablonu bez zmian:** `AI_PROVIDER=openai-compatible`, `AI_BASE_URL`, `AI_MODEL`, `AI_STRUCTURED_MODE` (`json_schema` → `json_object` → `prompt`). Odpowiedź zawsze sprawdza schemat Zod, a w testach działa `mock` (bez sieci i bez kosztów).
- **Wybór modelu (0.10):** krótka lista kandydatów, ocena na zestawie 0.3. Kryteria: trafność pól, koszt na wpis, miejsce przetwarzania danych (UE mile widziane) i obsługa `json_schema`. Kandydaci:
  - polskie modele (Bielik, PLLuM) przez hostowany endpoint,
  - modele komercyjne przez bramę zgodną z OpenAI (w tym Claude, którego używaliście dotąd),
  - ewentualnie AI Gateway Convexa.
- Pola `is_relevant` i `confidence`. Tani filtr przed AI („dzięki!”, emoji, bardzo krótkie wiadomości).
- Błąd lub nieprawidłowa odpowiedź modelu → wpis w kolejce jako „do ręcznego opisania”.
- Prompt injection: model nie ma narzędzi, a publikuje człowiek.

### 4.7 Logowanie

- **E-mail + hasło** (Convex Auth, provider Password) z weryfikacją adresu i resetem hasła. Wysyłka z `kwadratkreatywny.pl` wymaga rekordów DNS (SPF/DKIM).
- **Discord jako dodatek** (podpięcie konta). Convex Auth nie wspiera Discorda oficjalnie, więc przed wdrożeniem krótki eksperyment (4.7 w falach).

### 4.8 Serwer MCP

`app.kwadratkreatywny.pl/api/mcp`: funkcja Vercela w trybie bezstanowym, czyta z Convexa. Read-only:

- `search_opportunities`, `get_opportunity`, `upcoming_events`
- później `match_project`, `next_step`, `program_reviews`

Wpisy sponsorowane mają w odpowiedzi pole `sponsored: true`. MCP ma własny przełącznik.

### 4.9 „Co dalej?”

Drzewo decyzji bez AI: etap → czego brakuje → ścieżka + programy z katalogu + najbliższe wpisy. Reguły edytowalne przez admina.

### 4.10 Ranking programów

Opinie (1–5 + tekst) i polubienia dla zalogowanych, jedna opinia na program, średnia bayesowska z liczników, moderacja, prawo do odpowiedzi, regulamin.

### 4.11 Przełączniki kroków w panelu admina

Admin może wyłączyć każdy krok przepływu bez wdrażania kodu. Działa to natychmiast. Zmieniać może tylko rola `admin`, a każda zmiana trafia do historii (kto, kiedy, opcjonalny powód).

| Przełącznik                                                          | Zakres                                             | Gdy wyłączony                                                               | Po ponownym włączeniu                                                                    |
| -------------------------------------------------------------------- | -------------------------------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Scraping                                                             | globalnie + **każde źródło osobno**                | Cron pomija źródło                                                          | Następne uruchomienie pobiera aktualny stan; deduplikacja odsiewa powtórki               |
| StartupywPolsce.pl: przyjmowanie                                     | źródło WhatsApp                                    | `/ingest` odrzuca ich wiadomości, nic nie jest zapisywane                   | Przyjmuje nowe; wiadomości z przerwy przepadają                                          |
| StartupywPolsce.pl: promocja                                         | blok promocyjny na stronie i linijka na Discordzie | Promocja znika. **Atrybucja przy ich wpisach zostaje zawsze**               | Wraca                                                                                    |
| Przetwarzanie AI                                                     | globalnie                                          | Surowe pozycje czekają jako „czeka na AI”; moderator może je opisać ręcznie | Admin wybiera: **przetwórz zaległe** (z liczbą i szacowanym kosztem) albo **tylko nowe** |
| Discord                                                              | globalnie                                          | Wysyłki czekają jako `paused`                                               | Admin wybiera: **wyślij zaległe** albo **pomiń zaległe**. Bez wyboru nic nie leci        |
| Kanał Discord                                                        | **każdy kanał osobno** (+ osobno crosspost)        | Jak wyżej, tylko dla tego kanału                                            | Jak wyżej                                                                                |
| Sponsoring                                                           | globalnie, **domyślnie wyłączony** do formalizacji | Wpisy sponsorowane ukryte wszędzie, nie da się oznaczyć nowego              | Widoczne z oznaczeniem „Sponsorowane”                                                    |
| Przypomnienia, digest, MCP, formularz „zgłoś wpis”, rejestracja kont | globalnie                                          | Funkcja nieaktywna (MCP i formularz zwracają czytelny komunikat)            | Wraca                                                                                    |

Implementacja:

- Tabela `switches` + `isEnabled(key)` w `convex/lib/`.
- Każdy krok sprawdza swój przełącznik w miejscu wykonania, a nie tylko w UI.
- Każde zadanie dodające krok ma w kryteriach akceptacji „respektuje przełącznik X” + test.

### 4.12 Podglądy linków i SEO

Kompas na Vite zwraca ten sam HTML dla każdego adresu, więc wpis udostępniony na LinkedInie czy Facebooku nie pokazałby swojego tytułu. Rozwiązanie:

- `api/og.ts` (funkcja Vercela) zwraca meta tagi wpisu dla `/w/<slug>`,
- `sitemap.xml` z opublikowanych wpisów.

---

## 5. Fale wdrożeniowe

Zasada: fala zawiera wszystko, co można robić jednocześnie. Nic w fali nie czeka na inną pozycję z tej samej fali. 🧑 = praca ludzi, nie kod.

### Fala 0: rozpoznanie i treści

| #       | Pozycja                                                                                         | Stan         |
| ------- | ----------------------------------------------------------------------------------------------- | ------------ |
| 0.1     | Raport: koszty deployu                                                                          | ✅           |
| 0.2     | Raport: integracja z Discordem                                                                  | ✅           |
| 0.3 🧑  | Zestaw testowy: 30–50 wiadomości z grupy + oczekiwane pola (bez danych osobowych)               | do zrobienia |
| 0.4 🧑  | Katalog programów w Łodzi                                                                       | do zrobienia |
| 0.5 🧑  | Treść drzewa „Co dalej?”                                                                        | do zrobienia |
| 0.6 🧑  | Lista źródeł do scrapowania + czy mają RSS/API                                                  | do zrobienia |
| 0.7 🧑  | Szkic polityki prywatności i regulaminu (kto jest administratorem danych do czasu formalizacji) | do zrobienia |
| 0.8 🧑  | Osobny numer telefonu dla wa-workera                                                            | do zrobienia |
| 0.9     | Porównanie Convex vs Supabase, ocena szablonu                                                   | ✅           |
| 0.10 🧑 | Krótka lista modeli AI + dostęp (klucze/endpointy) do testu                                     | do zrobienia |

### Fala 1: spec i przygotowanie (pozycje niezależne od siebie)

| #      | Pozycja                                                                                                                                                                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1.1    | **Spec fundamentu:** tabele (§3), opakowania uprawnień, przełączniki, kontrakt `/ingest`, wysyłka na Discord przez scheduler, logowanie e-mail + hasło, lista funkcji i plików wspólnych                                                                  |
| 1.2    | **Repo Kompasu z szablonu** („Use this template”; samo założenie repo na GitHubie po Twoim „tak”): usunięcie przykładu `notes` i trybu hackathonowego, AGPL + nota MIT, README, `npm run setup:deploy` z Convexem w regionie UE, zielone `npm run verify` |
| 1.3    | Landing (`Kwadrat-strona`) na Vercel + przełączenie DNS z GitHub Pages                                                                                                                                                                                    |
| 1.4 🧑 | Discord: aplikacja i bot (bez Public Bot, bez intentów), uprawnienia per kanał, role opt-in, Onboarding                                                                                                                                                   |
| 1.5 🧑 | Konto u dostawcy e-mail + rekordy DNS (SPF/DKIM)                                                                                                                                                                                                          |
| 1.6 🧑 | Menedżer haseł dla organizacji; dostęp do wszystkich kont dla co najmniej dwóch osób                                                                                                                                                                      |

### Fala 2: kontrakty

Według reguły szablonu pliki wspólne (`convex/schema.ts`, `convex/*/tables.ts`, `convex/lib/`, `convex/http.ts`, `convex/auth.ts`, `src/app/`) zmieniają się w osobnych PR-ach-kontraktach i **nie równolegle**, bo każda zmiana regeneruje `convex/_generated/`. Dlatego 2.1 robi jeden agent.

| #   | Pozycja                                                                                                                                                                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | Kontrakty: wszystkie `tables.ts` z §3 + `schema.ts`; `convex/lib/` (opakowania uprawnień + testy, `isEnabled` + domyślne wartości, sponsoring wyłączony); `convex/auth.ts` (e-mail + hasło) i trasy w `http.ts` z pustymi handlerami; reguła CI „żadnej funkcji bez opakowania” |
| 2.2 | Środowiska (bez plików w `convex/`): deploymenty Convex dev/prod w UE, sekrety wdrożeniowe w GitHubie, Spend Management na Vercelu, domena `app.kwadratkreatywny.pl`, zgłoszenie do Convex for Open Source (repo musi być publiczne)                                            |

### Fala 3: funkcje (równolegle, w lane'ach; maks. 5 agentów naraz, więc dwie tury)

| #      | Pozycja                                                                                                                                                                                                          | Tura |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| 3.1    | `entries`: publiczna lista, filtry, strona wpisu, publiczny endpoint dla landingu                                                                                                                                | A    |
| 3.2    | `moderation` + `switches`: panel admina (kolejka na żywo, CRUD, wyróżnianie, „sponsorowane”, archiwizacja), ekran Przełączniki z historią i wyborem „zaległe / tylko nowe”, ekran logowania i zarządzania rolami | A    |
| 3.3    | `discord`: bot REST, wysyłka planowana przy publikacji, edycja/pin/archiwizacja, crosspost w kolejce z blokadą `noCrosspost`, cron ponowień, embedy                                                              | A    |
| 3.4    | `ingest` + `extraction`: handler `/ingest`, ekstrakcja przez warstwę AI szablonu, deduplikacja, **porównanie modeli z 0.10 na zestawie 0.3** i rekomendacja                                                      | A    |
| 3.5    | MCP: `api/mcp.ts` (wyszukiwanie i wpisy)                                                                                                                                                                         | A    |
| 3.6    | `programs`: katalog + import z 0.4                                                                                                                                                                               | B    |
| 3.7    | `seo`: `api/og.ts` + sitemap                                                                                                                                                                                     | B    |
| 3.8 🧑 | Publikacja polityki prywatności i regulaminu (z 0.7), przed otwarciem rejestracji dla wszystkich                                                                                                                 | B    |

Każde zadanie z fal 3–5, które dodaje krok przepływu, ma w kryteriach akceptacji „respektuje swój przełącznik” + test.

**Kamień milowy po fali 3:** moderator dodaje wpis ręcznie, a ten pojawia się w Kompasie, przez MCP i na właściwym kanale Discorda. Edycja poprawia post.

### Fala 4: źródła i społeczność

| #   | Pozycja                                                                      | Zależy od |
| --- | ---------------------------------------------------------------------------- | --------- |
| 4.1 | `workers/whatsapp` na Twoim PC → `/ingest`, atrybucja, autostart, runbook QR | 3.4, 0.8  |
| 4.2 | Scrapery: 2–3 źródła z 0.6 jako crony Convexa                                | 3.4       |
| 4.3 | Widget „najbliższe spotkania” na landingu                                    | 3.1       |
| 4.4 | `guide`: „Co dalej?”                                                         | 3.6, 0.5  |
| 4.5 | `reviews`: opinie, polubienia, ranking, moderacja opinii                     | 3.6, 3.8  |
| 4.6 | Przypomnienia o terminach na Discordzie                                      | 3.3       |
| 4.7 | Eksperyment z logowaniem przez Discord, potem podpinanie konta Discord       | 2.1       |

### Fala 5: domknięcie

| #   | Pozycja                                                     | Zależy od |
| --- | ----------------------------------------------------------- | --------- |
| 5.1 | Wyłączenie starego relaya po okresie równoległym            | 4.1, 3.3  |
| 5.2 | MCP: `next_step`, `program_reviews`, `match_project`        | 4.4, 4.5  |
| 5.3 | Monitoring źródeł, kolejne scrapery                         | 4.2       |
| 5.4 | Cotygodniowy digest na Discordzie; slash commands `/kompas` | 3.3, 3.1  |

### Fala 6: po formalizacji i personalizacja

6.1 Sponsorzy Kwadratu i publikacja wpisów sponsorowanych (po formalizacji) · 6.2 Profile projektów + cotygodniowy digest · 6.3 Wyszukiwanie wektorowe do dopasowań.

**Ścieżka krytyczna** (najdłuższy łańcuch zależności): 1.1 → 2.1 → 3.4 → 4.1 → 5.1. Pozycje 🧑 z fali 0 warto zacząć od razu.

---

## 6. Ryzyka

1. **Baileys to nieoficjalny klient WhatsAppa.** Ryzyko bana, więc osobny numer (0.8). Na PC dodatkowo: wyłączony komputer = brak newsów (stąd autostart i alert „0 pozycji”).
2. **Uprawnienia w kodzie zamiast w bazie** (Convex): stąd opakowania, testy i reguła w CI (2.1).
3. **Uzależnienie od Convexa:** backend da się hostować samemu (licencja FSL-Apache-2.0), ale wyjście z Convexa oznacza przepisanie warstwy danych.
4. **Sekrety w otwartym repo:** token bota, klucze AI, Convexa i dostawcy e-mail, sesja WhatsApp tylko w zmiennych środowiskowych (klucze AI tylko w env Convexa, nigdy w `VITE_*`). Obecny `config.json` relaya nie może trafić do repo.
5. **Dane osobowe a dostawca AI:** usuwamy je przed wysłaniem do modelu. Miejsce przetwarzania jest jednym z kryteriów wyboru modelu (0.10). Z dostawcami potrzebne umowy powierzenia (DPA).
6. **Ręczny „Publish” na Discordzie** może wypchnąć treści StartupywPolsce.pl poza nasze kanały. Bot tego nie zrobi, ale moderatorzy muszą znać zasadę.
7. **Komercyjność na Vercel Hobby:** regulamin jej nie definiuje. Sponsorzy oznaczają Pro albo przeniesienie.
8. **Polskie wyszukiwanie:** tokenizer Convexa nie zna odmiany słów (np. „dofinansowanie” nie trafi na „dofinansowania”). Na start filtry + tagi, później wyszukiwanie wektorowe.
9. **Limit crosspostów** (niezweryfikowane: ok. 10/h na kanał): crosspost w kolejce, porażka nie cofa publikacji.
10. **Scrapery się psują** (5.3). **Opinie o programach** wymagają moderacji i regulaminu (3.8, 4.5).

## 7. Otwarte decyzje

1. **Brzmienie linijki promocyjnej** StartupywPolsce.pl: do uzgodnienia z założycielem. Propozycja: podpis „Partner”.
2. **Wątki pod wiadomościami** na kanałach ogłoszeniowych (np. dyskusja pod dofinansowaniem): tworzyć automatycznie czy nie? Do rozstrzygnięcia w specu 1.1.
3. ~~Nazwa nowego repo~~ → **Kwadratowy Kompas** (`kwadratowy-kompas`), konto osobiste, bez organizacji (2026-11-24).

---

## 8. Orkiestracja i handoffy

Handoff to przekazanie pracy **nowemu** agentowi (albo nowej sesji) przez krótki plik zamiast przez historię rozmowy. Nowy agent zaczyna z czystym kontekstem i czyta tylko to, czego potrzebuje.

### Gdzie leżą pliki

Katalog orkiestracji **poza repo** (nic nie jest commitowane): `F:\Projects-now\.orch\Kwadrat\`

```
board.md                     stan wszystkich pozycji (prowadzi CTO = główna sesja)
handoff-<nn>-<krok>.md       pliki przekazania między sesjami CTO
fala-<n>/
  spec.md, spec-thread.md    spec fali + uwagi spec-reviewera
  contract.md                wspólne nazwy (funkcje Convex, tabele, trasy, pola)
  summary.md                 co FAKTYCZNIE powstało (nazwy, API, odstępstwa od specu)
  tasks/<nn>-<slug>/
    brief.md                 zadanie dla codera
    thread.md                coder <-> code-reviewer
```

### Kiedy następuje handoff

| #   | Moment                         | Kto → kto                      | Co dostaje nowy agent (i nic więcej)                                                                                                                                                  |
| --- | ------------------------------ | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| H0  | **Teraz**, po akceptacji planu | ta sesja → nowa sesja CTO      | `handoff-00-plan.md`: decyzje, link do planu i raportów, następny krok (spec 1.1)                                                                                                     |
| H1  | Start specu fali               | CTO → spec-designer            | plan (§ dotyczące fali), `summary.md` poprzedniej fali, lista pozycji fali                                                                                                            |
| H2  | Spec gotowy                    | spec-designer → spec-reviewer  | **tylko** `spec.md` (reviewer nie widzi rozmowy projektowej, więc zauważy luki, które designer „ma w głowie”)                                                                         |
| H3  | Spec zaakceptowany             | CTO → coder (jeden na zadanie) | `brief.md`: sekcja zadania ze specu, kryteria akceptacji, lista plików, `contract.md`, nazwa lane'a (`npm run lane:new`) i wynik `npm run overlap`                                    |
| H4  | Coder skończył                 | coder → code-reviewer          | zakres commitów (SHA), kryteria akceptacji, `thread.md`, wynik `npm run verify`. Reviewer startuje, gdy coder skończy, nigdy równolegle                                               |
| H5  | Poprawki po review             | reviewer → coder               | numerowane uwagi w `thread.md`. Ten sam coder do 3 rund; jeśli jego kontekst przekroczy ~50%, nowy coder dostaje `brief.md` + `thread.md`                                             |
| H6  | Koniec fali                    | CTO → CTO                      | CTO pisze `fala-<n>/summary.md` (max ~1 strona), aktualizuje `board.md` i zaczyna nową sesję z `handoff-<nn>.md`. Następna fala czyta `summary.md`, a nie wyniki pojedynczych agentów |
| H7  | Review całej fali/PR           | CTO → świeży reviewer          | diff fali + `spec.md` + `contract.md`. Szuka szwów między zadaniami, duplikacji i odejścia od specu                                                                                   |

### Zasady

- **Próg kontekstu:** gdy `/context` pokazuje ponad ~50–60%, piszemy handoff i zaczynamy nową sesję. `/compact` tylko wewnątrz kroku, gdy do końca zostało niewiele.
- **Handoff jest krótki** (1–2 strony) i **linkuje** zamiast wklejać. Struktura: cel · stan · decyzje z uzasadnieniem · kontrakty (ścieżki) · pliki do przeczytania (max ~5) · otwarte pytania · następny krok.
- **Agenci rozmawiają tylko przez pliki i PR.** Wątki są tylko dopisywane, a wpisy mają nagłówek `## <rola> — runda <n> — <OPEN|ADDRESSED|APPROVED>`.
- **Kontrakty przed falą równoległą** zgodnie z regułą szablonu (PR z `tables.ts` + `schema.ts`, osobno od funkcji). Agent, któremu brakuje nazwy, zatrzymuje się i zgłasza to zamiast ją wymyślać.
- **Lanes:** każdy coder pracuje w swoim lane'ie (worktree + porty + własny deployment Convex). Merge po kolei; konflikt w `convex/_generated/` rozwiązuje `npx convex codegen` po rebase.
- **Maks. ~5 agentów naraz.** Stąd dwie tury fali 3.
- **Panele agentów** uruchamiane z profilem work (wyczyszczony `CLAUDE_CONFIG_DIR` w `--cmd`). Po starcie trzeba sprawdzić ekran panelu (`wmux read-screen`), bo status `running` nie oznacza, że agent pracuje.
