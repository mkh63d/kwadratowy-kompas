# Agent B: optymalna integracja Kwadrat Kompas z Discordem

Data sprawdzenia źródeł: 2026-11-23. Nic nie zostało utworzone po stronie Discorda, a repo zostało nietknięte.

### Summary

Webhooki (pkt 4.3 planu) wystarczą do „opublikuj / popraw”, ale nie umieją przypiąć wiadomości, opublikować jej dalej z kanału ogłoszeniowego (crosspost), zamknąć wątku ani zagwarantować braku duplikatu przy ponowieniu. Bot, który rozmawia z Discordem wyłącznie przez REST API (bez stałego połączenia z gatewayem), jest tak samo prosty we wdrożeniu: jedno `fetch` z nagłówkiem `Authorization`. Działa na serverless, potrzebuje jednego sekretu zamiast pięciu i zostawia otwartą drogę do slash commands przez HTTP. Pełny bot gatewayowy nie jest potrzebny ani teraz, ani dla `/kompas szukaj`.

**Rekomendacja w jednej linii:** Faza 1 to bot REST-only (token w env, ID kanałów w bazie) plus outbox z `nonce`. `dofinansowania-i-konkursy` jako Forum, `eventy-branzowe` i `ogloszenia` jako Announcement, reszta jako zwykłe kanały tekstowe. Slash commands później przez HTTP Interactions na Vercelu, bez gatewaya.

---

### Options compared

Słowniczek:

- **Gateway** to stałe połączenie WebSocket z Discordem. Przez nie bot dostaje zdarzenia na żywo (nowe wiadomości, reakcje).
- **REST** to zwykłe zapytania HTTP: wysyłasz żądanie, dostajesz odpowiedź i połączenie się kończy.
- **HTTP Interactions** to tryb, w którym Discord sam wysyła POST na Twój URL, gdy ktoś użyje slash commanda. Ten URL to „Interactions Endpoint URL”.

|                                           | (a) Webhook per kanał                                                                | (b) Bot REST-only (+ opcjonalnie HTTP Interactions)                                                          | (c) Bot gatewayowy (discord.js, stały proces)                         | (d) Hybryda: (b) + webhook „surowe” |
| ----------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ----------------------------------- |
| Wysłanie embeda                           | ✅                                                                                   | ✅                                                                                                           | ✅                                                                    | ✅                                  |
| Edycja / usunięcie własnej wiadomości     | ✅ (Edit/Delete Webhook Message, tym samym webhookiem)                               | ✅ (autor może zmieniać `content`, `embeds`, `flags`)                                                        | ✅                                                                    | ✅                                  |
| Post w kanale Forum (z tagami)            | ✅ (`thread_name` + `applied_tags`)                                                  | ✅ (Start Thread in Forum, do 5 tagów)                                                                       | ✅                                                                    | ✅                                  |
| Zamknięcie / zarchiwizowanie wątku        | ❌ (brak endpointu dla webhooka)                                                     | ✅ (Modify Channel `archived`/`locked`, `MANAGE_THREADS`)                                                    | ✅                                                                    | ✅                                  |
| Przypięcie (pin)                          | ❌                                                                                   | ✅ (wymaga `PIN_MESSAGES`)                                                                                   | ✅                                                                    | ✅                                  |
| Crosspost (Publish) w kanale Announcement | ❌ (brak endpointu dla webhooka; trzeba by klikać ręcznie)                           | ✅ (własna wiadomość: wystarczy `SEND_MESSAGES`)                                                             | ✅                                                                    | ✅                                  |
| Reakcje                                   | ❌                                                                                   | ✅ (dodawanie; bez odczytu w czasie rzeczywistym)                                                            | ✅ (także nasłuch)                                                    | ✅                                  |
| Wzmianka roli (`<@&id>`)                  | ✅ (rola musi mieć „mentionable”)                                                    | ✅ (j.w., kontrola przez `allowed_mentions`)                                                                 | ✅                                                                    | ✅                                  |
| Ochrona przed podwójnym postem            | ❌ brak `nonce`                                                                      | ✅ `nonce` + `enforce_nonce` (deduplikacja „w ciągu kilku minut”)                                            | ✅                                                                    | ✅                                  |
| Slash commands                            | ❌                                                                                   | ✅ przez HTTP Interactions (nie wymaga podłączonego klienta)                                                 | ✅                                                                    | ✅                                  |
| Czytanie wiadomości z kanałów             | ❌                                                                                   | Tylko „na żądanie” (GET historii), bez zdarzeń live                                                          | ✅ (wymaga też uprzywilejowanego intentu Message Content)             | j.w. (b)                            |
| Hosting                                   | Dowolny, serverless OK                                                               | Serverless OK (Vercel Functions)                                                                             | Stały proces (VPS/Fly/Railway/Pi); **nie** Vercel                     | Serverless OK                       |
| Sekrety w repo open source                | N URL-i webhooków. Token siedzi w URL, więc każdy URL jest sekretem                  | 1× `DISCORD_BOT_TOKEN`. `APPLICATION_ID` i `PUBLIC_KEY` są jawne, ID kanałów i ról też jawne (mogą żyć w DB) | 1× token + utrzymanie procesu                                         | j.w. (b) + 1 URL                    |
| Rate limits                               | Limity per-route z nagłówków. Dokumentacja nie wymienia osobnych liczb dla webhooków | 50 req/s globalnie na bota + buckety per-route. Interakcje nie wliczają się do limitu globalnego             | j.w. + limity gatewaya                                                | j.w.                                |
| Złożoność                                 | Najniższa                                                                            | Niska (prawie identyczny kod co (a))                                                                         | Średnia-wysoka (reconnect, sharding niepotrzebny, monitoring procesu) | Niska                               |

Wniosek: (b) kosztuje tyle samo co (a), a rozwiązuje wszystko z cyklu życia wpisu (pin, archiwizacja, crosspost, idempotencja). (c) daje tylko nasłuch zdarzeń live, a Kompas go nie potrzebuje: źródłem prawdy jest baza, nie Discord.

**Jeśli agent-a wybierze hosting ze stałym procesem** (np. VPS, na którym i tak będzie wa-worker), nadal zostaję przy (b). Stały proces może wtedy przejąć rolę „workera outboxa” (pętla co 30 s zamiast crona), a gateway da się dołożyć później, np. do nasłuchu reakcji, bez zmiany modelu danych.

---

### Recommended design

#### 1. Typy kanałów

Słowniczek:

- **Announcement channel** to kanał, który inne serwery mogą „obserwować” (Follow). Wiadomość opublikowana przyciskiem _Publish_ (w API: crosspost) trafia do ich kanałów przez automatycznie utworzony webhook.
- **Forum channel** zawiera wyłącznie wątki (posty). Każdy post ma tytuł, tagi (max 20 zdefiniowanych na kanale, max 5 na post) i własną dyskusję.

| Kanał                       | Typ                                                           | Dlaczego                                                                                                                                                                                                     | Koszt dla czytelnika                                                                                                                        |
| --------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `ogloszenia`                | **Announcement** (ręczny, bez integracji)                     | Partnerskie społeczności mogą obserwować ogłoszenia Kwadratu                                                                                                                                                 | Brak                                                                                                                                        |
| `dofinansowania-i-konkursy` | **Forum**                                                     | Wpis żyje tygodniami do deadline'u, ludzie pytają („ktoś aplikował?”), a tagi `Dofinansowanie / Konkurs / Hackathon / Zamknięte` dają filtrowanie. Po terminie wątek się archiwizuje i lista sama się czyści | Forum nie jest „feedem”: posty sortują się po aktywności. Nie da się go obserwować z innych serwerów (Follow działa tylko dla Announcement) |
| `eventy-branzowe`           | **Announcement**                                              | Najbardziej „eksportowalna” treść dla ekosystemu (inne łódzkie społeczności)                                                                                                                                 | Limit publikacji (patrz Risks), więc crosspost jest „best effort”                                                                           |
| `szkolenia-i-warsztaty`     | Tekstowy                                                      | Mały wolumen, krótki cykl życia                                                                                                                                                                              | —                                                                                                                                           |
| `newsy`                     | Tekstowy (Announcement dopiero po zgodzie StartupywPolsce.pl) | Ich zgoda dotyczy publikacji u nas z linkiem i promocją. Dalsza redystrybucja na obce serwery przez Follow to inna sytuacja, więc trzeba ją potwierdzić z założycielem                                       | —                                                                                                                                           |

Warunek wstępny: Announcement channels (a według pomocy Discorda także Onboarding) wymagają włączonego **Community** na serwerze. Czy Forum też tego wymaga, nie zweryfikowałem; sprawdzić przy zakładaniu.

Alternatywa, jeśli Forum się nie przyjmie: `dofinansowania-i-konkursy` jako Announcement z wątkiem pod każdą wiadomością (Start Thread from Message tworzy `ANNOUNCEMENT_THREAD`). Zyskujemy Follow, tracimy tagi.

#### 2. Routing

Zasada: **jeden wpis = jeden kanał główny**, bez cross-postowania tego samego wpisu na kilka kanałów. Filtrowanie przekrojowe robi strona Kompasu, nie Discord. Tabela `discord_routes` mapuje typ na kanał, a admin może nadpisać kanał per wpis.

| Typ wpisu (`entries.type`)                          | Kanał                                               | Tag forum      |
| --------------------------------------------------- | --------------------------------------------------- | -------------- |
| `dofinansowanie`, `nabór`                           | dofinansowania-i-konkursy                           | Dofinansowanie |
| `konkurs`                                           | dofinansowania-i-konkursy                           | Konkurs        |
| hackathon (typ `konkurs`/`event` + tag `hackathon`) | **dofinansowania-i-konkursy**                       | Hackathon      |
| `szkolenie` (darmowe lub dofinansowane)             | szkolenia-i-warsztaty                               | —              |
| `szkolenie` płatne komercyjnie                      | eventy-branzowe (albo odrzucić; decyzja produktowa) | —              |
| `event`                                             | eventy-branzowe                                     | —              |
| `news`                                              | newsy                                               | —              |
| ogłoszenia Kwadratu                                 | ogloszenia: **ręcznie**, poza Kompasem              | —              |

Przypadki niejednoznaczne (rozstrzyga moderator, AI tylko podpowiada):

- **Hackathon, który jest też eventem** → dofinansowania-i-konkursy. Czytelnik szuka w nim szansy (nagrody, aplikacja z terminem), a nie wydarzenia do odwiedzenia. Kryterium: jest nabór/deadline lub nagroda → konkursy.
- **Szkolenie, które jest też eventem** (np. warsztat na konferencji) → szkolenia-i-warsztaty, jeśli głównym celem jest nauka i jest darmowe/dofinansowane. W przeciwnym razie eventy-branzowe.
- **News ogłaszający grant** → moderator zmienia typ na `dofinansowanie` (lub tworzy osobny wpis i scala duplikat), więc trafia do dofinansowania-i-konkursy. Atrybucja źródła jedzie z wpisem, niezależnie od kanału: jeśli wpis przyszedł z grupy StartupywPolsce.pl, embed w dofinansowaniach też ma ich link. Nie publikujemy tego samego dwa razy (news + grant).
- Fallback: typ bez trasy → wpis nie idzie na Discorda, a w panelu widać ostrzeżenie (lepiej nic niż zły kanał).

#### 3. Cykl życia

| Zdarzenie w Kompasie                       | Akcja na Discordzie (Text / Announcement)                                                                                                                       | Akcja (Forum)                                                                                                                |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Publikacja                                 | Create Message z `nonce`. W kanale Announcement potem Crosspost (osobny krok, może się nie udać bez szkody)                                                     | Start Thread in Forum: tytuł = tytuł wpisu (ucięty do limitu nazwy wątku), tagi                                              |
| Edycja wpisu                               | Edit Message tej samej wiadomości (re-render z aktualnego stanu wpisu). Dokumentacja nie mówi, czy edycja dociera do serwerów obserwujących; nie zakładamy tego | Edit pierwszej wiadomości wątku (+ zmiana nazwy/tagów przez Modify Channel)                                                  |
| Wyróżnienie (`featured_until`)             | Pin (`PIN_MESSAGES`, limit 250 pinów/kanał od 08.2025) + ⭐ w tytule i inny kolor embeda. Unpin, gdy `featured_until` minie. **Bez re-postu** (spam)            | Przypięcie posta na forum. Nie zweryfikowałem, ile postów naraz da się przypiąć (prawdopodobnie 1), więc trzeba to sprawdzić |
| Przypomnienie o deadline (np. 3 dni przed) | Odpowiedź (reply) do oryginalnej wiadomości: „Zostały 3 dni: termin <t:…:R>”. Raz na wpis. Bez crosspostu                                                       | Wiadomość w wątku (podbija post na górę forum)                                                                               |
| Archiwizacja / po terminie / odwołanie     | **Edycja, nie usuwanie**: szary kolor, tytuł „[NIEAKTUALNE]” lub „[ODWOŁANE]”, usunięte pole „Zapisz się”. Unpin, jeśli był przypięty                           | Edycja + tag `Zamknięte` + `archived: true, locked: true`                                                                    |
| Wycofanie (błąd, spam, prośba prawna)      | Delete Message. Jedyny przypadek usuwania, akcja admina „Wycofaj z Discorda”                                                                                    | Delete wątku                                                                                                                 |

Dlaczego edycja, a nie usuwanie: usunięcie zostawia „dziury” w dyskusjach i odpowiedziach, a kopie wysłane do obserwujących serwerów i tak zostają. Edycja do „nieaktualne” to uczciwy ślad.

**Outbox i idempotencja** (_idempotencja_ oznacza, że powtórzenie tej samej operacji nie zmienia wyniku: retry nie robi drugiego posta):

1. Akcja w panelu zapisuje w jednej transakcji zmianę wpisu i wiersz `discord_outbox` (`action`, `entry_id`). Dla tego samego `(entry_id, action)` istnieje najwyżej jeden oczekujący wiersz, więc kilka szybkich edycji zlewa się w jedną.
2. Wysyłka: od razu po zapisie (w tle, np. `after()`/`waitUntil` na Vercelu), a nieudane podejmuje cron (co kilka minut; harmonogram zależy od hostingu, patrz agent-a). Na 429 czekamy `retry_after`; na 5xx/timeout backoff wykładniczy; po N próbach status `failed` i widoczność w panelu.
3. Treść renderujemy **w momencie wysyłki** z aktualnego stanu wpisu, a nie z treści zapisanej w outboxie. Retry wysyła więc zawsze najnowszą wersję.
4. **Create:** jeśli `discord_posts` ma już `message_id`, zamiast tworzyć robimy update. Inaczej Create Message z `nonce` = id wiersza outboxa (≤25 znaków) i `enforce_nonce: true`. Jeśli poprzednia próba „zginęła” po stronie sieci, Discord zwróci istniejącą wiadomość zamiast tworzyć drugą. Okno deduplikacji to według dokumentacji „kilka minut”, więc retry po timeoucie robimy szybko. Gdy minęło więcej czasu, a stan jest niepewny, wiersz przechodzi do `needs_review` i admin sprawdza ręcznie. `message_id` zapisujemy natychmiast po odpowiedzi.
   Czy `nonce` działa przy Start Thread in Forum, nie sprawdziłem. Dla forum stosujemy tę samą ścieżkę `needs_review`.
5. Crosspost, pin i przypomnienie to osobne akcje outboxa. Ich porażka nie cofa publikacji.

Obrazowo: outbox działa jak skrzynka „do wysłania” w poczcie, a `nonce` jak numer na kopercie. Jeśli listonosz nie potwierdził odbioru i nadajesz list jeszcze raz z tym samym numerem, sortownia (Discord) przez kilka minut rozpozna, że już go ma. Po dłuższym czasie numer zostanie zapomniany, i dlatego wtedy decyduje człowiek.

#### 4. Format wiadomości

Jeden embed na wpis. Limity z dokumentacji:

- tytuł 256 znaków
- opis 4096
- do 25 pól; nazwa pola 256, wartość 1024
- stopka 2048, autor 256
- **łącznie 6000** we wszystkich embedach
- `content` do 2000

My celujemy znacznie niżej: opis ≤ 400 znaków. Pełna treść jest w Kompasie.

```
[content]   (tylko gdy ping) <@&ROLE_dofinansowania> · nowy nabór
┌ author:   StartupywPolsce.pl  → link do ich społeczności      (tylko źródło = SwP)
│ title:    ⭐ Akcelerator X: nabór 2027     → url = app.kwadratkreatywny.pl/w/<slug>
│ desc:     2–3 zdania streszczenia od AI, poprawione przez moderatora
│ fields (inline):
│   Termin zgłoszeń   <t:1767225600:D> (<t:1767225600:R>)
│   Kiedy             <t:…:F>  (eventy/szkolenia)
│   Gdzie             Łódź, ul. … / online
│   Kwota             do 200 000 zł
│   Organizator       …
│   Link              [Strona organizatora](…)
│   Źródło            StartupywPolsce.pl / scraper PARP / zgłoszenie
│ color:    per kanał (szary = nieaktualne)
└ footer:   Kompas Kwadratu Kreatywnego · więcej filtrów na app.kwadratkreatywny.pl
```

- **Pola per kanał:**
  - dofinansowania: Termin zgłoszeń, Kwota, Dla kogo/etap, Organizator
  - szkolenia: Kiedy, Gdzie, Koszt („bezpłatne” / „dofinansowane”), Zapisy do
  - eventy: Kiedy, Gdzie, Wstęp, Organizator
  - newsy: tylko opis + Źródło
  - Puste pola pomijamy.
- **StartupywPolsce.pl (ich warunek):**
  - pole `author` z nazwą i linkiem do społeczności
  - jedna stała linijka promocyjna w `content` lub na końcu opisu, np. „Więcej takich informacji: dołącz do StartupywPolsce.pl → link”. Treść linijki trzymamy w konfiguracji, a dokładne brzmienie uzgadniamy z założycielem.
  - Atrybucja zależy od `entries.source`, nie od kanału (patrz routing: news → grant).
- **Link do Kompasu:** `url` tytułu prowadzi zawsze na stronę wpisu w Kompasie. Link organizatora jest osobnym polem.
- **Polskie daty:**
  - Pola z terminami: składnia `<t:UNIX:D>` / `<t:UNIX:F>` / `<t:UNIX:R>`. Discord renderuje ją „w strefie czasowej i locale odbiorcy”, więc polski klient zobaczy „23 listopada 2026” i „za 3 dni”.
  - Tytuł, stopka i powiadomienia push mogą tej składni nie renderować; nie zweryfikowałem, gdzie dokładnie działa. Tam piszemy datę tekstem: `Intl.DateTimeFormat('pl-PL', { timeZone: 'Europe/Warsaw', dateStyle: 'long' })`. Strefę podajemy jawnie, bo funkcje Vercela działają w UTC.
  - Pole `timestamp` embeda (ISO8601) zostawiamy dla daty publikacji.

#### 5. Powiadomienia

- **Domyślnie bez pingów.** Kanały mają własne nieprzeczytane, a pingi przy kilkunastu wpisach dziennie wyciszą ludzi szybciej, niż pomogą.
- Role opt-in, przypisywane samodzielnie przez Onboarding Discorda (pytanie „Co chcesz śledzić?”), więc bot do ról nie jest potrzebny:
  - `@dofinansowania` dostaje ping przy nowym wpisie w dofinansowania-i-konkursy i przy przypomnieniu o deadline
  - `@eventy` dostaje ping tylko dla wyróżnionych eventów
  - `@szkolenia` dostaje ping przy nowych wpisach
  - `newsy`: nigdy nie pingujemy.
- Zawsze wysyłamy `allowed_mentions: { roles: ["<id tej jednej roli>"] }`. Uwaga: `parse` wyklucza się z `roles`, a bez `allowed_mentions` Discord parsuje wszystko. Bot **nie dostaje** `MENTION_EVERYONE`, więc @everyone/@here są technicznie niemożliwe. Role muszą mieć „mentionable” = on.
- Hurtowe wysyłki (np. pierwszy import 50 wpisów) idą z flagą `SUPPRESS_NOTIFICATIONS` i bez pingów.

---

### Data model impact

Rozszerzenie szkicu z sekcji 3 planu:

**`discord_routes`**: jawna konfiguracja, bez sekretów, bo przy bocie ID kanałów nie są tajne:

- `entry_type`, `tag?` → `channel_id`
- `channel_kind` (`text` | `announcement` | `forum`)
- `forum_tag_ids` (mapa typ→tag)
- `ping_role_id?`, `ping_policy` (`never` | `new` | `featured`)
- `crosspost` (bool)

Zmiana względem planu: kolumna „URL webhooka w sekretach” znika.

**`discord_posts`**: jeden wiersz na wiadomość, którą kontrolujemy:

- `entry_id`, `kind` (`main` | `reminder`)
- `channel_id`, `message_id`, `thread_id?` (forum)
- `rendered_hash`: hash ostatnio wysłanej treści, żeby pominąć edycję bez zmian
- `pinned`, `crossposted_at?`, `reminded_at?`, `archived_at?`
- `UNIQUE(entry_id, kind)`

**`discord_outbox`**:

- `id` (krótki, służy jako `nonce`), `entry_id`
- `action` (`create` | `update` | `archive` | `pin` | `unpin` | `crosspost` | `remind` | `delete`)
- `status` (`pending` | `sent` | `failed` | `needs_review`)
- `attempts`, `next_attempt_at`, `last_error`, `created_at`
- częściowy unikalny indeks na `(entry_id, action) WHERE status='pending'`

**`entries`**: dodać `discord_channel_override?` i `discord_ping` (bool, decyzja moderatora przy publikacji). Istniejące `featured_until`, `deadline` i `status` wystarczają jako wyzwalacze.

**Konfiguracja (env):**

- `DISCORD_BOT_TOKEN` (sekret)
- `DISCORD_APPLICATION_ID` i `DISCORD_PUBLIC_KEY` (jawne; potrzebne dopiero dla slash commands)
- `DISCORD_GUILD_ID`
- tekst promocji StartupywPolsce.pl + URL ich społeczności (config w repo lub DB)

Obecny relay WhatsApp→webhook (`whatsapp-discord-relay/index.js`) zostaje bez zmian jako `#surowe-ogloszenia` do czasu odbioru Fazy 2. To jedyne miejsce, gdzie webhook ma sens.

---

### Admin setup checklist

Do zrobienia ręcznie przez admina serwera. Niczego z tej listy nie wykonałem.

- [ ] **Serwer:** włączyć Community (Server Settings → Enable Community), jeśli jeszcze nie jest. To warunek Announcement i Onboardingu.
- [ ] **Developer Portal** (discord.com/developers/applications) → New Application „Kwadrat Kompas”:
  - [ ] skopiować Application ID i Public Key (jawne)
  - [ ] zakładka Bot → Reset Token → wkleić **tylko** do zmiennych środowiskowych Vercela/Supabase. Nigdy do repo ani `.env.example`.
  - [ ] zakładka Bot: wyłączyć „Public Bot”, żeby nikt inny nie dodał bota do swojego serwera.
  - [ ] **wszystkie Privileged Gateway Intents zostawić wyłączone** (Message Content, Server Members, Presence); nie są potrzebne.
  - [ ] Interactions Endpoint URL: **na razie puste**. Ustawić dopiero przy slash commands, bo Discord od razu wyśle PING i musi dostać PONG.
- [ ] **Zaproszenie bota:** OAuth2 URL Generator, scopes `bot` (+ `applications.commands`, które według dokumentacji jest i tak dołączane do `bot`). Uprawnienia serwerowe zostawić **puste**, a nadać je per kanał (niżej).
- [ ] **Rola bota „Kompas”:** nadpisania uprawnień na 4 kanałach (bez `ogloszenia`):
  - wszystkie 4: View Channel, Send Messages, Embed Links, Read Message History
  - forum `dofinansowania-i-konkursy`: także Send Messages in Threads i **Manage Threads** (archiwizacja/lock)
  - Pin Messages (w API `PIN_MESSAGES`, od 2025 oddzielone od Manage Messages): na kanałach z wyróżnieniami
  - **Nie** nadawać: Administrator, Manage Messages, Mention Everyone, Manage Webhooks.
- [ ] **Kanały:**
  - [ ] `ogloszenia` → typ Announcement (ręczne posty adminów; bot bez dostępu)
  - [ ] `dofinansowania-i-konkursy` → typ **Forum**; tagi: `Dofinansowanie`, `Konkurs`, `Hackathon`, `Zamknięte` (opcjonalnie `Łódź`, `Ogólnopolskie`); „Require tags” wyłączone (bot i tak taguje); wytyczne posta w opisie; ustawić domyślne auto-archiwizowanie (np. 1 tydzień braku aktywności)
  - [ ] `eventy-branzowe` → typ Announcement
  - [ ] `szkolenia-i-warsztaty`, `newsy` → zwykłe tekstowe; `newsy` zmienić na Announcement dopiero po zgodzie StartupywPolsce.pl
  - [ ] na kanałach zasilanych przez Kompas zablokować pisanie zwykłym użytkownikom (Send Messages = off), żeby feed był czysty. Na forum zostawić „Send Messages in Threads” = on, żeby dyskusja w postach działała.
- [ ] **Role opt-in:** utworzyć `@dofinansowania`, `@eventy`, `@szkolenia`, zaznaczyć „Allow anyone to @mention this role” i dodać je jako pytanie w Onboarding (Server Settings → Onboarding).
- [ ] Skopiować ID kanałów, tagów forum i ról (Developer Mode → prawy klik → Copy ID) do `discord_routes` przez panel admina.
- [ ] Zostawić obecny webhook relaya na kanale `#surowe-ogloszenia` do końca Fazy 2.

---

### Upgrade path

| Etap                                                 | Co dochodzi                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Czy wybór z Fazy 1 blokuje?                                                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Faza 1**                                           | Bot REST-only: create/edit/archive/pin/crosspost, outbox, przypomnienia cronem                                                                                                                                                                                                                                                                                                                                                                                                           | —                                                                                                                                                |
| Tygodniowy digest                                    | Cron raz w tygodniu wysyła wiadomość per kanał (lub jedną w `ogloszenia`) z listą otwartych naborów i najbliższych eventów, z pingiem ról opt-in raz w tygodniu zamiast przy każdym wpisie                                                                                                                                                                                                                                                                                               | Nie, to zwykłe Create Message                                                                                                                    |
| Slash commands (`/kompas szukaj`, `/kompas terminy`) | Route w Next.js jako Interactions Endpoint URL: weryfikacja Ed25519 (nagłówki `X-Signature-Ed25519`, `X-Signature-Timestamp`, 401 przy błędzie), PING→PONG, odpowiedź w **3 s**. Dla wolniejszych zapytań odpowiedź odroczona (typ 5, „bot myśli…”) i follow-up tokenem ważnym 15 min. Na serverless follow-up musi się dokończyć przez `waitUntil`/`after()`, bo inaczej funkcja może zostać zamrożona po zwróceniu odpowiedzi. Odpowiedzi efemeryczne (flaga 64) nie zaśmiecają kanału | **Nie.** HTTP Interactions „nie wymagają podłączonego klienta”, a ta sama aplikacja/bot już istnieje. Uwaga: tryby HTTP i gateway się wykluczają |
| Przyciski („Przypomnij mi”, „Zapisz w Kompasie”)     | Komponenty na wiadomościach bota, obsługiwane tym samym endpointem                                                                                                                                                                                                                                                                                                                                                                                                                       | Nie. Przy webhookach byłby problem: zwykłe (nie-aplikacyjne) webhooki nie mogą wysyłać interaktywnych komponentów                                |
| Discord Scheduled Events                             | Tylko dla **własnych** spotkań Kwadratu (limit 100 aktywnych eventów na serwer; EXTERNAL wymaga `location` i `scheduled_end_time`; uprawnienie `CREATE_EVENTS`)                                                                                                                                                                                                                                                                                                                          | Nie, REST                                                                                                                                        |
| Gateway (stały proces)                               | Tylko jeśli pojawi się potrzeba reagowania na zdarzenia live: np. „🔖 reakcja = zapisz do mojej listy”, moderacja zgłoszeń z Discorda, liczenie zaangażowania. Najlepiej w tym samym procesie co wa-worker                                                                                                                                                                                                                                                                               | Nie. Model danych bez zmian, ale wtedy slash commands trzeba przenieść z HTTP na gateway albo zostawić na HTTP                                   |

---

### Sources

Dokumentacja Discorda przeniosła się z `discord.com/developers/docs/...` (301) na `docs.discord.com/developers/...`.

| URL                                                                       | Co potwierdził                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Sprawdzono |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| https://docs.discord.com/developers/resources/webhook                     | Execute Webhook: `wait`, `thread_id`, `thread_name` + `applied_tags` dla forum; flagi tylko `SUPPRESS_EMBEDS`/`SUPPRESS_NOTIFICATIONS`/`IS_COMPONENTS_V2`; Edit/Delete/Get Webhook Message; „Non-application-owned webhooks cannot send interactive components”; brak wzmianki o crosspost/pin                                                                                                                                                                               | 2026-11-23 |
| https://docs.discord.com/developers/resources/message                     | Crosspost (Announcement → obserwujący; `SEND_MESSAGES` dla własnej wiadomości); Pin wymaga `PIN_MESSAGES`; limity embedów (256/4096/25 pól/256/1024/2048/256, łącznie 6000, 10 embedów); `content` 2000; `allowed_mentions` (`parse` wyklucza się z `roles`/`users`; domyślnie parsuje wszystko; rola musi być mentionable); `SUPPRESS_NOTIFICATIONS`; `nonce` (≤25) + `enforce_nonce` („w ciągu kilku minut” zwraca istniejącą wiadomość); edycja treści tylko przez autora | 2026-11-23 |
| https://docs.discord.com/developers/resources/channel                     | Typy GUILD_ANNOUNCEMENT/GUILD_FORUM/ANNOUNCEMENT_THREAD; Follow Announcement Channel (`MANAGE_WEBHOOKS` w kanale docelowym); Start Thread in Forum (`SEND_MESSAGES`, max 5 tagów); `available_tags` max 20; archiwizacja/lock (`MANAGE_THREADS`); auto-archive 60/1440/4320/10080 min                                                                                                                                                                                        | 2026-11-23 |
| https://docs.discord.com/developers/interactions/overview                 | HTTP vs gateway (wzajemnie wykluczające się); Ed25519, nagłówki, 401, PING/PONG przy zapisie URL; Discord wysyła celowo błędne podpisy kontrolne                                                                                                                                                                                                                                                                                                                             | 2026-11-23 |
| https://docs.discord.com/developers/interactions/receiving-and-responding | 3 s na pierwszą odpowiedź; token 15 min; odroczona odpowiedź; flaga EPHEMERAL (64); „webhook method … does not require a connected client”                                                                                                                                                                                                                                                                                                                                   | 2026-11-23 |
| https://docs.discord.com/developers/topics/rate-limits                    | 50 req/s globalnie; buckety z nagłówków, nie hardkodować; `retry_after`; 10 000 błędnych żądań / 10 min → czasowa blokada IP; „Interaction endpoints are not bound to the bot's Global Rate Limit”                                                                                                                                                                                                                                                                           | 2026-11-23 |
| https://docs.discord.com/developers/topics/oauth2                         | Scope `bot`, parametr `permissions`; `applications.commands` „included by default with the bot scope”; `webhook.incoming`                                                                                                                                                                                                                                                                                                                                                    | 2026-11-23 |
| https://docs.discord.com/developers/reference                             | `<t:UNIX:STYLE>` (style t/T/d/D/f/F/s/S/R) renderowane w strefie i locale odbiorcy; `<@&ROLE_ID>`; snowflake jako string                                                                                                                                                                                                                                                                                                                                                     | 2026-11-23 |
| https://docs.discord.com/developers/resources/guild-scheduled-event       | `CREATE_EVENTS`; EXTERNAL wymaga `location` i `scheduled_end_time`; max 100 SCHEDULED/ACTIVE                                                                                                                                                                                                                                                                                                                                                                                 | 2026-11-23 |
| https://discord.com/blog/discord-patch-notes-august-4-2025                | Limit pinów 50 → 250 na kanał (wg wyszukiwarki; strony nie pobrałem)                                                                                                                                                                                                                                                                                                                                                                                                         | 2026-11-23 |
| https://discord.com/blog/discord-patch-notes-september-3-2025             | Osobne uprawnienie do pinowania, odłączone od Manage Messages (wg wyszukiwarki)                                                                                                                                                                                                                                                                                                                                                                                              | 2026-11-23 |
| https://support.discord.com/hc/en-us/articles/360032008192                | Announcement wymaga Community; Publish ręczny. **403 przy pobraniu**, więc potwierdzone tylko przez wtórne źródła z wyszukiwarki                                                                                                                                                                                                                                                                                                                                             | 2026-11-23 |

---

### Risks

1. **Limit publikacji (crosspost) w kanale Announcement**: wtórne źródła podają ok. **10 publikacji na godzinę na kanał**. Oficjalnej strony nie udało się pobrać (403), więc to **niezweryfikowane**. Przy batchu scrapera eventów crosspost dostanie 429. Mitigacja: crosspost jako osobna akcja outboxa z kolejką i `retry_after`; ewentualnie crosspostować tylko wyróżnione.
2. **Okno `nonce` to „kilka minut”** (bez liczby w dokumentacji). Po dłuższej awarii stan „czy post powstał?” bywa niepewny, stąd status `needs_review` zamiast ślepego retry. Nie wiem, czy `nonce` działa przy Start Thread in Forum.
3. **Współdzielone IP serverless**: blokada po 10 000 błędnych żądań / 10 min jest per IP, a funkcje Vercela dzielą IP z innymi klientami. Przy naszym wolumenie to ryzyko małe, ale niezerowe. Kod nie może generować serii 401/403/404 (np. retry na skasowany kanał): błędy 4xx inne niż 429 → `failed` bez ponawiania.
4. **Token bota w repo open source**: wyciek = przejęcie bota w zakresie jego uprawnień. Mitigacja: minimalne uprawnienia per kanał, brak Administrator/Mention Everyone, token tylko w env, `.env.example` bez wartości. Discord prawdopodobnie uczestniczy w secret scanning GitHuba i unieważnia wykryte tokeny, ale tego **nie weryfikowałem**.
5. **Forum dla czytelników**: posty sortują się po aktywności, więc nowe wpisy mogą ginąć pod gorącą dyskusją, a kanału nie da się obserwować z innych serwerów. Jeśli po miesiącu ludzie nie korzystają z dyskusji, wracamy do Announcement + wątki (patrz alternatywa w sekcji 1).
6. **Zgoda StartupywPolsce.pl** obejmuje publikację u nas z linkiem i promocją. Follow/crosspost na obce serwery i przeniesienie ich newsa do innego kanału (news → grant) warto potwierdzić z założycielem przed włączeniem.
7. **Edycja a obserwujący serwery**: nie potwierdziłem w dokumentacji, czy edycja/archiwizacja opublikowanej wiadomości propaguje się do kopii u obserwujących. Zakładam, że nie, i nie obiecujemy tego partnerom.
8. **Harmonogram retry/przypomnień** zależy od hostingu (agent-a): jeśli plan Vercela ma rzadki cron, sweeper outboxa i przypomnienia trzeba wyzwalać z GitHub Actions lub Supabase (`pg_cron`). Logika się nie zmienia, tylko wyzwalacz.
9. **Niezweryfikowane drobiazgi do sprawdzenia przy specu**: czy Forum wymaga Community; ile postów forum można przypiąć; w których polach embeda renderuje się `<t:…>`; czy `applications.commands` jest potrzebne osobno przy zaproszeniu (dokumentacja mówi, że jest domyślnie w `bot`).
