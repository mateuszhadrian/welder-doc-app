# Podsumowanie sesji planowania PRD — Aplikacja do projektowania złączy spawanych

---

## Decyzje

1. **Docelowy użytkownik** — technik/technolog bez tła CAD; priorytet to maksymalna prostota obsługi dla każdego użytkownika.
2. **Wielojęzyczność** — i18n wbudowane w architekturę od MVP; minimum PL/EN.
3. **Model biznesowy** — SaaS z subskrypcją (Free / Pro), rozliczany per-seat (1 subskrypcja = 1 użytkownik).
4. **System kont** — trzy tryby: gość (guest), użytkownik Free, użytkownik Pro; logowanie i rejestracja wymagane dla Free/Pro.
5. **Tryb gościa** — tymczasowy autozapis lokalny (localStorage), baner zachęcający do rejestracji; brak zapisu w chmurze; max 5 elementów na scenie; eksport z watermarkiem; 0 projektów w chmurze.
6. **Plan Free** — max 15 elementów na scenie; 3 projekty w chmurze; eksport z watermarkiem; brak zapisu nieograniczonego.
7. **Plan Pro** — brak znaku wodnego; zniesione limity elementów i projektów; zapis w chmurze bez ograniczeń.
8. **Eksport** — priorytet: PNG/JPG; PDF wyłączony z MVP całkowicie. Warstwa opisowa (legenda, numeracja ściegów) opcjonalna — rysunek musi dać się wyeksportować samodzielnie bez opisu.
9. **Znak wodny** — semi-transparentny tekst po przekątnej obrazu.
10. **Renderowanie** — proporcjonalne (nie schematyczne); wybrany silnik 2D: **Konva.js** (ADR-001, status Accepted, 2026-04-22).
11. **Undo/Redo** — obowiązkowe w MVP, głębokość historii: 20 kroków.
12. **Onboarding** — brak tutoriala w MVP; blank canvas od startu; użytkownicy MVP nauczani werbalnie przez twórców.
13. **Organizacja projektów** — płaska lista w MVP (nazwa, data, akcje: otwórz/usuń/duplikuj).
14. **Grupowanie** — dostępne w MVP; grupa = jeden obiekt (wspólne przesuwanie, obrót, skalowanie); brak wejścia do grupy (no in-group edit).
15. **SNAP magnetyczny** — przyciąganie do geometrii innych elementów jako domyślne; toggle button (podświetlony gdy aktywny) do wyłączania; klawisz klawiatury (przytrzymanie = chwilowe wyłączenie SNAP, zwolnienie = powrót); toggle podświetla się również podczas przytrzymania klawisza.
16. **Canvas** — infinite canvas.
17. **Tryb sekwencji spawania** — ściegi (elipsy/kółka) można wstawiać, przesuwać, skalować; tryb edycji opcjonalny (klik na ścieg = wejście w edycję); po MVP: modyfikacja kształtu (spłaszczenia, wklęsłości, wypukłości) i tworzenie sekwencji z jednego ściegu bazowego.
18. **Walidacja** — przyjęty zakres MVP: walidacja pól liczbowych (inline), walidacja przy dodawaniu elementu (toast), walidacja przy eksporcie (toast), bez walidacji kolizji i zgodności normowej.
19. **Dark/Light mode** — oba tryby dostępne w MVP.
20. **Udostępnianie linkiem** — zaplanowane jako przyszła funkcja (poza MVP); architektura powinna być na to przygotowana.
21. **Normy branżowe** — MVP celuje w dokumentację roboczą/poglądową; zgodność z normami (ISO 2553, AWS A2.4) poza zakresem MVP.
22. **Biblioteka szablonów użytkownika** — poza MVP, zaplanowana na późniejszy etap.
23. **GDPR** — przyjęte podejście "minimum viable compliance" przed launchem (Polityka Prywatności, Regulamin, cookie consent, checkbox zgody przy rejestracji); pełna formalizacja compliance rozszerzana po MVP.
24. **Stack technologiczny** — Next.js (App Router) + React + TypeScript; Tailwind CSS + shadcn/ui; Supabase (PostgreSQL + auth); Cloudflare Pages + GitHub Actions CI/CD; Vitest + React Testing Library + Playwright.
25. **Inspiracja produktowa** — aplikacja Weldia (weldia.app) jako reference, ale cel to radykalne uproszczenie dla jednego "mocowania".
26. **Design UI/UX** — tworzony bezpośrednio przed fazą frontendu; brak makiet na etapie PRD.
27. **Model danych sceny JSON** — przyjęty i gotowy do implementacji jako `scene-graph-schema-v1` (status: zaakceptowany).
28. **Definicja elementu dla limitów planu** — limit 5/15/∞ dotyczy wyłącznie prymitywów (`plate`, `pipe`, `profile`); `weld` i `group` są poza limitem.
29. **Płatności i billing** — rekomendowany dostawca dla MVP: **Paddle (Merchant of Record)**, aby ograniczyć złożoność VAT/faktur i przyspieszyć launch.
30. **Strategia cenowa Pro (robocza do walidacji)** — Pro Monthly: 49 PLN, Pro Annual: 399 PLN (ok. 32% zniżki vs monthly), walidacja na beta-użytkownikach przed finalnym zatwierdzeniem.

---

## Dopasowane rekomendacje

1. **i18n w architekturze od startu** — podjęta decyzja o PL/EN jako minimum; wdrożyć `next-intl` lub `react-i18next` jako fundament przed budową komponentów.
2. **Tabela planów subskrypcji** — zdefiniowane twarde limity dla Guest/Free/Pro; konieczna implementacja feature-flag logic i komunikatów o przekroczeniu limitów w kodzie.
3. **Lokalny autozapis dla gościa** — zaimplementować localStorage persistence z banerem konwersji; niski koszt, wysoki wpływ na retencję i konwersję do rejestracji.
4. **Undo/Redo jako Command Pattern** — 20 kroków historii w MVP; rekomendowane wdrożenie wzorca Command lub biblioteki `zustand` z middleware `temporal` (immer-based).
5. **SNAP z podwójnym trybem wyłączenia** — toggle UI + klawisz klawiatury (przytrzymanie); oba wejścia powinny synchronicznie zmieniać stan wizualny przycisku.
6. **Semantyka grupowania** — grupa jako niepodzielny obiekt w MVP; model danych sceny (scene graph) musi przewidywać węzły grupowe; brak in-group edit upraszcza implementację.
7. **Infinite canvas** — wymagana implementacja viewportu z pan/zoom; eksport wymaga logiki "capture region" niezależnej od viewport transform.
8. **Warstwy eksportu** — rysunek eksportowalny bez opisu; warstwa opisowa (numeracja, legenda) opcjonalna i nakładana na obraz wynikowy; architektura compositing powinna to uwzględnić.
9. **Przygotowanie architektury pod link-sharing** — choć poza MVP, routing i model uprawnień projektów powinny przewidywać przyszłe tokeny publicznego dostępu (np. `shareToken` w schemacie bazy danych).
10. **Next.js zamiast Astro** — potwierdzona decyzja; uzasadnienie: interaktywna SaaS z canvasem, globalnym stanem i autentykacją jest naturalnym środowiskiem App Router + Server Components.
11. **Supabase EU region** — instancja Supabase powinna być skonfigurowana na region europejski (Frankfurt) od startu projektu ze względu na GDPR.
12. **Silnik 2D: Konva.js** — decyzja zamknięta w ADR-001; rekomendowana implementacja deklaratywna przez `react-konva` (`Stage`/`Layer`/węzły) ze stanem sceny w Zustand oraz `temporal` middleware dla undo/redo.
13. **Walidacja limitu elementów** — przed dodaniem nowego obiektu licz wyłącznie typy `plate`/`pipe`/`profile`; ściegi i grupy nie powinny triggerować limit gate.
14. **Płatności przez Merchant of Record** — MVP powinno iść przez Paddle, aby ograniczyć ryzyko operacyjne i compliance overhead przy bootstrapped launchu.
15. **GDPR minimum before launch** — wdrożyć pakiet prawny i cookie consent przed pierwszą publiczną rejestracją użytkownika.

---

## Szczegółowe podsumowanie planowania PRD

### Opis produktu

Przeglądarkowa aplikacja SaaS (Next.js, bez instalacji) umożliwiająca inżynierom spawalnikom i technologom produkcji — w tym osobom bez tła CAD — szybkie tworzenie proporcjonalnych przekrojów złączy spawanych, planowanie sekwencji spawania i eksport dokumentacji graficznej. Inspiracja: Weldia, jednak radykalnie uproszczona do obsługi pojedynczego złącza/"mocowania".

---

### Główne wymagania funkcjonalne

#### System kont i plany

| Plan | Elementy na scenie | Projekty w chmurze | Watermark | Eksport |
|---|---|---|---|---|
| Gość | max 5 (tylko prymitywy) | 0 (localStorage) | ✅ | PNG/JPG |
| Free | max 15 (tylko prymitywy) | 3 | ✅ | PNG/JPG |
| Pro | bez limitu | bez limitu | ❌ | PNG/JPG |

#### Canvas i nawigacja

- Infinite canvas z pan (przeciąganie), zoom i miniaturą (minimap).
- Proporcjonalne renderowanie geometrii (nie schematyczne).
- Silnik 2D: **Konva.js** (decyzja zamknięta w ADR-001, status Accepted, 2026-04-22).

#### Biblioteka prymitywów parametrycznych

- Płyty prostokątne (szerokość, grubość).
- Rury (średnica zewnętrzna, grubość ścianki).
- Profile L/C/I (konfigurowalne wymiary).
- Ukosowania: brak / jednostronne (V/Y) / dwustronne (X/K) z niezależnymi kątami.

#### Manipulacja i parametryzacja

- Suwaki z dokładnością 0,1 mm + ręczne wpisywanie wartości.
- Przełączanie jednostek (mm / cale / niestandardowe).
- Obrót o zadaną wartość, przesuwanie, zoom.
- SNAP magnetyczny do krawędzi i wierzchołków — domyślnie aktywny:
  - Toggle button w UI (podświetlony = aktywny).
  - Klawisz klawiatury: przytrzymanie = chwilowe wyłączenie (toggle synchronicznie podświetlony).
- Grupowanie: zaznaczenie wielu elementów → grupa działa jako jeden obiekt (przesuw, obrót, skala); bez in-group edit w MVP.
- Multi-select (zaznaczenie obszarem lub Shift+klik).
- Undo/Redo: 20 kroków historii (Command Pattern lub Zustand temporal middleware).

#### Tryb sekwencji spawania

- Osobny tryb (toggle/przycisk) niezależny od trybu rysowania elementów.
- Wstawianie symboli ściegu: elipsa / kółko, wybierane z listy.
- Skalowanie i przesuwanie ściegu po wstawieniu.
- Tryb edycji ściegu: opcjonalny (klik na ścieg = wejście w edycję).
- Numeracja: ręczna lub automatyczna (1,2,3… lub A,B,C…).
- **Post-MVP:** modyfikacja kształtu ściegu (spłaszczenia, wklęsłości), tworzenie sekwencji z bazy jednego ściegu.

#### Eksport dokumentacji

- **Priorytet MVP:** PNG i JPG.
- Warstwa opisowa (numeracja ściegów, legenda tekstowa) — opcjonalna; rysunek eksportowalny samodzielnie.
- Watermark (semi-transparentny tekst po przekątnej) dla Guest i Free.
- PDF — wyłączony z MVP.
- Architektura compositing: region capture niezależny od viewport.

#### Zarządzanie projektami

- Zapis/wczytanie w formacie JSON (Supabase).
- Płaska lista projektów (nazwa, data modyfikacji, akcje: otwórz/usuń/duplikuj).
- Lokalny autozapis dla gościa (localStorage).
- Link-sharing: poza MVP, ale schemat bazy (pole `shareToken`) powinien to przewidywać.

#### UX i interfejs

- Dark mode + Light mode.
- Walidacja inline: czerwona ramka + komunikat przy polach liczbowych; toast dla błędów zapisu/eksportu.
- Onboarding w MVP: blank canvas (brak tutoriala); użytkownicy MVP szkoleni werbalnie.
- Wielojęzyczność: i18n w architekturze od startu (PL/EN minimum).

---

### Kluczowe user stories

1. **Technik (gość)** otwiera aplikację, buduje złącze 3-elementowe, definiuje kolejność spawania i eksportuje PNG — wszystko w < 10 minut, bez rejestracji.
2. **Technolog (Free)** loguje się, tworzy projekt, zapisuje w chmurze, wraca do niego następnego dnia i kontynuuje pracę.
3. **Inżynier (Pro)** tworzy wiele złączy, eksportuje PNG bez watermarku do dokumentacji technicznej przekazanej klientowi.
4. **Powracający gość** otwiera przeglądarkę i zastaje poprzednią scenę odtworzoną z localStorage, widzi baner zachęcający do rejestracji.

---

### Kryteria sukcesu

| Kryterium | Miara |
|---|---|
| Czas tworzenia prostego złącza | < 10 minut (użytkownik początkujący) |
| Wydajność renderowania | ≥ 30 FPS na komputerach do 10 lat |
| Czas reakcji UI | < 200 ms dla podstawowych operacji |
| Ocena łatwości obsługi | ≥ 80% „łatwa" lub „bardzo łatwa" w testach użytkowników |
| Fidelity zapisu JSON | 100% odtworzenie sceny bez utraty danych |
| Poprawność eksportu | PNG/JPG otwiera się poprawnie, zawiera rysunek i opcjonalną numerację |

---

### Zakres walidacji geometrycznej MVP

| Parametr | Min | Max | Krok | Komunikat błędu |
|---|---|---|---|---|
| Grubość płyty | 1 mm | 200 mm | 0.1 mm | „Grubość musi być między 1 a 200 mm" |
| Szerokość płyty | 5 mm | 2000 mm | 0.1 mm | „Szerokość musi być między 5 a 2000 mm" |
| Średnica rury (zew.) | 5 mm | 500 mm | 0.1 mm | „Średnica musi być między 5 a 500 mm" |
| Grubość ścianki rury | 1 mm | 50 mm | 0.1 mm | „Grubość ścianki musi być między 1 a 50 mm" |
| Grubość ścianki rury vs promień | — | `(OD/2) - 1` | — | „Grubość ścianki nie może przekraczać promienia rury" |
| Kąt ukosowania | 0° | 80° | 0.5° | „Kąt ukosowania musi być między 0° a 80°" |

**Dodatkowe reguły MVP:**
- Przekroczenie limitu elementów planu: blokada + toast z CTA do upgrade.
- Eksport pustej sceny: blokada + toast.
- Brak walidacji kolizji geometrycznych i norm ISO/AWS w MVP.

---

### Strategia płatności i cen

- **Dostawca płatności MVP:** Paddle (Merchant of Record).
- **Plan cenowy roboczy (do walidacji):**
  - Pro Monthly: 49 PLN / mies.
  - Pro Annual: 399 PLN / rok
- **Model trialu:** do decyzji po rozmowach beta (opcja preferowana: 14 dni).
- **Waluta startowa:** PLN; EUR na etap post-launch po walidacji rynku PL.

---

### Stack technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript |
| Silnik canvas | Konva.js + react-konva |
| Styling | Tailwind CSS + shadcn/ui |
| Backend / Auth / DB | Supabase (PostgreSQL, EU region – Frankfurt) |
| Hosting / CDN | Cloudflare Pages |
| CI/CD | GitHub Actions |
| Testy jednostkowe | Vitest + React Testing Library + MSW |
| Testy E2E | Playwright |
| Testy dostępności (opcjonalne) | axe-core / axe-playwright |
| Testy wydajnościowe (opcjonalne) | Lighthouse CI, Artillery, WebPageTest |

---

## Rozwiązane kwestie od wersji v4

1. **Model subskrypcji i płatności** — zamknięte na poziomie MVP. Kierunek implementacyjny: Paddle jako Merchant of Record, z webhookami do tabeli `subscriptions` w Supabase.

2. **Szczegółowy zakres walidacji geometrycznej** — zamknięte. Ustalono konkretne zakresy min/max/krok dla kluczowych parametrów oraz granice walidacji (bez kolizji i bez walidacji normowej).

3. **GDPR compliance i kwestie prawne** — zamknięte dla etapu pre-launch MVP. Zakres minimalny obowiązkowy: Polityka Prywatności, Regulamin, cookie consent, checkbox zgody i rejestracja wersji zgody.

4. **Strategia cenowa planu Pro** — zamknięte roboczo. Przyjęto cenę startową 49 PLN monthly / 399 PLN annual, z walidacją podczas bety i możliwością korekty przed publicznym launch.

5. **Design UI/UX (status i doprecyzowanie)** — potwierdzone jako decyzja świadoma: design realizowany po PRD i przed frontendem, z Weldią jako punktem referencyjnym.

---

## Otwarte kwestie (po aktualizacji v5)

1. **Finalna decyzja o trialu Pro** — do walidacji z beta-użytkownikami (14 dni: tak/nie, z kartą czy bez).
2. **Wybór narzędzia analytics** — Plausible vs GA vs model hybrydowy.
3. **Dostawca e-maili transakcyjnych** — Resend vs Postmark (lub tymczasowo e-maile Supabase Auth).
4. **Formalne domknięcie DPA i rozszerzone compliance** — etap post-launch, przed skalowaniem i rozwojem rynku EU.
5. **Walidacja i ewentualna korekta ceny Pro** — decyzja po danych z bety i pierwszego kwartału.

---

*Dokument wygenerowany na podstawie sesji planowania PRD i rekomendacji do otwartych kwestii, 2026-04-22.*
*Wersja robocza do weryfikacji biznesowej, produktowej i prawnej.*
