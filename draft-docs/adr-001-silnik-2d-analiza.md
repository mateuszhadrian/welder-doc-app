# ADR-001: Wybór silnika renderowania 2D

> **Aplikacja:** Projektowanie złączy spawanych (SaaS)  
> **Status:** Accepted  
> **Data sesji:** 2026-04-21

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
| Edycja kształtu ściegu (Bezier) | **Faza 2–4** — blisko MVP, wymaganie krytyczne |
| SVG/DXF export | Pewna przyszłość, ale odleglejsza |
| React integration | Next.js App Router, React |
| Developer | Solo + AI tools, gotowy na niski poziom abstrakcji |
| Licencja | Wyłącznie open-source |
| Touch support | Przyszłość poza MVP |

---

## Analiza porównawcza kandydatów

### Konva.js

React-friendly dzięki bibliotece `react-konva` — to jej największa zaleta. Wbudowany `Transformer` (uchwyty do resize/rotate), prosta obsługa grup, eksport PNG jedną linią (`stage.toDataURL()`). Używana przez Weldię (aplikacja referencyjna z PRD).

**Krytyczny problem:** Konva nie jest biblioteką wektorową. Edycja kształtu przez krzywe Beziera wymaga ręcznego zarządzania punktami kontrolnymi — to dług techniczny, który ujawni się dokładnie w fazach 2–4, kiedy modyfikacje kształtu ściegu stają się wymaganiem krytycznym. SVG export wymaga obejść.

**Werdykt:** ❌ Odrzucona — nieodpowiednia domena (raster, nie wektor)

---

### Fabric.js

Wysoki poziom abstrakcji, dobra obsługa ścieżek SVG, wbudowany import/export SVG.

**Problemy:** Brak pierwszoklasowej integracji z Reactem (brak oficjalnych bindings), ciężki bundle, mniej aktywny development w ostatnich latach.

**Werdykt:** ❌ Odrzucona — brak aktywnego React integration, ciężki bundle

---

### PixiJS

Renderer WebGL z fallbackiem na Canvas — wyjątkowa wydajność przy tysiącach obiektów animowanych w czasie rzeczywistym.

**Problemy:** Przy 10–30 obiektach przewaga wydajnościowa jest zerowa. Nie jest biblioteką wektorową — edycja Beziera poza jej zakresem. SVG/DXF export wymagałby całkowicie zewnętrznych rozwiązań. Narzędzie niepasujące do domeny grafiki technicznej.

**Werdykt:** ❌ Odrzucona — WebGL-first, brak domeny wektorowej

---

### Paper.js ✅

Biblioteka stworzona **od podstaw jako silnik grafiki wektorowej**. Edycja krzywych Beziera to jej rdzeń: `Path`, `Segment`, `Curve`, operacje boolowskie na ścieżkach (`unite`, `subtract`, `intersect`), `CompoundPath`. SVG import/export natywny. Działa na Canvas 2D API. Licencja MIT.

**Werdykt:** ✅ Wybrana — patrz uzasadnienie poniżej

---

## Decyzja: Paper.js

### Uzasadnienie

Aplikacja jest w istocie **edytorem grafiki wektorowej** z parametrycznymi prymitywami. Kluczowy argument:

> Modyfikacja kształtu ściegu spawalniczego — spłaszczenia, wklęsłości, wypukłości — to operacje na krzywych Beziera. Paper.js jest zbudowany dokładnie pod ten przypadek użycia.

Wybór Konvy oznaczałby migrację lub bolesne obejścia dokładnie wtedy, gdy projekt nabiera tempa (faza 2–4). Paper.js buduje właściwy fundament od startu.

**Pozostałe argumenty za:**

- **SVG export w przyszłości** — natywny w Paper.js, zero dodatkowej pracy
- **Operacje boolowskie** — przydatne przy scalaniu prymitywów złącza w jeden obiekt (model eksportu: bounding box + padding)
- **Niska abstrakcja** — Paper.js ma rozbudowane, ale czyste API; developer gotowy na niski poziom
- **Bounding box przy eksporcie** — `layer.bounds` zwraca gotowy prostokąt; dodajesz padding i rysujesz do offscreen canvas
- **Licencja MIT** — spełnia wymaganie open-source

---

## Architektura integracji z React

Paper.js nie posiada oficjalnych React bindings. Standardowym wzorcem jest inicjalizacja imperatywna przez `ref` na elemencie `<canvas>`. Cały UI (paski narzędzi, panele, modale) budowany normalnie w React.

```
┌─────────────────────────────────────────┐
│              Next.js / React            │
│  ┌─────────────────────────────────┐    │
│  │   UI (toolbar, panels, modals)  │    │  ← React komponenty
│  └─────────────────────────────────┘    │
│  ┌─────────────────────────────────┐    │
│  │  <canvas ref={canvasRef} />     │    │  ← jeden element
│  └─────────────────────────────────┘    │
│              ↑ imperativne API          │
│  ┌─────────────────────────────────┐    │
│  │   CanvasEngine (Paper.js)       │    │  ← singleton serwis
│  │   useEffect → paper.setup(ref)  │    │
│  └─────────────────────────────────┘    │
└─────────────────────────────────────────┘
```

Paper.js inicjalizujesz raz w `useEffect` na `canvasRef`. Cały stan sceny żyje w Paper.js, React zarządza tylko UI wokół. Komunikacja przez Zustand jako "most" — zdarzenia z canvasu (zaznaczenie obiektu, zmiana wartości) emitujesz do store, React reaguje i rerenderuje panel boczny.

---

## Ryzyka i mitygacje

| Ryzyko | Mitygacja |
|---|---|
| Brak aktywnych React bindings | Własna warstwa abstrakcji: `useCanvas` hook + `CanvasService` klasa — jednorazowy koszt, długoterminowa kontrola |
| Mniejsza społeczność niż Konva | Dokumentacja Paper.js jest obszerna i dobra; z Claude Code i Cursorem brak Stack Overflow answers ma mniejsze znaczenie |
| Touch support (przyszłość) | Paper.js obsługuje `Tool` events mapujące się na Pointer Events API; do MVP bez znaczenia |

---

## Odrzucone alternatywy

| Biblioteka | Powód odrzucenia |
|---|---|
| Konva.js | Słaba obsługa edycji Beziera, SVG wymaga obejść, dług techniczny w fazach 2–4 |
| PixiJS | WebGL-first, brak domeny wektorowej, SVG/DXF wymagałby zewnętrznych rozwiązań |
| Fabric.js | Brak aktywnego React integration, ciężki bundle, mniejsza aktywność projektu |

---

## Konsekwencje

- Wymagana własna warstwa integracji z React (`useCanvas` hook + `CanvasService`)
- Brak gotowych React bindings — imperativny wzorzec przez `ref`
- Inwestycja przy starcie zwraca się w fazach 2–4 przy implementacji edycji kształtu ściegu
- Natywny SVG export gotowy bez dodatkowej pracy w momencie gdy będzie potrzebny
