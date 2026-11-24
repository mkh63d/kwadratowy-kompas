# agent-a: koszty i złożoność deployu Kwadrat Kompas

Data sprawdzenia wszystkich cen: **2026-11-23**. Ceny w walucie źródła. Przeliczenia na USD/PLN są orientacyjne: przyjąłem ok. 3,7 zł/USD i 4,3 zł/EUR, **kursy niezweryfikowane**. Vercel, Supabase i Hetzner podają ceny bez VAT. Osoba prywatna w PL zwykle dopłaca 23%.

### Summary

Element, który przesądza o architekturze, to `wa-worker`. Musi stać 24/7 z trwałym WebSocketem i sesją na dysku, więc **i tak potrzebny jest jeden mały, zawsze włączony serwer**. Na Vercelu tego nie da się sensownie zrobić: Vercel Daemons są w becie i nie mają trwałego dysku. Reszta (Next.js, API, MCP, Postgres) mieści się w darmowych lub prawie darmowych planach przy zakładanej skali. Największą pozycją kosztową będzie najpewniej Claude API (ok. 5–70 USD/mies.), a nie hosting (0–45 USD/mies.).

**Rekomendacja:** hybryda: Vercel (Kompas) + Supabase (Postgres + Auth) + jeden tani VPS w PL/EU (OVH VPS-1 ~20 zł brutto/mies.) na wa-workera, scrapery (cron) i nocny backup bazy. Kod od początku przenośny (Docker Compose do lokalnego uruchomienia). Po miesiącu Pro: zejście na Hobby tylko wtedy, gdy Kompas nie ma żadnego elementu komercyjnego. W przeciwnym razie Pro (20 USD) albo przeniesienie Next.js na ten sam VPS.

### Comparison table

Koszt = hosting bez Claude API (API osobno, niżej). „10×” = 10× ruch na stronie (kilkadziesiąt tys. wizyt/mies.). Wolumen wpisów AI liczę osobno.

| Opcja                                                                                  | Koszt/mies. bazowo                                                                                                         | Koszt/mies. przy 10×                                                                 | Obciążenie ops (junior + wolontariusze)                                                 | Open source / fork dla innego miasta                                  | Kluczowe limity, które bolą                                                                                                                        |
| -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1a. Vercel Hobby + Supabase Free + worker na domowym PC**                            | **0 USD** (+ prąd)                                                                                                         | 0 USD, o ile nie przekroczy limitów Hobby (wtedy funkcja staje do końca okna 30 dni) | niskie na co dzień; **brak backupów** na Supabase Free; worker pada razem z PC          | średnio: `supabase start` + `next dev`, fork zakłada własne konta     | Hobby tylko do użytku **niekomercyjnego**; cron Vercela raz na dobę; Supabase Free bez backupów, 500 MB, pauza po tygodniu bez aktywności          |
| **1b. Vercel Pro + Supabase Free + mały VPS na worker**                                | ~20 USD + ~5 zł (Mikrus 2.1) do ~20 zł (OVH VPS-1) ≈ **22–25 USD**                                                         | ~22–50 USD (Supabase Pro +25 USD, jeśli egress >5 GB albo potrzebne backupy)         | niskie–średnie (~1–3 h/mies.)                                                           | średnio                                                               | Supabase Free: brak backupów, 5 GB egress                                                                                                          |
| **1c. Vercel Pro + Supabase Pro + worker na Railway/Fly.io**                           | 20 + 25 + ~5–8 ≈ **50–53 USD**                                                                                             | ~50–60 USD                                                                           | najniższe (wszystko zarządzane)                                                         | średnio                                                               | Fly/Railway: trwała sesja Baileys wymaga wolumenu; koszt rośnie z RAM                                                                              |
| **2. Azure (Poland Central)**                                                          | po darmowym roku ≈ **43 USD** (App Service B1 13,15 + PG B1MS ~18,9 + VM pod worker ~10,6); w 1. roku ~24 USD (PG darmowy) | ~43–60 USD                                                                           | **najwyższe** (~2–4 h/mies. + 15–30 h na start: IAM, sieć, firewall PG, alerty kosztów) | słabe: fork musi mieć Azure + IaC (Bicep/Terraform)                   | brak gotowego Auth z Discordem → Auth.js; złożoność portalu; ryzyko „zapomnianych” zasobów na rachunku                                             |
| **3. Jeden VPS (Docker Compose: Next.js + Postgres + worker + cron + Caddy)**          | OVH VPS-1: **20,07 zł brutto (~5,4 USD)**; Hetzner CPX22: 16,99–19,99 EUR netto                                            | to samo (ewentualnie większy VPS)                                                    | średnie–wysokie (~3–5 h/mies. + 15–25 h na start); jedna osoba trzyma klucze            | **najlepsze**: `docker compose up` stawia całość lokalnie i dla forka | wszystko na jednej maszynie (SPOF, _single point of failure_: jeden punkt, którego awaria kładzie całość); backupy i aktualizacje na Waszej głowie |
| **4. Hybryda (rekomendowana): Vercel + Supabase + tani VPS na worker/scrapery/backup** | Hobby: **~5–6 USD** (sam VPS); Pro: ~25 USD                                                                                | ~25–50 USD                                                                           | niskie–średnie (~2–3 h/mies.)                                                           | dobre, jeśli repo ma `docker-compose.yml` do lokalnego dev            | jak 1b; Hobby tylko przy braku elementu komercyjnego                                                                                               |

### Details per option

#### Wspólne dla wszystkich opcji

- **wa-worker (Baileys)** to stały proces z wychodzącym WebSocketem do WhatsAppa i sesją w `auth_info/` na dysku. Nie przyjmuje ruchu przychodzącego, więc nie potrzebuje publicznego IPv4 ani portów 80/443. Dlatego nada się nawet najtańszy VPS ze współdzielonym IPv4 (Mikrus). Po utracie sesji ktoś z telefonem właściciela konta musi zeskanować QR, i to w każdej opcji jest głównym „incydentem” do opisania w runbooku. Baileys to nieoficjalny klient WhatsAppa, więc konto może zostać zablokowane niezależnie od hostingu. Bywa twierdzone, że IP z centrum danych zwiększa to ryzyko. **Niezweryfikowane**, anegdotyczne.
- **Scrapery na GitHub Actions**: dla publicznych repo standardowe runnery są darmowe (zweryfikowane). Najkrótszy interwał `schedule` to 5 min, przy obciążeniu GitHub może opóźnić start. **W publicznym repo harmonogramy wyłączają się automatycznie po 60 dniach bez aktywności w repo** (zweryfikowane). W projekcie społecznościowym z rzadkimi commitami to realnie zaboli. Obejście: commit „keepalive” albo cron na VPS-ie, który i tak będzie.
- **Backup bazy z GitHub Actions**: artefakty i logi w publicznym repo są publiczne. Zrzutu bazy z kontami użytkowników (RODO) nie wolno tam odkładać bez szyfrowania. Lepiej robić `pg_dump` z VPS-a do zewnętrznego storage'u.
- **Discord**: webhooki to zwykłe wywołania HTTP, działają z funkcji serverless. Bot z gatewayem (stały WebSocket) musiałby stać na VPS-ie obok wa-workera. Bot HTTP-interactions działa jako endpoint w Next.js. Decyzja należy do agent-b. Koszt hostingu zmienia się tylko przy bocie z gatewayem, a i tak zmieści się na tym samym VPS-ie.

#### 1. Vercel + Supabase + worker gdzie indziej

**Vercel** ([pricing](https://vercel.com/pricing), [Hobby](https://vercel.com/docs/plans/hobby)):

|                    | Hobby                                                      | Pro                                                                                     |
| ------------------ | ---------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Cena               | 0 USD                                                      | 20 USD/mies. za miejsce dewelopera (Viewer za darmo), zawiera 20 USD kredytu na zużycie |
| Fast Data Transfer | 100 GB                                                     | 1 TB, potem od 0,15 USD/GB                                                              |
| CDN requests       | 1 mln                                                      | 10 mln, potem od 2 USD/1 mln                                                            |
| Active CPU         | 4 h                                                        | od 0,128 USD/h                                                                          |
| Provisioned memory | 360 GB-h                                                   | od 0,0106 USD/GB-h                                                                      |
| Wywołania funkcji  | 1 mln                                                      | 0,60 USD/1 mln                                                                          |
| Max czas funkcji   | 300 s                                                      | 300 s domyślnie, do 800 s (1800 s w becie)                                              |
| Cron               | 100/projekt, **najczęściej raz na dobę**, precyzja ±59 min | 100/projekt, co minutę                                                                  |
| Logi runtime       | 1 h                                                        | 1 dzień                                                                                 |
| Po przekroczeniu   | nie da się dokupić; funkcja zwykle stoi do upływu 30 dni   | pay-as-you-go                                                                           |

- Skala: kilkaset do kilku tysięcy wizyt plus 10–50 wywołań ekstrakcji dziennie to ułamek limitów Hobby. Ekstrakcja AI czeka na odpowiedź Claude'a (sieć), a _Active CPU_ liczy tylko faktyczną pracę procesora. Czas oczekiwania wpada w _Provisioned Memory_: 1500 wywołań × ~30 s × 1–2 GB ≈ 12–25 GB-h, przy limicie 360 GB-h.
- **Cron na Hobby raz na dobę** wyklucza Vercel Cron jako mechanizm ponowień outboxa Discorda. Ponawiać mogą GitHub Actions albo cron na VPS-ie, który woła endpoint.
- **MCP (Streamable HTTP)**: narzędzia są read-only i krótkie, więc tryb bezstanowy (jedno żądanie, jedna odpowiedź) mieści się w 300 s. Długo otwarte strumienie SSE (_Server-Sent Events_, jednokierunkowy strumień serwer→klient) zjadałyby provisioned memory i kończyłyby się na limicie czasu funkcji. Na tę skalę to nie problem.
- **Zimne starty** (_cold start_: pierwsze żądanie po bezczynności uruchamia funkcję od zera, kilkaset ms do kilku s): przy małym ruchu występują, ale ISR/cache stron listy je maskuje.
- **Komercyjność Hobby**: regulamin, sekcja 4: _„You shall only use the Services under a Hobby plan for your personal or non-commercial use.”_ ([terms](https://vercel.com/legal/terms)). Strona regulaminu, którą pobrałem, **nie definiuje** „commercial”. Starsza dokumentacja Vercela definiowała to szeroko (każde wdrożenie służące korzyści finansowej kogokolwiek zaangażowanego), ale **w obecnej wersji tego nie zweryfikowałem**. Praktycznie: sponsorzy, płatne wyróżnienia albo logo partnerów w Kompasie to szara strefa. Landing jest statyczny i może zostać na GitHub Pages (jak teraz, za darmo), więc kwestia dotyczy tylko Kompasu.
- **Vercel Daemons** (beta, kontenerowe procesy w tle) jako dom dla wa-workera ([KB](https://vercel.com/kb/guide/vercel-daemons)): beta, **brak trwałego dysku lokalnego**, więc sesję Baileys trzeba by trzymać w bazie albo Blobie. Na Hobby jest 420 GB-h pamięci, czyli instancja 2 GiB wytrzymuje ok. 9 dni ciągłej pracy (1 GiB ok. 17 dni), potem stop do końca miesiąca. Na Pro: 0,0212 USD/GB-h, więc 1 GiB 24/7 ≈ 15,5 USD/mies. plus CPU. Czy kredyt Pro pokrywa Daemons: **niezweryfikowane**. Nie polecam: drożej niż VPS, beta, dodatkowa praca nad stanem.

**Supabase** ([pricing](https://supabase.com/pricing), [compute](https://supabase.com/docs/guides/platform/compute-and-disk)):

|            | Free                               | Pro                                                                                   |
| ---------- | ---------------------------------- | ------------------------------------------------------------------------------------- |
| Cena       | 0 USD, 2 aktywne projekty          | od 25 USD/mies., zawiera 10 USD kredytu na compute (pokrywa Micro: 1 GB RAM, ~10 USD) |
| Baza       | 500 MB                             | 8 GB dysku, potem 0,125 USD/GB                                                        |
| MAU (Auth) | 50 000                             | 100 000                                                                               |
| Egress     | 5 GB                               | 250 GB, potem 0,09 USD/GB                                                             |
| Backupy    | **brak**                           | codzienne, 7 dni                                                                      |
| Pauza      | po tygodniu bezczynności           | nigdy                                                                                 |
| Połączenia | Nano: 60 do bazy, 200 przez pooler | Micro: 60 / 200                                                                       |

- **Pooling połączeń Postgres ↔ serverless**: każda funkcja Vercela otwiera połączenie, więc trzeba używać poolera Supabase w trybie transakcyjnym. Limit 200 klientów poolera wystarczy z dużym zapasem.
- Pauza po tygodniu: codzienne ingesty z workera i scraperów powinny ją zapobiegać. Co dokładnie liczy się jako „aktywność”: **niezweryfikowane**.
- 500 MB wystarczy na lata dla tekstu wpisów (założenie < 1 GB), pod warunkiem że obrazki z WhatsAppa idą do storage'u, a nie do bazy.
- Region EU (np. Frankfurt) jest dostępny, ale w tej sesji **tego nie zweryfikowałem** na stronie Supabase.

**Gdzie postawić worker** (koszt miesięczny):

| Miejsce                                   | Koszt                                                                                                                               | Uwagi                                                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Domowy PC (jak teraz)                     | 0 zł + prąd                                                                                                                         | wyłączenie PC = brak ingestu; nie wymaga zmian                                                                    |
| Raspberry Pi                              | jednorazowo (ceny sprzętu nie sprawdzałem)                                                                                          | domowe IP; ktoś musi mieć Pi u siebie                                                                             |
| **Mikrus 2.1** (1 GB RAM, 10 GB, Docker)  | **75 zł/rok (6,25 zł/mies.)**, tylko rocznie ([mikr.us](https://mikr.us/))                                                          | współdzielone IPv4 z przekierowanymi portami + własne IPv6. Workerowi wystarcza, dla publicznej strony WWW gorzej |
| **OVH VPS-1** (2 vCore, 4 GB, 40 GB NVMe) | **16,32 zł netto / 20,07 zł brutto** ([OVH](https://www.ovhcloud.com/pl/vps/))                                                      | dzienny backup (ostatnie 24 h) w cenie; lokalizacja w Polsce oferowana, miasto niezweryfikowane                   |
| Hetzner CPX12 (1 vCPU, 2 GB, 40 GB)       | 9,99 EUR (Helsinki) / 11,99 EUR (DE) netto ([Hetzner](https://www.hetzner.com/cloud/regular-performance/))                          | tańsza linia CX (Cost-Optimized) oznaczona jako „Currently not available”                                         |
| Fly.io shared-cpu-1x 1 GB                 | 7,73 USD/mies. (Frankfurt) + wolumen 0,15 USD/GB ([Fly](https://docs.fly.io/about/pricing))                                         | darmowy plan: 1 USD kredytu, 5 USD/mies. po podaniu karty                                                         |
| Railway Hobby                             | 5 USD/mies. z 5 USD kredytu; RAM ~10 USD/GB-mies., vCPU ~20 USD/mies., wolumen 0,15 USD/GB ([Railway](https://railway.com/pricing)) | worker ~200–300 MB RAM zmieści się w okolicach kredytu (szacunek); regiony EU niezweryfikowane                    |

#### 2. Azure

Ceny z oficjalnego Azure Retail Prices API dla regionu **Poland Central** (Warszawa), pay-as-you-go, USD, 730 h/mies.:

| Składnik                                              | Cena                                                                                                                                                                                                                       | Miesięcznie                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| PostgreSQL Flexible Server B1MS (1 vCore, 2 GiB)      | 0,0199 USD/h                                                                                                                                                                                                               | 14,53 USD                                                                               |
| Storage PG                                            | 0,137 USD/GB-mies. × 32 GB                                                                                                                                                                                                 | 4,38 USD                                                                                |
| App Service Basic B1 Linux (Next.js, zawsze włączony) | 0,01802 USD/h                                                                                                                                                                                                              | 13,15 USD                                                                               |
| VM B2ats v2 (2 vCPU burst, 1 GiB) pod worker          | 0,0108 USD/h                                                                                                                                                                                                               | 7,88 USD                                                                                |
| VM B1s (alternatywa)                                  | 0,012 USD/h                                                                                                                                                                                                                | 8,76 USD                                                                                |
| Dysk Standard SSD E4 (32 GiB)                         | 2,40 USD + 0,338 USD „mount”                                                                                                                                                                                               | ~2,74 USD                                                                               |
| Container Apps (alternatywa dla Next.js)              | aktywne: 0,000024 USD/vCPU-s, 0,000003 USD/GiB-s; bezczynne vCPU 0,000003 USD/s; darmowe 180 000 vCPU-s + 360 000 GiB-s + 2 mln żądań/mies. ([pricing](https://azure.microsoft.com/en-us/pricing/details/container-apps/)) | scale-to-zero ≈ 0–3 USD (z zimnym startem); 1 replika 0,5 vCPU/1 GiB bezczynna ≈ 10 USD |
| Static Web Apps (landing)                             | Free 0 USD; Standard 9 USD/app (West Europe)                                                                                                                                                                               | 0 USD                                                                                   |

- **Razem po darmowym roku: ok. 43 USD/mies.** (B1 + PG + VM + dysk). W pierwszym roku nowe konto ma **750 h B1MS + 32 GB storage PostgreSQL miesięcznie przez 12 miesięcy** (dokumentacja Microsoft, potwierdzone w wynikach wyszukiwania, strony nie otworzyłem w całości), więc ok. 24 USD/mies. Darmowe godziny VM B1s/B2ats w pakiecie 12-miesięcznym: **niezweryfikowane**.
- **Granty**: Microsoft for Nonprofits daje **2000 USD rocznie** kredytów Azure, odnawialne. Wymaga zweryfikowanej organizacji non-profit (osobowość prawna; szczegółowych kryteriów dla PL nie sprawdziłem). Kwadrat jako nieformalna społeczność się nie kwalifikuje. Microsoft for Startups (dawne Founders Hub): do 5000 USD dla samoobsługowych startupów, ale to program dla firm-startupów, nie dla społeczności. Liczby się różnią między źródłami, **niezweryfikowane** na stronie głównej programu.
- Auth: na Azure nie ma odpowiednika Supabase Auth z Discordem „z pudełka”, więc **Auth.js** (biblioteka logowania do Next.js) z providerem Discord. RLS w Postgresie nadal działa, ale identyfikator użytkownika trzeba przekazywać do bazy samodzielnie (np. `set_config` na początku transakcji). To więcej kodu i więcej miejsc na błąd niż `auth.uid()` w Supabase.
- Ops: portal, role IAM, reguły firewall PG, sieć, alerty budżetowe. Dla juniora z wolontariuszami to najwięcej nowej wiedzy przy najmniejszej korzyści na tej skali.
- Lock-in umiarkowany: Postgres i kontenery Docker są przenośne, a konfiguracja (IaC, sieć) nie.

#### 3. Jeden VPS

Stos: Docker Compose z `kompas` (Next.js w trybie `standalone`), `postgres` (+ pgvector), `wa-worker`, `scrapers` (cron w kontenerze albo systemowy), **Caddy** (reverse proxy, czyli serwer przyjmujący ruch HTTPS i przekazujący go do aplikacji; sam pobiera i odnawia certyfikaty TLS z Let's Encrypt), backup `pg_dump` → zewnętrzny storage.

- **RAM**: Next.js ~200–400 MB, Postgres ~200–500 MB, worker ~150–300 MB, Caddy ~30 MB. 2 GB to minimum na styk, **4 GB komfortowo** (OVH VPS-1 albo Hetzner CPX22 2 vCPU/4 GB/80 GB: 16,99 EUR HEL / 19,99 EUR NBG netto). Zużycie RAM to moje szacunki.
- **Self-hosted Supabase** to ok. 10 kontenerów (Kong, GoTrue, PostgREST, Realtime, Storage, Studio, Meta, analityka…). Na 4 GB to ciężkie i dużo ruchomych części do aktualizowania. Na VPS-ie prościej: zwykły Postgres + Auth.js (Discord). Oficjalne minimalne wymagania self-hosted Supabase: **niezweryfikowane**.
- **Coolify** (open-source'owy, samohostowany „Vercel na własnym serwerze”: deploy z gita, TLS, backupy do S3) zdejmuje część pracy, ale sam zużywa RAM. Wymagania **niezweryfikowane**.
- **Backupy**: dzienny backup OVH obejmuje tylko ostatnie 24 h i ten sam dostawca. Hetzner Backups od 1,098 EUR/mies. Do tego potrzebny osobny `pg_dump` (szyfrowany) poza serwerem i test odtworzenia raz na kwartał. Cen storage'u obiektowego nie sprawdzałem.
- **Ops konkretnie**: start 15–25 h (SSH tylko kluczem, firewall, `unattended-upgrades` czyli automatyczne łatki bezpieczeństwa, Docker, Caddy, backup + test odtworzenia, monitoring dostępności z zewnątrz). Potem ~3–5 h/mies.: aktualizacje obrazów, przegląd logów, odnawianie się psuje rzadko. Incydent (dysk pełny, zawieszony kontener): 1–4 h, i to zawsze ten jeden człowiek z dostępem.
- **Open source**: najlepsza opcja. Ten sam `docker-compose.yml` służy do lokalnego dev, do produkcji i dla forka „Kompas Poznań”.
- **10×**: ten sam VPS spokojnie to obsłuży; wąskim gardłem będzie raczej API Claude'a niż serwer.

#### 4. Hybryda (rekomendowana)

- **Vercel** (Hobby albo Pro): Kompas UI, API, `/mcp`, wysyłka Discord (webhooki).
- **Supabase** (Free → Pro, gdy pojawią się prawdziwi użytkownicy z opiniami): Postgres, Auth (Discord OAuth), RLS, pooler.
- **Jeden tani VPS** (OVH VPS-1 ~20 zł brutto albo Mikrus 3.0, 2 GB, 130 zł/rok, jeśli wystarczy współdzielone IPv4): wa-worker, scrapery z crona (bez ryzyka 60-dniowego wyłączenia w GitHub Actions), ponawianie outboxa, nocny szyfrowany `pg_dump` z Supabase poza Supabase. To łata na brak backupów w Supabase Free.
- **Landing**: zostaje na GitHub Pages (0 zł, brak pytania o komercyjność) albo idzie na Vercel, zgodnie z planem.
- Przenośność: repo ma `docker-compose.yml` z Postgresem do lokalnego dev, Next.js buduje się też w trybie `standalone`, bez zależności od usług tylko-Vercel (Edge Config, KV, Blob, Daemons, Cron w `vercel.json`). Wtedy przejście na opcję 3 to dzień pracy, nie przepisywanie.
- Ryzyko lock-in: Supabase Auth (`auth.users`, `auth.uid()` w politykach RLS). Wyjście z Supabase wymaga przepisania logowania i polityk. To świadomy koszt za wygodę na start.

### Anthropic API cost

Ceny z [platform.claude.com/docs/en/about-claude/pricing](https://platform.claude.com/docs/en/about-claude/pricing) (2026-11-23). **Cache'owana kwota orkiestratora 2 USD / 10 USD za MTok dla `claude-sonnet-5-5` się zgadza.**

| Model                                    | Input      | Output      | Cache hit             | Batch (−50%) in/out |
| ---------------------------------------- | ---------- | ----------- | --------------------- | ------------------- |
| Claude Sonnet 5.5                        | 2 USD/MTok | 10 USD/MTok | 0,10 USD/MTok (0,05×) | 1 / 5 USD           |
| Claude Opus 5.5 (domyślny w planie §4.6) | 4          | 20          | 0,20                  | 2 / 10              |
| Claude Haiku 5.5 (prompt ≤100k)          | 0,10       | 0,50        | 0,01                  | 0,05 / 0,25         |

Zapis do cache: 1,25× ceny inputu (5 min) albo 2× (1 h). Rabaty batch i cache się sumują.

**Założenia tokenowe na wpis:**

- **A (typowe)**: input 4000 tokenów (prompt systemowy + schemat Zod + przykłady ~2500, treść ~1500), output 1000 (JSON ~400 + myślenie ~600 przy `effort: low`). Sonnet 5.5 ma myślenie zawsze włączone i domyślny effort `high`, więc **dla ekstrakcji warto ustawić `low` jawnie**, bo tokeny myślenia płaci się jak output.
- **B (pesymistyczne)**: input 8000 (długie strony ze scraperów), output 3000 (wyższy effort).
- Nowy tokenizer (modele 4.7+) daje ok. 30% więcej tokenów niż starsze modele dla tego samego tekstu. Założenia już to uwzględniają w przybliżeniu. Dla polskiego tekstu rzeczywista liczba **niezweryfikowana**: zmierzyć `count_tokens` na 30–50 prawdziwych wiadomościach.

| Wariant       | Na wpis    | 10 wpisów/dzień (300/mies.) | 50/dzień (1500/mies.) | 500/dzień (10× wolumen) |
| ------------- | ---------- | --------------------------- | --------------------- | ----------------------- |
| Sonnet 5.5, A | 0,018 USD  | **5,40 USD**                | **27 USD**            | 270 USD                 |
| Sonnet 5.5, B | 0,046 USD  | 13,80 USD                   | 69 USD                | 690 USD                 |
| Opus 5.5, A   | 0,036 USD  | 10,80 USD                   | 54 USD                | 540 USD                 |
| Haiku 5.5, A  | 0,0009 USD | 0,27 USD                    | 1,35 USD              | 13,50 USD               |

- **Batch API** dla scraperów (wyniki do ~24 h, bez pośpiechu): −50% na tej części. Przy połowie wolumenu ze scraperów Sonnet A dla 50/dzień spada z ok. 27 do ok. 20 USD.
- **Prompt caching**: stały prefiks ~2500 tokenów, cache hit oszczędza ok. 0,0047 USD na wpis (~26% wariantu A). Działa tylko, gdy wpisy przychodzą w odstępach poniżej 5 min (paczki ze scrapera: tak; pojedyncze wiadomości z WhatsAppa: rzadko), i tylko gdy prefiks przekracza minimalną długość cache'owalną modelu. Ten próg dla Sonnet 5.5 jest **niezweryfikowany** (zależnie od modelu 512–4096 tokenów).
- Tani wstępny filtr (np. „dzięki!”, emoji, wiadomości < N znaków) przed wywołaniem AI zmniejsza wolumen z WhatsAppa bez żadnego kosztu.
- Koszt API jest **taki sam w każdej opcji hostingu**.

### Recommendation and decision rule

**Teraz (w miesiącu Vercel Pro):** budować na Vercel + Supabase zgodnie z planem, ale:

1. Od razu postawić **jeden tani VPS** (OVH VPS-1 ~20 zł/mies. albo Mikrus 3.0 130 zł/rok) na wa-workera, cron scraperów, ponowienia outboxa i nocny backup Supabase. Wyprowadza to workera z domowego PC i łata brak backupów w Supabase Free.
2. Trzymać kod przenośny: `docker-compose.yml` do lokalnego dev, Next.js `standalone`, żadnych usług tylko-Vercel.
3. W ustawieniach Vercel Pro włączyć **Spend Management** (limit wydatków), żeby miesiąc testowy nie skończył się niespodzianką.

**Reguła decyzyjna po końcu miesiąca Pro:**

- **Jeśli Kompas nie ma nic komercyjnego** (brak płatnych wyróżnień, sponsorów i logo partnerów w aplikacji) → **zejść na Vercel Hobby**. Koszt hostingu ≈ sam VPS (~5 USD). Landing zostaje na GitHub Pages.
- **Jeśli jest jakikolwiek element komercyjny** (sponsor, partner, płatne wyróżnienie) → albo **zostać na Pro (20 USD/mies.)**, gdy wygoda deployu jest warta tyle co mały VPS, albo **przenieść Next.js na ten sam VPS** (Caddy + Docker, ~1 dzień pracy dzięki przenośnemu kodowi). Wybór zależy od tego, czy w zespole jest ktoś, kto weźmie na siebie ops VPS-a.
- **Jeśli pojawią się prawdziwi użytkownicy z kontami i opiniami** (RODO, wartość danych) → Supabase Pro (25 USD) dla codziennych backupów i braku pauzy, albo przejście w całości na VPS z własnym backupem.
- **Azure: tylko jeśli Kwadrat uzyska grant Microsoft for Nonprofits** (2000 USD/rok, wymaga zarejestrowanej organizacji). Bez grantu Azure jest najdroższy (~43 USD/mies.) i najbardziej pracochłonny przy tej skali.
- **Jeśli koszt ma być minimalny, a ktoś zna Linuksa** → opcja 3 (wszystko na jednym VPS, ~20–80 zł/mies.), najlepsza też pod forki dla innych miast.

Decyzja o modelu (Sonnet 5.5 vs Haiku 5.5 vs Opus 5.5) wpływa na budżet bardziej niż wybór hostingu i należy do Ciebie. Liczby powyżej dają skalę: przy 50 wpisach/dzień to ok. 1 USD (Haiku), 27 USD (Sonnet) albo 54 USD (Opus) miesięcznie.

### Sources

Wszystkie sprawdzone 2026-11-23.

- https://platform.claude.com/docs/en/about-claude/pricing: ceny Sonnet/Opus/Haiku 5.5, cache (0,05× dla Sonnet 5.5), batch −50%, informacja o ~30% więcej tokenów w nowym tokenizerze
- https://platform.claude.com/docs/en/manage-claude/data-residency: `inference_geo` tylko `global`/`us`; workspace geo tylko `us` (brak przetwarzania wyłącznie w EU)
- https://vercel.com/pricing: Hobby 0 USD, Pro 20 USD/miejsce + 20 USD kredytu, limity i stawki zużycia
- https://vercel.com/docs/plans/hobby: tabela Hobby vs Pro (czas funkcji 300/800 s, logi, deploye, brak dokupowania na Hobby, pauza do 30 dni)
- https://vercel.com/docs/cron-jobs/usage-and-pricing: cron Hobby raz na dobę ±59 min, Pro co minutę; Cron Jobs to „legacy”, przechodzą na Schedules
- https://vercel.com/legal/terms: Hobby tylko „personal or non-commercial use”, bez definicji „commercial”
- https://vercel.com/docs/limits/fair-use-guidelines: stawki pay-as-you-go Pro (Active CPU 0,128 USD/h, pamięć 0,0106 USD/GB-h)
- https://vercel.com/kb/guide/vercel-daemons: Daemons w becie, bez trwałego dysku, limity Hobby
- Wyniki wyszukiwania (vercel.com/pricing, vercel.com/docs/sandbox/pricing): stawka pamięci Daemons 0,0212 USD/GB-h (ze strony nie potwierdziłem wprost)
- https://supabase.com/pricing: Free/Pro (25 USD, 10 USD compute, 500 MB / 8 GB, egress 5 / 250 GB, backupy, pauza)
- https://supabase.com/docs/guides/platform/compute-and-disk: Nano/Micro/Small, limity połączeń i poolera
- https://docs.github.com/en/billing/concepts/product-billing/github-actions: Actions darmowe dla publicznych repo
- https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows: `schedule` min. 5 min, opóźnienia, auto-wyłączenie po 60 dniach w publicznych repo
- https://www.hetzner.com/cloud/ i https://www.hetzner.com/cloud/regular-performance/: CPX02–CPX62, ceny netto, CX niedostępne, backup od 1,098 EUR
- https://www.ovhcloud.com/pl/vps/: VPS-1 do VPS-4, ceny netto/brutto PLN, dzienny backup
- Wyszukiwanie „OVHcloud VPS Polska” (ovhcloud.com/en/vps/vps-poland/): lokalizacja w Polsce (miasto niepotwierdzone)
- https://mikr.us/: plany 1.0–4.2, ceny roczne brutto, współdzielone IPv4 + IPv6, ograniczenia
- https://docs.fly.io/about/pricing: shared-cpu-1x 1 GB Frankfurt 7,73 USD, wolumen 0,15 USD/GB, IPv4 2 USD, plan Free
- https://railway.com/pricing: plany i stawki za zasoby
- https://neon.com/pricing: Free (100 CU-h/projekt, 0,5 GB→1 GB/projekt, scale-to-zero), Launch (0,106 USD/CU-h, 0,35 USD/GB-mies.); alternatywa dla Supabase DB bez Auth
- https://prices.azure.com/api/retail/prices (oficjalne Azure Retail Prices API), region polandcentral: PG B1MS 0,0199 USD/h, storage PG 0,137 USD/GB, App Service B1 Linux 0,01802 USD/h, VM B1s 0,012 / B2ats v2 0,0108 USD/h, dysk E4 2,40 USD, Container Apps stawki za sekundę; westeurope: Static Web Apps Standard 9 USD/app
- https://azure.microsoft.com/en-us/pricing/details/container-apps/: darmowa pula 180k vCPU-s / 360k GiB-s / 2 mln żądań
- https://azure.microsoft.com/en-us/pricing/details/app-service/static/: SWA Free vs Standard (100 GB transferu na subskrypcję)
- Wyszukiwanie + learn.microsoft.com/azure/postgresql/flexible-server/how-to-deploy-on-azure-free-account (z wyników): 12 mies. 750 h B1MS + 32 GB
- Wyszukiwanie (Microsoft Nonprofit Offers Guide PDF, learn.microsoft.com Q&A): grant 2000 USD/rok dla nonprofit
- Wyszukiwanie (learn.microsoft.com/en-us/startups/changes-microsoft-for-startups): Microsoft for Startups do 5000 USD samoobsługowo (liczby niespójne między źródłami)

### Risks

- **Niezweryfikowane liczby**: kursy walut; stawka Daemons Pro i to, czy pokrywa ją kredyt Pro; darmowe godziny VM w pakiecie Azure na 12 mies.; kryteria grantu nonprofit w PL; region EU w Supabase i regiony funkcji Vercela (nie sprawdzałem w tej sesji); miasto DC OVH; minimalny prefiks cache dla Sonnet 5.5; RAM komponentów na VPS-ie i wymagania self-hosted Supabase/Coolify; definicja „commercial” na Vercel Hobby.
- **Założenia, które zmieniają odpowiedź**:
  - Długie strony ze scraperów (np. 20k tokenów HTML zamiast oczyszczonego tekstu) mnożą koszt API kilkukrotnie. Czyścić HTML przed wysłaniem.
  - Jeśli zostanie domyślny `claude-opus-5-5` z planu §4.6 zamiast Sonnet 5.5, koszt API rośnie 2×.
  - Wolumen > ~100 wpisów/dzień: wtedy model i batch/caching mają większe znaczenie niż hosting.
  - Pojawienie się sponsorów przesuwa wybór z Hobby na Pro albo VPS.
  - Bot Discorda z gatewayem wymaga stałego procesu. Zmieści się na tym samym VPS-ie, ale wtedy VPS hostuje już dwa krytyczne procesy.
- **RODO**: hosting w EU (Hetzner DE/FI, OVH PL, Azure Poland Central, Supabase/Vercel z regionem EU) nie zmienia tego, że **Anthropic API przetwarza i przechowuje dane poza EU** (dostępne geo: tylko `global`/`us`, workspace geo tylko `us`). Przed wysłaniem do AI usuwać imiona i numery nadawców (plan §4.4 już mówi, żeby ich nie zapisywać; trzeba też ich nie wysyłać). Z dostawcami potrzebne umowy powierzenia (DPA). Szczegółów DPA poszczególnych dostawców nie sprawdzałem.
- **GitHub Actions**: wyłączenie harmonogramu po 60 dniach bez commitów w publicznym repo to cicha awaria scraperów. Monitoring „0 pozycji przez X dni” z planu §4.5 to wychwyci, ale lepiej trzymać cron na VPS-ie.
- **Baileys/WhatsApp**: ryzyko blokady konta i potrzeba ręcznego ponownego parowania (QR) są takie same we wszystkich opcjach. To główne ryzyko operacyjne, większe niż wybór hostingu.
- **Jedna osoba z kluczami** (VPS, konta Vercel/Supabase/Anthropic): przy projekcie wolontariackim potrzebne jest współdzielone zarządzanie sekretami i drugi admin. Inaczej odejście jednej osoby blokuje projekt.
