# Architektura WelderDoc

WelderDoc to przeglądarkowa aplikacja SaaS do tworzenia proporcjonalnych przekrojów złączy spawanych i sekwencji ściegów spawania.

Wymagania wydajnościowe: ≥ 30 FPS przy typowych scenach; < 200 ms reakcji UI na operacje edycji.

---

## 1. Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Framework frontendowy | Next.js (App Router), React, TypeScript |
| Silnik canvas | Konva.js via `react-konva` — ukryta za `src/canvas-kit/` (patrz §22). Wymienialna na PixiJS bez modyfikacji domeny. |
| Zarządzanie stanem | Zustand + Immer |
| Styling | Tailwind CSS |
| Ikony | Lucide React |
| Backend / baza danych | Supabase (PostgreSQL, region EU — Frankfurt) |
| Autentykacja | Supabase Auth (email+hasło, opcjonalnie OAuth) |
| Hosting | Vercel |
| CI/CD | GitHub Actions |
| Płatności | Paddle (Merchant of Record) |
| Internacjonalizacja | `next-intl` |
| Testy jednostkowe | Vitest (`jsdom` environment + `vitest-canvas-mock`), `@vitejs/plugin-react`, @testing-library/react, @testing-library/jest-dom (`/vitest`) |
| Testy e2e | Playwright (`@playwright/test`) |

---

## 2. Zasady projektowe

1. **Shape Registry:** `SHAPE_REGISTRY` mapuje `ShapeType` → `ShapeDefinition<S>`. Infrastruktura (store, uchwyty, sidebar, SNAP, eksport) operuje wyłącznie na interfejsie `ShapeDefinition`. Dodanie nowego kształtu nie modyfikuje infrastruktury.

2. **Z-index = kolejność w `shapes[]`.** Brak systemu warstw. Operacje z-index to czysty reorder tablicy.

3. **WeldUnit = sztywna jednostka ruchu.** Złącze spawalnicze zablokowane z elementami tworzy `WeldUnit` — elementy wewnątrz nie mogą być przesuwane niezależnie. Modyfikacja geometrii złącza odbywa się wyłącznie przez jego uchwyty lub w trybie sekwencji ściegów.

4. **Pointer Events API (`pointer*`) wszędzie** — nie używać `mouse*` ani `touch*` w komponentach canvas. `setPointerCapture` przy każdym starcie dragu.

5. **Transient vs. committed:** `updateShapeTransient` — live drag bez historii; `commitShapeUpdate` — koniec operacji z wpisem do `history[]`.

6. **`FieldUpdate` / `ShapeUpdate` boundary:** `ShapeDefinition` używa luźnego `FieldUpdate = Partial<Record<string, unknown>>`. Store używa ścisłego `ShapeUpdate` (intersection-derived). Rozwiązanie cyklu importów `shapes/` ↔ `store/`.

7. **Canvas-kit boundary:** import `konva` / `react-konva` (i każdej innej biblioteki silnika canvasu) dozwolony **wyłącznie** w `src/canvas-kit/impl-*/` i `src/components/canvas/`. Reszta kodu (`shapes/`, `weld-units/`, `store/`, `lib/`) używa wyłącznie prymitywów i komponentów reeksportowanych z `@/canvas-kit`. Wymiana silnika canvasu (np. PixiJS) sprowadza się do dodania `impl-pixi/` i przełączenia jednego eksportu w `canvas-kit/index.ts`. Pełna specyfikacja granicy: §22. Plan wymiany: `.ai/canvas-kit-migration-plan.md`.

---

## 3. Struktura katalogów

```
src/
  proxy.ts                  ← Next 16 middleware (eksportuje proxy + config);
                              chain: Supabase updateSession() → next-intl

  i18n/                     ← konfiguracja next-intl (App Router)
    routing.ts              ← defineRouting (locales: pl/en, defaultLocale: pl,
                              localePrefix: 'as-needed', localeDetection: false)
    request.ts              ← getRequestConfig (ładuje messages/{locale}.json)
    navigation.ts           ← typed Link / redirect / router

  types/
    database.ts             ← supabase gen types typescript --schema public
                              (regenerowany skryptem `pnpm supabase:types`)

  messages/
    pl.json                 ← tłumaczenia PL
    en.json                 ← tłumaczenia EN

  shapes/
    _base/
      types.ts              ← Point, BaseShape, BoundingBox, HandleGeometry, AnchorPoint, FieldUpdate
      definition.ts         ← ShapeDefinition<S> interface
    registry.ts             ← SHAPE_REGISTRY: Partial<Record<ShapeType, ShapeDefinition<any>>> (pełny Record gdy wszystkie 8 kształtów MVP); dostęp przez getShapeDefinition(type)
    index.ts                ← Shape union, ShapeType union
    plate/
      types.ts
      index.ts              ← ShapeDefinition<PlateShape>
      handles.ts
      anchors.ts
      PropertiesPanel.tsx
    pipe-front/             ← przekrój czołowy rury (pierścień)
    pipe-longitudinal/      ← przekrój podłużny rury (prostokąt + oś)
    profile-i/
    profile-c/
    profile-l/
    profile-t/
    weld-joint/
      types.ts
      index.ts
      handles.ts
      anchors.ts            ← punkty SNAP na krawędziach złącza
      autosize.ts           ← auto-dopasowanie rozmiaru do elementów w pobliżu
      PropertiesPanel.tsx
    [nowy-ksztalt]/         ← dodać tu; nic innego się nie zmienia

  weld-units/
    types.ts                ← WeldUnit, WeldBeadSequenceData, WeldLayer, BeadShape
    bead-sequence.ts        ← generowanie i modyfikacja sekwencji ściegów
    WeldUnitOverlay.tsx     ← renderowanie sekwencji ściegów na canvasie

  store/
    types.ts                ← ShapeUpdate (intersection-derived), HistoryEntry
    slices/
      shapes.ts             ← ShapesSlice
      weld-units.ts         ← WeldUnitsSlice
      history.ts            ← HistorySlice
      canvas.ts             ← CanvasSlice (viewport, zoom, pan, tool mode)
      ui.ts                 ← UISlice (selection, snap, dark mode)
      document.ts           ← DocumentSlice (meta, isDirty, save state)
    use-canvas-store.ts     ← złożony Zustand store

  components/
    canvas/                 ← STREFA UPRZYWILEJOWANA (§22.3): może
                              importować konva/react-konva bezpośrednio
      CanvasApp.tsx         ← podpina usePointerInput; reklasyfikuje drag → pan/select na podstawie toolMode
      ShapeNode.tsx
      ShapeHandles.tsx      ← generyczny, registry-driven
      AnchorPoints.tsx      ← generyczny, registry-driven (tryb weld-joint)
      MultiShapeHandles.tsx
      WeldUnitHandles.tsx   ← uchwyt obrotu całego WeldUnit
      SelectionMarquee.tsx
    sidebar/
      PropertiesSidebar.tsx
      WeldJointPanel.tsx
      WeldSequencePanel.tsx ← zarządzanie warstwami i ściegami
    toolbar/
      Toolbar.tsx
      ToolButton.tsx
    project-list/
      ProjectList.tsx

  canvas-kit/               ← warstwa abstrakcji silnika canvasu (§22)
    index.ts                ← reeksport prymitywów + CanvasShell + rasterize z aktywnej impl
    primitives.ts           ← typy props prymitywów (G, Rect, Line, Arc, Circle, Path, Text)
    pointerInput.ts         ← normalizacja DOM PointerEvent → gesty (pinch/drag/tap;
                              pan = drag w trybie hand — reklasyfikacja w CanvasApp)
    constants.ts            ← HIT_AREA_TOUCH/DESKTOP, devicePixelRatio helper
    impl-konva/             ← aktywna implementacja
      index.ts
      primitives.tsx        ← G→Group, Rect, Line, Arc, Circle, Path, Text (react-konva)
      CanvasShell.tsx       ← <Stage>+<Layer>; singleton ref → activeStage.ts → rasterize
      activeStage.ts        ← singleton ref do aktywnej Konva.Stage (czytany przez rasterize)
      rasterize.ts          ← stage.toDataURL → Blob
    impl-pixi/              ← przygotowane pod podmianę (post-MVP, jeśli zajdzie potrzeba)

  lib/
    supabase/
      client.ts             ← createBrowserClient (Client Components, browser hooks)
      server.ts             ← createClient (Server Components / Route Handlers)
                              + createAdminClient (service_role; tylko server-side)
      middleware.ts         ← updateSession() — chain w proxy.ts; refresh JWT
      errors.ts             ← BusinessError enum + mapPostgrestError/mapAuthError
                              (deterministyczne mapowanie kodów DB/Auth na klucze i18n)
      profile.ts            ← updateProfile() wrapper — filtruje protected fields
                              (plan, paddle_customer_id, current_consent_version)
                              przed PATCH user_profiles; TypeScript egzekwuje SafeUpdate
    captureGeometry.ts      ← reeksport SHAPE_REGISTRY[type].captureGeometry
                              (used by store: commitShapeUpdate)
    shapeBounds.ts          ← reeksport SHAPE_REGISTRY[type].getBoundingBox
                              (used by SNAP, exportEngine, multi-select)
    snapEngine.ts           ← logika SNAP (czyste funkcje — bez Konvy / store'u)
    documentCodec.ts        ← serialize/deserialize sceny
    exportEngine.ts         ← eksport PNG/JPG (wywołuje canvas-kit.rasterize)
    overlapDetector.ts      ← wykrywanie nakładania weld-joint z elementami
    ipAnonymize.ts          ← anonimizacja IP do /24 (IPv4) / /48 (IPv6) — RODO motyw 30

  app/
    [locale]/               ← segment locale next-intl (pl | en); WSZYSTKIE
                              page.tsx i layout.tsx wywołują setRequestLocale(locale)
                              przed użyciem hooków next-intl
      layout.tsx            ← NextIntlClientProvider + generateStaticParams
      page.tsx              ← landing
      (auth)/
        login/page.tsx
        register/page.tsx
        reset-password/page.tsx
      (app)/
        canvas/[projectId]/page.tsx
        projects/page.tsx
    api/                    ← Route Handlers (sekretne / server-side; szczegóły §16)
      health/route.ts                              (GET)
      consent/route.ts                             (POST)
      user/export/route.ts                         (GET)
      user/account/route.ts                        (DELETE — RODO art. 17, re-auth wymagana)
      paddle/webhook/route.ts                      (POST)
      cron/expire-subscriptions/route.ts           (GET)
      cron/cleanup-webhook-events/route.ts         (GET)
    globals.css             ← Tailwind v4 (@import + @theme + @variant dark)

tests/                      ← Vitest integration / cross-module suites
                              (testy unit pojedynczego helpera mogą być
                               co-locowane jako src/lib/<x>.test.ts —
                               vitest.config.ts include obejmuje oba
                               wzorce)
e2e/                        ← Playwright e2e + visual regression
supabase/                   ← Supabase CLI: config.toml + migrations/ + seed.sql
```

---

## 4. Typy bazowe

### `src/shapes/_base/types.ts`

```typescript
// Point — kanoniczne źródło: src/canvas-kit/primitives.ts (geometria 2D należy do silnika).
// Re-eksport tutaj dla wygody konsumentów `shapes/`.
export type { Point } from '@/canvas-kit'
import type { Point } from '@/canvas-kit'

export interface BaseShape {
  id: string
  type: ShapeType
  x: number; y: number
  rotation: number
  opacity: number
  fill: string
  stroke: string
  strokeWidth: number
}

export interface BoundingBox { x1: number; y1: number; x2: number; y2: number }

export interface HandleDescriptor { kind: string; x: number; y: number; cursor?: string }

export interface HandleGeometry {
  bbox: BoundingBox
  sides: HandleDescriptor[]
  scale: Point
  rotate: Point
}

export interface AnchorPoint {
  id: string
  x: number
  y: number
  direction?: number   // kąt normalnej wychodzącej, 0 = prawo
}

export interface AnchorEdge {
  id: string
  a: Point             // start odcinka (world)
  b: Point             // koniec odcinka (world)
  direction: number    // kąt normalnej zewnętrznej, 0 = prawo
}

export interface StartSnapshot { x: number; y: number; rotation: number }

export type FieldUpdate = Partial<Record<string, unknown>>
```

### `src/shapes/_base/definition.ts`

```typescript
export interface ShapeDefinition<S extends BaseShape = BaseShape> {
  type: ShapeType
  label: string
  icon: ComponentType

  create: (pos: Point) => S

  Renderer: ComponentType<{ shape: S; isSelected: boolean; isInLockedUnit: boolean }>
  PropertiesPanel: ComponentType<{ shape: S }>

  captureGeometry: (shape: S) => FieldUpdate
  getBoundingBox: (shape: S) => BoundingBox
  getWorldPoints: (shape: S) => Point[]

  getHandles: ((shape: S) => HandleGeometry) | null
  captureStart: ((shape: S) => StartSnapshot) | null
  applyHandleDrag: ((
    start: StartSnapshot,
    kind: string,
    ldx: number, ldy: number,
    startLocalPtr: Point,
    sinθ: number, cosθ: number,
  ) => FieldUpdate) | null

  anchors?: (shape: S) => AnchorPoint[]     // point-snap (sekcja 10.1)
  edges?: (shape: S) => AnchorEdge[]        // edge-snap z attachmentem (sekcja 10.2)

  validate?: (shape: S) => ValidationError[]

  toSVG?: (shape: S) => string
}

export interface ValidationError {
  field: string
  message: string
}
```

---

## 5. Rejestr kształtów

### `src/shapes/registry.ts`

```typescript
// Partial podczas implementacji (kształty dodawane iteracyjnie).
// Gdy wszystkie 8 kształtów MVP zaimplementowane → zmienić Partial<Record> na Record.
export const SHAPE_REGISTRY: Partial<Record<ShapeType, ShapeDefinition<any>>> = {};

// Jedyny dostęp do registry z gwarancją runtime (rzuca Error jeśli type niezarejestrowany):
export function getShapeDefinition<S extends BaseShape>(type: ShapeType): ShapeDefinition<S>
```

Docelowe wpisy (dodawane wraz z kolejnymi kształtami):

```typescript
// Docelowa zawartość SHAPE_REGISTRY po implementacji wszystkich kształtów MVP:
{
  'plate':              PlateDefinition,
  'pipe-front':         PipeFrontDefinition,
  'pipe-longitudinal':  PipeLongitudinalDefinition,
  'profile-i':          ProfileIDefinition,
  'profile-c':          ProfileCDefinition,
  'profile-l':          ProfileLDefinition,
  'profile-t':          ProfileTDefinition,
  'weld-joint':         WeldJointDefinition,
}
```

**Dostęp do registry:** zawsze przez `getShapeDefinition(type)` — nigdy przez `SHAPE_REGISTRY[type]` bezpośrednio (może zwrócić `undefined` dopóki kształt nie jest zarejestrowany).

**Dodanie nowego kształtu — 4 miejsca:**
1. Nowy katalog `src/shapes/[typ]/` z `types.ts`, `handles.ts`, `anchors.ts` (eksportuje `anchors()` i — jeśli kształt ma proste ścianki — `edges()`), `index.ts`, `PropertiesPanel.tsx`
2. `src/shapes/index.ts` — dodanie do unii `ShapeType`
3. `src/shapes/registry.ts` — wpis w `SHAPE_REGISTRY`
4. `src/store/types.ts` — dodanie do `AllShapeGeometry`

Żaden inny plik nie ulega modyfikacji.

---

## 6. Typy kształtów MVP

### `plate`

```typescript
interface PlateShape extends BaseShape {
  type: 'plate'
  width: number
  thickness: number
  bevelType: 'none' | 'single' | 'double'
  bevelAngleTop: number      // 0–80°, krok 0.5°
  bevelAngleBottom: number   // tylko dla 'double'
  bevelHeight: number
}
```

Anchor points (point-snap): narożniki + środki ścianek.  
Anchor edges (edge-snap): każda widoczna ścianka prostoliniowa (zależnie od typu bevelu).

### `pipe-front`

```typescript
interface PipeFrontShape extends BaseShape {
  type: 'pipe-front'
  outerDiameter: number
  wallThickness: number    // constraint: < outerDiameter / 2 − 1
}
```

Wizualizacja: pierścień (koło wewnątrz koła).  
Anchor points (point-snap): 4 kardynalne + środek.  
Anchor edges: brak (kształt czysto okrągły — nie uczestniczy w edge-snap jako target).  
Uchwyty: skalowanie uchwytem zmienia `outerDiameter` (`Renderer` przelicza `radius = outerDiameter / 2`); `wallThickness` absolutna z walidacją inline. `outerDiameter` jest single source of truth — spójność z `pipe-longitudinal` oraz PRD US-019 ("średnica zewnętrzna").

### `pipe-longitudinal`

```typescript
interface PipeLongitudinalShape extends BaseShape {
  type: 'pipe-longitudinal'
  length: number
  outerDiameter: number
  wallThickness: number    // constraint: < outerDiameter / 2 − 1
}
```

Wizualizacja: prostokąt z osią symetrii i oznaczeniem ∅.  
Anchor points (point-snap): narożniki + środki ścianek.  
Anchor edges (edge-snap): 4 ścianki prostokąta.

### `profile-i` (analogicznie `profile-c`, `profile-l`, `profile-t`)

```typescript
interface ProfileIShape extends BaseShape {
  type: 'profile-i'
  totalHeight: number
  flangeWidth: number
  flangeThickness: number
  webThickness: number
  bevelType: 'none' | 'single' | 'double'
  bevelAngleTop: number
  bevelAngleBottom: number
  bevelHeight: number
}
```

Każdy wymiar niezależnie przeciągalny przez własny uchwyt. Walidacja geometryczna sygnalizowana inline — edycja nie jest blokowana.  
Anchor points (point-snap): środki każdej odsłoniętej ścianki profilu.  
Anchor edges (edge-snap): każda odsłonięta ścianka prostoliniowa profilu (po jednym `AnchorEdge` na segment konturu).

### `weld-joint`

```typescript
type WeldJoinType =
  | 'fillet'        // pachwinowa trójkątna
  | 'butt-square'   // czołowa prostokątna
  | 'butt-v'        // czołowa V
  | 'butt-x'        // czołowa X
  | 'butt-y'        // czołowa Y
  | 'butt-k'        // czołowa K
  | 'butt-u'        // czołowa U
  | 'spot'          // punktowa

interface WeldJointShape extends BaseShape {
  type: 'weld-joint'
  joinType: WeldJoinType
  leg1?: number           // fillet
  leg2?: number           // fillet
  angle?: number          // butt-v, butt-x, itp.
  rootGap?: number
  depth?: number
  diameter?: number       // spot
}
```

Przy wstawieniu: `autosize.ts` dopasowuje startowe wymiary na podstawie bounding boxów elementów w pobliżu.  
Renderowanie: proporcjonalna geometria zgodna z `joinType`.

---

## 7. Model WeldUnit

### `src/weld-units/types.ts`

```typescript
type WeldUnitState =
  | 'locked'      // elementy + złącze ruszają się jako jednostka; brak sekwencji (Konwertuj dostępne)
  | 'sequence'    // jak 'locked', ale złącze rysowane jako sekwencja ściegów (overlay)
  | 'detached'    // unit istnieje w storze (pamięć dormant), ale elementy poruszają się niezależnie

interface WeldUnit {
  id: string
  state: WeldUnitState
  elementIds: string[]                     // plate / pipe / profile
  weldJointId: string
  sequenceData: WeldBeadSequenceData | null
    // null w 'locked'
    // aktywna sekwencja (renderowana) w 'sequence'
    // dormant (do potencjalnego przywrócenia) w 'detached'; może być null jeśli unit nigdy nie był skonwertowany
  sequenceJointChecksum: string | null
    // checksum geometrii weld-joint w momencie zapisu sequenceData; null gdy sequenceData == null
}

interface WeldBeadSequenceData {
  beadShape: BeadShape
  layers: WeldLayer[]
  manualNumbering: number[][]              // [layerIndex][beadIndex] → numer wyświetlany
}

interface WeldLayer {
  id: string
  depth: number
  beadCount: number                        // min. 1
}

type BeadShape = 'rounded-triangle' | 'rounded-trapezoid'
```

Każdy `weld-joint` ma co najwyżej jeden `WeldUnit` (lookup po `weldJointId`). `WeldBeadSequenceData` NIE jest elementem `shapes[]` — żyje wyłącznie wewnątrz `WeldUnit`. `WeldUnitOverlay.tsx` renderuje sekwencję tylko gdy `state === 'sequence'`.

### Maszyna stanów

Stan `'detached'` pełni rolę „pamięci dormant" — unit istnieje, ale dla wszystkich efektów ruchu/zaznaczenia zachowuje się jak brak unitu. „Zablokuj" pojawia się ponownie gdy w stanie `'detached'` `weld-joint` znów nachodzi ≥ 2 elementy.

```
                        Zablokuj                                Konwertuj
   (brak unitu) ───────────────────────────► [state='locked'] ─────────────► [state='sequence']
        ▲                                            │  ▲                            │
        │                                            │  │                            │
        │ usunięcie                                  │  │  Zablokuj (checksum OK     │ Odblokuj
        │ weld-joint                       Odblokuj  │  │   → restore sequenceData)  │ (zapis sequenceData
        │ lub elementu                  (sequenceData│  │                            │  i sequenceJointChecksum)
        │ z elementIds                  bez zmian)   │  │  Zablokuj (inaczej         │
        │                                            │  │   → state='locked',        │
        │                                            ▼  │   sequenceData=null,       ▼
        │                                       [state='detached'] ◄──────────────────
        │                                            │
        └────────────────────────────────────────────┘
```

**Tworzenie unitu (brak unitu → `'locked'`):**
„Zablokuj" widoczne, gdy `weld-joint` nachodzi bbox-em na ≥ 2 elementy i nie istnieje unit dla tego `weldJointId`. Klik tworzy `WeldUnit` z `state='locked'`, `sequenceData=null`, `sequenceJointChecksum=null`.

**`'locked' → 'sequence'` (Konwertuj):**
Generuje świeże `WeldBeadSequenceData` z bieżącej geometrii `weld-joint`. `sequenceJointChecksum = computeWeldJointChecksum(weldJoint)`.

`computeWeldJointChecksum(s: WeldJointShape): string` to **pure function** w `src/weld-units/bead-sequence.ts` — deterministyczny hash kluczowych pól geometrycznych (`joinType`, `leg1`, `leg2`, `angle`, `rootGap`, `depth`, `diameter`). Nigdy nie jest przechowywana w `WeldJointShape` (pole `_geometryChecksum` zostało usunięte — checksum jest zawsze obliczany on-the-fly).

**`'sequence' → 'detached'` (Odblokuj z sekwencji):**
`state='detached'`. `sequenceData` i `sequenceJointChecksum` pozostają nietknięte — to one zasilają potencjalne przywrócenie. Elementy i złącze odzyskują niezależność ruchu, ale unit zostaje w storze.

**`'locked' → 'detached'` (Odblokuj bez konwersji):**
`state='detached'`. `sequenceData` i `sequenceJointChecksum` pozostają `null` (żadna sekwencja nigdy nie istniała).

**`'detached' → 'sequence' | 'locked'` (Zablokuj ponowne):**
Wymaga, by `weld-joint` ponownie nachodził ≥ 2 elementy.
- `sequenceData != null` AND `computeWeldJointChecksum(currentWeldJoint) === sequenceJointChecksum` → `state='sequence'` (przywrócenie 1:1, sekwencja widoczna natychmiast, bez przycisku Konwertuj).
- W przeciwnym razie → `state='locked'`, `sequenceData=null`, `sequenceJointChecksum=null` (świeży start; pojawia się Konwertuj).

**Zniszczenie unitu:** usunięcie `weld-joint` lub któregokolwiek elementu z `elementIds` kasuje unit wraz z dormant. Brak osobnej akcji „skasuj pamięć dormant" — naturalna ścieżka to modyfikacja geometrii złącza w stanie `'detached'` przed kolejnym Zablokuj.

**Niezmiennik geometrii w `'sequence'` i `'locked'`:** w obu tych stanach parametry `weld-joint` (oraz parametry powiązanych elementów) są tylko do odczytu w panelu właściwości. Dzięki temu `sequenceJointChecksum` zapisany w momencie odblokowania zawsze odpowiada geometrii sprzed odblokowania.

### Wykrywanie nakładania (`src/lib/overlapDetector.ts`)

Nakładanie = niepuste przecięcie bounding boxów `weld-joint` i elementu (z uwzględnieniem rotacji przez transformację punktów). Sprawdzane na każdym pointerup `weld-joint` i każdym pointerup elementu w stanach `'detached'` lub gdy unit jeszcze nie istnieje — wynik decyduje o widoczności przycisku „Zablokuj".

### Przyciski akcji

| Sytuacja | Widoczne przyciski |
|---|---|
| Brak unitu, overlap ≥ 2 | „Zablokuj" |
| Brak unitu, overlap < 2 | (brak) |
| `state='locked'` | „Konwertuj", „Odblokuj" |
| `state='sequence'` | „Odblokuj" |
| `state='detached'`, overlap ≥ 2 | „Zablokuj" |
| `state='detached'`, overlap < 2 | (brak — unit pozostaje w pamięci) |

### Zachowanie ruchu i zaznaczenia

| Stan | Drag elementu | Drag weld-joint | Edycja parametrów | Uchwyt obrotu |
|---|---|---|---|---|
| Brak unitu / `'detached'` | przesuwa pojedynczy element | przesuwa pojedyncze złącze | dostępna per element/złącze | per element |
| `'locked'` / `'sequence'` | przesuwa cały unit | przesuwa cały unit | tylko do odczytu | na poziomie unitu, obraca całość |

Pozostałe reguły dla `'locked'` / `'sequence'`:
- Kliknięcie → zaznaczany fizycznie kliknięty kształt; otwierany odpowiedni panel właściwości (read-only dla pól zablokowanych).
- Marquee obejmujące WeldUnit → zaznacza unit jako całość.
- Multi-select wielu unitów (`'locked'` / `'sequence'`) → drag przesuwa wszystkie.

W stanie `'detached'` unit nie wpływa na zaznaczenie ani ruch — interfejs traktuje elementy i złącze jak niezależne kształty.

### Generowanie sekwencji (`src/weld-units/bead-sequence.ts`)

1. Z geometrii `weld-joint` obliczana liczba warstw i ściegów per warstwa.
2. Ściegi równomiernie rozmieszczone w warstwie.
3. Numeracja: 1, 2, 3… od dołu do góry, od lewej do prawej.
4. Użytkownik może ręcznie zmieniać numery w `WeldSequencePanel`.

Operacje (wszystkie cofalne przez Undo, dostępne wyłącznie gdy `state === 'sequence'`):
- Dodaj / usuń ścieg w warstwie [+] / [−] (min. 1 ścieg)
- Dodaj / usuń warstwę (min. 1 warstwa)
- Kształt ściegu: globalny dla całej sekwencji

---

## 8. Store (Zustand + Immer)

### Złożenie

```typescript
type CanvasStore =
  ShapesSlice & WeldUnitsSlice & HistorySlice &
  CanvasSlice & UISlice & DocumentSlice

export const useCanvasStore = create<CanvasStore>()(
  immer((...a) => ({
    ...createShapesSlice(...a),
    ...createWeldUnitsSlice(...a),
    ...createHistorySlice(...a),
    ...createCanvasSlice(...a),
    ...createUISlice(...a),
    ...createDocumentSlice(...a),
  }))
)
```

### ShapesSlice

```typescript
interface ShapesSlice {
  shapes: Shape[]   // z-index = kolejność

  addShape: (shape: Shape) => void
  // sprawdza limit planu; push HistoryEntry { kind: 'shape', before: null, after: full }

  removeShape: (id: string) => void
  // push HistoryEntry { kind: 'shape', before: full, after: null }
  // jeśli kształt to weld-joint lub należy do elementIds aktywnego WeldUnit:
  //   wywołuje removeUnit z tym samym groupId — undo przywraca obie rzeczy atomowo

  updateShapeTransient: (id: string, patch: ShapeUpdate) => void
  // live drag / live edit; BEZ historii

  commitShapeUpdate: (id: string, before: ShapeUpdate, after: ShapeUpdate) => void
  // push HistoryEntry { kind: 'shape', before: diff, after: diff }

  reorderShape: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  mirrorShape: (id: string, axis: 'horizontal' | 'vertical') => void
  // ↑ wewnętrznie używają commitShapeUpdate — historia obsłużona automatycznie
}
```

### WeldUnitsSlice

```typescript
interface WeldUnitsSlice {
  weldUnits: WeldUnit[]

  // Tworzy nowy unit (state='locked') albo przywraca istniejący 'detached':
  // - jeśli istnieje unit dla weldJointId w 'detached' AND sequenceData != null
  //   AND checksum(currentJoint) === sequenceJointChecksum → state='sequence' (restore)
  // - jeśli istnieje unit w 'detached' z mismatchem → state='locked',
  //   sequenceData=null, sequenceJointChecksum=null
  // - jeśli unit nie istnieje → utwórz z state='locked'
  lockUnit: (weldJointId: string, elementIds: string[]) => void

  // 'sequence' → 'detached' (sequenceData i sequenceJointChecksum zachowane jako dormant)
  // 'locked'   → 'detached' (sequenceData/checksum pozostają null)
  unlockUnit: (unitId: string) => void

  // 'locked' → 'sequence' (generuje świeżą sekwencję, ustawia sequenceJointChecksum)
  convertToSequence: (unitId: string) => void

  addBeadToLayer: (unitId: string, layerIndex: number) => void
  removeBeadFromLayer: (unitId: string, layerIndex: number) => void
  addLayer: (unitId: string) => void
  removeLayer: (unitId: string, layerIndex: number) => void
  setBeadShape: (unitId: string, shape: BeadShape) => void
  setBeadNumber: (unitId: string, layerIndex: number, beadIndex: number, n: number) => void

  // Kasuje unit całkowicie (wraz z dormant). Wywoływane automatycznie
  // przy usunięciu weld-joint lub któregokolwiek elementu z elementIds.
  removeUnit: (unitId: string) => void
}
```

Operacje mutujące sekwencję (`addBeadToLayer`, `removeBeadFromLayer`, `addLayer`, `removeLayer`, `setBeadShape`, `setBeadNumber`) są dozwolone wyłącznie gdy `state === 'sequence'`. Próba wywołania w innym stanie to błąd programistyczny.

**Historia:** każda operacja `WeldUnitsSlice` (oprócz wewnętrznych readów) push'uje `HistoryEntry { kind: 'weld-unit' }` — wzorzec snapshot-mutate-snapshot:

```typescript
function withWeldUnitHistory(unitId: string, mutation: () => void) {
  const before = snapshotUnit(unitId)   // null jeśli unit jeszcze nie istnieje
  mutation()
  const after = snapshotUnit(unitId)    // null jeśli unit właśnie usunięty
  if (!equalsSnapshot(before, after)) {
    pushHistory({ kind: 'weld-unit', unitId, before, after })
  }
}
```

`snapshotUnit` zwraca `WeldUnitSnapshot | null`. Mapowanie operacji na zawartość wpisu:

| Operacja | `before` | `after` |
|---|---|---|
| `lockUnit` (nowy unit) | `null` | snapshot `'locked'` |
| `lockUnit` (z `'detached'`) | snapshot `'detached'` | snapshot `'locked'` lub `'sequence'` |
| `unlockUnit` | snapshot `'locked'`/`'sequence'` | snapshot `'detached'` |
| `convertToSequence` | snapshot `'locked'` | snapshot `'sequence'` (fresh data) |
| `addBeadToLayer` / `removeBeadFromLayer` | snapshot przed | snapshot po |
| `addLayer` / `removeLayer` | snapshot przed | snapshot po |
| `setBeadShape` / `setBeadNumber` | snapshot przed | snapshot po |
| `removeUnit` | snapshot przed | `null` |

Gdy `removeUnit` jest wywołane kaskadowo z `removeShape`, oba wpisy dostają wspólny `groupId` — jedno Ctrl+Z przywraca i kształt, i unit (z dormant).

### HistorySlice

```typescript
type WeldUnitSnapshot = Pick<
  WeldUnit,
  'weldJointId' | 'state' | 'sequenceData' | 'sequenceJointChecksum' | 'elementIds'
>

type HistoryEntry = (
  | { kind: 'shape';     shapeId: string; before: ShapeUpdate | null;      after: ShapeUpdate | null }
  | { kind: 'weld-unit'; unitId: string;  before: WeldUnitSnapshot | null; after: WeldUnitSnapshot | null }
) & {
  groupId?: string   // wpisy z tym samym groupId są cofane / redowane atomowo jednym Ctrl+Z
}

interface HistorySlice {
  history: HistoryEntry[]
  historyIndex: number

  pushHistory: (entry: HistoryEntry) => void
  undo: () => void                       // cofa pojedynczy wpis lub całą grupę z tym samym groupId
  redo: () => void
}
```

**Konwencja `before` / `after`:**
- `before === null` → wpis reprezentuje utworzenie; undo usuwa, redo tworzy.
- `after === null` → wpis reprezentuje usunięcie; undo tworzy, redo usuwa.
- Oba `!= null` → update; undo aplikuje `before`, redo aplikuje `after`.

Dla `kind: 'shape'`: `ShapeUpdate` to `Partial<AllShapeGeometry & { type: ShapeType }>` — przy create/delete musi zawierać komplet pól geometrycznych + `type`; przy update wystarczą zmienione pola.

Dla `kind: 'weld-unit'`: `WeldUnitSnapshot` to wszystkie pola definiujące tożsamość i logiczny stan unitu, z pominięciem `id` (`id` przechowywane w `unitId` na wpisie).

Max 100 wpisów (FIFO drop przy przepełnieniu). Nie persystowana do Supabase.

### CanvasSlice

```typescript
interface CanvasSlice {
  stageX: number; stageY: number
  stageScale: number
  canvasWidth: number; canvasHeight: number
  toolMode: 'select' | 'hand' | 'weld-joint'

  panBy: (dx: number, dy: number) => void
  zoomTo: (scale: number, focalPoint: Point) => void
  setToolMode: (mode: ToolMode) => void
  setCanvasSize: (w: number, h: number) => void
}
```

### UISlice

```typescript
interface UISlice {
  selectedIds: string[]
  snapEnabled: boolean
  attachment: SnapAttachment | null     // aktywny edge-snap attachment, patrz sekcja 10.2
  isDarkMode: boolean
  locale: 'pl' | 'en'

  setSelection: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  toggleSnap: () => void
  setSnapTemporary: (enabled: boolean) => void
  setAttachment: (a: SnapAttachment | null) => void
  setDarkMode: (dark: boolean) => void
  setLocale: (locale: 'pl' | 'en') => void
}
```

### DocumentSlice

```typescript
interface DocumentSlice {
  documentId: string | null
  documentName: string
  isDirty: boolean
  isSaving: boolean
  lastSavedAt: Date | null

  setDocumentName: (name: string) => void
  saveDocument: () => Promise<void>
  loadDocument: (id: string) => Promise<void>
  createDocument: (name: string) => Promise<void>
}
```

### ShapeUpdate (`src/store/types.ts`)

```typescript
type AllShapeGeometry =
  Omit<PlateShape,            'id' | 'type'> &
  Omit<PipeFrontShape,        'id' | 'type'> &
  Omit<PipeLongitudinalShape, 'id' | 'type'> &
  Omit<ProfileIShape,         'id' | 'type'> &
  Omit<ProfileCShape,         'id' | 'type'> &
  Omit<ProfileLShape,         'id' | 'type'> &
  Omit<ProfileTShape,         'id' | 'type'> &
  Omit<WeldJointShape,        'id' | 'type'>

export type ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>
```

---

## 9. Canvas i nawigacja

### Struktura sceny

Komponenty domeny (`CanvasApp`, `ShapeNode`, `ShapeHandles`, …) korzystają wyłącznie z `@/canvas-kit`. Konkretny silnik (Konva dziś, potencjalnie PixiJS jutro) jest niewidoczny dla tego poziomu.

```tsx
import { CanvasShell, GroupLayer, OverlayLayer } from '@/canvas-kit'

<CanvasShell width={viewportWidth} height={viewportHeight}>
  <GroupLayer>
    {shapes.map((s) => <ShapeNode key={s.id} shape={s} />)}
    {weldUnits.map((u) => <WeldUnitOverlay key={u.id} unit={u} />)}
  </GroupLayer>
  <OverlayLayer>  {/* kontrolki — zawsze na wierzchu */}
    <ShapeHandles />
    <WeldUnitHandles />
    <MultiShapeHandles />
    <AnchorPoints />      {/* widoczne w trybie 'weld-joint' */}
    <SelectionMarquee />
  </OverlayLayer>
</CanvasShell>
```

Mapowanie w aktywnej implementacji `canvas-kit/impl-konva/`:
- `CanvasShell` → `<Stage pixelRatio={devicePixelRatio()}>` (`devicePixelRatio` z `@/canvas-kit` jest funkcją SSR-safe — patrz `src/canvas-kit/constants.ts`)
- `GroupLayer` / `OverlayLayer` → `<Layer>`
- `G/Rect/Line/Arc/Circle/Path/Text` → `<Group>/<Rect>/<Line>/<Arc>/<Circle>/<Path>/<Text>` z `react-konva`

### Tryby kursora

| Tryb | Zachowanie | Skrót |
|---|---|---|
| `select` | drag na pustym → marquee; drag na elemencie → move | `V` |
| `hand` | drag → pan | `H` |
| `weld-joint` | klik → wstawia weld-joint | `W` |

### Pan i zoom

- Scroll → pan
- Scroll + Ctrl/Cmd → zoom (punkt ogniskowy = kursor)
- Touch 1 palec → pan; pinch → zoom
- Viewport ograniczony do granic obszaru roboczego (`canvasWidth × canvasHeight`)
- Widok startowy po wczytaniu: zoom-to-fit, padding ≤ 40 px
- Pinch-to-zoom: śledzenie dwóch `pointerId` w `canvas-kit/pointerInput.ts` (nie w `CanvasApp.tsx`). Komponenty domeny otrzymują znormalizowane gesty (`pinch | drag | tap`) z `pointerInput`; reklasyfikacja `drag` → pan dzieje się w `CanvasApp.tsx` na podstawie `toolMode` i hit-testu (`canvas-kit` jest engine-agnostic i nie zna trybów aplikacji). Nie używać `gesturestart`/`gesturechange` ani natywnych eventów `e.evt.touches[]` Konvy — pinch implementujemy wyłącznie przez Pointer Events API.

### Obsługa dotykowa

| Gest | Akcja |
|---|---|
| 1 tap na pustym | pan |
| 2 taps na pustym | aktywuje marquee |
| 2 taps na elemencie | inicjuje przesuwanie (jeśli element nie jest w locked WeldUnit) |
| 1 tap na zaznaczonym | inicjuje przesuwanie |
| 1 tap na uchwycie | aktywuje uchwyt |
| Pinch | zoom |

Hit area uchwytów: 20 px (touch) / 8 px (desktop). Detekcja: `navigator.maxTouchPoints > 0`.

---

## 10. System SNAP

System SNAP działa w dwóch niezależnych, **współistniejących** trybach. Oba tryby sterowane są jednym togglem (`UISlice.snapEnabled`) i tym samym tymczasowym wyłączeniem (`Alt`).

| Tryb | Cel | Stan między klatkami | Wybierany przez |
|---|---|---|---|
| **10.1 Point-snap** | Wstawianie `weld-joint`, wyrównywanie punktowe | Bezstanowy (per-frame) | Tryb `weld-joint`; tryb `select` przy braku kandydata edge-snap |
| **10.2 Edge-snap z attachmentem** | Przesuwanie elementów po równoległej ściance („na szynach") | Stan w `UISlice.attachment` | Tryb `select` przy dragu elementu/grupy/WeldUnit |

Dane wejściowe pochodzą z `SHAPE_REGISTRY`: `anchors()` zasila tryb 10.1, `edges()` zasila tryb 10.2. Przeciągany kształt i jego grupa (multi-select / WeldUnit) są wykluczone z listy kandydatów.

### 10.1 Point-snap

Tryb dyskretny: punkt referencyjny (kursor wstawiania `weld-joint`, narożnik bbox przy wyrównywaniu) przyciąga się do najbliższego dyskretnego `AnchorPoint`.

- Próg: `POINT_SNAP_THRESHOLD = 8 px` (przestrzeń canvasu)
- Brak histerezy, brak stanu — czysta projekcja per frame
- Wizualizacja: `AnchorPoints.tsx` renderuje diamenty w trybie `weld-joint`

### 10.2 Edge-snap z attachmentem

Tryb krawędziowy z trwałym przyklejeniem. Aktywny przy przesuwaniu elementu / grupy / WeldUnit w trybie `select`. Działa wyłącznie między **równoległymi** krawędziami.

#### Model attachmentu

```typescript
interface SnapAttachment {
  draggedShapeId: string        // pojedynczy element lub root grupy / WeldUnit
  draggedEdgeId: string
  targetShapeId: string
  targetEdgeId: string
  param: number                 // pozycja punktu kontaktu wzdłuż target edge, 0..1
}
```

Stan trzymany w `UISlice.attachment`. Resetowany na `pointerup` lub przy `Alt`/wyłączeniu snapu.

#### Stałe

```typescript
const POINT_SNAP_THRESHOLD = 8       // px, point-snap (10.1)
const ATTACH_THRESHOLD     = 8       // px, edge-snap attach
const RELEASE_THRESHOLD    = 16      // px, edge-snap release (histereza)
const PARALLEL_TOLERANCE   = 0.087   // sin(5°)
```

`RELEASE_THRESHOLD > ATTACH_THRESHOLD` zapewnia histerezę zapobiegającą drganiu attach/release przy ruchu blisko progu.

#### Faza ATTACH (gdy `attachment === null`)

1. Dla każdej pary `(e_drag, e_target)` z krawędzi przeciąganego × krawędzi pozostałych elementów:
   - **Równoległość:** `|sin(angle(e_drag) − angle(e_target))| < PARALLEL_TOLERANCE`
   - **Przekrycie:** rzutuj końce `e_drag` na linię nośną `e_target`; wymagaj `overlap > 0`
   - **Odległość prostopadła** `d` mierzy odsunięcie linii nośnych
2. Wybierz parę o najmniejszym `d` przy `d < ATTACH_THRESHOLD`
3. Zatrzaśnij: przesuń element prostopadle do `e_target`, tak aby krawędzie się stykały
4. Zapisz `attachment`; oblicz `param` jako pozycję rzutu środka `e_drag` na `e_target`

#### Faza SLIDE (gdy `attachment !== null`)

Ruch wskaźnika (`Δp`) rozkładany na bazę krawędzi:

- `Δ_along` — komponenta wzdłuż `e_target`
- `Δ_perp` — komponenta prostopadła do `e_target`

Algorytm:

1. Akumuluj `Δ_perp` od momentu ostatniego attachu: `perp_accum += Δ_perp`
2. Jeżeli `|perp_accum| < RELEASE_THRESHOLD`:
   - przesuń element wyłącznie o `Δ_along` (pozycja prostopadła zatrzaśnięta)
   - aktualizuj `attachment.param` o przesunięcie wzdłuż krawędzi
3. Jeżeli `|perp_accum| ≥ RELEASE_THRESHOLD`:
   - `attachment = null`, `perp_accum = 0`
   - kontynuuj jako swobodny drag (na kolejnej klatce może powstać nowy attach do innej krawędzi)

#### Multi-select i WeldUnit

Przy dragu grupy lub WeldUnit krawędzie kandydujące pochodzą **wyłącznie z zewnętrznego konturu** zbiorczego (nie z wewnętrznych krawędzi elementów grupy). Wszystkie elementy grupy są wykluczone z listy targetów.

#### Wizualizacja

- Stan ATTACHED: krawędź `e_target` podświetlona akcentem (linia 2 px) na dedykowanej warstwie kontrolek
- Brak diamentów point-snap w trybie `select` (są zarezerwowane dla trybu `weld-joint`)

### 10.3 Sterowanie (wspólne)

- Toggle button w toolbarze (`snapEnabled`); podświetlony = aktywny
- Przytrzymanie `Alt`: tymczasowe wyłączenie obu trybów; zwolnienie przywraca poprzedni stan
- Wyłączenie snapu lub `Alt` w trakcie attachu → `attachment = null` natychmiast

### 10.4 Kontrakt `src/lib/snapEngine.ts`

```typescript
export function findPointSnap(
  source: Point,
  candidates: AnchorPoint[],
  threshold: number,
): AnchorPoint | null

export function findEdgeAttachment(
  draggedEdges: AnchorEdge[],
  targetEdges: { shapeId: string; edges: AnchorEdge[] }[],
  attachThreshold: number,
  parallelTolerance: number,
): SnapAttachment | null

export function applySlide(
  attachment: SnapAttachment,
  targetEdge: AnchorEdge,
  pointerDelta: Point,
  perpAccum: number,
  releaseThreshold: number,
): { delta: Point; nextPerpAccum: number; release: boolean }
```

Wszystkie funkcje czyste — testowalne bez Konvy ani store'u.

---

## 11. Historia operacji (Undo/Redo)

`HistoryEntry` (sekcja 8) to dyskryminowana unia: `kind: 'shape'` i `kind: 'weld-unit'`. Każdy wpis ma snapshoty `before` / `after`; `null` na którymkolwiek końcu oznacza odpowiednio utworzenie (`before=null`) lub usunięcie (`after=null`). Snapshoty są pełne (nie diffy) dla create/delete oraz dla całej rodziny `weld-unit`; dla `commitShapeUpdate` to diff/diff.

**Co trafia do historii:**

| Slice / operacja | Rodzaj wpisu |
|---|---|
| `addShape` | `shape`, `before=null` / `after=full` |
| `removeShape` | `shape`, `before=full` / `after=null` (+ `groupId` jeśli kaskaduje na unit) |
| `commitShapeUpdate` | `shape`, diff / diff |
| `mirrorShape`, `reorderShape` | `shape` (poprzez `commitShapeUpdate`) |
| `lockUnit` (nowy unit) | `weld-unit`, `before=null` / `after=snapshot('locked')` |
| `lockUnit` (z `'detached'`) | `weld-unit`, `before=snapshot('detached')` / `after=snapshot('locked' \| 'sequence')` |
| `unlockUnit` | `weld-unit`, oba snapshoty |
| `convertToSequence` | `weld-unit`, `before=snapshot('locked')` / `after=snapshot('sequence')` z fresh data |
| `addBeadToLayer`, `removeBeadFromLayer` | `weld-unit`, oba snapshoty |
| `addLayer`, `removeLayer` | `weld-unit`, oba snapshoty |
| `setBeadShape`, `setBeadNumber` | `weld-unit`, oba snapshoty |
| `removeUnit` (kaskada z `removeShape`) | `weld-unit`, `before=full` / `after=null`, `groupId` współdzielony z `shape-remove` |

**Co NIE trafia do historii:**
- `updateShapeTransient` — live drag / live edit; snapshot dopiero w `commitShapeUpdate` na koniec interakcji.
- Operacje viewportowe (`panBy`, `zoomTo`), zaznaczenie (`setSelection`), toggle SNAP, dark mode, locale, save state.

**Atomowe grupy (`groupId`):** wpisy z tym samym `groupId` są cofane / redowane jednym Ctrl+Z. Główny use case: usunięcie `weld-joint` lub elementu należącego do unitu — `removeShape` push'uje wpis `shape` i pociąga `removeUnit` (wpis `weld-unit`), oba z tym samym `groupId`. Jedno Ctrl+Z przywraca kształt **i** unit z całym dormant. Multi-shape moves nadal generują po jednym wpisie na kształt bez `groupId` (zachowanie pre-existing — może otrzymać grupowanie w przyszłej iteracji bez zmiany typu `HistoryEntry`).

**Persistencja i limity:**
- Po każdym `pushHistory`: synchroniczny zapis pełnej sceny + historii do `localStorage`.
- Max 100 wpisów; przy przepełnieniu drop najstarszych (FIFO).
- Historia NIE trafia do Supabase (sekcja 13).

**Skróty:**
- Undo: `Ctrl+Z` / `Cmd+Z`
- Redo: `Ctrl+Y` / `Ctrl+Shift+Z` / `Cmd+Y` / `Cmd+Shift+Z`

---

## 12. Eksport

### Proces (`src/lib/exportEngine.ts`)

1. Ukryć kontrolki (handles, marquee, anchor points)
2. Jeśli kadrowanie: bounding box wszystkich elementów + padding 20 px
3. Nałożyć warstwę opisową (jeśli włączona)
4. Nałożyć watermark (jeśli plan Guest lub Free)
5. Wywołać `rasterize(options)` z `@/canvas-kit` → `Blob` (PNG lub JPG)

`exportEngine` nie zna konkretnego silnika canvasu. `canvas-kit/impl-konva/rasterize.ts` deleguje do `stage.toDataURL()`; `canvas-kit/impl-pixi/rasterize.ts` (jeśli powstanie) deleguje do `app.renderer.extract.image()`.

```typescript
// src/canvas-kit/index.ts (kontrakt — niezmienny przy wymianie silnika)
export interface RasterizeOptions {
  format: 'png' | 'jpg'
  area: 'full' | 'content'  // content = bbox + padding 20px
  pixelRatio?: number
}
export function rasterize(options: RasterizeOptions): Promise<Blob>
```

### Opcje

- **Obszar:** pełny canvas lub kadrowanie do bounding box zawartości (padding 20 px)
- **Warstwa opisowa:** numery ściegów rysowane na każdym ściegu + tabela legendy poniżej rysunku

### Watermark

Plany Guest i Free: powtarzający się tekst po przekątnej, pokrywający całą powierzchnię, opacity 25%. Renderowany jako ostatnia warstwa.

### Walidacja

`shapes.length === 0` → blokada eksportu z toastem. (`weldUnits.length === 0` jest zawsze implikowane przez `shapes.length === 0`, bo `removeShape(weld-joint)` kaskaduje na `removeUnit` — sprawdzanie obu warunków jest redundantne.)

---

## 13. Trwałość danych

### localStorage (autozapis)

Klucz: `'welderdoc_autosave'`. Zapis synchronicznie przy każdym `commitShapeUpdate` i operacji WeldUnit.

```typescript
interface LocalStorageSnapshot {
  schemaVersion: number
  scene: CanvasDocument
  history: HistoryEntry[]
  historyIndex: number
  savedAt: string   // ISO
}
```

Przy starcie: klucz istnieje i `schemaVersion` zgodna → przywróć scenę i historię.

`QuotaExceededError`: przyciąć historię do 50 wpisów i ponowić; przy dalszym błędzie → toast z rekomendacją zapisu w chmurze.

### Supabase (zapis świadomy)

Inicjowany wyłącznie akcją użytkownika. PATCH na `documents.data`.

```typescript
interface CanvasDocument {
  schemaVersion: number
  canvasWidth: number
  canvasHeight: number
  shapes: Shape[]
  weldUnits: WeldUnit[]
}
```

Historia operacji nie jest zapisywana do Supabase.

### Document Codec (`src/lib/documentCodec.ts`)

```typescript
encodeDocument(storeState): CanvasDocument
decodeDocument(doc: CanvasDocument): { shapes, weldUnits, canvasWidth, canvasHeight }
```

Jedyne miejsce definiujące format serializacji. Przy decode: sprawdzenie `schemaVersion`; jeśli starsza — uruchomienie funkcji migracyjnej.

Kod migracyjny pisany przy każdej realnej zmianie schematu; stare dokumenty muszą być upgradowne bez utraty danych.

---

## 14. Uwierzytelnianie i plany

### Supabase Auth

- Rejestracja: email + hasło (format email, min. 8 znaków)
- Logowanie, wylogowanie, reset przez email (link ważny min. 1 h)
- Sesja persystowana między odświeżeniami
- Rejestracja: obowiązkowy checkbox zgody; zdarzenie zgody zapisywane w `consent_log` (append-only) z anonimizacją IP po stronie serwera; denormalizacja aktywnej wersji w `user_profiles.current_consent_version`

### Przepływ rejestracji z consent (kolejność operacji)

Formularz rejestracji wykonuje **dwa kolejne wywołania** w tym samym `onSubmit`:

```
1. supabase.auth.signUp({ email, password })
   ↓ sukces → sesja
     - PROD (Supabase Cloud, enable_confirmations = ON): email unverified, email_confirmed_at = NULL
     - DEV  (lokalny config.toml, enable_confirmations = false): auto-confirmed, email_confirmed_at = now()
2. POST /api/consent { types: ['terms_of_service','privacy_policy','cookies'], version, userAgent }
   ↓ handler anonimizuje IP z nagłówka X-Forwarded-For, używa klienta sesji
     (createClient z @supabase/ssr) i wywołuje RPC `record_consent_bundle()`
     (SECURITY DEFINER, wykonuje się jako rola `postgres` — nie service_role).
     Funkcja waliduje auth.uid() = p_user_id i atomowo wstawia 3 wiersze do
     consent_log oraz (gdy p_accepted) aktualizuje user_profiles.current_consent_version.
     SUPABASE_SERVICE_ROLE_KEY nie jest tu potrzebny.
```

> **Konfiguracja prod:** Supabase Cloud → Auth → Settings musi mieć `Enable email confirmations = ON` + skonfigurowany custom SMTP (Resend/Postmark) **przed** pierwszą rejestracją produkcyjną. Bez confirmations on polityka RLS `documents` (`email_confirmed_at IS NOT NULL`) jest faktycznie bez efektu — patrz `db-plan.md` §5.13a.

**Obsługa błędów:**
- `signUp()` fail → walidacja formularza, brak POST consent
- `signUp()` ok + `POST /api/consent` fail → toast z możliwością ponowienia (handler waliduje brak duplikatu typu w bundle przed INSERT-em); użytkownik **nie** musi się ponownie rejestrować; przy następnym zalogowaniu aplikacja sprawdza `current_consent_version IS NULL` i wymusza ponowny modal zgody przed wejściem na kanwas
- Brak rollback `signUp()`: Supabase Auth nie oferuje atomowego rollbacku auth+insert; akceptujemy „unverified user bez zgody" jako stan przejściowy (RLS na `documents` blokuje zapis przez `email_confirmed_at IS NOT NULL` — w PROD; w DEV ten stan jest natychmiast skończony przez auto-confirm)

**Weryfikacja zgody przy sesji:** przy każdym zalogowaniu pobierz `user_profiles.current_consent_version`. Jeśli `NULL` lub starsza niż aktualna wersja TOS/PP → pokaż modal zgody przed wejściem do aplikacji (Route: `/[locale]/consent-required`). Zdarzenie ponownej zgody = `POST /api/consent` (bundle z aktualną wersją); handler wykona INSERT do `consent_log` i atomowo ustawi `current_consent_version` (kolumna chroniona triggerem przed bezpośrednim UPDATE z klienta — patrz `db-plan.md` §1.2).

### Tryb gościa

- Aplikacja dostępna bez konta
- Autozapis wyłącznie w localStorage
- Baner CTA
- Limit 3 elementów łącznie (prymitywy + weld-joint); 4. element blokowany z toastem CTA

### Migracja gościa

Po zalogowaniu: jeśli `'welderdoc_autosave'` istnieje → automatyczna migracja do Supabase jako nowy projekt (bez akcji użytkownika). Toast potwierdzający po pomyślnej migracji.

### Plany

| Plan | Elementy na scenie | Projekty cloud | Watermark |
|---|---|---|---|
| Guest | max 3 | 0 | tak |
| Free | max 3 | 1 | tak |
| Pro | bez limitu | bez limitu | nie |

Płatności: Paddle. Ceny: Pro Monthly 49 PLN / Pro Annual 399 PLN.  
Logika limitów: w `ShapesSlice.addShape`; plan pobierany z `user_profiles` przy starcie sesji.

---

## 15. Schemat bazy danych

> **Source of truth: `.ai/db-plan.md`.** Pełne typy, constrainty, triggery, indeksy, polityki RLS i funkcje `SECURITY DEFINER` — wyłącznie tam. Niniejsza sekcja zawiera **tylko diagram relacji + listę tabel**, by uniknąć dryfu DDL między dwoma plikami.

### Diagram

```
auth.users ──1:1── user_profiles
   │
   ├──1:N── documents      (owner_id, ON DELETE CASCADE)
   ├──1:N── subscriptions  (user_id, ON DELETE SET NULL — audyt billingu zachowany)
   └──1:N── consent_log    (user_id, ON DELETE CASCADE, append-only)

webhook_events  (samodzielne, dostęp wyłącznie service_role)
```

### Tabele

| Tabela | Cel | Kluczowe ograniczenia / triggery |
|---|---|---|
| `user_profiles` | 1:1 z `auth.users`; cache `plan`, `paddle_customer_id`, `current_consent_version`, `locale` | `block_protected_columns_update` chroni `plan`/`paddle_customer_id`/`current_consent_version` przed zapisem z roli `authenticated`. Dwa kanały bypass'a (zgodne intencjonalnie): **DB-side** (`current_user = 'postgres'`) — wszystkie SECURITY DEFINER funkcje wykonujące się jako rola właściciela: `record_consent_bundle` (zapisuje `current_consent_version`), `refresh_user_plan_from_subscriptions` (zapisuje `plan`), `sync_paddle_customer` (zapisuje `paddle_customer_id`); **App-side** (`auth.role() = 'service_role'`) — `createAdminClient` w `app/api/paddle/webhook/route.ts` przy `customer.*` wykonuje bezpośredni `UPDATE user_profiles SET paddle_customer_id = …`, omija block-trigger przez tę gałąź. Patrz `db-plan.md` §1.2. |
| `documents` | Pojedynczy projekt; cała scena w JSONB | `data` JSONB ≤ 5 MB; `check_free_project_limit` blokuje 2. projekt dla planu Free; `sync_schema_version_from_data` synchronizuje `schema_version` z `data->>'schemaVersion'` |
| `subscriptions` | Aktualny stan subskrypcji Paddle (1 wiersz / `paddle_subscription_id`) | Mutacje tylko z `service_role`; trigger `subscriptions_after_iu_refresh_plan` (insert/update of `status, current_period_end, user_id`) odświeża `user_profiles.plan` |
| `consent_log` | Append-only audyt zgód RODO (TOS / PP / cookies) | Brak `UPDATE`/`DELETE`; bundle insert + `current_consent_version` UPDATE atomowo przez `record_consent_bundle()` |
| `webhook_events` | Idempotencja webhooków + audyt techniczny | Brak polityk RLS = tylko `service_role`; `UNIQUE (provider, external_event_id)` |

### RLS (przegląd)

| Tabela | Polityki |
|---|---|
| `documents` | `FOR ALL TO authenticated USING owner_id = auth.uid() AND email_confirmed_at IS NOT NULL` |
| `user_profiles` | `SELECT` + `UPDATE` gdzie `id = auth.uid()` |
| `subscriptions` | `SELECT` gdzie `user_id = auth.uid()` |
| `consent_log` | `SELECT` + `INSERT` gdzie `user_id = auth.uid()` (append-only) |
| `webhook_events` | brak polityk → tylko `service_role` |

Pełne specyfikacje: `db-plan.md` §1.2 – §1.6 (kolumny + triggery), §3 (indeksy), §4 (RLS), §4.7 (funkcje `SECURITY DEFINER`).

---

## 16. API (Next.js Route Handlers)

Operacje CRUD dokumentów i auth: Supabase client SDK bezpośrednio (Row Level Security).  
Route Handlers dla operacji wymagających server-side secret lub kontekstu serwera:

```
POST   /api/paddle/webhook          ← weryfikacja podpisu Paddle + upsert subskrypcji; trigger DB aktualizuje plan
POST   /api/consent                 ← zapis zgody RODO z anonimizacją IP po stronie serwera (RODO motyw 30)
GET    /api/user/export             ← eksport danych użytkownika: dokumenty + consent_log (RODO art. 20)
DELETE /api/user/account            ← trwałe usunięcie konta (RODO art. 17); re-auth hasłem + `confirmation: "DELETE"`;
                                       kaskada DB: documents + consent_log CASCADE, subscriptions SET NULL
GET    /api/health
GET    /api/cron/expire-subscriptions     ← Vercel Cron 03:00 UTC daily; woła refresh_expired_plans()
GET    /api/cron/cleanup-webhook-events   ← Vercel Cron 02:00 UTC Sunday; retencja 90 dni webhook_events
```

**Middleware:** `src/proxy.ts` (nie standardowa `middleware.ts`) eksportuje `proxy` i `config`. Łańcuch wywołań: `updateSession()` (Supabase `@supabase/ssr`) → `next-intl` middleware. Kolejność jest obowiązkowa — Supabase musi odświeżyć token przed routingiem locale.

**Wyłączenie `/api/*` z proxy matchera (`?!api`):** Route Handlery nie przechodzą przez `updateSession()` w `proxy.ts` (matcher zaczyna się od negatywnej lookahead `?!api`). Odświeżenie tokenu odbywa się per-request wewnątrz handlera przy pierwszym wywołaniu `auth.getUser()` — `createServerClient` z `@supabase/ssr` rejestruje handler `cookies.setAll`, który zapisuje odświeżone tokeny do `Response`. Konsekwencja: każdy Route Handler wymagający sesji **musi** wywołać `auth.getUser()` (lub `auth.getSession()`) **przed** dowolną operacją na danych użytkownika — w przeciwnym razie operuje na potencjalnie wygasłym tokenie z poprzedniego requestu. Endpointy publiczne (`/api/health`) i webhook (`/api/paddle/webhook` — autoryzacja przez sygnaturę HMAC) i crony (`/api/cron/*` — `Authorization: Bearer ${CRON_SECRET}`) nie odczytują sesji użytkownika i nie podlegają tej zasadzie.

### Duplikowanie dokumentu (US-012)

Operacja **client-side** — bez dedykowanego Route Handlera:

```typescript
// 1. Pobierz oryginał
const { data: original } = await supabase
  .from('documents')
  .select('name, data, schema_version')
  .eq('id', sourceId)
  .single()

// 2. Wstaw kopię (id generowane przez DB default)
const { error } = await supabase
  .from('documents')
  .insert({ name: `${original.name} (kopia)`, data: original.data, schema_version: original.schema_version })
```

Trigger `check_free_project_limit()` automatycznie rzuca `project_limit_exceeded` przy próbie duplikacji na planie Free (limit 1 projektu). Aplikacja mapuje przez `error.message.includes('project_limit_exceeded')` na toast upgrade CTA.

**Egzekwowanie limitu Free (UI ↔ DB, defense-in-depth):**

- **UI (warstwa pierwszej linii):** przyciski `Duplikuj` / `Nowy projekt` w `ProjectList.tsx` są `disabled` dla `useUserPlan().plan === 'free'` gdy `projects.length >= 1`. Tooltip + CTA upgrade tłumaczony przez `useTranslations('errors.project_limit_exceeded')`.
- **DB (defense-in-depth):** trigger `check_free_project_limit()` rzuca `RAISE EXCEPTION 'project_limit_exceeded'` jeśli UI permitów (np. po race-condition między tabami albo w pierwszym tiku przy stale plan cache). Aplikacja łapie błąd po `error.message.includes('project_limit_exceeded')` i renderuje ten sam toast co warstwa UI — single source of truth dla copy w `messages/{pl,en}.json` pod kluczem `errors.project_limit_exceeded`.

Dlaczego dwa poziomy: UI disabled daje natychmiastowy feedback bez round-tripa do DB; DB trigger gwarantuje, że obejście DevTools / bezpośrednie wywołanie REST nie złamie limitu planu.

### Reguły implementacji checkout

**Checkout Paddle (US-045) — wymaganie `customData.user_id`:** call do `Paddle.Checkout.open({...})` MUSI ustawiać `customData: { user_id: <auth.uid()> }`. Bez tego pierwszy webhook subskrypcji idzie przez 3-stopniowy lookup (`customData → paddle_customer_id → email`) i może dotrzeć do orphan log, jeśli email Paddle różni się od Supabase Auth (np. user kupił Pro przez inny adres niż w `auth.users`, albo email jeszcze niepotwierdzony). Eventual consistency przez trigger `sync_paddle_customer` zwykle „dogania" stan, ale pierwszy webhook może nie zaaplikować efektu na `user_profiles`. Ten wymóg **nie jest weryfikowany przez kod handler'a** — PR-checklist musi go wymusić ręcznie. Patrz `api-plan.md` §2.1 (Recovery flow).

---

## 17. Internacjonalizacja

Biblioteka: `next-intl`.

```
src/messages/
  pl.json
  en.json
```

**Routing locale (`src/i18n/routing.ts`):** `defineRouting({ locales: ['pl','en'], defaultLocale: 'pl', localePrefix: 'as-needed', localeDetection: false })`. Detekcja preferencji przeglądarki (`Accept-Language`) jest **świadomie wyłączona** — uniknięcie zaskakującego dla użytkownika redirectu z `/` na `/en` przy pierwszej wizycie z anglojęzycznej przeglądarki, oraz uproszczenie cache'owania krawędziowego dla domyślnego locale.

**Rozpoznawanie locale w runtime (kolejność):**
1. Pathname URL (`/en/...` → `en`; brak prefiksu → `pl`, bo `localePrefix: 'as-needed'`).
2. Cookie `NEXT_LOCALE` (zapisywane przez `next-intl` na ręcznej zmianie języka).
3. `routing.defaultLocale` (`'pl'`).

**Persystencja preferencji użytkownika:**
- **Gość:** wybór języka w UI → cookie `NEXT_LOCALE` (zarządzane przez `next-intl`) + opcjonalnie `localStorage` jako fallback.
- **Zalogowany:** dodatkowo `UPDATE user_profiles.locale = '<wybrany>'` (zapis przez Supabase SDK). Po następnym logowaniu (zwłaszcza na innym urządzeniu) layout root wykonuje `redirect` na `/<user.locale>/...`, jeśli `pathname locale ≠ user.locale`.

**Wymagania per `page.tsx` / `layout.tsx`:** każda strona pod segmentem `[locale]` wywołuje `setRequestLocale(locale)` przed pierwszym hookiem `next-intl` (`useTranslations`, `getMessages`). `generateStaticParams()` zwraca komplet locali (`routing.locales.map((locale) => ({ locale }))`) — wymagane dla SSG.

Zero hardcoded stringów w komponentach — wszystkie teksty w `src/messages/{pl,en}.json` czytane przez `useTranslations(...)`.

---

## 18. CI/CD i deployment

```
GitHub Actions  (.github/workflows/ci.yml)
  ├── on: pull_request → main
  │     ├── lint-and-typecheck   (ESLint flat config + tsc --noEmit)
  │     ├── unit-tests           (Vitest single-run)
  │     ├── e2e-mandatory        (Playwright — chromium-desktop, jedyny obowiązkowy)
  │     └── e2e-informational    (chromium-mobile / firefox-desktop / webkit-desktop;
  │                               continue-on-error — informacyjne, nie blokują merge)
  └── on: push → main
        └── (ten sam zestaw jobów co dla pull_request — bez deploy stepa)

Deployment (PROD i preview)
  └── Vercel GitHub Integration (NIE GitHub Actions)
        ├── push do main           → production deploy
        ├── push do branch z PR    → preview URL (komentowany przez Vercel bot pod PR)
        └── revert / rollback      → konsolą Vercel (Deployments → Promote)
```

> **Brak deploy stepa w `ci.yml`** — Vercel GitHub Integration robi to atomowo. Dodanie `vercel deploy` do GitHub Actions zdublowałoby deploy i wymagałoby sekretu `VERCEL_TOKEN`. Tę zasadę dokumentuje `tech-stack.md` §12.

- **Preview:** Vercel preview URL dla każdego PR (Vercel Integration)
- **Production:** Vercel (region `fra1`) + Supabase EU-Frankfurt
- **Vercel Cron:** harmonogram w `vercel.json` (`crons[]`); endpointy w `app/api/cron/*` autoryzowane nagłówkiem `Authorization: Bearer ${CRON_SECRET}`. **Production deploy guardrail:** `vercel.json:crons[]` musi mieć pokrycie istniejącymi `route.ts` przed pierwszym push'em na `main` — inaczej Vercel Cron uderzy w 404 i nie zadziała ani downgrade planów po grace period (`refresh_expired_plans()`), ani retencja 90 dni `webhook_events`. Vercel Cron wymaga planu Pro projektu Vercel.

**Zmienne środowiskowe:** pełna lista w `tech-stack.md` §13 (jedyne źródło prawdy). `.env.example` w roocie repo zawiera szablon do skopiowania jako `.env.local`. Każda zmiana zestawu zmiennych aktualizowana w `tech-stack.md` §13 + `.env.example` jednocześnie — niniejszy dokument celowo nie duplikuje listy, by wykluczyć dryf.

---

## 19. Dodanie nowego typu kształtu

Przykład: `profile-u`.

1. `src/shapes/profile-u/` — `types.ts`, `handles.ts`, `anchors.ts` (eksportuje `anchors()` + `edges()`), `index.ts`, `PropertiesPanel.tsx`
2. `src/shapes/index.ts` — `'profile-u'` do unii `ShapeType`
3. `src/shapes/registry.ts` — `'profile-u': ProfileUDefinition`
4. `src/store/types.ts` — `Omit<ProfileUShape, 'id' | 'type'>` do `AllShapeGeometry`

Żaden inny plik nie ulega modyfikacji — `ShapeHandles`, `PropertiesSidebar`, `snapEngine` (point + edge), `documentCodec`, `exportEngine` działają automatycznie. `edges()` jest opcjonalne; brak implementacji oznacza, że kształt nie uczestniczy w edge-snap jako target.

> **⚠ BREAKING change przy pierwszym kształcie:** dziś `AllShapeGeometry = {}` (scaffold w `src/store/types.ts`) — to akceptowalne tylko dopóki `SHAPE_REGISTRY` jest pusty. Krok 4 dla **pierwszego** kształtu **musi** zastąpić scaffolda pełną intersectionem (`Omit<FirstShape, 'id' | 'type'>` zamiast `{}`); kolejny kształt rozszerza ją operatorem `&`. Bez tego `ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>` redukuje się do `Partial<{ type: ShapeType }>` i wszystkie call-sites `commitShapeUpdate` / `updateShapeTransient` tracą bezpieczeństwo typów (literówki w nazwach pól typu `with` vs `width` przejdą bez błędu kompilacji). Hard-stopu w CI nie ma — pamiętać o tym ręcznie przy review pierwszego PR-a kształtu.

---

## 20. Znane ryzyka techniczne

### Konva na tablet / stylus

- `pointer*` events wszędzie; `setPointerCapture` przy starcie dragu
- Hit area: 20 px (touch) / 8 px (desktop)
- `pixelRatio={devicePixelRatio()}` (wrapper SSR-safe z `@/canvas-kit/constants`) ustawiane przez `CanvasShell` (impl-konva → na `<Stage>`); patrz §22.9.4 — bezpośredni dostęp do `window.devicePixelRatio` poza `src/canvas-kit/` jest zabroniony
- **Spike na fizycznym tablecie (iPad, Wacom) PRZED implementacją 8 kształtów** — empiryczna weryfikacja, czy Konva nie wymaga wymiany na PixiJS
- Cała logika multi-touch żyje w `canvas-kit/pointerInput.ts` — niezależna od Konvy

### Wymiana silnika canvasu (Konva → PixiJS)

- Konva ukryta za `src/canvas-kit/`. Wymiana = dodanie `impl-pixi/` (prymitywy 1:1, `CanvasShell`, `rasterize`, adapter Federated Events) i przełączenie eksportu w `canvas-kit/index.ts`
- ESLint `no-restricted-imports` blokuje import `konva`/`react-konva` poza `src/canvas-kit/impl-*` i `src/components/canvas/`
- Pełny plan migracji: `.ai/canvas-kit-migration-plan.md`
- ~70% kodu (domena, store, history, snap, weld-units) przeżywa wymianę bez modyfikacji

### Złożoność maszyny stanów WeldUnit

- Cała logika izolowana w `WeldUnitsSlice` i `bead-sequence.ts`
- Checksum geometrii złącza jako deterministyczny warunek przywrócenia dormant sequence
- Testy jednostkowe dla każdego przejścia stanów

### Auto-sizing weld-joint

- `autosize.ts` jest pure function → łatwa do testowania
- Fallback na stałe domyślne wartości gdy algorytm nie może dopasować
- Użytkownik może ręcznie korygować uchwytami

### Wydajność przy dużych scenach

- `updateShapeTransient` nie zapisuje do historii ani localStorage — minimalna praca przy drag
- Przy > 50 elementach: rozważyć `cache()` na złożonych kształtach profili

---

## 21. Ściągawka

```
ShapeType (closed union)
  └─► getShapeDefinition(type) → ShapeDefinition<S>   ← ZAWSZE przez getShapeDefinition, nigdy SHAPE_REGISTRY[type] bezpośrednio
        ├── create(pos)              → nowy S
        ├── Renderer                 → drzewo prymitywów @/canvas-kit (G/Rect/Line/Arc/Circle/Path/Text)
        ├── PropertiesPanel          → sidebar form
        ├── captureGeometry(s)       → FieldUpdate
        ├── getBoundingBox(s)        → BoundingBox
        ├── getWorldPoints(s)        → Point[]
        ├── getHandles(s)            → HandleGeometry | null
        ├── captureStart(s)          → StartSnapshot | null
        ├── applyHandleDrag(…)       → FieldUpdate | null
        ├── anchors?(s)              → AnchorPoint[]   (point-snap)
        ├── edges?(s)                → AnchorEdge[]    (edge-snap target)
        └── validate?(s)             → ValidationError[]

Store (Zustand + Immer)
  ├── shapes: Shape[]           z-index = kolejność tablicy
  ├── weldUnits: WeldUnit[]
  ├── history: HistoryEntry[]   max 100, localStorage only
  │     kind: 'shape' | 'weld-unit'  before/after | null = create/delete
  │     groupId? → atomowy multi-entry undo (np. shape-remove + weld-unit-remove)
  ├── canvas                    viewport, zoom, toolMode
  ├── ui                        selection, snap, attachment, darkMode
  └── document                  name, isDirty, save state

WeldUnit (state: 'locked' | 'sequence' | 'detached')
  (brak unitu) ──Zablokuj──► locked ──Konwertuj──► sequence
                              │ ▲                     │
                              │ │                     │
                              │ │  Zablokuj           │ Odblokuj
                              │ │  (checksum OK       │ (zapis sequenceData
                              │ │   → sequence)       │  + sequenceJointChecksum)
                              │ │                     ▼
                              └─┴────── detached ◄────┘
                                Odblokuj (locked → detached, sequenceData=null)

  Trigger Zablokuj  : bbox overlap weld-joint × ≥ 2 elementy
  detached          : unit żyje w storze, ale ruch elementów niezależny (UI jak brak unitu)
  Restore dormant   : tylko gdy checksum(currentJoint) == sequenceJointChecksum
  Zniszczenie unitu : usunięcie weld-joint lub elementu z elementIds

Canvas (przez @/canvas-kit; impl-konva aktywne, impl-pixi przygotowane)
  CanvasShell
    GroupLayer   : shapes + WeldUnit overlays   [z-index = kolejność shapes[]]
    OverlayLayer : handles, WeldUnitHandles, marquee, anchors   [zawsze na wierzchu]
  pointerInput   : DOM PointerEvent → { pinch | drag | tap }
                   pan = drag w trybie 'hand' — reklasyfikacja w CanvasApp.tsx
  rasterize      : eksport PNG/JPG (delegacja do silnika)
  Import konva/react-konva: WYŁĄCZNIE w canvas-kit/impl-* i components/canvas/

SNAP (dwa tryby współistnieją)
  10.1 Point-snap          : anchors() → AnchorPoint, próg 8 px, bez stanu
                             tryb 'weld-joint' + wyrównywanie punktowe
  10.2 Edge-snap (sticky)  : edges() → AnchorEdge, attach 8 px / release 16 px (histereza)
                             równoległość ścian + slide po krawędzi target
                             stan: UISlice.attachment, reset na pointerup

Persistence
  localStorage : scena + historia → odtwarzanie przy starcie
  Supabase     : JSONB snapshot przy świadomym zapisie, bez historii

Nowy kształt → 4 miejsca:
  src/shapes/[typ]/      nowy katalog
  src/shapes/index.ts    +1 do ShapeType
  src/shapes/registry.ts +1 do SHAPE_REGISTRY
  src/store/types.ts     +1 do AllShapeGeometry
```

---

## 22. Canvas-kit boundary (warstwa abstrakcji silnika canvasu)

Cel: odizolować całą domenę aplikacji od konkretnej biblioteki renderującej, żeby ewentualna wymiana Konva → PixiJS (lub dowolny inny silnik) była lokalną zmianą w `src/canvas-kit/`, a nie ogólnoprojektowym refactoringiem.

### 22.1 Co jest wewnątrz `@/canvas-kit`

**Kontrakt publiczny (`src/canvas-kit/index.ts`)** — niezmienny przy wymianie silnika:

```typescript
// Komponenty kontenerowe
export { CanvasShell, GroupLayer, OverlayLayer } from './impl-konva'

// Prymitywy graficzne (drzewo deklaratywne, React)
export { G, Rect, Line, Arc, Circle, Path, Text } from './impl-konva'

// Wejście (znormalizowane gesty z Pointer Events API)
export { usePointerInput } from './pointerInput'
export type { PointerGesture } from './pointerInput'
// PointerGesture = { kind: 'pinch'|'drag'|'tap', ... }
// pan = drag reklasyfikowany w CanvasApp na podstawie toolMode === 'hand'

// Eksport rastrowy
export { rasterize } from './impl-konva'

// Stałe i helpery (w tym `devicePixelRatio` jako funkcja SSR-safe — wołać z nawiasami:
// `devicePixelRatio()`. Bezpośredni dostęp do `window.devicePixelRatio` jest zabroniony
// poza `src/canvas-kit/` przez §22.9.4.)
export { HIT_AREA_TOUCH, HIT_AREA_DESKTOP, devicePixelRatio } from './constants'

// Typy props prymitywów + geometria 2D — używane przez shape `Renderer`-y
// do deklaracji type-safe komponentów; każdy renderer importuje wyłącznie z `@/canvas-kit`.
// `Point` ma kanoniczne źródło tutaj (canvas-kit jest silnikiem 2D); `src/shapes/_base/types.ts`
// re-eksportuje go z `@/canvas-kit` dla wygody (zgodnie z §22.7: kierunek zależności
// geometria → domena, nie odwrotnie — żeby wymiana silnika nie wymagała ruchu typów).
export type {
  Point,
  CommonShapeProps, GProps, RectProps, LineProps, ArcProps,
  CircleProps, PathProps, TextProps,
  RasterizeOptions, CanvasPointerHandler
} from './primitives'
```

### 22.2 Typy props prymitywów

Każdy prymityw przyjmuje **tylko** props, które mają 1:1 odpowiednik w obu silnikach (Konva i Pixi) — bezpośrednio jako natywny atrybut, lub przez trywialne mapowanie. Brak na poziomie publicznym Konva-only properties (`shadowBlur`, `cache()`, `Konva.Animation`, …). Jeśli dany efekt jest niezbędny — dodajemy go do kontraktu i implementujemy w obu backendach.

```typescript
// src/canvas-kit/primitives.ts
export interface CommonShapeProps {
  x?: number; y?: number
  rotation?: number
  opacity?: number
  fill?: string
  stroke?: string
  strokeWidth?: number
  hitStrokeWidth?: number    // hit-area expansion (touch-friendly handles)
  visible?: boolean
  listening?: boolean        // czy element łapie zdarzenia pointer
  // pointer events (DOM PointerEvent — wspólne dla obu silników)
  onPointerDown?:   (e: PointerEvent) => void
  onPointerMove?:   (e: PointerEvent) => void
  onPointerUp?:     (e: PointerEvent) => void
  onPointerCancel?: (e: PointerEvent) => void
}

export interface RectProps   extends CommonShapeProps { width: number; height: number; cornerRadius?: number }
export interface LineProps   extends CommonShapeProps { points: number[]; closed?: boolean; dash?: number[]; lineCap?: 'butt'|'round'|'square'; lineJoin?: 'miter'|'round'|'bevel' }
export interface ArcProps    extends CommonShapeProps { innerRadius: number; outerRadius: number; angle: number }
export interface CircleProps extends CommonShapeProps { radius: number }
export interface PathProps   extends CommonShapeProps { d: string }   // SVG path data
export interface TextProps   extends CommonShapeProps { text: string; fontSize: number; fontFamily?: string; align?: 'left'|'center'|'right'; width?: number }
export interface GProps      extends CommonShapeProps { children?: React.ReactNode }
```

**Mapowanie cross-engine dla wybranych props (kontrakt zachowuje 1:1, implementacja translatuje):**

| Prop | Konva | Pixi |
|---|---|---|
| `hitStrokeWidth` | `Shape.hitStrokeWidth` (natywne) | poszerzenie geometrii hit-area lub `hitArea` jako poligon offset |
| `listening` | `Node.listening(boolean)` (natywne) | `eventMode: 'none' \| 'static'` (`false` ↔ `'none'`) |
| `dash` / `lineCap` / `lineJoin` | natywne props `Konva.Line` | `Graphics.setStrokeStyle({ dash, cap, join })` |

Wszystkie pozostałe props (`x`, `y`, `rotation`, `opacity`, `fill`, `stroke`, `strokeWidth`, `visible`, `cornerRadius`, `closed`, …) mapują się 1:1 bez translacji.

### 22.3 Granice importów (egzekwowane przez ESLint)

```jsonc
// eslint.config.js — fragment
{
  rules: {
    'no-restricted-imports': ['error', {
      patterns: [
        { group: ['konva', 'konva/*', 'react-konva'], message: 'Importuj z @/canvas-kit. Konva legalna tylko w src/canvas-kit/impl-konva i src/components/canvas/.' },
        { group: ['pixi.js', '@pixi/*'],              message: 'Importuj z @/canvas-kit. Pixi legalne tylko w src/canvas-kit/impl-pixi.' }
      ]
    }]
  },
  overrides: [
    { files: ['src/canvas-kit/impl-konva/**', 'src/components/canvas/**'], rules: { 'no-restricted-imports': 'off' } },
    { files: ['src/canvas-kit/impl-pixi/**'],                              rules: { 'no-restricted-imports': 'off' } }
  ]
}
```

### 22.4 Co Renderer może, a czego nie

**Może:**
- Importować `G/Rect/Line/Arc/Circle/Path/Text` z `@/canvas-kit`
- Używać DOM `PointerEvent` w handlerach
- Czytać `HIT_AREA_TOUCH`/`HIT_AREA_DESKTOP` z `@/canvas-kit`

**Nie może:**
- Importować nic z `konva`, `react-konva`, `pixi.js`, `@pixi/*` bezpośrednio
- Używać refów do nodów silnika (`Konva.Node`, `Pixi.Container`) — refy wewnątrz `impl-*`
- Wywoływać imperatywnych API (`.cache()`, `Konva.Animation`, `app.ticker`) — animacje przez stan React lub `requestAnimationFrame` na poziomie domeny
- Używać `e.evt.touches[]`, `gesturestart`, `gesturechange` — multi-touch wyłącznie przez `usePointerInput`

### 22.5 Kontrakt `pointerInput`

```typescript
// src/canvas-kit/pointerInput.ts
export type PointerGesture =
  | { kind: 'tap';   x: number; y: number; pointerId: number; pointerType: 'mouse'|'touch'|'pen' }
  | { kind: 'drag';  start: Point; current: Point; delta: Point; pointerId: number; phase: 'start'|'move'|'end' }
  | { kind: 'pinch'; center: Point; scale: number; rotation: number; phase: 'start'|'move'|'end' }

export function usePointerInput(target: RefObject<HTMLElement | null>, handler: (g: PointerGesture) => void): void
```

`canvas-kit` jest engine-agnostic i nie zna trybów aplikacji — **reklasyfikacja `drag` → pan dzieje się w `CanvasApp.tsx`** na podstawie `toolMode === 'hand'` lub braku trafienia w element. Stąd `kind: 'pan'` celowo nie istnieje w unii: domena gestów na granicy canvas-kit to `tap | drag | pinch`.

Implementacja śledzi mapę `pointerId → PointerEvent`, na podstawie której emituje znormalizowane gesty. Zero zależności od Konva/Pixi — używa wyłącznie DOM API. Testowalna w jsdom z syntetycznymi `PointerEvent`.

### 22.6 Kontrakt `rasterize`

```typescript
export interface RasterizeOptions {
  format: 'png' | 'jpg'
  area: 'full' | 'content'          // content = bbox + padding 20px
  pixelRatio?: number
  quality?: number                  // tylko 'jpg', 0..1
}
export function rasterize(opts: RasterizeOptions): Promise<Blob>
```

`impl-konva/rasterize.ts` deleguje do `stage.toDataURL()` + konwersja base64→Blob.
`impl-pixi/rasterize.ts` (jeśli powstanie) deleguje do `app.renderer.extract.image()`.

**Ograniczenie aktualnej implementacji (`impl-konva/activeStage.ts`):** referencja do bieżącego `Stage` trzymana jest w **module-level singleton** ustawianym przez `CanvasShell` przy mount/unmount. Konsekwencje, o których konsument musi wiedzieć:

- W drzewie React może istnieć **co najwyżej jedna** `CanvasShell` na raz — kilka instancji (np. preview + main canvas obok siebie) wzajemnie nadpisałoby singleton, a `rasterize()` operowałby na ostatnio zamontowanym Stage'u.
- W testach jednostkowych `exportEngine` trzeba albo wyrenderować pełny `CanvasShell` w jsdom, albo zamockować `getActiveStage`.
- Pattern jest świadomie pragmatyczny dla MVP. Migracja na React context (`CanvasStageContext.Provider`) jest TODO przy pierwszej iteracji `exportEngine.ts`, jeśli pojawi się potrzeba multi-stage (np. miniatury PDF). Implementacja `impl-pixi/` może wybrać dowolne podejście — kontrakt `rasterize(opts)` go nie wiąże.

### 22.7 Co przeżywa wymianę silnika bez modyfikacji

- Cały `src/store/`, `src/lib/`, `src/weld-units/` (bez `WeldUnitOverlay.tsx` — patrz §22.8)
- Wszystkie typy w `src/shapes/_base/` i `src/shapes/[typ]/types.ts`
- Wszystkie funkcje czyste: `captureGeometry`, `getBoundingBox`, `getWorldPoints`, `anchors`, `edges`, `snapEngine`, `shapes/weld-joint/autosize`, `overlapDetector`, `documentCodec`, `bead-sequence`
- `PropertiesPanel` każdego kształtu (czyste DOM/React)
- Cały `src/app/`, `src/messages/`, `src/components/sidebar/`, `src/components/toolbar/`, `src/components/project-list/`

### 22.8 Co trzeba przepisać przy wymianie silnika

- `src/canvas-kit/impl-konva/*` → nowa implementacja `impl-pixi/*` (≈400-700 LOC)
- `Renderer` w każdym `src/shapes/[typ]/index.ts` — **bez zmian**, bo importuje wyłącznie z `@/canvas-kit` (jeśli przestrzega §22.4)
- `src/components/canvas/*` — minimalne korekty pod nowy backend gdy używają imperatywnych API (np. `setPointerCapture` na konkretnym DOM evencie). Sam `pointerInput` przeżywa wymianę.
- `src/weld-units/WeldUnitOverlay.tsx` — przepisać na prymitywy `@/canvas-kit` (jeden plik)
- `next.config.ts` — usunąć alias `canvas` → `./empty.js` (Konva-specific) i ewentualnie dodać konfigurację Pixi
- ESLint override: dodać `impl-pixi/**`

Pełna procedura krok po kroku: **`.ai/canvas-kit-migration-plan.md`**.

### 22.9 Niezmienniki które wymuszają granicę

1. **Typ `ShapeDefinition.Renderer` jest `ComponentType<{shape, isSelected, isInLockedUnit}>`** — nie typuje wewnętrznego drzewa, ale ESLint blokuje import silnika spoza canvas-kit.
2. **`exportEngine` nie woła `stage.toDataURL` ani `app.renderer.extract`** — zawsze `rasterize` z canvas-kit.
3. **`store/canvas.ts` nie trzyma referencji do `Stage`/`Application`** — viewport (`stageX/Y/Scale`) to czyste liczby.
4. **`pixelRatio` ustawiane wyłącznie w `CanvasShell`** — żaden inny komponent nie czyta `window.devicePixelRatio` bezpośrednio.
5. **Multi-touch wyłącznie przez `usePointerInput`** — `e.evt.touches[]` Konvy zakazane (sprzeczne z zasadą §2.4).
