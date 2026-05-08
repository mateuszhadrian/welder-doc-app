# Analiza rozbieżności i problemów w dokumentacji oraz kodzie — WelderDoc (v3)

> **Data analizy:** 2026-05-08
> **Wersja dokumentu:** 3.0
> **Źródła:** `.ai/prd.md`, `.ai/architecture-base.md`, `.ai/db-plan.md`, `.ai/tech-stack.md`, `.ai/api-plan.md`, `.ai/code-documentation-problems-v2.md`, kod w `src/`, `supabase/migrations/20260507000000_complete_schema.sql`, `supabase/config.toml`, `vercel.json`, `package.json`.
>
> **Stan projektu:** post-bootstrap, pre-implementation. Pliki w `src/` to szkielety z komentarzami-wytycznymi; logika domen (shapes, weld-units, store slices, components) nie istnieje.
>
> **Legenda priorytetów:**
> - 🔴 **Krytyczne** — błąd blokujący implementację, powodujący błąd produkcyjny lub silnie wprowadzający w błąd implementatora.
> - 🟡 **Istotne** — wymagają decyzji lub aktualizacji przed startem odpowiedniego obszaru.
> - 🟢 **Drobne** — niespójności, kosmetyczne, niska pilność.

---

## 0. Status problemów z v2 — pełna tabela

| # v2 | Tytuł | Status (v3, 2026-05-08) | Komentarz |
|---|---|---|---|
| 1.1 | db-plan.md preambuła/§5.12 opisywała DROP IF EXISTS | ✅ **Naprawione** | Preambuła i §5.12 poprawnie opisują "czysty CREATE". |
| 1.2 | Cron route handlery nie istnieją | 🔴 **Wciąż aktywne** | Tylko `api/health/route.ts` istnieje. Patrz §1.1 niżej (nowy kontekst). |
| 1.3 | `supabase/config.toml` bez minimalnej długości hasła | ✅ **Naprawione** | `minimum_password_length = 8` obecne z komentarzem o PRD US-001. |
| 1.4 | `PointerGesture` zawierała typ `'pan'` | ✅ **Naprawione** | Architecture §22.5 mówi "'pan' celowo nie istnieje"; kod nigdy go nie emituje. |
| 1.5 | `usePointerInput` — `RefObject<HTMLElement>` vs `RefObject<HTMLElement \| null>` | ✅ **Naprawione** | Architecture §22.5 poprawiony na `RefObject<HTMLElement \| null>`. |
| 2.1 | `pipe-front` `outerRadius` vs PRD `outerDiameter` | ✅ **Naprawione** | Architecture §6 używa `outerDiameter`; adnotacja "single source of truth". |
| 2.2 | `BeadShape` — dwie wartości vs PRD "inne warianty" | ✅ **Naprawione** | PRD US-038 teraz mówi "dokładnie dwa kształty", post-MVP dla pozostałych. |
| 2.3 | Indeks `WHERE schema_version < 1` zawsze pusty | 🟡 **Wciąż aktywne** | Partial index z predykatem `< 1` przy default = 1 jest zawsze pusty. |
| 2.4 | db-plan.md §5.14 — otwarte tematy niezamknięte | ✅ **Naprawione** | Punkty 1, 6, 9 oznaczone ✅ z odsyłaczami. |
| 2.5 | Limit Free przy duplikowaniu — brak doprecyzowania | ✅ **Naprawione** | Architecture §16 opisuje UI disabled + DB defense-in-depth. |
| 2.6 | `block_protected_columns_update` — brak COALESCE (3-valued logic) | ✅ **Naprawione** | db-plan.md §1.2 dokumentuje `COALESCE(auth.role(), 'anon')`. |
| 3.1 | `hitStrokeWidth`/`listening` Konva-specific w `primitives.ts` | ✅ **Naprawione** | Architecture §22.2 dodał tabelę mapowania cross-engine. |
| 3.2 | `consent_log.ip_address` typowane jako `unknown` | 🟢 **Wciąż aktywne** | Typ wciąż `unknown` w `src/types/database.ts`. |
| 3.3 | `konva@^9.0.0` vs peer-dep `^9.3.0` | ✅ **Naprawione** | `package.json` i `tech-stack.md` oba pokazują `^9.3.0`. |
| 3.4 | `proxy.ts` — brak komentarza wyjaśniającego kopiowanie cookies | ✅ **Naprawione** | Blokowy komentarz obecny w `src/proxy.ts`. |
| 3.5 | e2e smoke test — kruchy selektor tytułu | 🟢 **Nieweryfikowalne** | Brak katalogu `e2e/` w repo — testy e2e nie istnieją. |
| 3.6 | `_geometryChecksum?: string` vs `sequenceJointChecksum: string \| null` | ✅ **Naprawione (częściowo)** | Architecture §6 używa `string \| null` w obu. Jednak lifecycle pola niejasny — patrz **nowy §2.4**. |
| 3.7 | Opis `subscriptions` sugerował append-only | ✅ **Naprawione** | db-plan.md §1.4 mówi "aktualny stan … upsert"; §5.4 analogicznie. |
| 3.8 | `lib/weldAutosize.ts` vs `shapes/weld-joint/autosize.ts` | ✅ **Naprawione** | Architecture §3 zawiera tylko `shapes/weld-joint/autosize.ts`. |
| 3.9 | `snapEngine` importuje z `@/shapes/_base/types` | 🟢 **Wciąż aktywne** | `src/lib/snapEngine.ts` nadal importuje `Point`/`AnchorEdge`/`AnchorPoint` z `shapes/`. |

**Wniosek:** 13 z 19 problemów v2 zostało naprawionych. 6 pozostało (1.2, 2.3, 3.2, 3.5, 3.6→przeniesiony, 3.9). Poniżej: nowe problemy oraz aktywne przeniesione.

---

## 1. 🔴 Krytyczne

### 1.1 `HIT_AREA_TOUCH = 16` w kodzie vs architecture §9 "20 px (touch)"

**Problem:**

`src/canvas-kit/constants.ts`:
```typescript
export const HIT_AREA_TOUCH   = 16;   // ← 16 px
export const HIT_AREA_DESKTOP = 8;    // ← 8 px (OK)
```

`architecture-base.md` §9:
> "Hit area uchwytów: **20 px (touch)** / 8 px (desktop). Detekcja: `navigator.maxTouchPoints > 0`."

Wartość dla desktopa jest zgodna (8 px = OK). Dla dotyku: kod ma 16 px, dokumentacja mówi 20 px. Ta stała eksportowana jest z `@/canvas-kit` i używana przez `ShapeHandles`, `WeldUnitHandles` — docelowo przez każdy komponent z uchwytami na urządzeniach dotykowych.

**Konsekwencje:**
- Implementatorzy kształtów czytają dokumentację i oczekują 20 px, a w runtime działają z 16 px.
- Różnica 4 px jest zauważalna dla precyzji tapów; na iOS minimalne zalecane touch target to 44 px, ale dla uchwytów modyfikacji kompromis to 20–24 px. 16 px jest poniżej tej granicy.
- Niezgodność kodu z dokumentacją jest błędna; implementacja kształtów będzie pisana pod błędne założenie.

**Rozwiązanie:**

Wybrać jedno z:

- **Opcja A (zalecana):** poprawić dokumentację architecture §9 na `16 px (touch)`, jeśli taki rozmiar był świadomą decyzją.
- **Opcja B:** zmienić kod `constants.ts` na `HIT_AREA_TOUCH = 20`, co jest zgodne z dokumentacją i lepi spełnia cele PRD dla obsługi dotykowej.

**Rekomendacja:** **Opcja B** — 20 px jest bardziej touch-friendly, zgodne z dokumentacją i z PRD §3.9 ("przyciski, suwaki i uchwyty odpowiednio zwymiarowane"). Możliwość korekty przed jakimkolwiek użyciem w kształtach.

---

### 1.2 Vercel Cron wysyła GET, architecture §16 deklaruje POST dla cron route handlerów

**Problem:**

`architecture-base.md` §16 (Route Handlers):
```
POST  /api/cron/expire-subscriptions     ← Vercel Cron 03:00 UTC daily
POST  /api/cron/cleanup-webhook-events   ← Vercel Cron 02:00 UTC Sunday
```

`vercel.json` (skonfigurowane crony):
```json
{ "path": "/api/cron/expire-subscriptions",   "schedule": "0 3 * * *" },
{ "path": "/api/cron/cleanup-webhook-events",  "schedule": "0 2 * * 0" }
```

Vercel Cron Jobs wywołują zadeklarowaną ścieżkę metodą **GET** (domyślnie; `method` nie jest podane w `vercel.json`). Jeśli Route Handler eksportuje tylko `POST`, Vercel Cron dostanie `405 Method Not Allowed` przy każdym wywołaniu.

**Konsekwencje:**
- Crony nie działają: plany Pro nie są downgrade'owane po wygaśnięciu, `webhook_events` rośnie bez retencji 90 dni.
- Implementator podąży za architecture §16 i napisze `export async function POST(...) {}` — przetestuje ręcznie przez curl z POST, wszystko zadziała, ale Vercel Cron nadal zwróci 405 w produkcji.

**Weryfikacja:**
```
# Vercel CLI / dashboard → Cron Jobs → sprawdź method w logach po deploy.
# Lub: w route.ts eksportuj GET i sprawdź, czy wywołanie przez `curl -X GET` z nagłówkiem Authorization: Bearer ${CRON_SECRET} odpowiada 200.
```

**Rozwiązanie:**

```diff
- POST  /api/cron/expire-subscriptions     ← Vercel Cron 03:00 UTC daily; woła refresh_expired_plans()
+ GET   /api/cron/expire-subscriptions     ← Vercel Cron 03:00 UTC daily; woła refresh_expired_plans()
- POST  /api/cron/cleanup-webhook-events   ← Vercel Cron 02:00 UTC Sunday; retencja 90 dni webhook_events
+ GET   /api/cron/cleanup-webhook-events   ← Vercel Cron 02:00 UTC Sunday; retencja 90 dni webhook_events
```

Analogicznie: route handlery powinny eksportować `async function GET(...)`, nie `POST`.

**Rekomendacja:** zaktualizować architecture §16 TERAZ, przed implementacją handlerów. To jeden z najłatwiejszych błędów do przeoczenia i najtrudniejszych do zdiagnozowania w produkcji (Vercel wyświetli błąd w logach cron, ale nie w UI deploymentu).

---

### 1.3 (przeniesione z v2 1.2) Cron i inne Route Handlery nie istnieją w repo

**Status:** wciąż aktywne z v2 — kontekst uzupełniony o problem z metodą HTTP (§1.2 powyżej).

**Brakujące pliki:**
```
src/app/api/cron/expire-subscriptions/route.ts
src/app/api/cron/cleanup-webhook-events/route.ts
src/app/api/paddle/webhook/route.ts
src/app/api/consent/route.ts
src/app/api/user/export/route.ts
```

**Guardrail** jest obecny w `tech-stack.md` §12 i `architecture-base.md` §18. Jednak nie ma mechanizmu egzekwowania — CI nie sprawdza obecności tych plików przed merge do `main`.

**Rozwiązanie:** dodać do CLAUDE.md w sekcji "Workflow guardrails" (lub do `.github/PULL_REQUEST_TEMPLATE.md`):

```markdown
## PR checklist — przed merge do `main`
- [ ] Jeśli `vercel.json.crons[]` nie pusty: sprawdź, że odpowiadające route.ts istnieją
      (`src/app/api/cron/{expire-subscriptions,cleanup-webhook-events}/route.ts`)
      i eksportują `GET` z weryfikacją `Authorization: Bearer ${CRON_SECRET}`.
```

---

## 2. 🟡 Istotne

### 2.1 `AllShapeGeometry = {}` — pusty typ łamie bezpieczeństwo typów `ShapeUpdate`

**Problem:**

`src/store/types.ts`:
```typescript
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export type AllShapeGeometry = {};

export type ShapeUpdate = Partial<AllShapeGeometry & { type: ShapeType }>;
```

Architecture §8 definiuje `AllShapeGeometry` jako:
```typescript
type AllShapeGeometry =
  Omit<PlateShape,            'id' | 'type'> &
  Omit<PipeFrontShape,        'id' | 'type'> &
  Omit<PipeLongitudinalShape, 'id' | 'type'> &
  ...
```

Aktualnie `ShapeUpdate = Partial<{ type: ShapeType }>` — akceptuje dosłownie każdy obiekt bez walidacji pól geometrycznych. `commitShapeUpdate(id, before, after)` nie daje TypeScript żadnej informacji o legalnych polach (`width`, `thickness`, `outerDiameter` itd.) i nie złapie literówek w nazwach pól.

**Konsekwencje:**
- Implementacja każdego kształtu może przekazać dowolny klucz do `commitShapeUpdate` bez błędu TS.
- Puste `AllShapeGeometry` skasuje TS-owe gwarancje z chwilą, gdy pierwsze kształty trafią do registry — `ShapeUpdate` stanie się nagle restrykcyjny, co pęknie cały istniejący kod store'a.
- `// eslint-disable-next-line @typescript-eslint/no-empty-object-type` sygnalizuje, że autorzy są świadomi stanu tymczasowego, ale brak dokumentacji kiedy i jak to zmienić.

**Rozwiązanie:**

Dodać do komentarza w `src/store/types.ts`:
```typescript
/**
 * AllShapeGeometry (architecture §8) — intersection Omit<*Shape, 'id'|'type'> dla każdego kształtu.
 * SCAFFOLD: puste {} dopóki żaden kształt nie jest zaimplementowany.
 * TODO: przy dodaniu pierwszego src/shapes/[typ]/ zastąpić scaffolda pełną intersectionem.
 *       Zmiana jest BREAKING dla wszystkich istniejących call-sites commitShapeUpdate.
 */
export type AllShapeGeometry = {};   // ← scaffold, see TODO above
```

Oraz dodać do architecture §8 / §19 (przy opisie "Dodanie nowego kształtu"):
> "Wraz z implementacją pierwszego kształtu `AllShapeGeometry = {}` w `store/types.ts` musi zostać zastąpione pełną intersectionem — inaczej `ShapeUpdate` pozostanie bezużyteczny dla sprawdzania typów."

---

### 2.2 `SHAPE_REGISTRY` to `Partial<Record>` vs pełny `Record` w specyfikacji

**Problem:**

Architecture §5:
```typescript
export const SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition<any>> = { … }
```

`src/shapes/registry.ts`:
```typescript
export const SHAPE_REGISTRY: Partial<Record<ShapeType, ShapeDefinition<any>>> = {};
```

Aktualny `Partial<Record>` jest sensowny dla etapu pre-implementation (kształty dodawane iteracyjnie). Obok jest helper `getShapeDefinition<S>(type)` z guard'em `if (!def) throw ...`, który obsługuje przypadek brakującego wpisu. Architecture §5 nie dokumentuje tej różnicy ani nie wspomina o `getShapeDefinition`.

**Konsekwencje:**
- Implementator czytający architecture §5 spodziewa się pełnego `Record` i nie wie, że SHAPE_REGISTRY może zwrócić `undefined` przy bezpośrednim dostępie `SHAPE_REGISTRY[type]`.
- Architecture §2 i §21 mówią "infrastruktura operuje wyłącznie na interfejsie `ShapeDefinition`" — ale nie precyzują, przez który punkt dostępu.

**Rozwiązanie:**

Zaktualizować architecture §5:
```diff
- export const SHAPE_REGISTRY: Record<ShapeType, ShapeDefinition<any>> = { … }
+ // Partial podczas implementacji (kształty dodawane iteracyjnie).
+ // Kiedy wszystkie 8 kształtów MVP zaimplementowane → zmienić Partial<Record> na Record.
+ export const SHAPE_REGISTRY: Partial<Record<ShapeType, ShapeDefinition<any>>> = {};

+ // Jedyny dostęp do registry z gwarancją runtime:
+ export function getShapeDefinition<S extends BaseShape>(type: ShapeType): ShapeDefinition<S>
+ // Rzuca Error jeśli type nie jest zarejestrowany.
```

Dodać też do architecture §21 (Ściągawka) wzmiankę: "Dostęp do SHAPE_REGISTRY przez `getShapeDefinition(type)` — nigdy bezpośrednio przez `SHAPE_REGISTRY[type]`."

---

### 2.3 `Shape = BaseShape` placeholder — brak discriminated union, brak dokumentacji scaffold stanu

**Problem:**

`src/shapes/index.ts`:
```typescript
export type Shape = BaseShape;  // Placeholder — zostanie zastąpiony właściwą unią
```

Architecture §4/§6 zakładają, że `Shape` to `PlateShape | PipeFrontShape | PipeLongitudinalShape | ProfileIShape | … | WeldJointShape`.

`shapes[]` w store (gdy zostanie zaimplementowany) będzie typowany jako `Shape[]`, czyli aktualnie `BaseShape[]`. Wszystkie kształty będą akceptowane jako `BaseShape`, a nie jako konkretne typy. Switch `shape.type` będzie technicznie możliwy, ale bez narrowing (TypeScript nie zwęzi typu w branchu `case 'plate':`).

**Konsekwencje:**
- Implementacja `Renderer`-ów i `PropertiesPanel`-ów wymagają konkretnych typów. Bez discriminated union każdy komponent musi castować: `const plate = shape as PlateShape`.
- Przy dodaniu pierwszego kształtu należy równocześnie zaktualizować `Shape` — to `BREAKING` dla wszystkich plików używających `Shape[]` (jeśli istnieją).

**Rozwiązanie:**

Dodać do `src/shapes/index.ts` komentarz z instrukcją:
```typescript
/**
 * Shape — discriminated union wszystkich konkretnych typów kształtów.
 * SCAFFOLD: = BaseShape dopóki żaden kształt nie jest zaimplementowany.
 * TODO: przy dodaniu src/shapes/plate/ zmienić na:
 *   export type Shape = PlateShape | PipeFrontShape | PipeLongitudinalShape | ... | WeldJointShape;
 * Każdy dodany kształt dokłada swój typ do unii (architecture §19, punkt 2).
 */
export type Shape = BaseShape;
```

---

### 2.4 `_geometryChecksum` w `WeldJointShape` — pole przechowywane vs obliczane, niejasny lifecycle

**Problem:**

Architecture §6 definiuje w `WeldJointShape`:
```typescript
_geometryChecksum: string | null   // do walidacji dormant sequence; ujednolicone z WeldUnit.sequenceJointChecksum
```

Architecture §7 definiuje w `WeldUnit`:
```typescript
sequenceJointChecksum: string | null
```

Logika walidacji dormant sequence (§7): przy `lockUnit` sprawdza `checksum(currentWeldJoint) === unit.sequenceJointChecksum`.

**Dwie interpretacje `_geometryChecksum` w WeldJointShape:**
1. **Pole cache'owane** — obliczane i zapisywane przy każdym `commitShapeUpdate` dla weld-joint. Wymaga, żeby `ShapesSlice` wiedziało o semantyce checksumu.
2. **Pole zawsze null** — obecne w typie strukturalnie, ale `checksum(shape)` jest obliczana na żywo z pól geometrycznych (nie z tego pola). Wtedy `_geometryChecksum` jest w typie niepotrzebne.

Architecture §7 mówi: `checksum(currentWeldJoint)` — nie `currentWeldJoint._geometryChecksum`. To sugeruje interpretację 2 (obliczane na żywo). Jednak `_geometryChecksum: string | null` jako pole w typie sugeruje interpretację 1 (pole przechowywane).

**Konsekwencje:**
- Implementator `lockUnit` nie wie, czy powinien czytać `weldJoint._geometryChecksum` czy wywołać `checksum(weldJoint)` (pure function z pól geometrycznych).
- Jeśli interpretacja 1: `_geometryChecksum` musi być aktualizowane przy każdej zmianie parametrów weld-joint (dodaje kompleksowość do `commitShapeUpdate`).
- Jeśli interpretacja 2: `_geometryChecksum` w WeldJointShape jest zbędne i powinno być usunięte.
- Pole z prefixem `_` sugeruje, że jest wewnętrzne, ale jest w typie danych persystowanych do JSON (localStorage, Supabase) — każda zmiana definicji checksumu powoduje inkompatybilność z istniejącymi zapisami.

**Rekomendacja:**

Interpretacja 2 (obliczane na żywo) jest lepsza architektonicznie — brak złożoności synchronizacji. Checksum = deterministyczna funkcja pure z pól geometrycznych kształtu:

```typescript
// src/weld-units/bead-sequence.ts lub odrębna util
export function computeWeldJointChecksum(shape: WeldJointShape): string {
  // JSON.stringify kluczowych pól geometrycznych (joinType, leg1, leg2, angle, ...)
  // + hash (np. cyrb64 lub prosty cyrb64)
}
```

`WeldJointShape._geometryChecksum` powinno być **usunięte** z typu. Architecture §7 pozostaje bez zmian (`sequenceJointChecksum` w WeldUnit przechowuje wartość w momencie konwersji).

Zaktualizować architecture §6 i §7:
```diff
 interface WeldJointShape extends BaseShape {
   ...
-  _geometryChecksum: string | null   // do walidacji dormant sequence; ujednolicone z WeldUnit.sequenceJointChecksum
 }
```

Dodać do §7 przy opisie `lockUnit`:
> "Porównanie checksumów: `computeWeldJointChecksum(currentWeldJoint) === unit.sequenceJointChecksum`, gdzie `computeWeldJointChecksum(s)` to pure function z `src/weld-units/bead-sequence.ts`."

---

### 2.5 (przeniesione z v2 2.3) Partial index `WHERE schema_version < 1` zawsze pusty

**Status:** wciąż aktywne. Migracja `20260507000000_complete_schema.sql` zawiera:
```sql
create index documents_schema_version_idx
  on public.documents (schema_version)
  where schema_version < 1;
```

Przy `default 1` predykat `< 1` jest zawsze fałszywy → indeks zawsze pusty.

**Rozwiązanie (zalecane):**
```diff
- create index documents_schema_version_idx
-   on public.documents (schema_version)
-   where schema_version < 1;
+ create index documents_schema_version_idx
+   on public.documents (schema_version);
```

Zaktualizować `db-plan.md` §3:
```diff
- | `documents_schema_version_idx` | `documents` | `(schema_version)` (full B-tree) | Wykrywanie projektów do migracji codec'a (skanowanie po `schema_version < N` przy bumpie codec'a) |
+ | `documents_schema_version_idx` | `documents` | `(schema_version)` (pełny B-tree) | Wykrywanie projektów do migracji codec'a (skanowanie po `schema_version < N` przy bumpie codec'a) |
```

**Rekomendacja:** wykonać w nowej migracji (`20260507000001_fix_schema_version_index.sql`), bo zmieniamy istniejący index. Alternatywnie — drop + create w tej samej migracji.

---

### 2.6 `devtools` middleware brakuje w store — CLAUDE.md wymóg niezrealizowany

**Problem:**

CLAUDE.md ("Zustand store conventions"):
> "**`devtools` middleware tylko w dev.** Store powinien być owiknięty w `devtools()` z `zustand/middleware` warunkowo: `process.env.NODE_ENV !== 'production'`. Umożliwia inspekcję stanu i time-travel w Redux DevTools podczas implementacji slice'ów; zero kosztu w produkcji."

`src/store/use-canvas-store.ts` (aktualnie):
```typescript
export const useCanvasStore = create<CanvasStore>()(
  immer(() => ({
    _placeholder: true
  }))
)
```

Brak `devtools`. Scaffold jest zrozumiały, ale CLAUDE.md traktuje to jako obowiązkową konwencję, nie opcjonalną.

**Konsekwencje:**
- Przy implementacji pierwszego slice'a (np. ShapesSlice) implementator może zapomnieć o `devtools` — i od razu debugować bez Redux DevTools.
- Retroaktywne dodanie `devtools` po implementacji kilku slice'ów jest trywialne technicznie, ale może być pominięte w pośpiechu.

**Rozwiązanie:**

Dodać `devtools` do scaffolda teraz (jednolinijkowa zmiana):
```diff
+ import { devtools } from 'zustand/middleware';

  export const useCanvasStore = create<CanvasStore>()(
-   immer(() => ({
-     _placeholder: true
-   }))
+   process.env.NODE_ENV !== 'production'
+     ? devtools(immer(() => ({ _placeholder: true })), { name: 'CanvasStore' })
+     : immer(() => ({ _placeholder: true }))
  )
```

Lub użyć kompozycji middleware zgodnie z zaleceniem CLAUDE.md przy implementacji pierwszego slice'a.

---

## 3. 🟢 Drobne

### 3.1 `Point` zdefiniowany w dwóch miejscach — brak kanonicznego źródła

**Problem:**

Dwie osobne definicje:
```typescript
// src/shapes/_base/types.ts
export interface Point { x: number; y: number }

// src/canvas-kit/pointerInput.ts
export interface Point { x: number; y: number }
```

`src/canvas-kit/index.ts` re-eksportuje `Point` z `pointerInput`. `src/lib/snapEngine.ts` importuje `Point` z `@/shapes/_base/types`. Są strukturalnie identyczne (TypeScript structural typing), więc nie ma błędu TS, ale:

- Architecture §22.1 eksportuje `Point` z `@/canvas-kit` — sugeruje to jako kanoniczne.
- Implementatorzy kształtów będą importować `Point` z `@/shapes/_base/types` (bo tam żyją `AnchorPoint`, `AnchorEdge` itd. — naturalne sąsiedztwo).
- `snapEngine.ts` już importuje z `shapes/_base/types`, co jest niezgodne z architecture §22.1.

**Rozwiązanie:**

Zdefiniować `Point` dokładnie raz w `src/shapes/_base/types.ts` (kanoniczne, bo typy domeny geometrycznej). Re-eksportować z `canvas-kit/pointerInput.ts` (lub bezpośrednio z `@/canvas-kit`):

```diff
// src/canvas-kit/pointerInput.ts
- export interface Point { x: number; y: number }
+ export type { Point } from '@/shapes/_base/types';
```

Zaktualizować architecture §22.1, żeby nie sugerować, że `Point` pochodzi z canvas-kit — to jest typ domeny geometrycznej, nie silnika canvasu.

---

### 3.2 Architecture §3 — komentarz "CanvasShell podpina pointerInput" niepoprawny

**Problem:**

`architecture-base.md` §3 (drzewo katalogów):
```
canvas-kit/impl-konva/
  CanvasShell.tsx       ← <Stage>+<Layer>, podpina pointerInput
```

Aktualny `src/canvas-kit/impl-konva/CanvasShell.tsx` importuje tylko `Stage, Layer` i nie wywołuje `usePointerInput`. Zgodnie z architecture §22.5 i §9:
> "Reklasyfikacja `drag` → pan dzieje się w `CanvasApp.tsx`... canvas-kit jest engine-agnostic i nie zna trybów aplikacji."

`usePointerInput` powinien być używany w `src/components/canvas/CanvasApp.tsx` (strefa uprzywilejowana), nie w `CanvasShell`. CanvasShell to opakowanie `<Stage>`, nie konsument gestów.

**Konsekwencje:**
- Implementator `CanvasApp.tsx` może szukać `usePointerInput` w CanvasShell (bo tak mówi §3) zamiast wpiąć go w CanvasApp.

**Rozwiązanie:**
```diff
- CanvasShell.tsx       ← <Stage>+<Layer>, podpina pointerInput
+ CanvasShell.tsx       ← <Stage>+<Layer>; singleton ref → activeStage.ts → rasterize
```

I dodać do komentarza przy `components/canvas/`:
```diff
  components/
    canvas/            ← STREFA UPRZYWILEJOWANA (§22.3)
+     CanvasApp.tsx    ← podpina usePointerInput, reklasyfikuje drag→pan/select na podstawie toolMode
```

---

### 3.3 Walidacja eksportu — `&& weldUnits.length === 0` jest redundancją

**Problem:**

Architecture §12:
> "`shapes.length === 0 && weldUnits.length === 0` → blokada eksportu z toastem."

Warunek `weldUnits.length === 0` jest zawsze równoważny `shapes.length === 0` dla poprawnych stanów aplikacji:
- `WeldUnit` zawiera `weldJointId` wskazujący na kształt w `shapes[]`.
- `removeShape` dla weld-joint kaskaduje na `removeUnit` (architecture §8 ShapesSlice).
- Niemożliwe jest istnienie `WeldUnit` bez kształtu weld-joint w `shapes[]`.

Jeśli `shapes.length === 0`, to też `weldUnits.length === 0` (bo removeShape weld-joint kasuje unit). Warunek `&&` jest więc tautologią.

**Konsekwencje:** brak błędu w runtime, ale mylące dla implementatora `exportEngine.ts`.

**Rozwiązanie:**
```diff
- `shapes.length === 0 && weldUnits.length === 0` → blokada eksportu z toastem.
+ `shapes.length === 0` → blokada eksportu z toastem.
+ // Nota: weldUnits.length === 0 jest zawsze implikowane przez shapes.length === 0,
+ // bo removeShape(weld-joint) kaskaduje na removeUnit. Sprawdzanie obu warunków zbędne.
```

---

### 3.4 (przeniesione z v2 3.2) `consent_log.ip_address` typowane jako `unknown`

**Status:** wciąż aktywne. `src/types/database.ts`:
```typescript
consent_log: { Row: { ...; ip_address: unknown; ... } }
```

PostgreSQL `inet` nie ma natywnego odpowiednika w TypeScript — generator Supabase wybiera `unknown`. W rzeczywistości Supabase REST zwraca `INET` jako `string` (np. `'192.168.1.0/24'`).

**Rozwiązanie:** przy implementacji `/api/consent` Route Handlera dodać wrapper:
```typescript
// src/types/supabase-helpers.ts
import type { Tables } from './database'
export type ConsentLogRow = Omit<Tables<'consent_log'>, 'ip_address'> & {
  ip_address: string | null
}
```

Albo dodać do `db-plan.md` §1.5 uwagę: "Postgres `inet` mapuje się w `supabase gen types` na `unknown`. Konsumenci typują manualnie jako `string | null`."

---

### 3.5 (przeniesione z v2 3.9) `snapEngine.ts` importuje z `@/shapes/_base/types`

**Status:** wciąż aktywne. `src/lib/snapEngine.ts`:
```typescript
import type { AnchorEdge, AnchorPoint, Point } from '@/shapes/_base/types';
```

Architecture §2 opisuje rozwiązanie cyklu `shapes/ ↔ store/` przez `FieldUpdate`/`ShapeUpdate`, ale nie omawia relacji `lib/ ↔ shapes/`. Import `lib/ → shapes/` jest jednokierunkowy (brak cyklu dziś), ale gdyby `shapes/` chciało użyć np. helpera geometrycznego z `lib/`, powstanie cykl.

**Rozwiązanie:** przenieść współdzielone typy geometryczne (`Point`, `AnchorEdge`, `AnchorPoint`) do osobnego, niezależnego modułu, np. `src/types/geometry.ts` (zero zależności). Zarówno `shapes/` jak i `lib/` mogą z niego importować. Alternatywnie: zostawić jak jest (zależność jednostronna jest akceptowalna), ale dokumentować w architecture §3 komentarzem przy `snapEngine.ts`: "`lib/` może importować typy z `shapes/_base/types` (zależność jednostronna — legalna; cykl `shapes/ → lib/snapEngine` jest zakazany)."

---

## 4. Rekomendacje priorytetowe (lista działań)

### Przed startem implementacji kształtów (ASAP):
1. 🔴 **§1.1** — zdecydować: 16 px czy 20 px dla `HIT_AREA_TOUCH`; zaktualizować kod lub dokument.
2. 🔴 **§1.2** — zmienić `POST` na `GET` dla cron routes w architecture §16.
3. 🟡 **§2.4** — usunąć `_geometryChecksum` z `WeldJointShape`; opisać `computeWeldJointChecksum()` jako pure function.
4. 🟡 **§2.6** — dodać `devtools` do `use-canvas-store.ts` (jednolinijkowa zmiana).

### Przy implementacji pierwszego kształtu (`plate`):
5. 🟡 **§2.1** — zaktualizować `AllShapeGeometry` z `{}` na pełną intersectionem; dodać instrukcję w komentarzu.
6. 🟡 **§2.2** — zaktualizować architecture §5 o `Partial<Record>` + `getShapeDefinition`.
7. 🟡 **§2.3** — zaktualizować `Shape` union; dodać instrukcję w komentarzu.

### Przy implementacji cron Route Handlerów:
8. 🔴 **§1.3** — dodać guardrail do CLAUDE.md lub PR template.

### W dowolnym momencie (drobne):
9. 🟢 **§3.1** — ujednolicić `Point` do jednego miejsca.
10. 🟢 **§3.2** — poprawić komentarz w architecture §3 (CanvasShell vs CanvasApp).
11. 🟡 **§2.5** — naprawić partial index w nowej migracji.
12. 🟢 **§3.3** — uprosić warunek walidacji eksportu w architecture §12.
13. 🟢 **§3.4** — wrapper dla `ip_address: unknown` przy implementacji `/api/consent`.
14. 🟢 **§3.5** — dokumentować lub naprawić zależność `lib/ → shapes/`.
