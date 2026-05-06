# Plan migracji silnika canvasu (Konva → PixiJS)

**Cel:** zabezpieczyć projekt na wypadek, gdy Konva okaże się niewystarczająca dla urządzeń dotykowych (tablet, stylus, iPad z Apple Pencil) i konieczna będzie wymiana na PixiJS bez przepisywania całej aplikacji.

**Strategia:** wprowadzić cienką warstwę abstrakcji `src/canvas-kit/` od dnia 0, schować Konvę za nią, egzekwować granicę ESLintem. Wymiana silnika = nowa implementacja w `impl-pixi/` + przełączenie eksportu w `canvas-kit/index.ts`. Domena (store, history, snap, weld-units, ~70% kodu) przeżywa wymianę bez modyfikacji.

Specyfikacja granicy: `architecture-base.md` §22.

---

## Spis treści

1. [Faza 0 — Przygotowanie (DO ZROBIENIA TERAZ)](#faza-0--przygotowanie-do-zrobienia-teraz)
2. [Faza 1 — Dyscyplina podczas implementacji MVP](#faza-1--dyscyplina-podczas-implementacji-mvp)
3. [Faza 2 — Empiryczna weryfikacja na realnym sprzęcie](#faza-2--empiryczna-weryfikacja-na-realnym-sprzęcie)
4. [Faza 3 — Wymiana Konva → PixiJS (gdy zapadnie decyzja)](#faza-3--wymiana-konva--pixijs-gdy-zapadnie-decyzja)
5. [Mapowanie API Konva ↔ PixiJS](#mapowanie-api-konva--pixijs)
6. [Co przeżywa wymianę, a co trzeba przepisać](#co-przeżywa-wymianę-a-co-trzeba-przepisać)
7. [Lista kontrolna PR-a wymiany](#lista-kontrolna-pr-a-wymiany)
8. [Decyzje i kompromisy](#decyzje-i-kompromisy)

---

## Faza 0 — Przygotowanie (DO ZROBIENIA TERAZ)

Wszystkie kroki wykonać **przed** napisaniem pierwszego `Renderer`-a kształtu. Łączny koszt: ~1 dzień pracy.

### 0.1 Scaffolding `src/canvas-kit/`

Utworzyć katalogi i pliki zgodnie z architekturą §3:

```
src/canvas-kit/
  index.ts
  primitives.ts
  pointerInput.ts
  constants.ts
  impl-konva/
    index.ts
    primitives.tsx
    CanvasShell.tsx
    rasterize.ts
```

`src/canvas-kit/index.ts` powinien być **jedynym** punktem styku domeny z silnikiem:

```typescript
export { CanvasShell, GroupLayer, OverlayLayer } from './impl-konva'
export { G, Rect, Line, Arc, Circle, Path, Text } from './impl-konva'
export { rasterize } from './impl-konva'
export { usePointerInput } from './pointerInput'
export type { PointerGesture } from './pointerInput'
export type {
  RasterizeOptions,
  CommonShapeProps, RectProps, LineProps, ArcProps, CircleProps, PathProps, TextProps, GProps
} from './primitives'
export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants'
```

### 0.2 Implementacja `impl-konva/`

#### `impl-konva/primitives.tsx`

Mapowanie 1:1 prymitywów na komponenty `react-konva`:

```typescript
import { Group, Rect as KRect, Line as KLine, Arc as KArc, Circle as KCircle, Path as KPath, Text as KText } from 'react-konva'
import type { GProps, RectProps, LineProps, ArcProps, CircleProps, PathProps, TextProps } from '../primitives'

export const G = ({ children, ...p }: GProps) => <Group {...p}>{children}</Group>
export const Rect = (p: RectProps) => <KRect {...p} />
export const Line = (p: LineProps) => <KLine {...p} />
export const Arc = (p: ArcProps) => <KArc {...p} />
export const Circle = (p: CircleProps) => <KCircle {...p} />
export const Path = (p: PathProps) => <KPath {...p} />
export const Text = (p: TextProps) => <KText {...p} />
```

Każdy prymityw przyjmuje wyłącznie props z `primitives.ts` — żadnych Konva-specyficznych. Jeśli któraś funkcjonalność wymaga rozszerzenia (np. dash pattern dla `Line`), dodać do `primitives.ts` i zaimplementować w obu backendach.

#### `impl-konva/CanvasShell.tsx`

```typescript
import { Stage, Layer } from 'react-konva'
import { devicePixelRatio } from '../constants'

export const CanvasShell = ({ width, height, children }) => (
  <Stage width={width} height={height} pixelRatio={devicePixelRatio()}>
    {children}
  </Stage>
)
export const GroupLayer = ({ children }) => <Layer>{children}</Layer>
export const OverlayLayer = ({ children }) => <Layer>{children}</Layer>
```

#### `impl-konva/rasterize.ts`

```typescript
export async function rasterize(opts: RasterizeOptions): Promise<Blob> {
  const stage = getActiveStage()           // singleton ref do aktywnego <Stage>, wystawiony przez CanvasShell
  const dataUrl = stage.toDataURL({
    mimeType: opts.format === 'jpg' ? 'image/jpeg' : 'image/png',
    pixelRatio: opts.pixelRatio ?? devicePixelRatio(),
    quality: opts.quality
  })
  return await (await fetch(dataUrl)).blob()
}
```

### 0.3 `pointerInput.ts` — niezależny od silnika

To jest plik, który **najmocniej** chroni przed bólem migracji. Cała logika multi-touch żyje tutaj i pracuje wyłącznie na DOM `PointerEvent`:

```typescript
export type PointerGesture =
  | { kind: 'tap';   x: number; y: number; pointerId: number; pointerType: 'mouse'|'touch'|'pen' }
  | { kind: 'drag';  start: Point; current: Point; delta: Point; pointerId: number; phase: 'start'|'move'|'end' }
  | { kind: 'pan';   delta: Point; pointerId: number; phase: 'start'|'move'|'end' }
  | { kind: 'pinch'; center: Point; scale: number; rotation: number; phase: 'start'|'move'|'end' }

export function usePointerInput(target: RefObject<HTMLElement>, handler: (g: PointerGesture) => void): void {
  // Mapuje pointerdown/move/up/cancel → znormalizowane gesty
  // Pinch: śledzenie dwóch aktywnych pointerId, obliczanie scale = currentDist / startDist
  // Pan: jeden pointer w trybie 'hand' lub na pustym tle w trybie 'select'
  // Drag: jeden pointer na elemencie
  // Tap: down + up bez ruchu w progu 5px i czasie <250ms
}
```

Testować w Vitest z syntetycznymi `PointerEvent`. Zero importów Konvy/Pixi.

### 0.4 ESLint zone enforcement

W `eslint.config.js` (lub `.eslintrc`):

```javascript
import { defineConfig } from 'eslint/config'

export default defineConfig([
  {
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['konva', 'konva/*', 'react-konva'], message: 'Importuj z @/canvas-kit. Konva legalna tylko w src/canvas-kit/impl-konva i src/components/canvas/.' },
          { group: ['pixi.js', '@pixi/*'],              message: 'Importuj z @/canvas-kit. Pixi legalne tylko w src/canvas-kit/impl-pixi.' }
        ]
      }]
    }
  },
  {
    files: ['src/canvas-kit/impl-konva/**', 'src/components/canvas/**'],
    rules: { 'no-restricted-imports': 'off' }
  },
  {
    files: ['src/canvas-kit/impl-pixi/**'],
    rules: { 'no-restricted-imports': 'off' }
  }
])
```

Dodać `pnpm lint` do pre-commit (już jest przez lint-staged). Pierwszy nieautoryzowany import Konvy będzie crashował CI.

### 0.5 Aktualizacja `architecture-base.md`

Już wykonane — patrz §22. Każdy nowy programista czytający dokumentację widzi granicę od pierwszego dnia.

### 0.6 Test sanity

Stworzyć jeden testowy `Renderer` (np. dla `plate`), który używa wyłącznie `@/canvas-kit`. Uruchomić `pnpm dev` i sprawdzić, że renderuje się poprawnie. Dopiero wtedy implementować pozostałe kształty.

---

## Faza 1 — Dyscyplina podczas implementacji MVP

Podczas implementacji 8 kształtów + weld-units, trzymać się poniższych reguł. Każde naruszenie zwiększa koszt późniejszej migracji.

### 1.1 Renderer każdego kształtu

```typescript
// src/shapes/plate/index.ts
import { G, Rect, Line } from '@/canvas-kit'   // ← jedyne dozwolone źródło prymitywów

export const PlateDefinition: ShapeDefinition<PlateShape> = {
  // ...
  Renderer: ({ shape, isSelected, isInLockedUnit }) => (
    <G x={shape.x} y={shape.y} rotation={shape.rotation} opacity={shape.opacity}>
      <Rect
        width={shape.width}
        height={shape.thickness}
        fill={shape.fill}
        stroke={isSelected ? 'accent' : shape.stroke}
        strokeWidth={shape.strokeWidth}
      />
      {/* bevel jako Line z points */}
    </G>
  )
}
```

### 1.2 Komponenty w `src/components/canvas/`

Tylko tutaj (i w `impl-*/`) wolno importować `react-konva`. Pożądane jednak, by **nawet tutaj** używać `@/canvas-kit` gdzie się da — ułatwia migrację.

`CanvasApp.tsx` używa `CanvasShell` + `usePointerInput`. Nie ma w nim `<Stage>` ani `e.evt.touches[]`.

### 1.3 `exportEngine.ts`

```typescript
import { rasterize } from '@/canvas-kit'

export async function exportPNG(opts: ExportOptions): Promise<Blob> {
  hideControls()
  applyDescriptiveLayer(opts)
  applyWatermark(opts)
  return rasterize({ format: 'png', area: opts.area, pixelRatio: opts.pixelRatio })
}
```

Zero `stage.toDataURL()` w `lib/`.

### 1.4 Przegląd przed mergem

Code review checklist (dodać do template'a PR):
- [ ] Czy nowe pliki spoza `src/canvas-kit/impl-*` i `src/components/canvas/` importują `konva`/`react-konva`? → **odrzuć**
- [ ] Czy `Renderer` używa wyłącznie prymitywów z `@/canvas-kit`?
- [ ] Czy nowy gest dotykowy jest w `pointerInput.ts`, czy w komponencie?

---

## Faza 2 — Empiryczna weryfikacja na realnym sprzęcie

**Wykonać po implementacji 1-2 kształtów, przed napisaniem pozostałych 6.**

### 2.1 Spike na fizycznym tablecie

Cel: ustalić empirycznie, czy Konva sprawdza się na docelowym sprzęcie. Lista urządzeń do testów:
- iPad (z Apple Pencil + bez)
- Tablet z Androidem (Galaxy Tab lub podobny)
- Wacom Cintiq (jeśli docelowa grupa to spawalnicy używający stacji projektowych)
- Surface Pro

### 2.2 Scenariusze testowe

| Scenariusz | Akceptacja |
|---|---|
| Pinch-to-zoom dwoma palcami | płynne, < 100ms latencji, brak gubienia eventów |
| Drag elementu jednym palcem | brak „ucieczki" elementu spod palca |
| Pen z naciskiem (Apple Pencil, Wacom) | hit detection działa nawet przy lekkim nacisku |
| Multi-select marquee dwoma palcami | drugi palec nie zakłóca pierwszego |
| Edycja uchwytu (8px hit area) | trafialność > 90% przy pierwszej próbie |
| Scrolling poza canvasem | nie blokuje gestów wewnątrz canvasu |

### 2.3 Decyzja go/no-go

- **Wszystkie scenariusze pass** → kontynuować na Konvie. Faza 3 pozostaje hipotetyczna.
- **≥ 1 scenariusz fail po próbach naprawy** → eskalować do Fazy 3.

Wynik testu zapisać w `.ai/touch-spike-results.md` — obecna decyzja bazuje na danych, nie przeczuciu.

---

## Faza 3 — Wymiana Konva → PixiJS (gdy zapadnie decyzja)

Wykonywać dopiero, gdy Faza 2 da no-go. Szacowany koszt: 3-7 dni roboczych w zależności od stanu MVP.

### 3.1 Instalacja PixiJS

```bash
pnpm add pixi.js@^8 @pixi/react@^8
pnpm remove konva react-konva
```

W `next.config.ts` usunąć alias `canvas` → `./empty.js` (Konva-specific). PixiJS nie wymaga tego workaroundu.

### 3.2 Implementacja `impl-pixi/`

Stworzyć równoległy katalog `src/canvas-kit/impl-pixi/`:

```
src/canvas-kit/impl-pixi/
  index.ts
  primitives.tsx
  CanvasShell.tsx
  rasterize.ts
```

#### `impl-pixi/primitives.tsx`

```typescript
import { Application, extend } from '@pixi/react'
import { Container, Graphics, Text as PText } from 'pixi.js'
import type { GProps, RectProps, LineProps, ArcProps, CircleProps, PathProps, TextProps } from '../primitives'

extend({ Container, Graphics, Text: PText })

export const G = ({ children, x, y, rotation, opacity, ...handlers }: GProps) => (
  <pixiContainer x={x} y={y} rotation={rotation} alpha={opacity} eventMode="static" {...handlers}>
    {children}
  </pixiContainer>
)

export const Rect = ({ x, y, width, height, fill, stroke, strokeWidth, cornerRadius, ...handlers }: RectProps) => (
  <pixiGraphics
    eventMode="static"
    {...handlers}
    draw={(g) => {
      g.clear()
      if (fill) g.setFillStyle({ color: fill })
      if (stroke) g.setStrokeStyle({ width: strokeWidth ?? 1, color: stroke })
      if (cornerRadius) g.roundRect(x ?? 0, y ?? 0, width, height, cornerRadius)
      else              g.rect(x ?? 0, y ?? 0, width, height)
      if (fill) g.fill()
      if (stroke) g.stroke()
    }}
  />
)

// Analogicznie: Line (g.moveTo + g.lineTo), Arc (g.arc), Circle (g.circle),
// Path (parser SVG path), Text (<pixiText>)
```

#### `impl-pixi/CanvasShell.tsx`

```typescript
import { Application } from '@pixi/react'

export const CanvasShell = ({ width, height, children }) => (
  <Application width={width} height={height} resolution={devicePixelRatio()} autoDensity>
    {children}
  </Application>
)

// PixiJS nie ma odpowiednika Konvy <Layer>. GroupLayer/OverlayLayer = pusty <pixiContainer>
// z odpowiednim z-index'em (zIndex prop, sortableChildren=true na rodzicu).
export const GroupLayer = ({ children }) => <pixiContainer zIndex={0} sortableChildren>{children}</pixiContainer>
export const OverlayLayer = ({ children }) => <pixiContainer zIndex={1} sortableChildren>{children}</pixiContainer>
```

#### `impl-pixi/rasterize.ts`

```typescript
export async function rasterize(opts: RasterizeOptions): Promise<Blob> {
  const app = getActiveApp()
  return await app.renderer.extract.blob({
    target: app.stage,
    format: opts.format === 'jpg' ? 'jpeg' : 'png',
    quality: opts.quality,
    resolution: opts.pixelRatio
  })
}
```

### 3.3 Adapter Pointer Events

PixiJS Federated Events emituje już znormalizowane `pointer*` przez `eventMode="static"`. Zmiana w `pointerInput.ts` minimalna: zamiast nasłuchiwać DOM events na `<Stage>` HTMLDiv, podpiąć się pod `app.stage.on('pointerdown', ...)`. Reszta logiki (pinch tracking, gesture normalization) bez zmian.

### 3.4 Przełączenie eksportu

Jedna zmiana w `src/canvas-kit/index.ts`:

```typescript
// PRZED
export { CanvasShell, GroupLayer, OverlayLayer, G, Rect, Line, Arc, Circle, Path, Text, rasterize } from './impl-konva'

// PO
export { CanvasShell, GroupLayer, OverlayLayer, G, Rect, Line, Arc, Circle, Path, Text, rasterize } from './impl-pixi'
```

Po tej zmianie cały projekt (z `Renderer`-ami 8 kształtów włącznie) działa na PixiJS bez modyfikacji.

### 3.5 Aktualizacja ESLint zone

Wymienić aktywną whitelist:

```javascript
{
  files: ['src/canvas-kit/impl-pixi/**', 'src/components/canvas/**'],
  rules: { 'no-restricted-imports': 'off' }
}
```

I do `patterns` dodać blokadę `konva`/`react-konva` jako zakaz globalny (już jest, więc tylko upewnić się).

### 3.6 Usunięcie martwego kodu

Po zielonych testach: `git rm -r src/canvas-kit/impl-konva/`. Skasować alias `canvas` z `next.config.ts`. Skasować typ wpisów Konvy z `package.json` jeśli nie zostały.

### 3.7 Aktualizacja visual regression baselines

Playwright PNG baselines (sekcja CI w `CLAUDE.md`) zostaną złamane przez subtelne różnice antialiasingu między Konva (canvas2D) a PixiJS (WebGL). Procedura:

```bash
pnpm test:e2e -- --update-snapshots
git diff e2e/__screenshots__/   # ręcznie zweryfikować że różnice są tylko AA, nie geometrii
```

Commit nowych baselines z opisem „chore(canvas-kit): swap rendering engine — update visual baselines".

---

## Mapowanie API Konva ↔ PixiJS

| Konva (`react-konva`) | PixiJS v8 (`@pixi/react`) | Uwagi |
|---|---|---|
| `<Stage>` | `<Application>` | PixiJS używa WebGL/WebGPU, Konva canvas2D |
| `<Layer>` | `<pixiContainer zIndex>` + `sortableChildren` | PixiJS nie ma layerów, tylko z-index |
| `<Group x y rotation>` | `<pixiContainer x y rotation>` | semantycznie identyczne |
| `<Rect width height fill>` | `<pixiGraphics draw={g => g.rect(...).fill()}>` | PixiJS: imperatywne API w callback |
| `<Line points={[...]} />` | `<pixiGraphics draw={g => g.moveTo().lineTo()}>` | identycznie |
| `<Arc innerRadius outerRadius angle />` | `<pixiGraphics draw={g => g.arc(...)}>` | PixiJS bardziej low-level |
| `<Circle radius />` | `<pixiGraphics draw={g => g.circle(...).fill()}>` | identycznie |
| `<Text text fontSize align />` | `<pixiText text style={{fontSize, align}} />` | API zbliżone |
| `<Path data="M..."/>` | parser SVG path → seria `g.moveTo/lineTo/bezierCurveTo` | wymaga małej funkcji pomocniczej |
| `onClick`, `onTap` | `onClick`, `onPointerTap` (wymaga `eventMode="static"`) | PixiJS Federated Events |
| `onPointerDown/Move/Up` | tak samo, z `eventMode="static"` | unifikacja mouse/touch/pen out-of-the-box |
| `e.evt.touches[]` | nie istnieje — używać Pointer Events | **już teraz tego nie używamy** |
| `Konva.hitOnDragEnabled = true` | nie potrzebne (Federated Events działa zawsze) | gain |
| `stage.toDataURL()` | `app.renderer.extract.blob()` | wynik bardziej elastyczny w Pixi |
| `node.cache()` (Konva optimization) | `node.cacheAsBitmap = true` | różny mechanizm, zwykle niepotrzebne |
| `Stage.getIntersection(point)` | `app.stage.hitTest(point)` (lub własny bbox check) | **już teraz nie używamy — mamy `getWorldPoints`** |

---

## Co przeżywa wymianę, a co trzeba przepisać

### Bez modyfikacji (≈70% kodu)

- `src/store/**` — cały Zustand, slice'y, history, document codec
- `src/lib/**` — captureGeometry, shapeBounds, snapEngine, weldAutosize, documentCodec, exportEngine, overlapDetector
- `src/weld-units/types.ts`, `src/weld-units/bead-sequence.ts`
- `src/shapes/_base/**` — typy bazowe, ShapeDefinition interface
- `src/shapes/[typ]/types.ts`, `handles.ts`, `anchors.ts`, `autosize.ts`, `PropertiesPanel.tsx`
- `src/shapes/registry.ts`, `src/shapes/index.ts`
- `src/shapes/[typ]/index.ts.Renderer` — **TYLKO jeśli przestrzega §22.4** (importuje wyłącznie z `@/canvas-kit`)
- `src/app/**`, `src/messages/**`, `src/components/sidebar/**`, `src/components/toolbar/**`, `src/components/project-list/**`
- `src/canvas-kit/index.ts`, `primitives.ts`, `pointerInput.ts`, `constants.ts`
- Wszystkie testy Vitest jednostkowe spoza `canvas-kit/impl-*`

### Wymaga przepisania (≈30% kodu)

- `src/canvas-kit/impl-konva/**` → `src/canvas-kit/impl-pixi/**` (≈400-700 LOC)
- `src/weld-units/WeldUnitOverlay.tsx` — jeśli używa Konva-specific API zamiast prymitywów (powinien używać prymitywów)
- `src/components/canvas/CanvasApp.tsx`, `ShapeNode.tsx`, `ShapeHandles.tsx`, `MultiShapeHandles.tsx`, `WeldUnitHandles.tsx`, `AnchorPoints.tsx`, `SelectionMarquee.tsx` — minimalne korekty pod nowy backend zdarzeń (jeśli używają imperatywnych API Konvy)
- `next.config.ts` — usunąć alias `canvas: './empty.js'`
- `vitest.setup.ts` — usunąć `vitest-canvas-mock` (PixiJS w jsdom wymaga innego mocka, zazwyczaj wystarcza `@pixi/unsafe-eval` headless)
- ESLint config — przełączyć whitelist z `impl-konva` na `impl-pixi`
- Visual regression baselines (Playwright) — pełna regeneracja
- `CLAUDE.md` sekcja „Konva needs the `canvas` alias" — usunąć

### Ryzyka migracji

- **Antialiasing visual differences** — WebGL renderuje subtelnie inaczej niż canvas2D. Visual regression sygnalizuje to jako diff. Nie blocker, ale wymaga regeneracji baselines.
- **Tekst** — PixiJS używa innego renderera tekstu (BitmapFont lub SDF). Może wymagać korekty rozmiarów/pozycji w panelach legendy ściegów.
- **Wydajność maska/clip** — w Konvie clipping przez `clipFunc`. W PixiJS przez `mask`. Jeśli używamy clippingu — jeden plik więcej do przepisania.

---

## Lista kontrolna PR-a wymiany

PR „chore(canvas-kit): swap engine to PixiJS":

### Pre-merge

- [ ] Faza 2 zakończona z udokumentowanym no-go w `.ai/touch-spike-results.md`
- [ ] `src/canvas-kit/impl-pixi/` skompletowane (wszystkie prymitywy z `primitives.ts`)
- [ ] `pointerInput.ts` przepięte na PixiJS Federated Events (lub niezmienione, jeśli słucha DOM bezpośrednio)
- [ ] `eslint.config.js` — whitelist przeniesiona z `impl-konva` na `impl-pixi`
- [ ] `pnpm typecheck` — zielony
- [ ] `pnpm lint` — zielony (zero importów Konvy poza `impl-konva` które za chwilę usuniemy)
- [ ] `pnpm test:run` — zielony (jednostki domeny powinny być całkowicie nietknięte)
- [ ] `pnpm test:e2e -- --update-snapshots` — manualne zatwierdzenie diffów wizualnych
- [ ] `pnpm dev` — sanity check w przeglądarce (desktop + responsive mobile)
- [ ] Test na fizycznym tablecie — wszystkie scenariusze z Fazy 2.2 pass
- [ ] Bundle size check — porównanie z poprzednim buildem (PixiJS jest większy, ale lazy loadable)

### Merge

- [ ] `git rm -r src/canvas-kit/impl-konva/`
- [ ] `pnpm remove konva react-konva vitest-canvas-mock`
- [ ] `next.config.ts` — usunięcie aliasu `canvas`
- [ ] `CLAUDE.md` — usunięcie sekcji o aliasie Konvy, dodanie analogicznej notatki o Pixi (jeśli wymagana)
- [ ] `architecture-base.md` §1 — zmiana wpisu „Silnik canvas" na PixiJS
- [ ] `architecture-base.md` §22.1 — zmiana eksportów z `./impl-konva` na `./impl-pixi`
- [ ] Tag commitu: `chore(canvas-kit): swap rendering engine Konva → PixiJS`

### Post-merge

- [ ] Monitoring błędów (Sentry, jeśli wpięty) przez 7 dni — szczególnie raporty z urządzeń mobilnych
- [ ] Aktualizacja `.ai/touch-spike-results.md` z post-mortem (czy realnie pomogło)

---

## Decyzje i kompromisy

### Dlaczego cienki adapter, a nie pełny port/adapter (DDD ACL)?

Pełny adapter (np. interfejs `RenderingDriver` z metodami imperatywnymi) byłby bardziej formalny, ale:
- React-y deklaratywny model (komponenty-prymitywy) jest tańszy w utrzymaniu
- Konva i PixiJS mają niemal identyczną deklaratywną semantykę przez `react-konva` i `@pixi/react`
- Dodatkowa warstwa abstrakcji = dodatkowa konwersja na każdej klatce → ryzyko wydajności

Cienki re-eksport prymitywów + ESLint zone daje 95% korzyści ACL przy 10% kosztu.

### Dlaczego PixiJS, a nie Fabric.js / Three.js / custom canvas?

- **Fabric.js** — narzuca własny model selection/controls/transformers, sprzeczny z naszym `HandleGeometry` z rejestru. Migracja byłaby większą walką niż na PixiJS.
- **Three.js / r3f** — overkill (3D), ale ma najlepsze pointer events. Rozważyć tylko jeśli PixiJS też zawiedzie.
- **Custom `<canvas>` + reconciler** — DIY, niewspółmiernie do projektu MVP.
- **PixiJS** — najbliższy semantycznie do Konvy, WebGL/WebGPU = lepsza wydajność na mobile, Federated Events natywnie pointer-event-based, dojrzały React adapter (`@pixi/react` v8).

### Dlaczego `src/canvas-kit/`, a nie `src/lib/canvas/`?

`src/canvas-kit/` to świadoma sygnalizacja: to jest **boundary**, nie zwykła biblioteka pomocnicza. Wyróżnia się w drzewie katalogów i ESLint config może go cytować bez ryzyka pomyłki z innym `lib/`.

### Dlaczego `Renderer` zostaje `ComponentType`, a nie staje się czystą strukturą danych?

Pure-data renderer (np. `() => SceneNode[]`) byłby idealny dla agnostycyzmu, ale:
- Tracimy React state (animacje, lokalny hover)
- Tracimy hooks (useTranslations dla labelek)
- Konwersja JSX → SceneNode → ponowny JSX dla silnika to dwa razy ta sama praca

Kompromis: `Renderer` to React component, ale jego drzewo zawiera **wyłącznie** prymitywy `@/canvas-kit`. ESLint pilnuje, by zostało tak na zawsze.
