# Podsumowanie sesji planowania PRD — Aplikacja do projektowania złączy spawanych

---

## Decyzje

1. **Docelowy użytkownik** — technik/technolog bez tła CAD; priorytet to maksymalna prostota obsługi dla każdego użytkownika.
2. **Wielojęzyczność** — i18n wbudowane w architekturę od MVP; minimum PL/EN.
3. **Model biznesowy** — SaaS z subskrypcją (Free / Pro).
4. **System kont** — trzy tryby: gość (guest), użytkownik Free, użytkownik Pro; logowanie i rejestracja wymagane dla Free/Pro.
5. **Tryb gościa** — tymczasowy autozapis lokalny (localStorage), baner zachęcający do rejestracji; brak zapisu w chmurze; max 5 elementów na scenie; eksport z watermarkiem; 0 projektów w chmurze.
6. **Plan Free** — max 15 elementów na scenie; 3 projekty w chmurze; eksport z watermarkiem; brak zapisu nieograniczonego.
7. **Plan Pro** — brak znaku wodnego; zniesione limity elementów i projektów; zapis w chmurze bez ograniczeń.
8. **Eksport** — priorytet: PNG/JPG; PDF wyłączony z MVP całkowicie. Warstwa opisowa (legenda, numeracja ściegów) opcjonalna — rysunek musi dać się wyeksportować samodzielnie bez opisu.
9. **Znak wodny** — semi-transparentny tekst po przekątnej obrazu.
10. **Renderowanie** — proporcjonalne (nie schematyczne); wybrany silnik 2D: **Paper.js** (ADR-001, status Accepted, 2026-04-21).
11. **Undo/Redo** — obowiązkowe w MVP, głębokość historii: 20 kroków.
12. **Onboarding** — brak tutoriala w MVP; blank canvas od startu; użytkownicy MVP nauczani werbalnie przez twórców.
13. **Organizacja projektów** — płaska lista w MVP (nazwa, data, akcje: otwórz/usuń/duplikuj).
14. **Grupowanie** — dostępne w MVP; grupa = jeden obiekt (wspólne przesuwanie, obrót, skalowanie); brak wejścia do grupy (no in-group edit).
15. **SNAP magnetyczny** — przyciąganie do geometrii innych elementów jako domyślne; toggle button (podświetlony gdy aktywny) do wyłączania; klawisz klawiatury (przytrzymanie = chwilowe wyłączenie SNAP, zwolnienie = powrót); toggle podświetla się również podczas przytrzymania klawisza.
16. **Canvas** — infinite canvas.
17. **Tryb sekwencji spawania** — ściegi (elipsy/kółka) można wstawiać, przesuwać, skalować; tryb edycji opcjonalny (klik na ścieg = wejście w edycję); po MVP: modyfikacja kształtu (spłaszczenia, wklęsłości, wypukłości) i tworzenie sekwencji z jednego ściegu bazowego.
18. **Walidacja** — podstawowe reguły walidacji liczbowej: czerwona ramka + komunikat inline przy polach; toast notifications dla błędów zapisu/eksportu.
19. **Dark/Light mode** — oba tryby dostępne w MVP.
20. **Udostępnianie linkiem** — zaplanowane jako przyszła funkcja (poza MVP); architektura powinna być na to przygotowana.
21. **Normy branżowe** — MVP celuje w dokumentację roboczą/poglądową; zgodność z normami (ISO 2553, AWS A2.4) poza zakresem MVP.
22. **Biblioteka szablonów użytkownika** — poza MVP, zaplanowana na późniejszy etap.
23. **GDPR** — aplikacja kierowana na rynek UE (Polska i kraje GDPR); kwestie prawne i compliance odłożone na po MVP; region Supabase: EU.
24. **Stack technologiczny** — Next.js (App Router) + React + TypeScript; Tailwind CSS + shadcn/ui; Supabase (PostgreSQL + auth); Cloudflare Pages + GitHub Actions CI/CD; Vitest + React Testing Library + Playwright.
25. **Inspiracja produktowa** — aplikacja Weldia (weldia.app) jako reference, ale cel to radykalne uproszczenie dla jednego "mocowania".
26. **Design UI/UX** — tworzony bezpośrednio przed fazą frontendu; brak makiet na etapie PRD.

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
12. **Silnik 2D: Paper.js** — decyzja zamknięta w ADR-001; rekomendowana implementacja przez warstwę integracyjną `CanvasService` + hook `useCanvas` (inicjalizacja imperatywna przez `canvasRef`) oraz most stanu z React przez Zustand.

---

## Szczegółowe podsumowanie planowania PRD

### Opis produktu

Przeglądarkowa aplikacja SaaS (Next.js, bez instalacji) umożliwiająca inżynierom spawalnikom i technologom produkcji — w tym osobom bez tła CAD — szybkie tworzenie proporcjonalnych przekrojów złączy spawanych, planowanie sekwencji spawania i eksport dokumentacji graficznej. Inspiracja: Weldia, jednak radykalnie uproszczona do obsługi pojedynczego złącza/"mocowania".

---

### Główne wymagania funkcjonalne

#### System kont i plany

| Plan | Elementy na scenie | Projekty w chmurze | Watermark | Eksport |
|---|---|---|---|---|
| Gość | max 5 | 0 (localStorage) | ✅ | PNG/JPG |
| Free | max 15 | 3 | ✅ | PNG/JPG |
| Pro | bez limitu | bez limitu | ❌ | PNG/JPG |

#### Canvas i nawigacja

- Infinite canvas z pan (przeciąganie), zoom i miniaturą (minimap).
- Proporcjonalne renderowanie geometrii (nie schematyczne).
- Silnik 2D: **Paper.js** (decyzja zamknięta w ADR-001, status Accepted, 2026-04-21).

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

### Stack technologiczny

| Warstwa | Technologia |
|---|---|
| Frontend | Next.js (App Router) + React + TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Backend / Auth / DB | Supabase (PostgreSQL, EU region – Frankfurt) |
| Hosting / CDN | Cloudflare Pages |
| CI/CD | GitHub Actions |
| Testy jednostkowe | Vitest + React Testing Library + MSW |
| Testy E2E | Playwright |
| Testy dostępności (opcjonalne) | axe-core / axe-playwright |
| Testy wydajnościowe (opcjonalne) | Lighthouse CI, Artillery, WebPageTest |

---

## Nierozwiązane kwestie

1. **Szczegółowy model danych JSON** — schemat zapisu sceny (scene graph: elementy, grupy, ściegi, ukosowania, viewport) nie został zdefiniowany. Konieczne przed implementacją zapisu/wczytania.

2. **Definicja "elementu" w kontekście limitu** — czy limit 5/15 elementów dotyczy prymitywów, czy każdej osobnej figury na scenie (w tym ściegów, grup)? Wymaga precyzji przed implementacją feature-gate logic.

3. **Model subskrypcji i płatności** — nie został wybrany dostawca płatności (np. Stripe). Konieczne przed implementacją planu Pro i logiki upgradu.

4. **Design UI/UX** — brak makiet, wireframe'ów i systemu designu na etapie PRD. Decyzja świadoma (design tworzony przed fazą frontendu), ale PRD powinno zawierać referencję do Weldii jako punkt wyjścia oraz notatkę o tym etapie.

5. **Szczegółowy zakres walidacji geometrycznej** — ustalono, że walidacja będzie, ale nie zdefiniowano pełnej listy reguł (np. zakres kątów ukosowania, minimalna/maksymalna grubość ścianki, kolizje elementów).

6. **GDPR compliance i kwestie prawne** — świadomie odłożone na po MVP; wymaga powrotu przed pierwszym publicznym launchem (polityka prywatności, cookie consent, regulamin).

7. **Strategia cenowa planu Pro** — cena subskrypcji miesięcznej/rocznej nie została określona; niezbędna przed implementacją landing page'a i systemu płatności.
