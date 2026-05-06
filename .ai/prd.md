# Dokument wymagań produktu (PRD) - WelderDoc

## 1. Przegląd produktu

WelderDoc to przeglądarkowa aplikacja SaaS przeznaczona dla inżynierów spawalników i technologów. Umożliwia szybkie tworzenie proporcjonalnych przekrojów złączy spawanych, planowanie sekwencji spawania oraz eksport dokumentacji graficznej — bez instalacji i bez wymagania znajomości narzędzi CAD.

Aplikacja działa w modelu subskrypcyjnym (Free/Pro) z opcją korzystania jako gość.

**Stos technologiczny:**
- **Frontend:** Next.js (App Router), React, TypeScript, Konva.js (via `react-konva`), Zustand + Immer (zarządzanie stanem), Tailwind CSS, Lucide React (ikony)
- **Testowanie:** Vitest (z `jsdom` jako environment + `vitest-canvas-mock` dla testów Konva), `@vitejs/plugin-react`, @testing-library/react, @testing-library/user-event, @testing-library/jest-dom (entry point `/vitest`), Playwright (`@playwright/test`)
- **Backend:** Supabase (PostgreSQL, region EU — Frankfurt)
- **Hosting:** Vercel
- **CI/CD:** GitHub Actions

Wersje poszczególnych pakietów będą dobierane w trakcie implementacji — w miarę możliwości najnowsze stabilne wersje.

Punkt referencyjny produktowy: Weldia (weldia.app), jednak z radykalnym uproszczeniem do obsługi pojedynczego złącza/mocowania przez użytkownika bez tła CAD.

Wersja MVP dostarczana jako aplikacja przeglądarkowa obsługująca zarówno komputery stacjonarne i laptopy (Chrome, Edge, Firefox, Safari na desktop — Windows i Mac), jak i urządzenia mobilne oraz tablety z obsługą gestów dotykowych. Wsparcie wersji mobilnej będzie iteracyjnie rozwijane i dostosowywane w ramach ciągłego procesu CI/CD po wdrożeniu potoku deploymentowego.

---

## 2. Problem użytkownika

Inżynierowie spawalnicy oraz technolodzy nie mają dostępu do prostego, przystępnego cenowo i dedykowanego narzędzia do tworzenia przekrojów złączy spawanych oraz planowania sekwencji spawania.

Obecne alternatywy i ich wady:

- Ogólne programy CAD (AutoCAD, Catia, Inventor, SolidWorks): zbyt skomplikowane, czasochłonne, wymagają wysokich kompetencji technicznych i są kosztowne.
- Edytory graficzne (Paint, Word z clipartami): niskiej jakości wyniki, brak parametryczności, brak dedykowanych prymitywów spawalniczych.
- Ręczne szkice: nieprecyzyjne, trudne do edycji i nienadające się do dokumentacji przekazywanej klientom.

Konsekwencje: przygotowanie dokumentacji technicznej jest czasochłonne, podatne na błędy i daje efekty o niskiej jakości wizualnej. Specjaliści potrzebują narzędzia, które pozwoli technikowi bez doświadczenia CAD stworzyć czytelną dokumentację złącza spawanego i sekwencji spawania w mniej niż 10 minut.

---

## 3. Wymagania funkcjonalne

### 3.1 System kont i plany subskrypcji


| Plan         | Elementy na scenie | Projekty w chmurze         | Watermark | Eksport |
| ------------ | ------------------- | -------------------------- | --------- | ------- |
| Gość (Guest) | max 3               | 0 (wyłącznie localStorage) | tak       | PNG/JPG |
| Free         | max 3               | 1                          | tak       | PNG/JPG |
| Pro          | bez limitu          | bez limitu                 | nie       | PNG/JPG |


- Limit elementów dotyczy wszystkich obiektów na scenie: prymitywów (`plate`, `pipe`, `profile`) oraz połączeń spawalniczych (`weld connection`). Jedno połączenie spawalnicze liczy się jako jeden element. Wielokrotne zaznaczenie nie jest osobnym obiektem i nie wlicza się do limitu.
- Dostawca płatności MVP: Paddle (Merchant of Record).
- Ceny robocze (do walidacji z beta-użytkownikami): Pro Monthly 49 PLN, Pro Annual 399 PLN (ok. 32% zniżki).
- Rejestracja i logowanie wymagane dla planów Free i Pro; gość nie zakłada konta.

### 3.2 Uwierzytelnianie i autoryzacja

- Rejestracja e-mail + hasło (oraz opcjonalnie OAuth przez Supabase Auth).
- Logowanie i wylogowanie.
- Odzyskiwanie hasła (reset przez e-mail).
- Tryb gościa: autozapis lokalny (localStorage), baner CTA zachęcający do rejestracji, brak dostępu do chmury.
- Migracja danych: po zalogowaniu się użytkownika (w tym byłego gościa) scena zapisana w localStorage jest automatycznie migrowana do chmury, aby użytkownik nie tracił dotychczasowej pracy.
- Zabezpieczenie tras chronionych przed dostępem bez sesji.

### 3.3 Canvas i nawigacja

- Ograniczony obszar roboczy (bounded canvas) — domyślny rozmiar **2970 × 2100 px**, konfigurowalny przez użytkownika z poziomu ustawień projektu.
- Viewport jest ograniczony do granic obszaru roboczego — pan i zoom nie mogą wyjść poza krawędzie canvasu.
- Proporcjonalne renderowanie geometrii (nie schematyczne).
- Silnik 2D: Konva.js implementowany przez `react-konva`.

**Widok startowy po wczytaniu projektu:**
Po otwarciu zapisanego projektu scena jest automatycznie wycentrowana na ekranie, a poziom zoomu jest dobierany tak, aby jak największa część zawartości projektu była widoczna. Jeżeli canvas jest znacznie większy niż zawartość projektu, zoom jest dostosowywany do rozmiaru ekranu użytkownika z marginesem (padding) nie przekraczającym 40 px.

**Tryby kursora i nawigacja — desktop:**

- **Tryb kursora domyślny (strzałka):**
  - Kliknięcie i przeciągnięcie na pustym obszarze canvasu = prostokątne zaznaczenie (selection marquee).
  - Kliknięcie i przeciągnięcie na elemencie = przesuwanie elementu.
- **Tryb kursora Hand (dłoń):**
  - Kliknięcie i przeciągnięcie na canvasie = pan obszaru roboczego.
- **Pan za pomocą scroll:**
  - Scroll myszką (bez modyfikatora) = pan obszaru roboczego.
- **Zoom:**
  - Scroll myszką z przytrzymanym Ctrl (Windows/Linux) lub Cmd (Mac) = zoom in/out.

**Nawigacja na urządzeniach dotykowych:**

- **Jedno stuknięcie (tap) na pustym obszarze:** inicjuje pan canvasu.
- **Podwójne stuknięcie (double tap) na pustym obszarze:** aktywuje selection marquee.
- **Podwójne stuknięcie (double tap) na elemencie:** umożliwia przesuwanie tego elementu.
- **Jeśli element jest już zaznaczony:** pojedyncze stuknięcie na zaznaczony element inicjuje przesuwanie.
- **Pojedyncze stuknięcie na uchwyt modyfikacji (Adjustment Handle):** działa tak samo jak kliknięcie myszką na uchwyt w trybie domyślnym na desktopie.
- **Gest pinch (zbliżanie/rozszerzanie dwóch palców):** zoom in/out.

Wszystkie operacje pan i zoom są ograniczone do granic obszaru roboczego.

### 3.4 Biblioteka prymitywów parametrycznych

Aplikacja nie używa określonych jednostek miary — wszystkie parametry wymiarowe są wartościami bezwymiarowymi (proporcjonalnymi). Rysunek odwzorowuje proporcje geometryczne, nie wymiary bezwzględne.

**Docelowa klasyfikacja kształtów (architektura biblioteki):**

**A. Elementy Płaskie (Plates)**
Blachy i płaskowniki o przekroju prostokątnym, z możliwością modyfikacji krawędzi (skosy, fazowania, zaokrąglenia).

**B. Profile Zamknięte i Rury (Hollow Sections / Tubes)**
Elementy o przekroju kołowym lub prostokątnym, dostępne w dwóch wariantach wizualizacji:
- *Przekrój Czołowy*: wizualizowany jako pierścień (koło wewnątrz koła).
- *Przekrój Podłużny*: wizualizowany jako prostokąt z naniesioną osią symetrii i parametrem średnicy, reprezentujący widok boczny rury.

**C. Profile Standardowe (Standard Profiles)**
Otwarte wyroby hutnicze o stałym, zunifikowanym przekroju poprzecznym:
- Dwuteownik (I)
- Ceownik (C)
- Kątownik (L)
- Teownik (T)

**D. Kształty Specjalne (Special/Custom Shapes)** *(post-MVP)*
Złożone geometrie (np. elementy typu „U", „Plug", kształty z wypustkami), bezpośrednio dodawane na canvas w celu tworzenia nietypowych złączy.

**E. Elementy Podporowe (Backing Elements)** *(post-MVP)*
Kształty pomocnicze (np. podkładki spawalnicze), wspierające proces spajania i uwzględniane w geometrii złącza.

**F. Kształty Dowolne (Generic/User-Defined Shapes)** *(post-MVP)*
Otwarta kategoria dla obiektów definiowanych parametrycznie lub importowanych z zewnątrz, umożliwiająca przyszłą rozbudowę biblioteki o niestandardowe geometrie.

**Dostępne w MVP:** A (plate), B (pipe — oba warianty: przekrój czołowy i podłużny), C (profile: I, C, L, T).

**Ukosowania** (dla elementów płaskich i profili):
- Brak ukosowania: krawędź prosta.
- Ukosowanie jednostronne (typ V lub Y): kąt ukosu (0°–80°, krok 0,5°) i wysokość całkowita.
- Ukosowanie dwustronne (typ X lub K): niezależne kąty górny i dolny (0°–80°) i wysokość całkowita.

### 3.5 Manipulacja i parametryzacja elementów

- Parametry wymiarowe są bezwymiarowe (wartości proporcjonalne). Brak przełączania jednostek miary.
- Suwaki z krokiem 0,1 dla wszystkich parametrów wymiarowych.
- Ręczne wpisywanie wartości liczbowych w polach wejściowych.

**Interaktywne uchwyty modyfikacji (Adjustment Handles):**
Na krawędziach i przekrojach każdego elementu dostępne są uchwyty interaktywne. Przeciągnięcie uchwytu krawędziowego powoduje rozciąganie (stretching) elementu wzdłuż danej osi. Dla kształtów złożonych (np. profil C, T) uchwyty mogą wpływać na więcej niż jeden parametr jednocześnie — np. wyciągnięcie pionowego ramienia profilu może skutkować automatycznym przeliczeniem krzywizny (promienia) podstawy w celu zachowania ciągłości geometrycznej.

**Uchwyt obrotu:**
Na rogu zaznaczonego elementu lub grupy wyświetlany jest uchwyt obrotu (ikona kółka). Najechanie kursorem na uchwyt zmienia kursor na kursor obrotu. Przeciągnięcie uchwytu obraca element lub grupę względem środka zaznaczenia. W przypadku zaznaczonej grupy elementów obracana jest cała grupa jako jednostka.

**Przesuwanie:**
Elementy przesuwane są metodą drag & drop w trybie kursora domyślnego (strzałka). Podczas przeciągania aktywny SNAP może przykleić element do równoległej ścianki innego elementu (edge-snap z attachmentem) — po przyklejeniu element ślizga się wyłącznie wzdłuż napotkanej krawędzi („na szynach") do momentu wyraźnego ruchu prostopadłego, który zrywa attachment. Elementy zablokowane połączeniem spawalniczym przesuwają się jako jednostka.

**Odbicie lustrzane:**
W panelu właściwości dostępne są opcje odbicia lustrzanego w poziomie i w pionie. Operacja działa na zaznaczonym elemencie lub grupie zaznaczonych elementów.

**Kolejność warstw (Z-index):**
W panelu właściwości dostępna jest opcja zarządzania kolejnością warstw zaznaczonego elementu lub grupy: przesuń na wierzch, przesuń do tyłu, o jedną warstwę wyżej, o jedną warstwę niżej.

**Zaznaczanie i grupowanie:**
Zaznaczenie wielu elementów (przez selection marquee lub Shift+klik) automatycznie traktuje je jako grupę dla celów wszystkich operacji (przesuwanie, obrót, odbicie, skalowanie) — nie jest wymagane osobne kliknięcie przycisku „Grupuj".

**SNAP magnetyczny:**
System SNAP działa w dwóch współistniejących trybach, sterowanych jednym togglem — domyślnie aktywny:

- *Point-snap (przyciąganie do punktów anchor)*: punkt referencyjny (kursor wstawiania połączenia spawalniczego, narożnik bbox przy wyrównywaniu) przyciąga się do dyskretnych punktów — środki ścianek, narożniki, środki kół.
- *Edge-snap z attachmentem („na szynach")*: przy przesuwaniu elementu w trybie kursora domyślnego, gdy jego ścianka zbliża się równolegle do ścianki innego elementu, element automatycznie dociąga się prostopadle po najkrótszej drodze i przykleja do napotkanej krawędzi. Po przyklejeniu ślizga się wyłącznie wzdłuż krawędzi target. Zwolnienie attachmentu wymaga wyraźnego, skumulowanego ruchu prostopadłego (próg zerwania jest istotnie większy od progu przyklejenia — histereza zapobiegająca drganiu „przyklej/odklej").

Sterowanie wspólne dla obu trybów:
- Toggle button w UI (podświetlony gdy aktywny).
- Przytrzymanie dedykowanego klawisza tymczasowo wyłącza SNAP (przycisk synchronicznie zmienia stan wizualny); zwolnienie przywraca poprzedni stan. Aktywny attachment jest natychmiast zrywany.

**Undo/Redo:**
Głębokość **100 kroków** historii; implementacja przez **Command Pattern** (custom history slice w Zustand); historia persystowana w localStorage (autozapis przy każdym `pushHistory`) — nie jest zapisywana do Supabase. Architektura jest przygotowana na przyszłą aktywną współpracę wieloosobową. Skróty klawiszowe: Ctrl/Cmd+Z (undo), Ctrl/Cmd+Y lub Ctrl/Cmd+Shift+Z (redo) — obsługiwane zarówno na Windows/Linux (Ctrl), jak i na Mac (Cmd).

### 3.6 Tryb sekwencji spawania

Tryb sekwencji spawania umożliwia tworzenie **połączeń spawalniczych** — wielowarstwowych sekwencji ściegów odwzorowujących geometrię spoiny. Cały opisany system tworzenia i modyfikacji połączeń spawalniczych jest dostępny już w MVP.

**Workflow tworzenia połączenia:**

1. **Wejście w tryb tworzenia połączenia spawalniczego** — toggle/przycisk w toolbarze. Aktywny tryb jest wizualnie sygnalizowany (podświetlenie przycisku, zmiana kursora). W trybie aktywnym nie można dodawać nowych prymitywów.

2. **Wybór predefiniowanego kształtu połączenia** — użytkownik wybiera kształt z listy predefiniowanych typów połączeń (np. spoina czołowa prostokątna, pachwinowa trójkątna i inne dostępne warianty).

3. **Umieszczenie i modyfikacja kształtu połączenia** — po wyborze kształtu użytkownik umieszcza go na canvasie między/na elementach, a następnie dostosowuje za pomocą interaktywnych uchwytów modyfikacji (Adjustment Handles), analogicznie do edycji prymitywów.

4. **Zablokowanie połączenia z elementami** — jeśli umieszczone połączenie dotyka co najmniej dwóch elementów, obok kształtu pojawia się opcja „Zablokuj połączenie z elementami". Po kliknięciu powiązane elementy i kształt połączenia tworzą jednostkę (nie mogą być przesuwane niezależnie); opcja zmienia się na „Odblokuj połączenie z elementami". Odblokowanie przywraca niezależność elementów i ukrywa przycisk konwersji, ale **zachowuje w pamięci aplikacji ostatnio wygenerowaną sekwencję ściegów wraz z geometrią połączenia z momentu odblokowania** (pamięć dormant). Ponowne kliknięcie „Zablokuj" bez modyfikacji geometrii połączenia od czasu odblokowania natychmiast przywraca tę sekwencję (bez ponownego pojawienia się przycisku „Konwertuj"); jeżeli geometria połączenia uległa w międzyczasie zmianie — pamięć jest kasowana, pojawia się przycisk „Konwertuj na sekwencję ściegów" i nowa sekwencja generowana jest od nowa według defaultu.

5. **Konwersja na sekwencję ściegów** — przycisk „Konwertuj na sekwencję ściegów" pojawia się wyłącznie po zablokowaniu połączenia z co najmniej dwoma elementami. Po kliknięciu połączenie zamienia się w wielowarstwową sekwencję ściegów:
   - Liczba warstw wyznaczana automatycznie na podstawie rozmiaru (głębokości) połączenia.
   - Każda warstwa zawiera równomiernie rozmieszczone ściegi; ich wstępna liczba zależy od szerokości warstwy.
   - Obok każdej warstwy widoczne są przyciski **[−]** (po lewej) i **[+]** (po prawej) umożliwiające usunięcie lub dodanie ściegu przy zachowaniu równomiernego rozmieszczenia.
   - Dostępna jest możliwość dodania lub usunięcia całej warstwy.
   - Jednocześnie z pojawieniem się warstw wyświetlany jest panel boczny umożliwiający wybór kształtu pojedynczego ściegu — dostępne warianty to przede wszystkim trójkąt z zaokrąglonymi wierzchołkami oraz trapez z zaokrąglonymi wierzchołkami, a także inne dostępne kształty.

6. **Zablokowane elementy jako jednostka** — po zablokowaniu połączenia spawalniczego powiązane elementy sceny nie mogą być przesuwane niezależnie. Przesunięcie jednego elementu powoduje przesunięcie całej jednostki (oba elementy + połączenie).

### 3.7 Eksport dokumentacji

- Formaty MVP: PNG i JPG.
- Warstwa opisowa (numeracja ściegów, legenda tekstowa): opcjonalna; rysunek eksportowalny samodzielnie bez opisu.
- Watermark (semi-transparentny tekst po przekątnej obrazu): nakładany dla planów Guest i Free.
- Eksport do PDF: wyłączony z MVP.
- Walidacja przed eksportem: blokada eksportu pustej sceny z komunikatem toast.

### 3.8 Zarządzanie projektami

- Zapis projektu (scena JSON) w Supabase dla planów Free (1 projekt) i Pro (bez limitu).
- Wczytywanie projektu ze zbioru projektów użytkownika.
- Płaska lista projektów: nazwa, data modyfikacji, akcje: otwórz / usuń / duplikuj.
- **Lokalny autozapis dla wszystkich użytkowników** (localStorage) — scena odtwarzana przy kolejnym otwarciu przeglądarki, niezależnie od planu. Dla trybu gościa autozapis lokalny jest jedyną formą zapisu.
- Po zalogowaniu się użytkownika (w tym byłego gościa) scena zapisana w localStorage jest automatycznie migrowana do chmury.
- Udostępnianie linkiem (link-sharing): poza MVP; schemat bazy danych powinien zawierać pole `shareToken` z myślą o przyszłej implementacji.

### 3.9 UX i interfejs

- Dark mode i Light mode — oba dostępne w MVP.
- Interfejs dostosowany do obsługi dotykiem (touch-friendly) — przyciski, suwaki i uchwyty odpowiednio zwymiarowane.
- Walidacja inline: czerwona ramka i komunikat pod polem przy błędnych wartościach liczbowych.
- Komunikaty toast: błędy zapisu, eksportu, przekroczenia limitu elementów (z CTA do upgrade).
- Wielojęzyczność: architektura i18n od startu (biblioteka `next-intl` lub `react-i18next`), minimum PL/EN.
- Onboarding MVP: blank canvas przy starcie, brak interaktywnego tutoriala; użytkownicy MVP szkoleni werbalnie przez twórców.

### 3.10 Zgodność prawna (GDPR minimum przed launch)

- Polityka Prywatności i Regulamin dostępne jako statyczne strony.
- Cookie consent banner.
- Checkbox zgody przy rejestracji z zapisem wersji zgody.
- Instancja Supabase w regionie EU (Frankfurt).

---

## 4. Granice produktu

### W zakresie MVP

- Aplikacja przeglądarkowa: desktop (Chrome, Edge, Firefox, Safari na Windows i Mac) oraz urządzenia mobilne i tablety z obsługą gestów dotykowych; wersja mobilna rozwijana iteracyjnie w ramach CI/CD.
- Ograniczony obszar roboczy (bounded canvas) o domyślnym rozmiarze 2970 × 2100 px, konfigurowalny przez użytkownika.
- Automatyczne wycentrowanie i zoom-to-fit przy otwarciu projektu (padding max 40 px).
- Tryby kursora (strzałka / dłoń), nawigacja scrollem i gestami dotykowymi.
- Biblioteka prymitywów MVP: Elementy Płaskie (plate), Profile Zamknięte i Rury (pipe — przekrój czołowy i podłużny), Profile Standardowe (I, C, L, T).
- Ukosowania krawędzi: brak / jednostronne (V/Y) / dwustronne (X/K).
- Interaktywne uchwyty modyfikacji (Adjustment Handles) i uchwyt obrotu na krawędziach/przekrojach elementów.
- Odbicie lustrzane (poziome i pionowe) oraz zarządzanie z-index z poziomu panelu.
- Manipulacja: przesuwanie (z zachowaniem jednostki dla połączonych elementów), obrót (uchwyt narożny), zoom, pan, SNAP, multi-select z automatycznym grupowaniem.
- Undo/Redo: 100 kroków, Command Pattern, historia w localStorage (architektonicznie gotowe na multi-user), skróty Ctrl/Cmd.
- Pełny system tworzenia połączeń spawalniczych: predefiniowane kształty → modyfikacja uchwytami → zablokowanie połączenia z min. 2 elementami → konwersja na wielowarstwową sekwencję ściegów → zarządzanie ściegami i warstwami ([+]/[−]) → wybór kształtu ściegu (trójkąt, trapez z zaokrąglonymi wierzchołkami i inne).
- Eksport PNG i JPG (z watermarkiem dla Guest/Free, bez dla Pro).
- Zarządzanie projektami: 1 projekt w chmurze dla Free, bez limitu dla Pro; lokalny autozapis dla wszystkich; migracja danych gościa do chmury po zalogowaniu.
- System kont: Guest / Free / Pro z płatnościami przez Paddle.
- Dark mode i Light mode.
- Wielojęzyczność PL/EN.
- GDPR minimum: Polityka Prywatności, Regulamin, cookie consent, checkbox zgody.
- CI/CD: GitHub Actions z deploymentem na Vercel.

### Poza zakresem MVP

- Kształty Specjalne (Special/Custom Shapes), Elementy Podporowe (Backing Elements), Kształty Dowolne (Generic/User-Defined Shapes).
- Import/eksport DXF, SVG, DWG i innych formatów CAD.
- Eksport do PDF.
- Zaawansowane narzędzia wymiarowania i tolerancji.
- Walidacja kolizji geometrycznych.
- Walidacja zgodności z normami ISO 2553 / AWS A2.4.
- Biblioteka szablonów użytkownika.
- Udostępnianie projektu linkiem.
- Aktywna współpraca wieloosobowa w czasie rzeczywistym (real-time collaborative editing) — architektura jest przygotowana w MVP, funkcja aktywna post-MVP.
- Interaktywny tutorial onboardingowy.
- Pełna formalizacja compliance GDPR (DPA, rozszerzone raporty).
- Obsługa walut innych niż PLN (EUR planowane post-launch).
- Zaawansowane analizy i metryki produktowe (poza minimalnym trackingiem).

---

## 5. Historyjki użytkowników

### Uwierzytelnianie i konta

---

US-001
Tytuł: Rejestracja nowego użytkownika

Opis: Jako nowy użytkownik chcę założyć konto e-mail + hasło, aby móc zapisywać projekty w chmurze i korzystać z planu Free.

Kryteria akceptacji:

- Formularz rejestracji zawiera pola: e-mail, hasło, potwierdzenie hasła.
- Wymagany jest checkbox zgody na Regulamin i Politykę Prywatności; bez zaznaczenia rejestracja jest niemożliwa.
- System waliduje format e-mail i minimalną długość hasła (min. 8 znaków).
- Po pomyślnej rejestracji użytkownik jest zalogowany i trafia do listy projektów.
- Wersja zgody jest zapisywana w bazie danych.

---

US-002
Tytuł: Logowanie użytkownika

Opis: Jako zarejestrowany użytkownik chcę zalogować się do aplikacji, aby mieć dostęp do swoich projektów i planu subskrypcji.

Kryteria akceptacji:

- Formularz logowania zawiera pola e-mail i hasło.
- Po podaniu błędnych danych wyświetlany jest czytelny komunikat o błędzie.
- Po pomyślnym zalogowaniu użytkownik trafia do listy swoich projektów.
- Sesja jest utrzymywana między odświeżeniami strony.

---

US-003
Tytuł: Wylogowanie użytkownika

Opis: Jako zalogowany użytkownik chcę się wylogować, aby zakończyć sesję i zabezpieczyć swoje konto.

Kryteria akceptacji:

- Przycisk wylogowania jest dostępny w interfejsie aplikacji.
- Po wylogowaniu sesja jest zakończona i użytkownik jest przekierowywany na stronę logowania lub stronę główną.
- Po wylogowaniu chronione trasy są niedostępne bez ponownego zalogowania.

---

US-004
Tytuł: Odzyskiwanie hasła

Opis: Jako użytkownik, który zapomniał hasła, chcę zresetować hasło przez e-mail, aby odzyskać dostęp do konta.

Kryteria akceptacji:

- Formularz „zapomniałem hasła" przyjmuje adres e-mail.
- System wysyła e-mail z linkiem do resetu hasła.
- Link jest ważny przez określony czas (min. 1 godzina).
- Po kliknięciu linku użytkownik może ustawić nowe hasło.
- Po pomyślnym resecie użytkownik może zalogować się nowym hasłem.

---

US-005
Tytuł: Korzystanie z aplikacji jako gość

Opis: Jako użytkownik nieposiadający konta chcę korzystać z aplikacji bez rejestracji, aby szybko wypróbować narzędzie.

Kryteria akceptacji:

- Aplikacja jest dostępna bez logowania (tryb gościa).
- Gość może dodać maksymalnie 3 elementy na scenie (prymitywy i połączenia spawalnicze łącznie); próba dodania czwartego blokuje akcję i wyświetla toast z CTA do rejestracji.
- Scena jest automatycznie zapisywana w localStorage.
- Eksport PNG/JPG zawiera watermark.
- Wyświetlany jest baner zachęcający do rejestracji.
- Zapis do chmury jest niedostępny.

---

US-006
Tytuł: Odtworzenie sceny po ponownym otwarciu przeglądarki

Opis: Jako użytkownik chcę zastać poprzednią scenę odtworzoną po ponownym otwarciu przeglądarki, aby nie tracić pracy między sesjami.

Kryteria akceptacji:

- Po ponownym otwarciu aplikacji w tej samej przeglądarce scena jest odtworzona z localStorage dokładnie tak jak przy ostatnim zamknięciu — dotyczy wszystkich użytkowników (gość, Free, Pro).
- Wszystkie elementy, pozycje, parametry, ukosowania i połączenia spawalnicze są zachowane.
- Dla gościa wyświetlany jest baner zachęcający do rejestracji.

---

US-007
Tytuł: Migracja danych gościa do chmury po zalogowaniu

Opis: Jako były gość, który właśnie założył konto i zalogował się, chcę, aby moja scena z localStorage została automatycznie przeniesiona do chmury, aby nie stracić dotychczasowej pracy.

Kryteria akceptacji:

- Bezpośrednio po zalogowaniu system wykrywa istniejące dane sceny w localStorage.
- Scena jest automatycznie migrowana do chmury jako nowy projekt użytkownika bez wymagania akcji ze strony użytkownika.
- Po migracji projekt jest widoczny na liście projektów użytkownika.
- Dane lokalne w localStorage są zachowane lub czyszczone po potwierdzeniu pomyślnej migracji.
- W przypadku błędu migracji wyświetlany jest toast z informacją i możliwością ponowienia próby.

---

### Zarządzanie projektami

---

US-008
Tytuł: Tworzenie nowego projektu

Opis: Jako zalogowany użytkownik chcę utworzyć nowy projekt, aby zacząć pracę nad nowym złączem spawanym.

Kryteria akceptacji:

- Przycisk „Nowy projekt" jest dostępny na liście projektów.
- Kliknięcie otwiera pusty canvas z domyślną nazwą projektu i domyślnym rozmiarem obszaru roboczego (2970 × 2100 px).
- Projekt pojawia się na liście projektów użytkownika po pierwszym zapisaniu.
- Użytkownik Free nie może przekroczyć limitu 1 projektu w chmurze; próba wyświetla komunikat o limicie z CTA do upgrade.

---

US-009
Tytuł: Zapisywanie projektu w chmurze

Opis: Jako zalogowany użytkownik Free lub Pro chcę zapisać projekt w chmurze, aby móc do niego wrócić z dowolnego urządzenia.

Kryteria akceptacji:

- Przycisk „Zapisz" jest dostępny podczas pracy na canvasie.
- Po zapisaniu pojawia się potwierdzenie (toast lub wskaźnik w UI).
- Scena JSON jest zapisana w Supabase i w pełni odtwarza stan złącza przy wczytaniu.
- W przypadku błędu zapisu wyświetlany jest toast z informacją o problemie.

---

US-010
Tytuł: Wczytywanie istniejącego projektu

Opis: Jako zalogowany użytkownik chcę otworzyć istniejący projekt z listy, aby kontynuować pracę.

Kryteria akceptacji:

- Lista projektów wyświetla nazwę i datę ostatniej modyfikacji.
- Kliknięcie „Otwórz" wczytuje projekt na canvas.
- Wszystkie elementy, parametry, ukosowania, połączenia spawalnicze i ich warstwy są odtworzone bez utraty danych.
- Po wczytaniu scena jest automatycznie wycentrowana na ekranie, a zoom jest dobrany tak, aby jak największa część zawartości projektu była widoczna; jeśli canvas jest znacznie większy niż zawartość, zoom dostosowuje się do rozmiaru ekranu z paddingiem maksymalnie 40 px.
- Scena jest odtworzona w 100% przypadków (bez utraty danych).

---

US-011
Tytuł: Usuwanie projektu

Opis: Jako zalogowany użytkownik chcę usunąć projekt, którego już nie potrzebuję, aby utrzymać porządek na liście.

Kryteria akceptacji:

- Na liście projektów dostępna jest akcja „Usuń" dla każdego projektu.
- Przed usunięciem wyświetlane jest potwierdzenie (dialog/modal).
- Po potwierdzeniu projekt jest trwale usunięty z listy i z bazy danych.
- Operacja jest nieodwracalna po potwierdzeniu.

---

US-012
Tytuł: Duplikowanie projektu

Opis: Jako zalogowany użytkownik chcę zduplikować istniejący projekt, aby użyć go jako punktu startowego dla podobnego złącza.

Kryteria akceptacji:

- Na liście projektów dostępna jest akcja „Duplikuj".
- Kopia pojawia się na liście z nazwą w formacie „[oryginał] (kopia)" i aktualną datą.
- Kopia jest niezależna od oryginału — modyfikacja kopii nie zmienia oryginału.
- Limit projektów planu Free (1 projekt) jest respektowany przy duplikowaniu.

---

US-013
Tytuł: Zmiana nazwy projektu

Opis: Jako zalogowany użytkownik chcę zmienić nazwę projektu, aby nadać mu czytelne oznaczenie.

Kryteria akceptacji:

- Nazwa projektu jest edytowalna (inline na liście lub w nagłówku canvasu).
- Zmiana jest zapisywana po zatwierdzeniu (Enter lub kliknięcie poza pole).
- Nowa nazwa jest widoczna na liście projektów.

---

US-014
Tytuł: Zmiana rozmiaru obszaru roboczego

Opis: Jako użytkownik chcę zmienić rozmiar canvasu, aby dostosować obszar roboczy do potrzeb projektu.

Kryteria akceptacji:

- Opcja zmiany rozmiaru obszaru roboczego jest dostępna w ustawieniach projektu.
- Użytkownik może zdefiniować szerokość i wysokość canvasu (w pikselach).
- Po zmianie rozmiar obszaru roboczego jest aktualizowany; istniejące elementy pozostają na swoich pozycjach.
- Viewport nadal jest ograniczony do nowych granic obszaru roboczego.

---

### Canvas i nawigacja

---

US-015
Tytuł: Nawigacja po obszarze roboczym — tryby kursora i skróty (desktop)

Opis: Jako użytkownik na desktopie chcę sprawnie nawigować po obszarze roboczym za pomocą kursora i myszy, aby efektywnie pracować z projektem.

Kryteria akceptacji:

- Dostępne są dwa tryby kursora: domyślny (strzałka) i Hand (dłoń), przełączane przyciskiem w toolbarze lub skrótem klawiszowym.
- W trybie kursora domyślnego (strzałka): kliknięcie i przeciągnięcie na pustym obszarze canvasu aktywuje selection marquee; kliknięcie i przeciągnięcie na elemencie przesuwa element.
- W trybie kursora Hand (dłoń): kliknięcie i przeciągnięcie na canvasie realizuje pan obszaru roboczego.
- Scroll myszką (bez modyfikatora) realizuje pan obszaru roboczego niezależnie od aktywnego trybu kursora.
- Scroll myszką z przytrzymanym Ctrl (Windows/Linux) lub Cmd (Mac) realizuje zoom in/out.
- Pan i zoom są ograniczone do granic obszaru roboczego.
- Operacje pan i zoom działają płynnie (≥ 30 FPS).

---

US-016
Tytuł: Nawigacja i interakcja dotykowa na urządzeniach mobilnych

Opis: Jako użytkownik na urządzeniu mobilnym lub tablecie chcę poruszać się po obszarze roboczym i manipulować elementami gestami dotykowymi, aby wygodnie pracować bez myszy.

Kryteria akceptacji:

- Jedno stuknięcie (tap) na pustym obszarze canvasu: inicjuje pan (przesuwanie widoku).
- Podwójne stuknięcie (double tap) na pustym obszarze: aktywuje selection marquee.
- Podwójne stuknięcie (double tap) na elemencie: umożliwia przesuwanie tego elementu.
- Jeśli element jest już zaznaczony: pojedyncze stuknięcie na zaznaczony element inicjuje jego przesuwanie (bez potrzeby podwójnego tap).
- Pojedyncze stuknięcie na uchwyt modyfikacji (Adjustment Handle lub uchwyt obrotu): aktywuje ten uchwyt (działa tak samo jak kliknięcie myszką w trybie domyślnym na desktopie).
- Gest pinch (zbliżanie/rozszerzanie dwóch palców): zoom in/out.
- Gesty są responsywne i płynne (≥ 30 FPS).
- Pan i zoom dotykowy są ograniczone do granic obszaru roboczego.

---

US-017
Tytuł: Przełączanie dark mode / light mode

Opis: Jako użytkownik chcę przełączać motyw wizualny aplikacji między ciemnym a jasnym, aby dostosować go do swoich preferencji.

Kryteria akceptacji:

- Przycisk przełączania trybu jest dostępny w interfejsie.
- Przełączenie zmienia motyw całej aplikacji (UI i canvas).
- Wybór jest zapamiętywany między sesjami (localStorage lub preferencje konta).

---

### Dodawanie i edycja prymitywów

---

US-018
Tytuł: Dodawanie elementu płaskiego (Plate) do sceny

Opis: Jako użytkownik chcę dodać element płaski z określonymi proporcjami, aby zbudować element złącza spawanego.

Kryteria akceptacji:

- Użytkownik może wybrać element płaski z biblioteki prymitywów i umieścić go na canvasie.
- Dostępne parametry proporcjonalne: szerokość i grubość.
- Parametry ustawiane suwakiem lub ręcznym wpisaniem wartości.
- Element renderowany jest proporcjonalnie na canvasie.
- Przekroczenie zakresu wyświetla inline komunikat walidacyjny.

---

US-019
Tytuł: Dodawanie rury / profilu zamkniętego — Przekrój Czołowy

Opis: Jako użytkownik chcę dodać widok czołowy rury lub profilu zamkniętego, aby wizualizować przekrój poprzeczny elementu rurowego.

Kryteria akceptacji:

- Użytkownik wybiera wariant „Przekrój Czołowy" z biblioteki (kategoria Hollow Sections / Tubes).
- Element jest wizualizowany jako pierścień (koło wewnątrz koła).
- Dostępne parametry proporcjonalne: średnica zewnętrzna i grubość ścianki.
- System waliduje, że grubość ścianki < średnica zewnętrzna / 2 − 1; w przypadku naruszenia wyświetla komunikat inline.
- Element renderowany jest proporcjonalnie na canvasie.

---

US-020
Tytuł: Dodawanie rury / profilu zamkniętego — Przekrój Podłużny

Opis: Jako użytkownik chcę dodać widok podłużny (boczny) rury lub profilu zamkniętego, aby wizualizować ścianki rury w rzucie prostokątnym.

Kryteria akceptacji:

- Użytkownik wybiera wariant „Przekrój Podłużny" z biblioteki (kategoria Hollow Sections / Tubes).
- Element jest wizualizowany jako prostokąt z naniesioną osią symetrii i oznaczeniem parametru średnicy.
- Dostępne parametry proporcjonalne: długość, średnica zewnętrzna i grubość ścianki.
- System waliduje warunek grubości ścianki analogicznie jak w US-019.
- Element renderowany jest proporcjonalnie na canvasie.

---

US-021
Tytuł: Dodawanie profilu standardowego (I, C, L, T)

Opis: Jako użytkownik chcę dodać profil stalowy (I, C, L lub T) z konfigurowanymi proporcjami, aby zbudować złącze profilowe.

Kryteria akceptacji:

- Użytkownik może wybrać typ profilu (I, C, L lub T) z biblioteki.
- Dostępne parametry proporcjonalne zależne od kształtu profilu są edytowalne suwakiem i ręcznie.
- Profil renderowany jest proporcjonalnie na canvasie zgodnie z wybranymi wymiarami.
- Przekroczenie zakresów wyświetla inline komunikat walidacyjny.

---

US-022
Tytuł: Definiowanie ukosowania elementu

Opis: Jako użytkownik chcę zdefiniować rodzaj ukosowania krawędzi elementu, aby precyzyjnie odwzorować geometrię złącza spawanego.

Kryteria akceptacji:

- Dla każdego prymitywu dostępny jest wybór ukosowania: brak / jednostronne (V/Y) / dwustronne (X/K).
- Ukosowanie jednostronne: parametry kąt (0°–80°, krok 0,5°) i wysokość.
- Ukosowanie dwustronne: niezależne kąty górny i dolny (0°–80°) i wysokość.
- Zmiana ukosowania jest natychmiast odzwierciedlana na canvasie.
- Przekroczenie zakresu kąta wyświetla komunikat: „Kąt ukosowania musi być między 0° a 80°".

---

US-023
Tytuł: Edycja parametrów istniejącego elementu

Opis: Jako użytkownik chcę edytować wymiary elementu już umieszczonego na scenie, aby poprawić lub zaktualizować projekt.

Kryteria akceptacji:

- Kliknięcie (lub dotknięcie) elementu otwiera panel właściwości z jego aktualnymi parametrami.
- Zmiana wartości (suwakiem lub ręcznie) jest natychmiast widoczna na canvasie.
- Czas reakcji od zmiany do aktualizacji widoku: < 200 ms.
- Wszystkie reguły walidacji obowiązują podczas edycji.

---

US-024
Tytuł: Modyfikacja elementu za pomocą uchwytów krawędziowych (Adjustment Handles)

Opis: Jako użytkownik chcę przeciągać interaktywne uchwyty na krawędziach elementu, aby szybko zmieniać jego kształt bezpośrednio na canvasie.

Kryteria akceptacji:

- Na krawędziach każdego elementu widoczne są interaktywne uchwyty modyfikacji.
- Przeciągnięcie uchwytu krawędziowego rozciąga element wzdłuż danej osi i aktualizuje odpowiadające parametry w panelu właściwości.
- Dla kształtów złożonych (np. profile C, T) przeciągnięcie uchwytu może automatycznie przeliczać zależne parametry w celu zachowania ciągłości geometrycznej.
- Zmiana jest natychmiast widoczna na canvasie (< 200 ms).
- Operacja jest cofalna przez Undo.

---

US-025
Tytuł: Przesuwanie elementu na canvasie

Opis: Jako użytkownik chcę przesuwać elementy metodą drag & drop, aby ułożyć złącze zgodnie z projektem.

Kryteria akceptacji:

- W trybie kursora domyślnego (strzałka) element można przeciągnąć w dowolne miejsce na canvasie.
- Podczas przeciągania aktywny SNAP może przykleić element do równoległej ścianki innego elementu (edge-snap z attachmentem); po przyklejeniu element ślizga się wzdłuż napotkanej krawędzi do momentu wyraźnego ruchu prostopadłego, który zrywa attachment (szczegóły w US-027b).
- Elementy scalone połączeniem spawalniczym przesuwają się jako jednostka — przesunięcie jednego przesuwa całą grupę.
- Czas reakcji przesunięcia: < 200 ms.

---

US-026
Tytuł: Obracanie elementu za pomocą uchwytu narożnego

Opis: Jako użytkownik chcę obrócić element lub grupę elementów, aby ułożyć je w poprawnej orientacji.

Kryteria akceptacji:

- Na rogu zaznaczonego elementu lub grupy wyświetlany jest uchwyt obrotu (ikona kółka).
- Najechanie kursorem na uchwyt zmienia kursor na kursor obrotu.
- Przeciągnięcie uchwytu obraca element lub grupę względem środka zaznaczenia.
- W przypadku zaznaczonej grupy elementów obracana jest cała grupa jako jednostka.
- Obrót jest dodatkowo dostępny jako pole kąta w panelu właściwości (wpisanie wartości lub suwak).
- Obrót jest natychmiast odzwierciedlany na canvasie.

---

US-027
Tytuł: Korzystanie z SNAP magnetycznego

Opis: Jako użytkownik chcę, aby elementy przyciągały się do krawędzi i wierzchołków innych elementów, aby precyzyjnie złączyć geometrię.

Kryteria akceptacji:

- SNAP jest domyślnie aktywny po uruchomieniu aplikacji.
- Toggle button w UI (podświetlony = aktywny) umożliwia ręczne włączenie/wyłączenie obu trybów SNAP jednocześnie.
- Przytrzymanie dedykowanego klawisza tymczasowo wyłącza SNAP; stan przycisku zmienia się synchronicznie. Wyłączenie zrywa również aktywny edge-snap attachment.
- Zwolnienie klawisza przywraca poprzedni stan SNAP.
- Podczas aktywnego SNAP system zapewnia dwa współistniejące tryby:
  - *point-snap*: kursor / punkt referencyjny przyciąga się do dyskretnych punktów anchor (środki ścianek, narożniki, środki kół) — wykorzystywany m.in. podczas wstawiania połączenia spawalniczego;
  - *edge-snap z attachmentem*: przeciągany element przykleja się do równoległej ścianki innego elementu i ślizga się po niej — szczegóły w US-027b.

---

US-027b
Tytuł: Przyklejanie elementu do równoległej ścianki (edge-snap z attachmentem)

Opis: Jako użytkownik chcę, aby przesuwany element automatycznie przyklejał się do równoległej ścianki innego elementu i ślizgał się po niej („jak po szynach"), dopóki świadomie go nie odkleję, aby precyzyjnie zestawiać elementy „styk w styk" bez ręcznego pozycjonowania.

Kryteria akceptacji:

- Podczas dragu elementu w trybie kursora domyślnego, gdy jakaś jego ścianka zbliża się równolegle (z niewielką tolerancją kątową) do ścianki innego elementu, system wykrywa kandydata pod warunkiem że odcinki rzutowane mają niepuste przekrycie.
- Gdy odległość prostopadła między równoległymi ściankami spada poniżej progu przyklejenia, element automatycznie przesuwa się prostopadle po najkrótszej drodze, tak aby ścianki się stykały (attachment).
- Po przyklejeniu ruch wskaźnika wzdłuż krawędzi target przesuwa element wyłącznie wzdłuż tej krawędzi; pozycja prostopadła jest zatrzaśnięta — element ślizga się po krawędzi.
- Niewielkie ruchy prostopadłe nie zrywają attachmentu (histereza). Próg zerwania jest istotnie większy od progu przyklejenia, co zapobiega drganiu „przyklej/odklej" przy ruchu w okolicy granicy.
- Wyraźny, skumulowany ruch prostopadły powyżej progu zerwania zwalnia attachment; od tej klatki element jest przeciągany swobodnie i może natychmiast utworzyć nowy attachment do innej krawędzi.
- Wyłączenie SNAP togglem lub przytrzymanie dedykowanego klawisza wyłączającego SNAP natychmiast zrywa aktywny attachment.
- Stan attached jest wizualnie sygnalizowany (np. podświetlenie krawędzi target).
- Edge-snap działa również dla zaznaczonej grupy elementów oraz dla zablokowanego połączenia spawalniczego — wykorzystywane są wyłącznie krawędzie zewnętrznego konturu zbiorczego, a pozostałe elementy grupy są wykluczone z listy targetów.
- Kształty bez prostoliniowych ścianek (np. przekrój czołowy rury) nie pełnią roli targetu edge-snap; mogą być natomiast przeciąganym elementem (przy ich wyrównywaniu działa wyłącznie point-snap).
- Operacja przesunięcia z attachmentem i jego ewentualnym zerwaniem jest cofalna przez Undo jako pojedyncza operacja przesuwania.

---

US-028
Tytuł: Zaznaczanie wielu elementów i automatyczne grupowanie

Opis: Jako użytkownik chcę zaznaczyć wiele elementów jednocześnie, aby wykonywać operacje na grupie bez potrzeby ręcznego grupowania.

Kryteria akceptacji:

- Zaznaczenie prostokątne (selection marquee) jest możliwe przez przeciągnięcie na pustym obszarze canvasu.
- Shift+klik dodaje lub usuwa element z aktywnego zaznaczenia.
- Zaznaczone elementy są wizualnie wyróżnione (ramka podświetlenia).
- Zaznaczenie wielu elementów automatycznie traktuje je jako grupę — nie jest wymagane osobne kliknięcie przycisku „Grupuj".
- Wszystkie operacje (przesuwanie, obrót, odbicie lustrzane, skalowanie) wykonywane na zaznaczeniu działają na całej grupie jednocześnie.

---

US-029
Tytuł: Cofanie i ponawianie operacji (Undo/Redo)

Opis: Jako użytkownik chcę cofać i ponawiać ostatnie operacje, aby swobodnie eksperymentować bez obawy przed nieodwracalnymi zmianami.

Kryteria akceptacji:

- Skróty klawiszowe Ctrl/Cmd+Z (undo) oraz Ctrl/Cmd+Y lub Ctrl/Cmd+Shift+Z (redo) działają poprawnie na Windows/Linux (Ctrl) i Mac (Cmd).
- Przyciski Undo/Redo są dostępne w toolbarze.
- Historia obejmuje 100 ostatnich kroków; cofnięcie poza limit nie powoduje błędu.
- Po cofnięciu operacji stan sceny jest identyczny z tym sprzed cofniętej operacji.
- Historia jest persystowana w localStorage (synchronicznie po każdej operacji); nie jest zapisywana do Supabase.

---

US-030
Tytuł: Odbicie lustrzane elementu lub grupy

Opis: Jako użytkownik chcę odbić lustrzanie element lub grupę elementów w poziomie lub pionie, aby uzyskać symetryczny układ złącza.

Kryteria akceptacji:

- W panelu właściwości dostępne są dwie opcje: „Odbij poziomo" i „Odbij pionowo".
- Operacja działa na aktualnie zaznaczonym elemencie lub grupie zaznaczonych elementów.
- Odbicie jest natychmiast odzwierciedlane na canvasie.
- Operacja jest cofalna przez Undo.

---

US-031
Tytuł: Zarządzanie kolejnością warstw elementu lub grupy (Z-index)

Opis: Jako użytkownik chcę zmieniać kolejność warstw elementów na canvasie, aby kontrolować, który element jest rysowany na wierzchu.

Kryteria akceptacji:

- W panelu właściwości dostępne są opcje zarządzania z-index: „Przesuń na wierzch", „Przesuń do tyłu", „O jedną warstwę wyżej", „O jedną warstwę niżej".
- Operacja działa na aktualnie zaznaczonym elemencie lub grupie zaznaczonych elementów.
- Zmiana kolejności warstw jest natychmiast widoczna na canvasie.
- Operacja jest cofalna przez Undo.

---

### Tryb sekwencji spawania

---

US-032
Tytuł: Wejście w tryb tworzenia połączenia spawalniczego

Opis: Jako użytkownik chcę przejść w tryb tworzenia połączenia spawalniczego, aby zdefiniować spoinę między elementami złącza.

Kryteria akceptacji:

- W toolbarze dostępny jest przycisk/toggle przełączający w tryb tworzenia połączenia spawalniczego.
- Wejście w tryb jest wizualnie sygnalizowane (podświetlenie przycisku, zmiana kursora lub inny wskaźnik).
- W aktywnym trybie nie można dodawać nowych prymitywów.
- Wyjście z trybu przywraca tryb rysowania/edycji elementów.

---

US-033
Tytuł: Wybór i umieszczenie predefiniowanego kształtu połączenia

Opis: Jako użytkownik chcę wybrać predefiniowany kształt połączenia spawalniczego i umieścić go na canvasie, aby wyznaczyć geometrię spoiny.

Kryteria akceptacji:

- Po wejściu w tryb tworzenia połączenia wyświetlana jest lista predefiniowanych kształtów połączeń.
- Użytkownik wybiera kształt z listy i umieszcza go na canvasie.
- Wstawione połączenie jest widoczne na canvasie jako edytowalny obiekt.
- Jeśli umieszczone połączenie dotyka co najmniej dwóch elementów, obok kształtu pojawia się opcja „Zablokuj połączenie z elementami".
- Jeśli połączenie nie dotyka wystarczającej liczby elementów, opcja blokady nie jest wyświetlana.

---

US-034
Tytuł: Modyfikacja kształtu połączenia za pomocą uchwytów

Opis: Jako użytkownik chcę dostosować kształt wstawionego połączenia spawalniczego za pomocą uchwytów, aby precyzyjnie dopasować geometrię spoiny do złącza.

Kryteria akceptacji:

- Na krawędziach kształtu połączenia widoczne są interaktywne uchwyty modyfikacji.
- Przeciągnięcie uchwytu zmienia kształt/wymiary połączenia, a zmiany są widoczne natychmiast.
- Można modyfikować kształt dowolną liczbę razy przed zablokowaniem i konwersją.
- Operacja jest cofalna przez Undo.

---

US-034b
Tytuł: Blokowanie i odblokowywanie połączenia spawalniczego z elementami

Opis: Jako użytkownik chcę zablokować połączenie spawalnicze z elementami, które dotyka, aby scalić je w jednostkę i odblokować dostęp do konwersji na sekwencję ściegów. Chcę też móc odblokować jednostkę bez utraty wcześniej wygenerowanej sekwencji, jeśli nie zmieniłem geometrii połączenia.

Kryteria akceptacji:

- Opcja „Zablokuj połączenie z elementami" pojawia się wyłącznie gdy kształt połączenia dotyka co najmniej dwóch elementów.
- Po kliknięciu opcji blokady powiązane elementy i kształt połączenia tworzą jednostkę — nie mogą być przesuwane niezależnie.
- Po zablokowaniu opcja zmienia się na „Odblokuj połączenie z elementami".
- Kliknięcie „Odblokuj" przywraca niezależność wszystkich elementów (każdy element i samo połączenie można chwytać i przesuwać osobno) oraz ukrywa przycisk „Konwertuj na sekwencję ściegów".
- Po odblokowaniu, jeśli wcześniej istniała sekwencja ściegów, jest ona zachowana w pamięci aplikacji (dormant) wraz z geometrią połączenia z momentu odblokowania; nie jest jednak renderowana na canvasie.
- Ponowne kliknięcie „Zablokuj" — gdy geometria połączenia nie została zmieniona od czasu odblokowania — natychmiast przywraca zapamiętaną sekwencję ściegów wraz ze wszystkimi modyfikacjami liczby warstw, ściegów i numeracji; przycisk „Konwertuj" nie pojawia się.
- Ponowne kliknięcie „Zablokuj" — gdy geometria połączenia została zmieniona od czasu odblokowania — kasuje zapamiętaną sekwencję; pojawia się przycisk „Konwertuj na sekwencję ściegów", którego kliknięcie generuje nową, domyślną sekwencję.
- Usunięcie połączenia spawalniczego lub któregokolwiek z powiązanych elementów kasuje również zapamiętaną sekwencję dormant.
- Operacja blokowania i odblokowania jest cofalna przez Undo.

---

US-035
Tytuł: Konwersja połączenia na wielowarstwową sekwencję ściegów

Opis: Jako użytkownik chcę przekonwertować zdefiniowane połączenie spawalnicze na wielowarstwową sekwencję ściegów, aby wyznaczyć kolejność i układ spawania.

Kryteria akceptacji:

- Przycisk „Konwertuj na sekwencję ściegów" jest dostępny wyłącznie po zablokowaniu połączenia z co najmniej dwoma elementami.
- Po kliknięciu przycisku połączenie zamienia się w wielowarstwową strukturę: liczba warstw wyznaczona automatycznie na podstawie rozmiaru połączenia; każda warstwa zawiera równomiernie rozmieszczone ściegi o wstępnej liczbie zależnej od szerokości warstwy.
- Jednocześnie wyświetlany jest panel boczny z wyborem kształtu ściegu.
- Konwersja jest cofalna przez Undo.

---

US-036
Tytuł: Zarządzanie ściegami w warstwie

Opis: Jako użytkownik chcę dodawać i usuwać ściegi w poszczególnych warstwach połączenia, aby precyzyjnie określić ich liczbę.

Kryteria akceptacji:

- Obok każdej warstwy widoczne są przyciski [−] (po lewej) i [+] (po prawej).
- Kliknięcie [+] dodaje jeden ścieg; ściegi w warstwie pozostają równomiernie rozmieszczone.
- Kliknięcie [−] usuwa jeden ścieg; ściegi są ponownie równomiernie rozmieszczone.
- Nie można usunąć ostatniego ściegu z warstwy (minimum 1).
- Operacje są cofalne przez Undo.

---

US-037
Tytuł: Zarządzanie warstwami połączenia

Opis: Jako użytkownik chcę dodawać i usuwać warstwy połączenia spawalniczego, aby dostosować ich liczbę do specyfiki złącza.

Kryteria akceptacji:

- Dostępne są przyciski dodania nowej warstwy i usunięcia istniejącej.
- Nowa warstwa jest dodawana z domyślną liczbą ściegów zależną od jej szerokości.
- Nie można usunąć ostatniej warstwy (minimum 1).
- Operacje są cofalne przez Undo.

---

US-038
Tytuł: Wybór kształtu ściegu

Opis: Jako użytkownik chcę wybrać kształt pojedynczego ściegu w sekwencji spawania, aby graficznie odwzorować typ spoiny.

Kryteria akceptacji:

- Panel wyboru kształtu ściegu pojawia się automatycznie w momencie konwersji połączenia na sekwencję warstw.
- Dostępne są co najmniej dwa podstawowe kształty ściegu: trójkąt z zaokrąglonymi wierzchołkami oraz trapez z zaokrąglonymi wierzchołkami, a także inne dostępne warianty.
- Wybrany kształt jest natychmiast stosowany do wszystkich ściegów w sekwencji.
- Można zmienić kształt ściegu po konwersji, wchodząc ponownie w tryb edycji połączenia.

---

US-039
Tytuł: Zachowanie zablokowanych elementów jako jednostki

Opis: Jako użytkownik chcę, aby elementy zablokowane połączeniem spawalniczym poruszały się razem, co odzwierciedla rzeczywistość spawanego złącza.

Kryteria akceptacji:

- Po zablokowaniu połączenia spawalniczego z elementami powiązane elementy nie mogą być przesuwane niezależnie.
- Próba przeciągnięcia jednego z powiązanych elementów przesuwa całą jednostkę (oba elementy + połączenie).
- Zachowanie dotyczy również obracania całej jednostki.
- Przed zablokowaniem wszystkie elementy (w tym kształt połączenia) mogą być przesuwane niezależnie.

---

US-040
Tytuł: Usuwanie połączenia spawalniczego

Opis: Jako użytkownik chcę usunąć niepotrzebne połączenie spawalnicze ze sceny.

Kryteria akceptacji:

- Zaznaczone połączenie spawalnicze można usunąć klawiszem Delete/Backspace lub przyciskiem w panelu.
- Usunięcie połączenia przywraca możliwość niezależnego przesuwania dotychczas powiązanych elementów.
- Jeśli połączenie było zablokowane z elementami, usunięcie automatycznie je odblokowuje przed usunięciem.
- Operacja jest cofalna przez Undo.
- Usunięte połączenie zwalnia 1 slot w liczniku elementów planu.

---

### Eksport dokumentacji

---

US-041
Tytuł: Eksport złącza do PNG

Opis: Jako użytkownik chcę wyeksportować złącze do pliku PNG, aby dołączyć dokumentację do raportu lub przekazać klientowi.

Kryteria akceptacji:

- Przycisk eksportu do PNG jest dostępny w toolbarze lub menu.
- Eksport przechwytuje cały obszar roboczy lub zaznaczony region sceny.
- Wyeksportowany plik PNG otwiera się poprawnie i zawiera proporcjonalne renderowanie złącza.
- Dla planów Guest i Free plik zawiera semi-transparentny watermark po przekątnej.
- Plan Pro nie zawiera watermarku.
- Eksport pustej sceny jest zablokowany; wyświetlany jest toast.

---

US-042
Tytuł: Eksport złącza do JPG

Opis: Jako użytkownik chcę wyeksportować złącze do pliku JPG.

Kryteria akceptacji:

- Przycisk eksportu do JPG jest dostępny.
- Wyeksportowany plik JPG otwiera się poprawnie i zawiera proporcjonalne renderowanie złącza.
- Warunki dotyczące watermarku i pustej sceny są takie same jak dla PNG (US-041).

---

US-043
Tytuł: Eksport z warstwą opisową (numeracja i legenda)

Opis: Jako użytkownik chcę wyeksportować złącze z numeracją warstw/ściegów i legendą tekstową, aby dokument był kompletny.

Kryteria akceptacji:

- Przed eksportem użytkownik może włączyć/wyłączyć opcję „dołącz warstwę opisową".
- Gdy opcja jest włączona, wyeksportowany plik zawiera numerację warstw i ściegów oraz legendę tekstową.
- Gdy opcja jest wyłączona, wyeksportowany plik zawiera wyłącznie rysunek bez opisu.
- Obie wersje otwierają się poprawnie.

---

### Subskrypcja i płatności

---

US-044
Tytuł: Przeglądanie planów subskrypcji

Opis: Jako użytkownik chcę zobaczyć dostępne plany subskrypcji (Free / Pro) z ich limitami i cenami, aby podjąć świadomą decyzję o upgrade.

Kryteria akceptacji:

- Strona z planami jest dostępna z poziomu aplikacji (np. z menu konta lub banera).
- Tabela planów wyświetla limity elementów, projektów, watermark i ceny.
- Plan Pro wyświetla ceny: 49 PLN/mies. i 399 PLN/rok.

---

US-045
Tytuł: Upgrade do planu Pro

Opis: Jako użytkownik Free chcę zakupić plan Pro, aby usunąć watermark i limity.

Kryteria akceptacji:

- Przycisk „Upgrade do Pro" jest dostępny na stronie planów i w komunikatach o przekroczeniu limitu.
- Kliknięcie przekierowuje do procesu płatności przez Paddle.
- Po udanej płatności plan użytkownika jest zaktualizowany do Pro.
- Watermark przestaje być nakładany na nowe eksporty.
- Limity elementów i projektów są zniesione.

---

US-046
Tytuł: Komunikat o przekroczeniu limitu elementów

Opis: Jako użytkownik Guest lub Free chcę być poinformowany o przekroczeniu limitu elementów, aby wiedzieć, że mogę zupgradować plan.

Kryteria akceptacji:

- Próba dodania elementu (prymitywu lub połączenia spawalniczego) powyżej limitu 3 blokuje akcję — dotyczy zarówno planu Guest, jak i Free.
- Wyświetlany jest toast z informacją o limicie i linkiem/przyciskiem CTA do upgrade (dla gościa — do rejestracji/upgrade).
- Operacja nie jest wykonana.

---

US-047
Tytuł: Komunikat o przekroczeniu limitu projektów

Opis: Jako użytkownik Free chcę być poinformowany o przekroczeniu limitu projektów, aby wiedzieć o możliwości upgrade.

Kryteria akceptacji:

- Próba zapisania nowego projektu po osiągnięciu limitu 1 projektu w chmurze blokuje akcję.
- Wyświetlany jest toast z informacją o limicie i CTA do upgrade.

---

### Walidacja i obsługa błędów

---

US-048
Tytuł: Walidacja wartości parametrów w panelu właściwości

Opis: Jako użytkownik chcę być natychmiast poinformowany o błędnej wartości parametru, aby szybko ją poprawić.

Kryteria akceptacji:

- Wpisanie wartości poza dopuszczalnym zakresem podświetla pole na czerwono i wyświetla komunikat inline.
- Nieprawidłowa wartość nie jest przyjmowana — element nie zmienia geometrii.
- Po poprawieniu wartości komunikat znika.

---

US-049
Tytuł: Walidacja przy eksporcie pustej sceny

Opis: Jako użytkownik chcę być poinformowany, gdy próbuję wyeksportować pustą scenę.

Kryteria akceptacji:

- Próba eksportu bez żadnych elementów na scenie wyświetla toast z komunikatem.
- Eksport nie jest wykonywany.

---

### Wielojęzyczność

---

US-050
Tytuł: Wybór języka interfejsu

Opis: Jako użytkownik chcę wybrać język interfejsu (PL lub EN), aby korzystać z aplikacji w preferowanym języku.

Kryteria akceptacji:

- Przełącznik języka (PL/EN) jest dostępny w interfejsie (np. w nagłówku lub ustawieniach).
- Po zmianie języka cały interfejs przełącza się na wybrany język, w tym komunikaty walidacyjne i toasty.
- Wybór języka jest zapamiętywany między sesjami.

---

### Zgodność prawna

---

US-051
Tytuł: Wyświetlanie cookie consent i akceptacja polityki prywatności

Opis: Jako nowy odwiedzający chcę zobaczyć informację o cookies i mieć możliwość zaakceptowania polityki prywatności, aby wiedzieć, jak przetwarzane są moje dane.

Kryteria akceptacji:

- Przy pierwszej wizycie wyświetlany jest cookie consent banner.
- Użytkownik może zaakceptować lub odrzucić cookies (nieobowiązkowe).
- Linki do Polityki Prywatności i Regulaminu są dostępne w stopce i przy rejestracji.
- Checkbox zgody przy rejestracji jest obowiązkowy.

---

## 6. Metryki sukcesu


| Kryterium                    | Miara                                                                                                                    | Metoda pomiaru                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------- |
| Czas tworzenia złącza        | Użytkownik początkujący tworzy złącze 3-elementowe, definiuje sekwencję spawania i eksportuje PNG w < 10 minut          | Testy użytkowników (sesje obserwacyjne lub nagrania)                |
| Wydajność renderowania       | ≥ 30 FPS przy typowych scenariuszach na komputerach nie starszych niż 10 lat                                             | Lighthouse CI / manualne testy FPS na testowych urządzeniach        |
| Czas reakcji UI              | < 200 ms dla podstawowych operacji: dodanie elementu, zmiana wymiaru, obrót, SNAP, modyfikacja uchwytami                 | Testy wydajnościowe (Artillery / WebPageTest / Playwright)          |
| Ocena łatwości obsługi       | ≥ 80% użytkowników testowych ocenia łatwość obsługi jako „łatwą" lub „bardzo łatwą"                                      | Kwestionariusz po sesji testowej (skala Likerta lub SUS)            |
| Fidelity zapisu JSON         | 100% przypadków: wczytanie zapisanego projektu odtwarza scenę bez utraty danych                                          | Testy automatyczne (Vitest / Playwright — zapis i porównanie sceny) |
| Poprawność eksportu          | Wyeksportowany plik PNG/JPG otwiera się poprawnie i zawiera: rysunek, opcjonalną numerację i legendę                    | Testy automatyczne + manualna weryfikacja próbek                    |
| Konwersja gość → rejestracja | Wskaźnik rejestracji wśród sesji gościa (cel do określenia po beta)                                                      | Analityka (Plausible/GA — do wyboru po MVP)                         |
| Konwersja Free → Pro         | Wskaźnik upgrade do Pro wśród aktywnych użytkowników Free (cel do określenia po beta)                                    | Analityka + dane z Paddle                                           |


---

