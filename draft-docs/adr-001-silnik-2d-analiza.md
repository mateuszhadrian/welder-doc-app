# ADR-001: Wybór silnika renderowania 2D

> **Aplikacja:** Projektowanie złączy spawanych (SaaS)  
> **Status:** Accepted  
> **Data sesji:** 2026-04-22

---

## Kontekst

Przeglądarkowa aplikacja SaaS do tworzenia proporcjonalnych przekrojów złączy spawanych, planowania sekwencji spawania i eksportu dokumentacji graficznej. Zbudowana na Next.js (App Router) + React + TypeScript. Wymaga infinite canvasu z pan/zoom, snap magnetycznym, grupowaniem, undo/redo (20 kroków) i eksportem PNG/JPG.

Wybór silnika 2D był pozycją otwartą w PRD — niniejszy dokument zamyka tę decyzję.

---

## Zebrane wymagania

| Czynnik | Wartość |
|---|---|
| Skala sceny | 10–30 obiektów (niskie wymagania wydajnościowe) |
| Animacje | Brak — statyczny redraw przy każdej zmianie stanu |
| Eksport | Bounding box wszystkich obiektów + padding → PNG/JPG |
| Edycja kształtu ściegu (Bezier) | **Faza 2–4** — blisko MVP, wymaganie ważne (świadomy trade-off) |
| SVG/DXF export | Pewna przyszłość, ale odleglejsza |
| React integration | Next.js App Router, React — priorytet pierwszoklasowy |
| Developer | Solo + AI tools |
| Licencja | Wyłącznie open-source |
| Touch support | Przyszłość poza MVP |

---

## Analiza porównawcza kandydatów

### Konva.js ✅

React-friendly dzięki bibliotece `react-konva` — pierwszoklasowa integracja z Reactem przez JSX, props, state i hooks. Wbudowany `Transformer` (uchwyty do resize/rotate), prosta obsługa grup, drag & drop, touch support i eksport PNG jedną linią (`stage.toDataURL()`). Aktywnie rozwijana — v10.2.3 wydana w marcu 2026, `react-konva` v19.2.3 dwa miesiące temu. Aplikacja referencyjna Weldia działa na produkcji na Konvie, co stanowi praktyczny proof of concept dla tej domeny.

**Świadomy trade-off:** Konva nie jest biblioteką wektorową — edycja kształtu ściegu przez krzywe Beziera (fazy 2–4) wymaga własnej implementacji uchwytów punktów kontrolnych lub użycia `Konva.Shape` z customowym `sceneFunc`. Jest to wykonalne z AI tools, ale stanowi dodatkowy koszt implementacyjny względem bibliotek wektorowych.

**Werdykt:** ✅ Wybrana — patrz uzasadnienie poniżej

---

### Paper.js

Biblioteka stworzona od podstaw jako silnik grafiki wektorowej. Natywna obsługa krzywych Beziera, operacji boolowskich i SVG export. Pierwotnie rozważana jako główny kandydat z uwagi na domenę wektorową.

**Dyskwalifikacja:** Ostatnia wersja (v0.12.17) pochodzi z listopada 2022. Projekt de facto porzucony — issues na GitHubie akumulują się bez odpowiedzi maintainera. Dla solo projektu brak poprawek bezpieczeństwa i brak kompatybilności z przyszłymi wersjami Node i przeglądarek to ryzyko nie do zaakceptowania.

**Werdykt:** ❌ Odrzucona — projekt porzucony

---

### Fabric.js

Aktywnie utrzymywana (v7.2.0, dwa miesiące temu), natywna obsługa `Path` z SVG path data, wbudowany SVG import/export, TypeScript od v6. Silny kandydat pod kątem przyszłej edycji Beziera.

**Problemy:** Brak oficjalnych React bindings — wzorzec imperatywny przez `ref` i `useEffect`. Dla solo dewelopera oznacza to własną warstwę infrastruktury od pierwszego dnia MVP. Historia v5→v6→v7 pokazuje regularne breaking changes.

**Werdykt:** ❌ Odrzucona — brak oficjalnych React bindings, wyższy koszt infrastruktury przy MVP

---

### PixiJS

Renderer WebGL z fallbackiem na Canvas — wyjątkowa wydajność przy tysiącach animowanych obiektów.

**Problemy:** Przy 10–30 obiektach bez animacji przewaga wydajnościowa jest zerowa. Nie jest biblioteką wektorową — edycja Beziera i SVG/DXF export wymagałyby w pełni zewnętrznych rozwiązań. Narzędzie niepasujące do domeny grafiki technicznej.

**Werdykt:** ❌ Odrzucona — WebGL-first, brak domeny wektorowej

---

## Decyzja: Konva.js

### Uzasadnienie

Dla solo projektu budowanego na Next.js + React priorytetem jest **produktywność i pewność stosu**, nie maksymalna elegancja API domenowego. Kluczowe argumenty:

> Konva + react-konva to jedyny kandydat z pierwszoklasową integracją React — deklaratywny JSX, pełen event system, zsynchronizowane wersje. Weldia udowadnia, że ta architektura działa na produkcji dla dokładnie tej domeny aplikacyjnej.

**Pozostałe argumenty za:**

- **Aktywne utrzymanie** — v10.2.3 z marca 2026, regularne release'y, brak ryzyka porzucenia
- **Wbudowany Transformer** — resize i rotate z uchwytami gotowe od razu, bez własnej implementacji
- **Touch support wbudowany** — gotowy na przyszłą obsługę tabletów bez dodatkowej pracy
- **Eksport PNG/JPG** — `stage.toDataURL()`, jedna linia kodu
- **Weldia jako proof of concept** — aplikacja referencyjna zweryfikowała architekturę w tej domenie
- **Next.js** — znany i udokumentowany wzorzec konfiguracji (`canvas` alias w `next.config.js`)

### Świadomy trade-off: edycja Beziera w fazach 2–4

Modyfikacja kształtu ściegu (spłaszczenia, wklęsłości, wypukłości) nie jest natywnie wspierana przez Konvę. Planowane podejście implementacyjne:

- **Opcja A (preferowana):** `Konva.Shape` z customowym `sceneFunc` rysującym ścieżkę przez Canvas 2D API bezpośrednio — pełna kontrola nad geometrią, wspomagana biblioteką `bezier-js` do obliczeń punktów kontrolnych
- **Opcja B (alternatywna):** `Konva.Line` z tablicą punktów + własne uchwyty Beziera jako osobne węzły na canvasie

Decyzja o wyborze podejścia odroczona do momentu startu implementacji fazy 2.

---

## Architektura integracji z React

`react-konva` dostarcza pierwszoklasową integrację — canvas budowany deklaratywnie jako drzewo komponentów React. Cały UI (paski narzędzi, panele, modale) i canvas żyją w tym samym drzewie.

```
┌─────────────────────────────────────────┐
│              Next.js / React            │
│  ┌─────────────────────────────────┐    │
│  │   UI (toolbar, panels, modals)  │    │  ← React komponenty
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  <Stage> (react-konva)          │    │  ← Konva Stage
│  │    <Layer>                      │    │
│  │      <Rect /> <Circle /> ...    │    │  ← deklaratywne węzły
│  │      <Transformer />            │    │  ← wbudowany
│  │    </Layer>                     │    │
│  │  </Stage>                       │    │
│  └─────────────────────────────────┘    │
│              ↑ Zustand store            │
│  ┌─────────────────────────────────┐    │
│  │   sceneStore (Zustand)          │    │  ← źródło prawdy
│  │   + temporal middleware (undo)  │    │  ← historia 20 kroków
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

Zustand pełni rolę źródła prawdy dla stanu sceny — Konva renderuje to co jest w store, zdarzenia z canvasu (drag, transform, klik) mutują store, React rerenderuje UI wokół. Middleware `temporal` (immer-based) obsługuje undo/redo 20 kroków natywnie.

---

## Ryzyka i mitygacje

| Ryzyko | Mitygacja |
|---|---|
| Brak natywnej edycji Beziera (fazy 2–4) | `Konva.Shape` z `sceneFunc` + `bezier-js`; decyzja o podejściu przed startem fazy 2 |
| Brak natywnego SVG export | Zewnętrzna konwersja w momencie potrzeby; nie blokuje MVP ani faz 2–4 |
| Konfiguracja Next.js (canvas SSR) | Udokumentowany wzorzec — lazy loading + canvas alias w `next.config.js` |
| Touch support (przyszłość) | Konva ma wbudowany Pointer Events — gotowy bez dodatkowej pracy |

---

## Odrzucone alternatywy

| Biblioteka | Powód odrzucenia |
|---|---|
| Paper.js | Projekt porzucony — ostatnia wersja listopad 2022, brak aktywnego maintainera |
| Fabric.js | Brak oficjalnych React bindings, wyższy koszt infrastruktury przy MVP, breaking changes między wersjami |
| PixiJS | WebGL-first, brak domeny wektorowej, SVG/DXF wymagałby zewnętrznych rozwiązań |

---

## Konsekwencje

- Deklaratywny canvas w React przez `react-konva` — niższy koszt infrastruktury przy MVP
- Zustand z `temporal` middleware jako źródło prawdy sceny + undo/redo 20 kroków
- Edycja kształtu ściegu (fazy 2–4) wymaga własnej implementacji geometrii Beziera — świadomy trade-off
- SVG export odłożony do momentu rzeczywistej potrzeby — nie blokuje żadnej z planowanych faz
- Touch support gotowy bez dodatkowej pracy w momencie uruchomienia wersji mobilnej
