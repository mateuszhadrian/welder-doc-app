# Dokument wymagań produktu (PRD) - WelderDoc

## 1. Przegląd produktu

WelderDoc to przeglądarkowa aplikacja SaaS przeznaczona dla inżynierów spawalników i technologów produkcji. Umożliwia szybkie tworzenie proporcjonalnych przekrojów złączy spawanych, planowanie sekwencji spawania oraz eksport dokumentacji graficznej — bez instalacji i bez wymagania znajomości narzędzi CAD.

Aplikacja działa w modelu subskrypcyjnym (Free/Pro) z opcją korzystania jako gość. Zbudowana jest na stosie Next.js (App Router) + React + TypeScript z silnikiem canvas Konva.js, backendem Supabase (PostgreSQL, EU region) i hostingiem na Cloudflare Pages.

Punkt referencyjny produktowy: Weldia (weldia.app), jednak z radykalnym uproszczeniem do obsługi pojedynczego złącza/mocowania przez użytkownika bez tła CAD.

Wersja MVP dostarczana jako aplikacja desktopowa działająca na Chrome, Edge, Firefox i Safari (bez instalacji). Obsługa urządzeń mobilnych i tabletów poza zakresem MVP.

---

## 2. Problem użytkownika

Inżynierowie spawalnicy oraz technolodzy produkcji nie mają dostępu do prostego, przystępnego cenowo i dedykowanego narzędzia do tworzenia przekrojów złączy spawanych oraz planowania sekwencji spawania.

Obecne alternatywy i ich wady:

- Ogólne programy CAD (AutoCAD, Catia, Inventor, SolidWorks): zbyt skomplikowane, czasochłonne, wymagają wysokich kompetencji technicznych i są kosztowne.
- Edytory graficzne (Paint, Word z clipartami): niskiej jakości wyniki, brak parametryczności, brak dedykowanych prymitywów spawalniczych.
- Ręczne szkice: nieprecyzyjne, trudne do edycji i nienadające się do dokumentacji przekazywanej klientom.

Konsekwencje: przygotowanie dokumentacji technicznej jest czasochłonne, podatne na błędy i daje efekty o niskiej jakości wizualnej. Specjaliści potrzebują narzędzia, które pozwoli technikowi bez doświadczenia CAD stworzyć czytelną dokumentację złącza spawanego i sekwencji spawania w mniej niż 10 minut.

---

## 3. Wymagania funkcjonalne

### 3.1 System kont i plany subskrypcji

| Plan | Prymitywy na scenie | Projekty w chmurze | Watermark | Eksport |
|---|---|---|---|---|
| Gość (Guest) | max 5 | 0 (wyłącznie localStorage) | tak | PNG/JPG |
| Free | max 15 | 3 | tak | PNG/JPG |
| Pro | bez limitu | bez limitu | nie | PNG/JPG |

- Limit dotyczy wyłącznie prymitywów (`plate`, `pipe`, `profile`); obiekty `weld` i `group` nie są wliczane.
- Dostawca płatności MVP: Paddle (Merchant of Record).
- Ceny robocze (do walidacji z beta-użytkownikami): Pro Monthly 49 PLN, Pro Annual 399 PLN (ok. 32% zniżki).
- Rejestracja i logowanie wymagane dla planów Free i Pro; gość nie zakłada konta.

### 3.2 Uwierzytelnianie i autoryzacja

- Rejestracja e-mail + hasło (oraz opcjonalnie OAuth przez Supabase Auth).
- Logowanie i wylogowanie.
- Odzyskiwanie hasła (reset przez e-mail).
- Tryb gościa: autozapis lokalny (localStorage), baner CTA zachęcający do rejestracji, brak dostępu do chmury.
- Zabezpieczenie tras chronionych przed dostępem bez sesji.

### 3.3 Canvas i nawigacja

- Infinite canvas z możliwością pana (przeciąganie tłem) i zoomu (kółko myszy / gesty trackpad).
- Miniatura widoku (minimap) pokazująca aktualną pozycję w przestrzeni canvasu.
- Proporcjonalne renderowanie geometrii (nie schematyczne).
- Silnik 2D: Konva.js (decyzja ADR-001, zaakceptowana 2026-04-22) implementowany przez `react-konva`.

### 3.4 Biblioteka prymitywów parametrycznych

Dostępne typy elementów:

- Płyta prostokątna: parametry szerokość (5–2000 mm, krok 0,1 mm) i grubość (1–200 mm, krok 0,1 mm).
- Rura: parametry średnica zewnętrzna (5–500 mm) i grubość ścianki (1–50 mm; warunek: grubość ścianki < OD/2 − 1).
- Profil L/C/I: konfigurowalne wymiary w zależności od wybranego kształtu profilu.

Ukosowania (dla każdego prymitywu):

- Brak ukosowania: krawędź prosta, bez parametrów kątowych.
- Ukosowanie jednostronne (typ V lub Y): kąt ukosu (0°–80°, krok 0,5°) i wysokość całkowita.
- Ukosowanie dwustronne (typ X lub K): niezależne kąty górny i dolny (0°–80°) i wysokość całkowita.

### 3.5 Manipulacja i parametryzacja elementów

- Suwaki z dokładnością 0,1 mm dla wszystkich parametrów wymiarowych.
- Ręczne wpisywanie wartości liczbowych w polach wejściowych.
- Przełączanie jednostek: mm / cale / niestandardowe.
- Przesuwanie elementów (drag & drop na canvasie).
- Obrót o zadaną wartość kątową.
- SNAP magnetyczny do krawędzi i wierzchołków innych elementów — domyślnie aktywny:
  - Toggle button w UI (podświetlony gdy aktywny).
  - Klawisz klawiatury: przytrzymanie = chwilowe wyłączenie (przycisk synchronicznie zmienia stan wizualny); zwolnienie = powrót do poprzedniego stanu.
- Multi-select: zaznaczenie obszarem (lasso/prostokąt) lub Shift+klik.
- Grupowanie: zaznaczone elementy → jedna grupa; grupa porusza się, obraca i skaluje jako jeden obiekt; brak edycji wewnątrz grupy w MVP.
- Undo/Redo: głębokość 20 kroków historii (Command Pattern lub Zustand temporal middleware).

### 3.6 Tryb sekwencji spawania

- Osobny tryb wstawiania ściegów (toggle/przycisk), niezależny od trybu rysowania elementów.
- Kształt symbolu ściegu do wyboru: elipsa lub kółko.
- Wstawianie symbolu ściegu na canvasie.
- Skalowanie i przesuwanie wstawionego ściegu.
- Edycja ściegu: klik na ścieg = wejście w tryb edycji.
- Numeracja ściegów: ręczna lub automatyczna (1, 2, 3… albo A, B, C…), wybierana przez użytkownika.
- Post-MVP: modyfikacja kształtu ściegu (spłaszczenia, wklęsłości, wypukłości), tworzenie sekwencji z jednego ściegu bazowego.

### 3.7 Eksport dokumentacji

- Formaty MVP: PNG i JPG.
- Warstwa opisowa (numeracja ściegów, legenda tekstowa): opcjonalna; rysunek eksportowalny samodzielnie bez opisu.
- Watermark (semi-transparentny tekst po przekątnej obrazu): nakładany dla planów Guest i Free.
- Eksport do PDF: wyłączony z MVP.
- Architektura compositing: region capture niezależny od bieżącego viewport transform (infinite canvas).
- Walidacja przed eksportem: blokada eksportu pustej sceny z komunikatem toast.

### 3.8 Zarządzanie projektami

- Zapis projektu (scena JSON) w Supabase dla planów Free i Pro.
- Wczytywanie projektu ze zbioru projektów użytkownika.
- Płaska lista projektów: nazwa, data modyfikacji, akcje: otwórz / usuń / duplikuj.
- Lokalny autozapis dla trybu gościa (localStorage) — scena odtwarzana przy kolejnym otwarciu przeglądarki.
- Udostępnianie linkiem (link-sharing): poza MVP; schemat bazy danych powinien zawierać pole `shareToken` z myślą o przyszłej implementacji.

### 3.9 UX i interfejs

- Dark mode i Light mode — oba dostępne w MVP.
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

- Przeglądarkowa aplikacja desktopowa (Chrome, Edge, Firefox, Safari).
- Biblioteka prymitywów: płyta, rura, profil L/C/I z ukosowaniami.
- Manipulacja: przesuwanie, obrót, zoom, SNAP, grupowanie, multi-select, undo/redo.
- Tryb sekwencji spawania z numeracją ściegów.
- Eksport PNG i JPG (z watermarkiem dla Guest/Free, bez dla Pro).
- Zarządzanie projektami (zapis/wczytanie JSON w chmurze dla Free/Pro; localStorage dla gościa).
- System kont: Guest / Free / Pro z płatnościami przez Paddle.
- Dark mode i Light mode.
- Wielojęzyczność PL/EN.
- GDPR minimum: Polityka Prywatności, Regulamin, cookie consent, checkbox zgody.

### Poza zakresem MVP

- Wersja offline (PWA) i obsługa tabletów / smartfonów.
- Import/eksport DXF, SVG, DWG i innych formatów CAD.
- Eksport do PDF.
- Zaawansowane narzędzia wymiarowania i tolerancji.
- Walidacja kolizji geometrycznych.
- Walidacja zgodności z normami ISO 2553 / AWS A2.4.
- Biblioteka szablonów użytkownika.
- Udostępnianie projektu linkiem.
- Modyfikacja kształtu ściegu (spłaszczenia, wklęsłości).
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
- Formularz "zapomniałem hasła" przyjmuje adres e-mail.
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
- Gość może dodać maksymalnie 5 prymitywów na scenie; próba dodania szóstego blokuje akcję i wyświetla toast z CTA do rejestracji.
- Scena jest automatycznie zapisywana w localStorage.
- Eksport PNG/JPG zawiera watermark.
- Wyświetlany jest baner zachęcający do rejestracji.
- Zapis do chmury jest niedostępny.

---

US-006
Tytuł: Odtworzenie sceny gościa po ponownym otwarciu przeglądarki

Opis: Jako powracający gość chcę zastać poprzednią scenę odtworzoną z localStorage, aby nie tracić pracy mimo braku konta.

Kryteria akceptacji:
- Po ponownym otwarciu aplikacji w tej samej przeglądarce scena jest odtworzona dokładnie tak jak przy ostatnim zamknięciu.
- Wszystkie elementy, pozycje, parametry i ściegi są zachowane.
- Wyświetlany jest baner zachęcający do rejestracji (opcjonalnie z informacją o odtworzonej scenie).

---

### Zarządzanie projektami

---

US-007
Tytuł: Tworzenie nowego projektu

Opis: Jako zalogowany użytkownik chcę utworzyć nowy projekt, aby zacząć pracę nad nowym złączem spawanym.

Kryteria akceptacji:
- Przycisk "Nowy projekt" jest dostępny na liście projektów.
- Kliknięcie otwiera pusty canvas z domyślną nazwą projektu.
- Projekt pojawia się na liście projektów użytkownika po pierwszym zapisaniu.
- Użytkownik Free nie może przekroczyć limitu 3 projektów; próba wyświetla komunikat o limicie z CTA do upgrade.

---

US-008
Tytuł: Zapisywanie projektu w chmurze

Opis: Jako zalogowany użytkownik Free lub Pro chcę zapisać projekt w chmurze, aby móc do niego wrócić z dowolnego urządzenia desktopowego.

Kryteria akceptacji:
- Przycisk "Zapisz" jest dostępny podczas pracy na canvasie.
- Po zapisaniu pojawia się potwierdzenie (toast lub wskaźnik w UI).
- Scena JSON jest zapisana w Supabase i w pełni odtwarza stan złącza przy wczytaniu.
- W przypadku błędu zapisu wyświetlany jest toast z informacją o problemie.

---

US-009
Tytuł: Wczytywanie istniejącego projektu

Opis: Jako zalogowany użytkownik chcę otworzyć istniejący projekt z listy, aby kontynuować pracę.

Kryteria akceptacji:
- Lista projektów wyświetla nazwę i datę ostatniej modyfikacji.
- Kliknięcie "Otwórz" wczytuje projekt na canvas.
- Wszystkie elementy, parametry, ukosowania, ściegi i numeracja są odtworzone bez utraty danych.
- Scena jest odtworzona w 100% przypadków (bez utraty danych).

---

US-010
Tytuł: Usuwanie projektu

Opis: Jako zalogowany użytkownik chcę usunąć projekt, którego już nie potrzebuję, aby utrzymać porządek na liście.

Kryteria akceptacji:
- Na liście projektów dostępna jest akcja "Usuń" dla każdego projektu.
- Przed usunięciem wyświetlane jest potwierdzenie (dialog/modal).
- Po potwierdzeniu projekt jest trwale usunięty z listy i z bazy danych.
- Operacja jest nieodwracalna po potwierdzeniu.

---

US-011
Tytuł: Duplikowanie projektu

Opis: Jako zalogowany użytkownik chcę zduplikować istniejący projekt, aby użyć go jako punktu startowego dla podobnego złącza.

Kryteria akceptacji:
- Na liście projektów dostępna jest akcja "Duplikuj".
- Kopia pojawia się na liście z nazwą w formacie "[oryginał] (kopia)" i aktualną datą.
- Kopia jest niezależna od oryginału — modyfikacja kopii nie zmienia oryginału.
- Limit projektów planu Free jest respektowany przy duplikowaniu.

---

US-012
Tytuł: Zmiana nazwy projektu

Opis: Jako zalogowany użytkownik chcę zmienić nazwę projektu, aby nadać mu czytelne oznaczenie.

Kryteria akceptacji:
- Nazwa projektu jest edytowalna (inline na liście lub w nagłówku canvasu).
- Zmiana jest zapisywana po zatwierdzeniu (Enter lub kliknięcie poza pole).
- Nowa nazwa jest widoczna na liście projektów.

---

### Canvas i nawigacja

---

US-013
Tytuł: Nawigacja po infinite canvas (pan i zoom)

Opis: Jako użytkownik chcę przewijać i powiększać/pomniejszać canvas, aby swobodnie poruszać się po przestrzeni roboczej.

Kryteria akceptacji:
- Pan jest realizowany przez przeciąganie tłem canvasu (kliknięcie i przeciągnięcie na wolnym miejscu).
- Zoom jest realizowany kółkiem myszy lub gestem pinch na trackpadzie.
- Canvas nie ma twardych granic (infinite canvas).
- Operacje pan i zoom działają płynnie (≥ 30 FPS).

---

US-014
Tytuł: Korzystanie z miniatury widoku (minimap)

Opis: Jako użytkownik pracujący z rozbudowaną sceną chcę widzieć miniaturę, aby orientować się w rozkładzie elementów.

Kryteria akceptacji:
- Minimap jest widoczny jako nakładka w rogu canvasu.
- Minimap pokazuje aktualne położenie viewportu na tle wszystkich elementów.
- Kliknięcie lub przeciąganie na minimapie przesuwa viewport do wybranego miejsca.

---

US-015
Tytuł: Przełączanie dark mode / light mode

Opis: Jako użytkownik chcę przełączać motyw wizualny aplikacji między ciemnym a jasnym, aby dostosować go do swoich preferencji lub warunków oświetleniowych.

Kryteria akceptacji:
- Przycisk przełączania trybu jest dostępny w interfejsie.
- Przełączenie zmienia motyw całej aplikacji (UI i canvas).
- Wybór jest zapamiętywany między sesjami (localStorage lub preferencje konta).

---

### Dodawanie i edycja prymitywów

---

US-016
Tytuł: Dodawanie płyty prostokątnej do sceny

Opis: Jako użytkownik chcę dodać płytę prostokątną z określonymi wymiarami, aby zbudować element złącza spawanego.

Kryteria akceptacji:
- Użytkownik może wybrać płytę z biblioteki prymitywów i umieścić ją na canvasie.
- Dostępne parametry: szerokość (5–2000 mm) i grubość (1–200 mm), z krokiem 0,1 mm.
- Parametry ustawiane suwakiem lub ręcznym wpisaniem wartości.
- Płyta renderowana jest proporcjonalnie na canvasie.
- Przekroczenie zakresu wyświetla inline komunikat walidacyjny.

---

US-017
Tytuł: Dodawanie rury do sceny

Opis: Jako użytkownik chcę dodać rurę z określonymi wymiarami, aby zbudować element złącza rur.

Kryteria akceptacji:
- Użytkownik może wybrać rurę z biblioteki i umieścić ją na canvasie.
- Dostępne parametry: średnica zewnętrzna (5–500 mm) i grubość ścianki (1–50 mm).
- System waliduje, że grubość ścianki < OD/2 − 1; w przypadku naruszenia wyświetla komunikat inline.
- Rura renderowana jest jako przekrój proporcjonalny (pierścień).

---

US-018
Tytuł: Dodawanie profilu L/C/I do sceny

Opis: Jako użytkownik chcę dodać profil stalowy (L, C lub I) z konfigurowanymi wymiarami, aby zbudować złącze profilowe.

Kryteria akceptacji:
- Użytkownik może wybrać typ profilu (L, C lub I) z biblioteki.
- Dostępne parametry zależne od kształtu profilu są edytowalne suwakiem i ręcznie.
- Profil renderowany jest proporcjonalnie na canvasie zgodnie z wybranymi wymiarami.
- Przekroczenie zakresów wyświetla inline komunikat walidacyjny.

---

US-019
Tytuł: Definiowanie ukosowania elementu

Opis: Jako użytkownik chcę zdefiniować rodzaj ukosowania krawędzi elementu, aby precyzyjnie odwzorować geometrię złącza spawanego.

Kryteria akceptacji:
- Dla każdego prymitywu dostępny jest wybór ukosowania: brak / jednostronne (V/Y) / dwustronne (X/K).
- Ukosowanie jednostronne: parametry kąt (0°–80°, krok 0,5°) i wysokość całkowita.
- Ukosowanie dwustronne: niezależne kąty górny i dolny (0°–80°) i wysokość całkowita.
- Zmiana ukosowania jest natychmiast odzwierciedlana na canvasie.
- Przekroczenie zakresu kąta wyświetla komunikat: „Kąt ukosowania musi być między 0° a 80°".

---

US-020
Tytuł: Edycja parametrów istniejącego elementu

Opis: Jako użytkownik chcę edytować wymiary elementu już umieszczonego na scenie, aby poprawić lub zaktualizować projekt.

Kryteria akceptacji:
- Kliknięcie elementu otwiera panel właściwości z jego aktualnymi parametrami.
- Zmiana wartości (suwakiem lub ręcznie) jest natychmiast widoczna na canvasie.
- Czas reakcji od zmiany do aktualizacji widoku: < 200 ms.
- Wszystkie reguły walidacji obowiązują podczas edycji.

---

US-021
Tytuł: Przesuwanie elementu na canvasie

Opis: Jako użytkownik chcę przesuwać elementy metodą drag & drop, aby ułożyć złącze zgodnie z projektem.

Kryteria akceptacji:
- Element można przeciągnąć w dowolne miejsce na canvasie.
- Podczas przeciągania aktywny SNAP przyciąga element do krawędzi i wierzchołków innych elementów.
- Czas reakcji przesunięcia: < 200 ms.

---

US-022
Tytuł: Obracanie elementu

Opis: Jako użytkownik chcę obrócić element o zadaną wartość kątową, aby ułożyć go w poprawnej orientacji.

Kryteria akceptacji:
- Panel właściwości zawiera pole kąta obrotu z możliwością wpisania wartości lub użycia suwaka.
- Obrót jest natychmiast odzwierciedlany na canvasie.
- Element można obrócić o dowolną wartość (0°–360°).

---

US-023
Tytuł: Korzystanie z SNAP magnetycznego

Opis: Jako użytkownik chcę, aby elementy przyciągały się do krawędzi i wierzchołków innych elementów, aby precyzyjnie złączyć geometrię.

Kryteria akceptacji:
- SNAP jest domyślnie aktywny po uruchomieniu aplikacji.
- Toggle button w UI (podświetlony = aktywny) umożliwia ręczne włączenie/wyłączenie.
- Przytrzymanie dedykowanego klawisza klawiatury tymczasowo wyłącza SNAP; stan przycisku zmienia się synchronicznie.
- Zwolnienie klawisza przywraca poprzedni stan SNAP.
- Podczas aktywnego SNAP element przyciąga się do geometrii innych elementów w zasięgu.

---

US-024
Tytuł: Zmiana jednostek miary

Opis: Jako użytkownik chcę przełączyć jednostki miary (mm / cale / niestandardowe), aby dopasować je do stosowanego standardu.

Kryteria akceptacji:
- Przełącznik jednostek jest dostępny w UI (np. w ustawieniach lub toolbarze).
- Po zmianie jednostek wszystkie wartości w panelach właściwości są przeliczone i wyświetlone w nowych jednostkach.
- Geometria na canvasie pozostaje niezmieniona (zmiana wyłącznie reprezentacji wartości).

---

US-025
Tytuł: Multi-select elementów

Opis: Jako użytkownik chcę zaznaczyć wiele elementów jednocześnie, aby wykonywać operacje na grupie.

Kryteria akceptacji:
- Zaznaczenie prostokątne (lasso) jest możliwe przez przeciągnięcie na pustym obszarze canvasu.
- Shift+klik dodaje lub usuwa element z aktywnego zaznaczenia.
- Zaznaczone elementy są wizualnie wyróżnione (np. ramka podświetlenia).
- Przesunięcie lub obrót przesuwa/obraca wszystkie zaznaczone elementy jednocześnie.

---

US-026
Tytuł: Grupowanie elementów

Opis: Jako użytkownik chcę zgrupować wybrane elementy, aby móc nimi manipulować jako jednym obiektem.

Kryteria akceptacji:
- Po zaznaczeniu wielu elementów dostępna jest opcja "Grupuj".
- Zgrupowane elementy poruszają się, obracają i skalują jako jeden obiekt.
- Grupa jest wyświetlana jako jeden byt z jedną ramką zaznaczenia.
- Dostępna jest opcja "Rozgrupuj", która przywraca elementy jako niezależne obiekty.
- Grupy nie są wliczane do limitu prymitywów.

---

US-027
Tytuł: Cofanie i ponawianie operacji (Undo/Redo)

Opis: Jako użytkownik chcę cofać i ponawiać ostatnie operacje, aby swobodnie eksperymentować bez obawy przed nieodwracalnymi zmianami.

Kryteria akceptacji:
- Skróty klawiszowe Ctrl+Z (undo) i Ctrl+Y lub Ctrl+Shift+Z (redo) działają poprawnie.
- Przyciski Undo/Redo są dostępne w toolbarze.
- Historia obejmuje 20 ostatnich kroków; cofnięcie poza limit nie powoduje błędu.
- Po cofnięciu operacji stan sceny jest identyczny z tym sprzed cofniętej operacji.

---

### Tryb sekwencji spawania

---

US-028
Tytuł: Przełączanie w tryb sekwencji spawania

Opis: Jako użytkownik chcę przejść w tryb sekwencji spawania, aby wstawiać symbole ściegów na złączu.

Kryteria akceptacji:
- W toolbarze lub menu dostępny jest przycisk/toggle przełączający w tryb sekwencji spawania.
- Wejście w tryb jest wizualnie sygnalizowane (podświetlenie przycisku, zmiana kursora lub inny indicator).
- W trybie sekwencji spawania nie można dodawać nowych prymitywów.
- Wyjście z trybu przywraca tryb rysowania/edycji elementów.

---

US-029
Tytuł: Wstawianie symbolu ściegu

Opis: Jako użytkownik chcę wstawić symbol ściegu (elipsa lub kółko) na złączu, aby oznaczyć miejsce spawania.

Kryteria akceptacji:
- W trybie sekwencji spawania kliknięcie na canvasie wstawia symbol ściegu w wybranym miejscu.
- Użytkownik może wybrać kształt symbolu: elipsa lub kółko.
- Wstawiony ścieg jest widoczny na canvasie w pozycji kliknięcia.
- Ściegi nie są wliczane do limitu prymitywów planu.

---

US-030
Tytuł: Przesuwanie i skalowanie symbolu ściegu

Opis: Jako użytkownik chcę przesunąć i zmienić rozmiar wstawionego ściegu, aby precyzyjnie dopasować go do geometrii złącza.

Kryteria akceptacji:
- Ścieg można przeciągnąć do nowej pozycji.
- Ścieg można skalować (zmiana rozmiaru przez uchwyt lub pole wartości).
- Zmiany są natychmiast widoczne na canvasie.

---

US-031
Tytuł: Numeracja ściegów

Opis: Jako użytkownik chcę ponumerować ściegi, aby wyznaczyć kolejność spawania.

Kryteria akceptacji:
- Dostępne są dwa tryby numeracji: automatyczny (1, 2, 3… lub A, B, C…) i ręczny (użytkownik wpisuje numer).
- Typ numeracji (cyfry / litery) jest wybierany przez użytkownika.
- Numer jest wyświetlany wewnątrz lub obok symbolu ściegu na canvasie.
- Zmiana numeru jest widoczna natychmiast.

---

US-032
Tytuł: Edycja symbolu ściegu

Opis: Jako użytkownik chcę edytować wstawiony symbol ściegu (numer, kształt), aby poprawić oznaczenie.

Kryteria akceptacji:
- Kliknięcie na istniejący ścieg wchodzi w tryb edycji.
- W trybie edycji można zmienić numer i kształt ściegu.
- Zmiany są potwierdzane przez kliknięcie poza ścieg lub naciśnięcie Enter.

---

US-033
Tytuł: Usuwanie symbolu ściegu

Opis: Jako użytkownik chcę usunąć niepotrzebny symbol ściegu ze sceny.

Kryteria akceptacji:
- Zaznaczony ścieg można usunąć klawiszem Delete/Backspace lub przyciskiem w panelu.
- Operacja jest cofalna przez Undo.

---

### Eksport dokumentacji

---

US-034
Tytuł: Eksport złącza do PNG

Opis: Jako użytkownik chcę wyeksportować złącze do pliku PNG, aby dołączyć dokumentację do raportu lub przekazać klientowi.

Kryteria akceptacji:
- Przycisk eksportu do PNG jest dostępny w toolbarze lub menu.
- Eksport przechwytuje cały region sceny niezależnie od aktualnego viewport.
- Wyeksportowany plik PNG otwiera się poprawnie i zawiera proporcjonalne renderowanie złącza.
- Dla planów Guest i Free plik zawiera semi-transparentny watermark po przekątnej.
- Plan Pro nie zawiera watermarku.
- Eksport pustej sceny jest zablokowany; wyświetlany jest toast.

---

US-035
Tytuł: Eksport złącza do JPG

Opis: Jako użytkownik chcę wyeksportować złącze do pliku JPG.

Kryteria akceptacji:
- Przycisk eksportu do JPG jest dostępny.
- Wyeksportowany plik JPG otwiera się poprawnie i zawiera proporcjonalne renderowanie złącza.
- Warunki dotyczące watermarku i pustej sceny są takie same jak dla PNG (US-034).

---

US-036
Tytuł: Eksport z warstwą opisową (numeracja i legenda)

Opis: Jako użytkownik chcę wyeksportować złącze z numeracją ściegów i legendą tekstową, aby dokument był kompletny.

Kryteria akceptacji:
- Przed eksportem użytkownik może włączyć/wyłączyć opcję "dołącz warstwę opisową".
- Gdy opcja jest włączona, wyeksportowany plik zawiera numerację ściegów i legendę tekstową.
- Gdy opcja jest wyłączona, wyeksportowany plik zawiera wyłącznie rysunek bez opisu.
- Obie wersje (z opisem i bez) otwierają się poprawnie.

---

### Subskrypcja i płatności

---

US-037
Tytuł: Przeglądanie planów subskrypcji

Opis: Jako użytkownik chcę zobaczyć dostępne plany subskrypcji (Free / Pro) z ich limitami i cenami, aby podjąć świadomą decyzję o upgrade.

Kryteria akceptacji:
- Strona z planami jest dostępna z poziomu aplikacji (np. z menu konta lub banera).
- Tabela planów wyświetla limity elementów, projektów, watermark i ceny.
- Plan Pro wyświetla ceny: 49 PLN/mies. i 399 PLN/rok.

---

US-038
Tytuł: Upgrade do planu Pro

Opis: Jako użytkownik Free chcę zakupić plan Pro, aby usunąć watermark i limity.

Kryteria akceptacji:
- Przycisk "Upgrade do Pro" jest dostępny na stronie planów i w komunikatach o przekroczeniu limitu.
- Kliknięcie przekierowuje do procesu płatności przez Paddle.
- Po udanej płatności plan użytkownika jest zaktualizowany do Pro.
- Watermark przestaje być nakładany na nowe eksporty.
- Limity elementów i projektów są zniesione.

---

US-039
Tytuł: Komunikat o przekroczeniu limitu elementów

Opis: Jako użytkownik Guest lub Free chcę być poinformowany o przekroczeniu limitu elementów, aby wiedzieć, że mogę zupgradować plan.

Kryteria akceptacji:
- Próba dodania elementu powyżej limitu (5 dla Guest, 15 dla Free) blokuje akcję.
- Wyświetlany jest toast z informacją o limicie i linkiem/przyciskiem CTA do upgrade.
- Operacja nie jest wykonana.

---

US-040
Tytuł: Komunikat o przekroczeniu limitu projektów

Opis: Jako użytkownik Free chcę być poinformowany o przekroczeniu limitu projektów (3 projekty), aby wiedzieć o możliwości upgrade.

Kryteria akceptacji:
- Próba zapisania nowego projektu po osiągnięciu limitu 3 projektów blokuje akcję.
- Wyświetlany jest toast z informacją o limicie i CTA do upgrade.

---

### Walidacja i obsługa błędów

---

US-041
Tytuł: Walidacja wartości liczbowych w panelu właściwości

Opis: Jako użytkownik chcę być natychmiast poinformowany o błędnej wartości parametru, aby szybko ją poprawić.

Kryteria akceptacji:
- Wpisanie wartości poza dopuszczalnym zakresem podświetla pole na czerwono i wyświetla komunikat inline (np. „Grubość musi być między 1 a 200 mm").
- Nieprawidłowa wartość nie jest przyjmowana — element nie zmienia geometrii.
- Po poprawieniu wartości komunikat znika.

---

US-042
Tytuł: Walidacja przy eksporcie pustej sceny

Opis: Jako użytkownik chcę być poinformowany, gdy próbuję wyeksportować pustą scenę.

Kryteria akceptacji:
- Próba eksportu bez żadnych elementów na scenie wyświetla toast z komunikatem.
- Eksport nie jest wykonywany.

---

### Wielojęzyczność

---

US-043
Tytuł: Wybór języka interfejsu

Opis: Jako użytkownik chcę wybrać język interfejsu (PL lub EN), aby korzystać z aplikacji w preferowanym języku.

Kryteria akceptacji:
- Przełącznik języka (PL/EN) jest dostępny w interfejsie (np. w nagłówku lub ustawieniach).
- Po zmianie języka cały interfejs przełącza się na wybrany język, w tym komunikaty walidacyjne i toasty.
- Wybór języka jest zapamiętywany między sesjami.

---

### Zgodność prawna

---

US-044
Tytuł: Wyświetlanie cookie consent i akceptacja polityki prywatności

Opis: Jako nowy odwiedzający chcę zobaczyć informację o cookies i mieć możliwość zaakceptowania polityki prywatności, aby wiedzieć, jak przetwarzane są moje dane.

Kryteria akceptacji:
- Przy pierwszej wizycie wyświetlany jest cookie consent banner.
- Użytkownik może zaakceptować lub odrzucić cookies (nieobowiązkowe).
- Linki do Polityki Prywatności i Regulaminu są dostępne w stopce i przy rejestracji.
- Checkbox zgody przy rejestracji jest obowiązkowy.

---

## 6. Metryki sukcesu

| Kryterium | Miara | Metoda pomiaru |
|---|---|---|
| Czas tworzenia złącza | Użytkownik początkujący tworzy złącze 3-elementowe, definiuje sekwencję spawania i eksportuje PNG w < 10 minut | Testy użytkowników (sesje obserwacyjne lub nagrania) |
| Wydajność renderowania | ≥ 30 FPS przy typowych scenariuszach na komputerach nie starszych niż 10 lat | Lighthouse CI / manualne testy FPS na testowych urządzeniach |
| Czas reakcji UI | < 200 ms dla podstawowych operacji: dodanie elementu, zmiana wymiaru, obrót, SNAP | Testy wydajnościowe (Artillery / WebPageTest / Playwright) |
| Ocena łatwości obsługi | ≥ 80% użytkowników testowych ocenia łatwość obsługi jako „łatwą" lub „bardzo łatwą" | Kwestionariusz po sesji testowej (skala Likerta lub SUS) |
| Fidelity zapisu JSON | 100% przypadków: wczytanie zapisanego projektu odtwarza scenę bez utraty danych | Testy automatyczne (Vitest / Playwright — zapis i porównanie sceny) |
| Poprawność eksportu | Wyeksportowany plik PNG/JPG otwiera się poprawnie i zawiera: rysunek, opcjonalną numerację i legendę | Testy automatyczne + manualna weryfikacja próbek |
| Konwersja gość → rejestracja | Wskaźnik rejestracji wśród sesji gościa (cel do określenia po beta) | Analityka (Plausible/GA — do wyboru po MVP) |
| Konwersja Free → Pro | Wskaźnik upgrade do Pro wśród aktywnych użytkowników Free (cel do określenia po beta) | Analityka + dane z Paddle |

---

*Dokument przygotowany na podstawie sesji planowania PRD v5, 2026-04-22.*
*Wersja robocza do weryfikacji biznesowej, produktowej i prawnej przed implementacją.*
