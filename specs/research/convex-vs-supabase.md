# Convex vs Supabase dla Kompasu

Sprawdzone 2026-11-23 na stronach Convexa (źródła na dole).

## Co Convex daje temu projektowi

| Potrzeba Kompasu                                                             | Supabase                              | Convex                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------- | ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ponowienia outboxa Discorda, przypomnienia o terminach, wygaszanie wyróżnień | Zewnętrzny cron (VPS) albo `pg_cron`  | **Wbudowane crony i zaplanowane funkcje.** Zaplanowanie wysyłki w mutacji jest transakcyjne: jeśli zapis wpisu się nie uda, wysyłka też się nie zaplanuje. To jest dokładnie gwarancja outboxa, bez pisania jej samemu |
| Scrapery według harmonogramu                                                 | Cron na VPS-ie                        | Crony + akcje (Node do 10 min, runtime Convexa do 30 min), więc **scrapery bez VPS-a**                                                                                                                                 |
| Kolejka moderacji odświeżana na żywo                                         | Realtime jako dodatek                 | Każde zapytanie jest reaktywne z definicji                                                                                                                                                                             |
| Schemat danych                                                               | SQL + migracje + osobno Zod           | Schemat w TypeScript, jeden język w całym repo                                                                                                                                                                         |
| Wyszukiwanie semantyczne (później)                                           | pgvector                              | Wbudowany vector search                                                                                                                                                                                                |
| Pliki (obrazki z WhatsAppa)                                                  | Storage                               | Wbudowany file storage                                                                                                                                                                                                 |
| Uprawnienia                                                                  | **RLS w bazie**                       | **W kodzie funkcji**: każda funkcja sama sprawdza rolę. Potrzebne opakowania typu `adminMutation` + testy, bo zapomniany warunek to dziura                                                                             |
| Ranking (średnia bayesowska), zliczenia                                      | Jedno zapytanie SQL                   | Bez SQL: liczniki trzymane w dokumentach albo komponent Aggregate                                                                                                                                                      |
| Logowanie przez Discord                                                      | Wspierane oficjalnie                  | Convex Auth oficjalnie wspiera GitHub, Google, Apple. **Discord działa przez providera Auth.js, ale „bez wsparcia”.** Alternatywa: Clerk (kolejny dostawca)                                                            |
| Region UE                                                                    | Tak                                   | Tak, **Irlandia**, z dopłatą 30% za zużycie ponad darmowe limity                                                                                                                                                       |
| Backupy                                                                      | Free: brak, Pro: dzienne              | Free: brak, Pro: dzienne                                                                                                                                                                                               |
| Koszt                                                                        | Free / Pro 25 USD                     | Free 0 USD. **Program „Convex for Open Source”: darmowy Pro dla aktywnie utrzymywanego, w pełni otwartego projektu**, więc dzienne backupy w cenie                                                                     |
| Wyszukiwanie po polsku                                                       | Brak polskiego słownika w standardzie | Prosty tokenizer, bez odmiany (np. „dofinansowanie” nie trafi na „dofinansowania”). Remis; ratuje wyszukiwanie wektorowe                                                                                               |
| Uzależnienie od dostawcy                                                     | Postgres jest przenośny               | API Convexa jest własne. Backend jest open source (licencja FSL-Apache-2.0) i da się go hostować samemu, ale wyjście z Convexa oznacza przepisanie warstwy danych                                                      |
| Lokalny dev / fork dla innego miasta                                         | `supabase start` (Docker)             | Lokalny backend open source albo darmowe konto                                                                                                                                                                         |

## Wpływ na architekturę

- VPS zostaje **tylko dla wa-workera**: Baileys potrzebuje stałego połączenia, a tego Convex też nie da. Wystarczy najtańszy (Mikrus) albo na początek Twój PC.
- `/api/ingest` staje się HTTP action w Convexie. Discord, crony i scrapery też w Convexie.
- Next.js na Vercelu: UI, panel i `/mcp`. MCP czyta z Convexa przez klienta HTTP.

## Rekomendacja

Convex pasuje tu **lepiej** niż Supabase. Większość „klejenia”, które planowałem ręcznie (outbox, cron na VPS-ie, sweeper ponowień, nocny backup), dostajemy gotowe, a całość jest w jednym języku. Za to płacimy uzależnieniem od API Convexa i dwiema rzeczami do sprawdzenia na start:

1. **Spike** (krótki eksperyment do wyrzucenia) na 1–2 h: logowanie przez Discord w Convex Auth. Jeśli zadziała, idziemy dalej. Jeśli nie: Google + Discord przez Clerk albo inne rozwiązanie.
2. **Zgłoszenie do programu Convex for Open Source** po upublicznieniu repo (backupy).

## Źródła

- https://www.convex.dev/pricing: plany, limity Free, backupy tylko Pro
- https://docs.convex.dev/production/regions: `aws-eu-west-1` Irlandia, +30%
- https://docs.convex.dev/self-hosting: licencja FSL-Apache-2.0, self-hosting
- https://labs.convex.dev/auth/config/oauth: oficjalnie GitHub/Google/Apple, pozostałe providery Auth.js bez wsparcia
- https://docs.convex.dev/production/state/limits: czas akcji 10 min (Node) / 30 min (runtime Convexa)
- https://docs.convex.dev/search/text-search: tokenizer bez odmiany, najlepiej dla angielskiego
- https://www.convex.dev/open-source-program: darmowy Pro dla projektów open source
