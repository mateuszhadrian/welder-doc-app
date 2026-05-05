# Plan Architektury Aplikacji WelderDoc

> Wersja: 1.0 — maj 2026  
> Dokument opisuje architekturę techniczną aplikacji WelderDoc zgodną z PRD v1.0. Stanowi jedyne źródło prawdy dla decyzji architektonicznych na etapie MVP.

---

## 1. Przegląd i cele

WelderDoc to przeglądarkowa aplikacja SaaS umożliwiająca inżynierom i technologom spawania szybkie tworzenie proporcjonalnych przekrojów złączy spawanych i sekwencji ściegów — bez znajomości CAD, bez instalacji.

**Cele architektoniczne:**
- **Rozszerzalność bez ryzyka** — dodanie nowego typu kształtu dotyka wyłącznie nowego katalogu i trzech punktów rejestracji; infrastruktura nie jest modyfikowana.
- **Prostota modelu domenowego** — brak Photoshop-owych warstw, brak auto-przeliczania geometrii złączy przy ruchu; złącze spawalnicze i powiązane elementy tworzą sztywną jednostkę (`WeldUnit`).
- **Inkrementalne budowanie** — każda faza dodaje funkcjonalność nad stabilną podstawą.
- **Wydajność** — ≥ 30 FPS przy typowych scenach; < 200 ms reakcji UI na operacje edycji.

---

## 2. Kluczowe zasady architektury

### 2.1 Shape Registry Pattern

Rdzeń aplikacji opiera się na centralnym rejestrze kształtów: `SHAPE_REGISTRY` mapuje każdy typ kształtu (`ShapeType`) na obiekt `ShapeDefinition<S>` zawierający całe zachowanie danego kształtu jako funkcje i komponenty. Infrastruktura (store, uchwyty, panel właściwości, SNAP, eksport) jest napisana raz — przeciwko interfejsowi `ShapeDefinition`. Autorzy nowych kształtów implementują interfejs; infrastruktura działa automatycznie.

**Centralna zasada: każde zachowanie specyficzne dla kształtu jest danymi, nie kodem infrastruktury.**

### 2.2 Uproszczenia względem wzorca bazowego

Wzorzec bazowy (GeoCanvas) zakładał m.in. system warstw Photoshop i dynamiczne przeliczanie geometrii złączy przy ruchu połączonych elementów. W WelderDoc oba mechanizmy zostały celowo uproszczone:

1. **Brak systemu warstw Photoshop.** Kolejność wizualna elementów to wyłącznie ich kolejność w tablicy `shapes[]` w store. Operacje z-index (`Przesuń na wierzch` itp.) to czysty reorder tej tablicy.

2. **Brak `ConnectionsSlice` i `resolveConnection`.** Złącze spawalnicze po zablokowaniu z elementami tworzy `WeldUnit` — sztywną jednostkę. Elementy wewnątrz jednostki nie mogą być przesuwane niezależnie, więc nie ma potrzeby dynamicznego przeliczania geometrii złącza przy ruchu elementów. Modyfikacja kształtu złącza odbywa się wyłącznie przez bezpośrednie przeciąganie jego uchwytów lub w trybie sekwencji ściegów.

### 2.3 Co pozostaje niezmienione ze wzorca bazowego

- Mechanizm `SHAPE_REGISTRY` i interfejs `ShapeDefinition<S>` — rdzeń rozszerzalności
- Granica `FieldUpdate` / `ShapeUpdate` (rozwiązanie cyklu zależności)
- Historia operacji — Command Pattern (before/after snapshot per kształt)
- Pointer Events API (`pointer*`) — wymagane dla obsługi stylusa/dotyku
- `setPointerCapture` przy starcie dragu — wymagane dla niezawodności na touch
- Anchor points na kształtach — wykorzystywane jako punkty SNAP, nie do mocowania złączy

---

## 3. Stos technologiczny

| Warstwa | Technologia |
|---|---|
| Framework frontendowy | Next.js (App Router), React, TypeScript |
| Silnik canvas | Konva.js via `react-konva` |
| Zarządzanie stanem | Zustand + Immer |
| Styling | Tailwind CSS |
| Ikony | Lucide React |
| Backend / baza danych | Supabase (PostgreSQL, region EU — Frankfurt) |
| Autentykacja | Supabase Auth (email+hasło, opcjonalnie OAuth) |
| Hosting | Vercel |
| CI/CD | GitHub Actions |
| Płatności | Paddle (Merchant of Record) |
| Internacjonalizacja | `next-intl` |
| Testy jednostkowe | Jest, jest-environment-jsdom, jest-canvas-mock, @testing-library/react |
| Testy e2e | Playwright (`@playwright/test`) |

Wersje pakietów: najnowsze stabilne w momencie inicjalizacji projektu.

---

## 4. Struktura katalogów źródłowych

```
src/
  shapes/
    _base/
      types.ts              ← Point, BaseShape, BoundingBox, HandleGeometry, AnchorPoint, FieldUpdate
      definition.ts         ← ShapeDefinition<S> interface
    registry.ts             ← SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition<any>>
    index.ts                ← re-eksport Shape union, ShapeType union
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
    weld-joint/             ← złącze spawalnicze (generyczny typ z joinType)
      types.ts
      index.ts
      handles.ts
      anchors.ts            ← punkty SNAP na krawędziach złącza
      autosize.ts           ← logika auto-dopasowania rozmiaru do elementów w pobliżu
      PropertiesPanel.tsx
    [nowy-ksztalt]/         ← dodać tu; nic innego się nie zmienia

  weld-units/
    types.ts                ← WeldUnit, WeldBeadSequence, WeldLayer, BeadShape
    bead-sequence.ts        ← logika generowania i modyfikacji sekwencji ściegów
    WeldUnitOverlay.tsx     ← renderowanie sekwencji ściegów na canvasie

  store/
    types.ts                ← ShapeUpdate (intersection-derived), HistoryEntry, DocumentMeta
    slices/
      shapes.ts             ← ShapesSlice
      weld-units.ts         ← WeldUnitsSlice
      history.ts            ← HistorySlice (Command Pattern)
      canvas.ts             ← CanvasSlice (viewport, zoom, pan, tool mode)
      ui.ts                 ← UISlice (selection, snap toggle, dark mode)
      document.ts           ← DocumentSlice (meta, isDirty, save state)
    use-canvas-store.ts     ← złożony Zustand store

  components/
    canvas/
      CanvasApp.tsx
      ShapeNode.tsx
      ShapeHandles.tsx      ← generyczny, registry-driven
      AnchorPoints.tsx      ← generyczny, registry-driven (używany w SNAP)
      MultiShapeHandles.tsx
      WeldUnitHandles.tsx   ← uchwyt obrotu całego WeldUnit
      SelectionMarquee.tsx
    sidebar/
      PropertiesSidebar.tsx
      WeldJointPanel.tsx
      WeldSequencePanel.tsx ← panel zarządzania warstwami i ściegami
    toolbar/
      Toolbar.tsx
      ToolButton.tsx
    project-list/
      ProjectList.tsx

  lib/
    captureGeometry.ts      ← fasada rejestru
    shapeBounds.ts          ← fasada rejestru
    snapEngine.ts           ← logika SNAP (wykrywanie punktów przyciągania)
    weldAutosize.ts         ← auto-dopasowanie weld-joint do elementów
    documentCodec.ts        ← encode/decode (serialize/deserialize sceny)
    exportEngine.ts         ← eksport PNG/JPG z warstwą opisową i watermark
    overlapDetector.ts      ← wykrywanie nakładania weld-joint z elementami

  app/
    (auth)/
      login/page.tsx
      register/page.tsx
      reset-password/page.tsx
    (app)/
      canvas/[projectId]/page.tsx
      projects/page.tsx
    layout.tsx
    page.tsx                ← strona główna / landing
```

---

## 5. Typy bazowe i interfejsy

### 5.1 Typy geometryczne (`src/shapes/_base/types.ts`)

```typescript
export interface Point { x: number; y: number }

export interface BaseShape {
  id: string
  type: ShapeType
  x: number; y: number
  rotation: number
  opacity: number
  fill: string
  stroke: string
  strokeWidth: number
  // Brak layerId — z-index wynika z kolejności w shapes[]
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

export interface StartSnapshot { x: number; y: number; rotation: number }

export type FieldUpdate = Partial<Record<string, unknown>>
```

### 5.2 ShapeDefinition (`src/shapes/_base/definition.ts`)

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

  // Punkty przyciągania SNAP — ściany i krawędzie kształtu
  anchors?: (shape: S) => AnchorPoint[]

  // Walidacja inline parametrów
  validate?: (shape: S) => ValidationError[]

  // Eksport (opcjonalny — implementowany gdy wymagany)
  toSVG?: (shape: S) => string
}

export interface ValidationError {
  field: string
  message: string
}
```

**Różnica względem wzorca bazowego:** usunięto `resolveConnection`, `validate` zwraca `ValidationError[]` (per pole) zamiast `ValidationViolation[]` (per kształt domenowy).

---

## 6. Rejestr kształtów (`src/shapes/registry.ts`)

```typescript
import type { ShapeDefinition } from './_base/definition'
import type { ShapeType } from '.'
import { PlateDefinition }           from './plate'
import { PipeFrontDefinition }       from './pipe-front'
import { PipeLongitudinalDefinition } from './pipe-longitudinal'
import { ProfileIDefinition }        from './profile-i'
import { ProfileCDefinition }        from './profile-c'
import { ProfileLDefinition }        from './profile-l'
import { ProfileTDefinition }        from './profile-t'
import { WeldJointDefinition }       from './weld-joint'

export const SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition<any>> = {
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

**Jak dodać nowy typ kształtu** (np. `profile-u` w przyszłości):
1. Utwórz `src/shapes/profile-u/` z `types.ts`, `handles.ts`, `anchors.ts`, `index.ts`, `PropertiesPanel.tsx`
2. Dodaj `'profile-u'` do unii `ShapeType` w `src/shapes/index.ts`
3. Zarejestruj w `SHAPE_REGISTRY`
4. Dodaj do `AllShapeGeometry` w `src/store/types.ts`

Żaden inny plik nie ulega zmianie.

---

## 7. Typy kształtów — biblioteka prymitywów MVP

### 7.1 Elementy płaskie (`plate`)

```typescript
interface PlateShape extends BaseShape {
  type: 'plate'
  width: number
  thickness: number
  bevelType: 'none' | 'single' | 'double'    // brak / jednostronne / dwustronne
  bevelAngleTop: number      // 0–80°, krok 0.5°
  bevelAngleBottom: number   // dla 'double'
  bevelHeight: number
}
```

Anchor points: narożniki + środki każdej ściany (6 punktów SNAP).

### 7.2 Rury i profile zamknięte

**Przekrój czołowy (`pipe-front`):**
```typescript
interface PipeFrontShape extends BaseShape {
  type: 'pipe-front'
  outerRadius: number
  wallThickness: number    // musi być < outerRadius − 1
}
```
Anchor points: 4 punkty kardynalne na zewnętrznym obwodzie + środek.  
Uchwyty: zewnętrzna średnica (uchwyt skaluje `outerRadius`; `wallThickness` absolutna z walidacją inline).

**Przekrój podłużny (`pipe-longitudinal`):**
```typescript
interface PipeLongitudinalShape extends BaseShape {
  type: 'pipe-longitudinal'
  length: number
  outerDiameter: number
  wallThickness: number
}
```
Wizualizacja: prostokąt z naniesioną osią symetrii i oznaczeniem ∅.  
Anchor points: krawędzie + środki ścianek.

### 7.3 Profile standardowe (`profile-i`, `profile-c`, `profile-l`, `profile-t`)

Przykład profilu I:
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

Każdy wymiar jest niezależnie przeciągalny przez odpowiedni uchwyt. Walidacja geometryczna (np. `webThickness < flangeWidth`, `flangeThickness < totalHeight / 2`) sygnalizowana inline — edycja nie jest blokowana, ale pole podświetlane na czerwono z komunikatem.

Anchor points: środki każdej odsłoniętej ścianki profilu (punkty SNAP do umieszczania złączy).

### 7.4 Złącze spawalnicze (`weld-joint`)

```typescript
type WeldJoinType =
  | 'fillet'        // pachwinowa trójkątna
  | 'butt-square'   // czołowa prostokątna
  | 'butt-v'        // czołowa V
  | 'butt-x'        // czołowa X (dwustronna V)
  | 'butt-y'        // czołowa Y
  | 'butt-k'        // czołowa K
  | 'butt-u'        // czołowa U
  | 'spot'          // punktowa

interface WeldJointShape extends BaseShape {
  type: 'weld-joint'
  joinType: WeldJoinType
  // Parametry geometryczne zależne od joinType:
  leg1?: number           // dla fillet
  leg2?: number           // dla fillet
  angle?: number          // kąt rowka (butt-v, butt-x, itp.)
  rootGap?: number
  depth?: number          // głębokość rowka
  diameter?: number       // dla spot
  // Checksum geometrii — używany do walidacji dormant sequence po odblokowaniu:
  _geometryChecksum?: string
}
```

**Auto-sizing przy wstawieniu:** funkcja `autosize.ts` na podstawie bounding boxów elementów w promieniu wstawiania oblicza startowe wymiary złącza.

**Renderowanie:** kształt złącza renderuje się jako proporcjonalna geometria spoiny (trójkąt, trapez, rowek V/X itp.) zgodnie z `joinType`.

**Uchwyty:** analogiczne do innych kształtów — każdy wymiar złącza ma uchwyt do przeciągania.

---

## 8. Model WeldUnit — jednostka spawalnicza

### 8.1 Struktura danych (`src/weld-units/types.ts`)

```typescript
interface WeldUnit {
  id: string
  elementIds: string[]           // ID elementów (plate, pipe, profile) wewnątrz jednostki
  weldJointId: string            // ID kształtu weld-joint
  beadSequenceId: string | null  // ID sekwencji ściegów (jeśli skonwertowana)
  isLocked: boolean
  // Dane dormant sequence — przechowywane przy odblokowaniu
  dormantSequenceData: WeldBeadSequenceData | null
  // Checksum geometrii złącza przy ostatnim zablokowaniu — do walidacji dormant sequence
  lockedJointChecksum: string | null
}

interface WeldBeadSequenceData {
  beadShape: BeadShape           // globalny kształt ściegu
  layers: WeldLayer[]
  manualNumbering: number[][]    // [layer][bead] → number wyświetlany
}

interface WeldLayer {
  id: string
  depth: number                  // głębokość warstwy (jednostki proporcjonalne)
  beadCount: number              // liczba ściegów w warstwie (min. 1)
}

type BeadShape = 'rounded-triangle' | 'rounded-trapezoid'
```

**`WeldBeadSequence` NIE jest elementem tablicy `shapes[]`.** Jest przechowywana w `WeldUnit` jako dane wewnętrzne i renderowana przez `WeldUnitOverlay.tsx`.

### 8.2 Maszyna stanów WeldUnit

```
                    ┌──────────────────────────────────────┐
                    │                                      │
          ┌─────────▼─────────┐                ┌──────────▼──────────┐
          │      FREE         │                │      SEQUENCE        │
          │  (niezablokowany) │                │  (zablokowana +      │
          │  Każdy element    │                │   sekwencja ściegów) │
          │  niezależny       │                │  Cały unit jako      │
          └─────────┬─────────┘                │  jedna jednostka     │
                    │                          └──────────┬───────────┘
          "Zablokuj"│                          "Odblokuj" │
                    │  (weld-joint nachodzi    ▲           │
                    │   na ≥ 2 elementy)       │"Zablokuj" │
                    │                          │(checksum  │
                    ▼                          │ OK → przywróć dormant)
          ┌─────────────────┐                  │
          │     LOCKED      │──"Konwertuj"────►│ SEQUENCE
          │  (zablokowany)  │                  │
          │  Unit jako      │◄─"Odblokuj"──────┘
          │  jedna          │  (sequence → dormantSequenceData)
          │  jednostka      │
          └─────────────────┘
```

**Przejście FREE → LOCKED:** możliwe gdy `weld-joint` nakłada się (bbox overlap) na co najmniej 2 elementy.

**Przejście LOCKED → SEQUENCE:** przycisk „Konwertuj na sekwencję ściegów" — generuje `WeldBeadSequenceData` na podstawie geometrii `weld-joint`.

**Przejście SEQUENCE → LOCKED (odblokowanie):** `beadSequenceId` → `dormantSequenceData`; `beadSequenceId = null`. Obliczany i zapisywany `lockedJointChecksum` bieżącej geometrii złącza.

**Przejście LOCKED → SEQUENCE (ponowne zablokowanie po odblokowaniu):**
- Jeśli `dormantSequenceData !== null` AND aktualny checksum geometrii złącza === `lockedJointChecksum` → przywróć dormant sequence.
- Jeśli geometria złącza uległa zmianie → dormant sequence jest nieważna, `dormantSequenceData = null`. Użytkownik musi przeprowadzić konwersję od nowa.

### 8.3 Logika wykrywania nakładania (`src/lib/overlapDetector.ts`)

Nakładanie `weld-joint` z elementem = niepuste przecięcie ich bounding boxów (w układzie współrzędnych canvasu, z uwzględnieniem rotacji przez transformację punktów).

### 8.4 Zachowanie przy zaznaczeniu i edycji

- **Kliknięcie w obrębie WeldUnit (LOCKED lub SEQUENCE):** zaznaczany jest fizycznie kliknięty kształt. Panel właściwości otwiera odpowiedni panel (plate/profile/weld-joint). Jednak żadna operacja przesuwania nie jest dostępna — element jest zablokowany.
- **Próba przeciągnięcia elementu wewnątrz locked WeldUnit:** przeciąganie działa na poziomie całego WeldUnit (wszystkie elementy + złącze przemieszczają się razem).
- **Edycja parametrów elementu zablokowanego w jednostce:** blokada wyświetla komunikat; dostępna dopiero po odblokowaniu.
- **Uchwyt obrotu WeldUnit:** pojawia się na poziomie całego unitu (obrys obejmujący wszystkie elementy + złącze). Obrót dotyczy całej jednostki.
- **Zaznaczenie marquee obejmujące WeldUnit:** zaznacza unit jako całość; przesuwanie pociąga unit razem ze wszystkimi jego elementami.
- **Multi-select z kilkoma unitami:** możliwy; przesuwanie przesuwa wszystkie zaznaczone unity oraz ich elementy.

### 8.5 Generowanie sekwencji ściegów (`src/weld-units/bead-sequence.ts`)

Przy konwersji (`LOCKED → SEQUENCE`):
1. Z geometrii `weld-joint` (głębokość rowka, szerokość u góry) obliczana jest liczba warstw i liczba ściegów per warstwa.
2. Ściegi są równomiernie rozmieszczone w każdej warstwie.
3. Numeracja startuje od 1, automatycznie rosnąco (od dołu do góry, od lewej do prawej).
4. Użytkownik może ręcznie zmieniać kolejność numerów w panelu `WeldSequencePanel`.

Operacje zarządzania:
- Dodaj ścieg w warstwie [+] / Usuń ścieg [−] (min. 1 ścieg per warstwa)
- Dodaj warstwę / Usuń warstwę (min. 1 warstwa)
- Po każdej operacji ściegi są równomiernie przeliczane wewnątrz warstwy
- Kształt ściegu: globalny (jeden wybór dla całej sekwencji)
- Wszystkie operacje cofalne przez Undo

---

## 9. Store — zarządzanie stanem (Zustand + Immer)

### 9.1 Ogólna struktura

```typescript
// src/store/use-canvas-store.ts

type CanvasStore =
  ShapesSlice &
  WeldUnitsSlice &
  HistorySlice &
  CanvasSlice &
  UISlice &
  DocumentSlice

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

### 9.2 ShapesSlice

```typescript
interface ShapesSlice {
  shapes: Shape[]                           // z-index = kolejność w tablicy

  addShape: (shape: Shape) => void          // sprawdza limit planu przed dodaniem
  removeShape: (id: string) => void
  updateShapeTransient: (id: string, patch: ShapeUpdate) => void   // bez historii (drag live)
  commitShapeUpdate: (id: string, before: ShapeUpdate, after: ShapeUpdate) => void
  reorderShape: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void
  mirrorShape: (id: string, axis: 'horizontal' | 'vertical') => void
}
```

### 9.3 WeldUnitsSlice

```typescript
interface WeldUnitsSlice {
  weldUnits: WeldUnit[]

  lockUnit: (weldJointId: string, elementIds: string[]) => void
  unlockUnit: (unitId: string) => void
  convertToSequence: (unitId: string) => void
  addBeadToLayer: (unitId: string, layerIndex: number) => void
  removeBeadFromLayer: (unitId: string, layerIndex: number) => void
  addLayer: (unitId: string) => void
  removeLayer: (unitId: string, layerIndex: number) => void
  setBeadShape: (unitId: string, shape: BeadShape) => void
  setBeadNumber: (unitId: string, layerIndex: number, beadIndex: number, number: number) => void
  removeUnit: (unitId: string) => void
}
```

### 9.4 HistorySlice (Command Pattern)

```typescript
interface HistoryEntry {
  shapeId: string
  before: ShapeUpdate
  after: ShapeUpdate
}

interface HistorySlice {
  history: HistoryEntry[]
  historyIndex: number               // wskaźnik bieżącej pozycji (dla redo)

  pushHistory: (entry: HistoryEntry) => void
  undo: () => void
  redo: () => void
}
```

Historia jest przechowywana wyłącznie w pamięci i localStorage. **Nie jest persystowana do Supabase między sesjami.** Maksymalna głębokość: 100 kroków.

### 9.5 CanvasSlice

```typescript
interface CanvasSlice {
  stageX: number; stageY: number     // offset viewportu
  stageScale: number                 // poziom zoomu
  canvasWidth: number                // rozmiar obszaru roboczego (konfigurow.)
  canvasHeight: number
  toolMode: 'select' | 'hand' | 'weld-joint'   // aktywny tryb kursora

  panBy: (dx: number, dy: number) => void
  zoomTo: (scale: number, focalPoint: Point) => void
  setToolMode: (mode: ToolMode) => void
  setCanvasSize: (w: number, h: number) => void
}
```

### 9.6 UISlice

```typescript
interface UISlice {
  selectedIds: string[]              // ID zaznaczonych kształtów
  snapEnabled: boolean
  isDarkMode: boolean
  locale: 'pl' | 'en'

  setSelection: (ids: string[]) => void
  addToSelection: (id: string) => void
  removeFromSelection: (id: string) => void
  toggleSnap: () => void
  setSnapTemporary: (enabled: boolean) => void
  setDarkMode: (dark: boolean) => void
  setLocale: (locale: 'pl' | 'en') => void
}
```

### 9.7 DocumentSlice

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

### 9.8 ShapeUpdate — intersection-derived typ

```typescript
// src/store/types.ts

type AllShapeGeometry =
  Omit<PlateShape,             'id' | 'type'> &
  Omit<PipeFrontShape,         'id' | 'type'> &
  Omit<PipeLongitudinalShape,  'id' | 'type'> &
  Omit<ProfileIShape,          'id' | 'type'> &
  Omit<ProfileCShape,          'id' | 'type'> &
  Omit<ProfileLShape,          'id' | 'type'> &
  Omit<ProfileTShape,          'id' | 'type'> &
  Omit<WeldJointShape,         'id' | 'type'>

export type ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>
```

---

## 10. Canvas i nawigacja

### 10.1 Silnik renderowania (Konva.js)

Struktura warstw Konva:
```tsx
<Stage width={viewportWidth} height={viewportHeight} pixelRatio={window.devicePixelRatio}>
  {/* Jedna warstwa na całą zawartość — kolejność z-index wynika z kolejności shapes[] */}
  <Layer>
    {shapes.map((s) => <ShapeNode key={s.id} shape={s} />)}
    {weldUnits.map((u) => <WeldUnitOverlay key={u.id} unit={u} />)}
  </Layer>

  {/* Warstwa kontrolek — zawsze na wierzchu */}
  <Layer>
    <ShapeHandles … />
    <WeldUnitHandles … />
    <MultiShapeHandles … />
    <AnchorPoints … />       {/* widoczne w trybie 'weld-joint' */}
    <SelectionMarquee … />
  </Layer>
</Stage>
```

### 10.2 Tryby kursora

| Tryb | Zachowanie na desktopie | Ikona / skrót |
|---|---|---|
| `select` | Klik/drag na pustym → marquee; klik/drag na elemencie → move | Strzałka, `V` |
| `hand` | Klik/drag na canvasie → pan | Dłoń, `H` |
| `weld-joint` | Klik → wstawia weld-joint w kliknięte miejsce | Spoina, `W` |

### 10.3 Pan i zoom

- **Scroll bez modyfikatora** → pan (niezależnie od trybu kursora)
- **Scroll + Ctrl/Cmd** → zoom in/out (punkt ogniskowy = pozycja kursora)
- **Touch: 1 palec** → pan; **pinch (2 palce)** → zoom
- Granice: viewport nie wychodzi poza obszar roboczy (`canvasWidth × canvasHeight`)
- **Widok startowy po wczytaniu:** zoom-to-fit z paddingiem ≤ 40 px

Implementacja pinch-to-zoom przez śledzenie dwóch aktywnych `pointerId` w `CanvasApp.tsx`. Nie używać `gesturestart` / `gesturechange` (Safari-only).

### 10.4 Obsługa dotykowa

| Gest | Akcja |
|---|---|
| 1 tap na pustym obszarze | pan |
| 2 taps na pustym obszarze | aktywuje marquee |
| 2 taps na elemencie | inicjuje przesuwanie (jeśli nie jest zablokowany w WeldUnit) |
| 1 tap na zaznaczonym elemencie | inicjuje przesuwanie |
| 1 tap na uchwycie | aktywuje uchwyt |
| Pinch | zoom |

Hit area dla uchwytów na touch: 20 px (vs. 8 px na desktop), wykrywane przez `navigator.maxTouchPoints > 0`.

---

## 11. System SNAP

### 11.1 Logika (`src/lib/snapEngine.ts`)

SNAP przyciąga do **ścianek elementów** — środków każdej odsłoniętej ściany kształtu. Punkty przyciągania są obliczane dynamicznie przez wywołanie `anchors()` z `SHAPE_REGISTRY` dla każdego kształtu (z pominięciem aktualnie przeciąganego elementu i jego grupy).

Dla każdego punktu przyciągania: jeśli odległość od aktualnej pozycji kursora (w przestrzeni canvasu) < `SNAP_THRESHOLD` (domyślnie 8 px), pozycja jest „przyciągana" do punktu.

### 11.2 Sterowanie

- **Toggle button** w toolbarze — SNAP aktywny (podświetlony) / nieaktywny
- **Przytrzymanie klawisza** (domyślnie `Alt`): tymczasowe wyłączenie SNAP; przycisk zmienia stan synchronicznie; zwolnienie przywraca poprzedni stan

### 11.3 Anchor points w kontekście SNAP

Każdy typ kształtu implementuje `anchors?()` w `ShapeDefinition`. Dla profili punkty SNAP obejmują środki każdej ściany (krawędzi zewnętrznej) — naturalne miejsca łączenia złączy. Te same punkty są wyświetlane jako małe diamenty (`AnchorPoints.tsx`) gdy aktywny jest tryb `weld-joint`.

---

## 12. Historia operacji (Undo/Redo)

### 12.1 Command Pattern

```typescript
// Każda operacja zmiana kształtu generuje jeden HistoryEntry
interface HistoryEntry {
  shapeId: string
  before: ShapeUpdate    // snapshot przed operacją
  after: ShapeUpdate     // snapshot po operacji
}

// Operacje multi-shape generują wiele wpisów (jeden per kształt)
// Operacje WeldUnit (lock/unlock, convert) generują osobne wpisy per zmieniony kształt
```

### 12.2 Transient vs. committed

- `updateShapeTransient(id, patch)` — live podgląd podczas przeciągania, **bez zapisu do historii**
- `commitShapeUpdate(id, before, after)` — koniec operacji, **zapis do historii**

### 12.3 Przechowywanie

- **Pamięć operacyjna:** tablica `history[]` w Zustand store (max 100 wpisów)
- **localStorage:** przy każdym `commitShapeUpdate` (debounce 0 ms — synchronicznie z commitem) zapisywana jest pełna scena JSON + stos historii → odtwarzanie przy starcie przeglądarki
- **Supabase:** historia **NIE jest persystowana** między sesjami. Baza przechowuje wyłącznie pełny snapshot sceny przy świadomym zapisie użytkownika.

### 12.4 Skróty klawiszowe

- Undo: `Ctrl+Z` (Windows/Linux), `Cmd+Z` (Mac)
- Redo: `Ctrl+Y` lub `Ctrl+Shift+Z` (Win/Lin), `Cmd+Y` lub `Cmd+Shift+Z` (Mac)

---

## 13. Eksport dokumentacji

### 13.1 Silnik eksportu (`src/lib/exportEngine.ts`)

Eksport używa Konva `stage.toDataURL()` lub `stage.toCanvas()`. Proces:

1. Wyłączyć widoczność kontrolek (handles, marquee, anchor points)
2. Jeśli eksport z kadrowanym obszarem: obliczyć bounding box wszystkich elementów, dodać padding 20 px, przyciąć stage
3. Nałożyć warstwę opisową (jeśli włączona)
4. Nałożyć watermark (jeśli plan Guest lub Free)
5. Zapisać jako PNG lub JPG

### 13.2 Opcje eksportu

- **Obszar:** pełny canvas (`canvasWidth × canvasHeight`) lub kadrowanie do bounding box zawartości (padding 20 px)
- **Warstwa opisowa:** opcjonalna — numery ściegów rysowane na każdym ściegu + tabela legendy generowana poniżej rysunku

### 13.3 Watermark

Dla planów Guest i Free: powtarzający się tekst (np. `„WelderDoc"`) renderowany po przekątnej, pokrywający całą powierzchnię eksportowanego obrazu, z semi-transparentnością (np. 25% opacity). Watermark renderowany jako ostatnia warstwa przed zapisem — nie można go usunąć przez edycję canvasu.

### 13.4 Walidacja przed eksportem

Przed inicjacją eksportu sprawdzane jest `shapes.length === 0 && weldUnits.length === 0`. Jeśli scena pusta — blokada eksportu z komunikatem toast.

---

## 14. Trwałość danych (Persistence)

### 14.1 Lokalny autozapis (localStorage)

Przy każdym `commitShapeUpdate` (oraz operacjach WeldUnit) zapis do `localStorage`:

```typescript
interface LocalStorageSnapshot {
  schemaVersion: number
  scene: CanvasDocument          // pełny stan: shapes, weldUnits, canvas meta
  history: HistoryEntry[]
  historyIndex: number
  savedAt: string                // ISO timestamp
}
```

Klucz: `'welderdoc_autosave'`. Przy starcie aplikacji: jeśli klucz istnieje i `schemaVersion` jest zgodna → przywróć scenę i historię.

### 14.2 Zapis w chmurze (Supabase)

Inicjowany wyłącznie przez akcję użytkownika (przycisk „Zapisz"). Serializuje bieżący stan sceny do `CanvasDocument` przez `documentCodec.ts` i wykonuje PATCH na tabeli `documents`.

```typescript
interface CanvasDocument {
  schemaVersion: number          // integer, inkrementowany przy zmianach schematu
  canvasWidth: number
  canvasHeight: number
  shapes: Shape[]
  weldUnits: WeldUnit[]
}
```

Historia operacji **nie jest zapisywana** do Supabase.

### 14.3 Document Codec (`src/lib/documentCodec.ts`)

```typescript
encodeDocument(storeState): CanvasDocument
decodeDocument(doc: CanvasDocument): { shapes, weldUnits, canvasWidth, canvasHeight }
```

Kodek jest jedynym miejscem definiującym format serializacji. Przy decodowaniu sprawdzane jest `schemaVersion` — jeśli starsza, należy uruchomić odpowiednią funkcję migracyjną.

### 14.4 Wersjonowanie schematu

- MVP: pole `schema_version` w Supabase i `schemaVersion` w localStorage/JSONB
- Kod migracyjny pisany przy każdej realnej zmianie schematu (nie wcześniej)
- Stare dokumenty muszą być upgradowne bez utraty danych

---

## 15. Uwierzytelnianie i autoryzacja

### 15.1 Supabase Auth

- Rejestracja: email + hasło (walidacja: format email, min. 8 znaków hasła)
- Logowanie, wylogowanie, reset hasła przez email (link ważny min. 1 godzina)
- Opcjonalnie: OAuth przez Supabase Auth (post-MVP)
- Sesja persystowana między odświeżeniami (Supabase Session)
- Checkpoint zgody przy rejestracji: checkbox z zapisem wersji zgody do bazy

### 15.2 Tryb gościa

- Brak konta — aplikacja dostępna bez logowania
- Autozapis wyłącznie do localStorage
- Baner CTA zachęcający do rejestracji
- Limit 3 elementów (prymitywy + połączenia spawalnicze łącznie); próba dodania 4. elementu blokuje akcję z toastem CTA

### 15.3 Migracja danych gościa

Po zalogowaniu: jeśli `localStorage` zawiera aktywną scenę (`welderdoc_autosave`) — automatyczna migracja do chmury jako nowy projekt, bez akcji użytkownika. Po pomyślnej migracji toast potwierdzający; na liście projektów pojawia się nowy projekt.

### 15.4 System planów

| Plan | Elementy na scenie | Projekty cloud | Watermark |
|---|---|---|---|
| Guest | max 3 | 0 | tak |
| Free | max 3 | 1 | tak |
| Pro | bez limitu | bez limitu | nie |

Płatności: Paddle (Merchant of Record). Ceny robocze: Pro Monthly 49 PLN, Pro Annual 399 PLN.

Logika limitów: sprawdzana w `ShapesSlice.addShape` przed dodaniem kształtu; informacja o planie pobierana z Supabase (tabela `user_profiles`) przy starcie sesji.

---

## 16. Schemat bazy danych (Supabase)

```sql
-- Tabela dokumentów
CREATE TABLE documents (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id      UUID        REFERENCES auth.users NOT NULL,
  name          TEXT        NOT NULL DEFAULT 'Nowy projekt',
  data          JSONB       NOT NULL,           -- CanvasDocument JSON
  schema_version INT        NOT NULL DEFAULT 1,
  share_token   TEXT        UNIQUE,             -- zarezerwowane na post-MVP
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "owner only" ON documents USING (owner_id = auth.uid());

-- Tabela metadanych użytkowników (plan, zgody)
CREATE TABLE user_profiles (
  id              UUID    PRIMARY KEY REFERENCES auth.users,
  plan            TEXT    NOT NULL DEFAULT 'free', -- 'free' | 'pro'
  paddle_customer TEXT,
  consent_version TEXT,
  consent_at      TIMESTAMPTZ,
  locale          TEXT    DEFAULT 'pl'
);

ALTER TABLE user_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "self only" ON user_profiles USING (id = auth.uid());
```

Liczba projektów sprawdzana przez `SELECT COUNT(*) FROM documents WHERE owner_id = auth.uid()` przed zapisem nowego projektu.

---

## 17. API i endpointy (Next.js Route Handlers)

Większość operacji danych korzysta bezpośrednio z Supabase JS Client po stronie klienta (z Row Level Security). Route Handlers (`app/api/`) używane wyłącznie do operacji wymagających server-side secret lub integracji z Paddle.

```
POST   /api/paddle/webhook          ← aktualizacja planu po płatności
GET    /api/health                  ← sprawdzenie zdrowia aplikacji
```

Pozostałe operacje (CRUD dokumentów, auth) — Supabase client SDK bezpośrednio.

---

## 18. Internacjonalizacja (i18n)

Biblioteka: `next-intl`.

```
src/
  messages/
    pl.json        ← wszystkie teksty PL
    en.json        ← wszystkie teksty EN
```

Lokalizacja: automatycznie na podstawie ustawień przeglądarki przy pierwszej wizycie, zapis w localStorage i opcjonalnie w `user_profiles.locale`. Przełącznik PL/EN dostępny w interfejsie.

Wszystkie komunikaty walidacyjne, toasty, etykiety paneli — w plikach messages. Zero hardcoded stringów w komponentach.

---

## 19. CI/CD i deployment

```
GitHub Actions
  ├── on: pull_request
  │     ├── lint (ESLint, tsc --noEmit)
  │     ├── test:unit (Jest)
  │     └── test:e2e (Playwright — headless Chromium)
  │
  └── on: push → main
        ├── build (next build)
        └── deploy → Vercel (production)
```

Środowiska:
- **Preview:** Vercel preview URL dla każdego PR (Supabase — wspólna instancja dev lub branch DB)
- **Production:** Vercel production (Supabase EU Frankfurt)

Zmienne środowiskowe (Vercel + GitHub Actions):
```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY    ← tylko server-side (Route Handlers)
PADDLE_WEBHOOK_SECRET
NEXT_PUBLIC_APP_URL
```

---

## 20. Rozszerzalność — jak dodać nowy typ kształtu

Przykład: dodanie kształtu `profile-u` (profil U) po MVP.

**Kroki (dokładnie 4 dotknięcia kodu):**

1. **Nowy katalog** `src/shapes/profile-u/`:
   - `types.ts` — interfejs `ProfileUShape extends BaseShape`
   - `handles.ts` — `captureStart`, `getHandles`, `applyHandleDrag`
   - `anchors.ts` — `getProfileUAnchors`
   - `index.ts` — `ProfileUDefinition: ShapeDefinition<ProfileUShape>`
   - `PropertiesPanel.tsx` — formularz parametrów

2. **`src/shapes/index.ts`** — dodanie `'profile-u'` do unii `ShapeType`

3. **`src/shapes/registry.ts`** — dodanie `'profile-u': ProfileUDefinition`

4. **`src/store/types.ts`** — dodanie `Omit<ProfileUShape, 'id' | 'type'>` do `AllShapeGeometry`

**Żaden inny plik nie ulega modyfikacji.** `ShapeHandles`, `PropertiesSidebar`, `SnapEngine`, `documentCodec`, eksport — wszystkie działają automatycznie przez rejestr.

---

## 21. Ryzyka techniczne i mitygacje

### 21.1 Konva.js na tablet / stylus

**Ryzyko:** hit detection canvas-based, brak semantyki DOM.  
**Mitygacja:**
- Pointer Events API (`pointer*`) wszędzie — spójne zachowanie dla myszy, dotyku i stylusa
- `setPointerCapture` przy starcie każdego dragu — wymagane dla niezawodności
- Hit area 20 px dla touch vs. 8 px dla desktop (`navigator.maxTouchPoints > 0`)
- Test na rzeczywistym tablecie Wacom na wczesnym etapie

### 21.2 Złożoność WeldUnit

**Ryzyko:** maszyna stanów FREE/LOCKED/SEQUENCE z dormant sequence może generować trudne do debugowania stany.  
**Mitygacja:**
- Dedykowany `WeldUnitsSlice` izoluje całą logikę
- Checksum geometrii złącza jako deterministyczny warunek przywrócenia sekwencji
- Testy jednostkowe dla każdego przejścia stanów w `bead-sequence.ts`

### 21.3 Auto-sizing weld-joint

**Ryzyko:** algorytm auto-dopasowania może dawać nieoczekiwane wyniki dla skomplikowanych układów elementów.  
**Mitygacja:**
- Funkcja `autosize.ts` jest czysta (pure function) i łatwa do testowania
- Fallback na stałe domyślne wartości gdy algorytm nie może jednoznacznie dopasować
- Użytkownik zawsze może ręcznie skorygować przez uchwyty

### 21.4 Wydajność przy dużych scenach

**Ryzyko:** Konva renderuje wszystko przy każdym `commitShapeUpdate`.  
**Mitygacja:**
- Konva automatycznie optymalizuje przez dirty regions
- `updateShapeTransient` nie zapisuje do historii — minimalna praca przy drag
- Przy > 50 elementach rozważyć Konva `cache()` na złożonych kształtach profili

### 21.5 localStorage przepełnienie

**Ryzyko:** przy dużej historii i scenie localStorage może osiągnąć limit 5–10 MB.  
**Mitygacja:**
- Przy zapisie: jeśli błąd `QuotaExceededError` → przyciąć historię do 50 wpisów i spróbować ponownie → jeśli nadal błąd → toast z ostrzeżeniem i rekomendacja do zapisu w chmurze

---

## 22. Podsumowanie architektury (ściągawka)

```
ShapeType (closed union)
  │
  └─► SHAPE_REGISTRY[type] → ShapeDefinition<S>
        │
        ├── create(pos)                  → nowy S
        ├── Renderer                     → Konva Group (JSX)
        ├── PropertiesPanel              → formularz właściwości
        ├── captureGeometry(s)           → FieldUpdate (snapshot)
        ├── getBoundingBox(s)            → BoundingBox
        ├── getWorldPoints(s)            → Point[] (multi-select)
        ├── getHandles(s)                → HandleGeometry | null
        ├── captureStart(s)              → StartSnapshot | null
        ├── applyHandleDrag(…)           → FieldUpdate | null
        ├── anchors?(s)                  → AnchorPoint[] (SNAP hints)
        └── validate?(s)                 → ValidationError[]

Store (Zustand + Immer)
  ├── shapes: Shape[]                    (z-index = kolejność tablicy)
  ├── weldUnits: WeldUnit[]              (semantycznie czyste obiekty nadrzędne)
  ├── history: HistoryEntry[]            (Command Pattern, max 100, localStorage only)
  ├── canvas: viewport, zoom, toolMode
  ├── ui: selection, snap, darkMode
  └── document: name, isDirty, save state

WeldUnit (maszyna stanów)
  FREE ──► LOCKED ──► SEQUENCE
         ◄──────  ◄──────────
  (lock: bbox overlap ≥2 elementów)
  (unlock: dormant sequence → przywrócenie przy ponownym lock jeśli checksum OK)

Canvas (Konva)
  ├── Layer (zawartość): shapes + WeldUnit overlays  [z-index = kolejność]
  └── Layer (kontrolki): handles, WeldUnitHandles, marquee, anchors [zawsze na wierzchu]

Persistence
  ├── localStorage: pełna scena + historia → odtwarzanie przy starcie
  └── Supabase: JSONB snapshot przy świadomym zapisie → bez historii między sesjami

Dodanie nowego kształtu dotyka dokładnie 4 miejsc:
  1. src/shapes/[nowy-ksztalt]/  (nowy katalog)
  2. src/shapes/index.ts         (ShapeType union +1)
  3. src/shapes/registry.ts      (SHAPE_REGISTRY +1)
  4. src/store/types.ts          (AllShapeGeometry +1)
```

---

*Dokument wygenerowany na podstawie: Shape-Registry Canvas Architecture Pattern (wzorzec bazowy), PRD WelderDoc v1.0, oraz sesji Q&A z autorami aplikacji — maj 2026.*
