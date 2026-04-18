# Koncepcja MVP – podstawa do stworzenia PRD

## Główny problem
Inżynierowie spawalnicy oraz technolodzy produkcji nie mają obecnie dostępu do prostego, przystępnego cenowo i dedykowanego narzędzia umożliwiającego szybkie tworzenie przekrojów złączy spawanych oraz planowanie sekwencji spawania. W praktyce korzystają z ogólnych programów CAD (np. AutoCAD, Catia, Inventor, SolidWorks), co jest zbyt skomplikowane i czasochłonne do prostych zastosowań, lub wykonują szkice ręcznie w edytorach typu Paint albo Word (gdzie można wstawiać bloki czy cliparty). Takie rozwiązania wymagają wysokich umiejętności technicznych, zajmują dużo czasu i utrudniają przygotowanie przejrzystej, czytelnej dokumentacji technicznej.

## Najmniejszy zestaw funkcjonalności (MVP)
1. **Przeglądarkowa aplikacja on-line** działająca na Chrome, Edge, Firefox, Safari (desktop) bez instalacji.
2. **Biblioteka prymitywów parametrycznych oraz ukosowań**
   * Podstawowe elementy do budowy złącza:
     - Płyty prostokątne (parametry: szerokość, grubość)
     - Rury (średnica zewnętrzna, grubość ścianki)
     - Profile L/C/I (dowolna konfiguracja wymiarów)
     - Spoiny spawalnicze w uproszczonej formie:
       * Podstawowa wielowarstwowość (możliwość dodawania warstw)
       * Uproszczona penetracja spoiny
       * W kolejnych etapach będą rozwijane zaawansowane modele geometryczne spoin
   * Definiowanie rodzaju ukosowania elementów w złączu w oparciu o trzy typowe scenariusze:
     - Brak ukosowania (krawędź prosta): element płaski, bez dodatkowych parametrów kątowych.
     - Ukosowanie jednostronne (typ V lub Y): pełne ścięcie jednej ścianki pod zadanym kątem.
         - Parametry: wysokość całkowita oraz kąt ukosu.
     - Ukosowanie dwustronne (typ X lub K): ścięcie krawędzi od góry i dołu.
         - Parametry: wysokość całkowita oraz niezależne kąty dla skosu górnego i dolnego.
3. **Manipulacja i parametryzacja**
   * Możliwość precyzyjnej regulacji wszystkich wymiarów za pomocą suwaków z dokładnością do 0,1 mm; użytkownik może w dowolnej chwili przełączyć jednostki (np. na cale lub jednostki niestandardowe według potrzeb).
   * Możliwość ręcznego wpisania wartości
   * Obrót (o zadaną wartość), przesuwanie i zoom
   * SNAP magnetyczny do krawędzi i wierzchołków
4. **Tryb sekwencji spawania (uproszczony)**
   * Wstawianie symboli ściegu (elipsy/kółka)
   * Możliwość nadawania numeracji ściegów zarówno ręcznie, jak i automatycznie (np. 1, 2, 3… lub A, B, C…), w zależności od preferencji użytkownika.
5. **Eksport dokumentacji**
   * **Priorytet główny**: Eksport do plików graficznych (JPG, PNG) – rysunek złącza + numeracja + prosta legenda tekstowa
   * **Niższy priorytet**: Eksport do PDF (funkcja docelowa, ale specjaliści rzadziej korzystają z tego formatu)
6. **Zarządzanie projektami**
   * Zapisywanie i wczytywanie projektów w formacie JSON w chmurze/bazie danych
7. **Modułowa architektura** – zaprojektowana z myślą o łatwej rozbudowie w przyszłości, na przykład o wsparcie dla urządzeń mobilnych oraz dodatkowych formatów plików (DXF, SVG, DWG i inne kompatybilne z AutoCAD).

## Co NIE wchodzi w zakres MVP
- Wersja offline (PWA) oraz pełna obsługa tabletów/smartfonów
- Import/eksport DXF, SVG lub innych formatów CAD
- Zaawansowane narzędzia wymiarowania i tolerancji

## Kryteria sukcesu
1. Użytkownik początkujący tworzy proste złącze z trzech elementów, definiuje kolejność spawania i generuje raport graficzny (PNG/JPG) w **mniej niż 10 minut**.
2. Aplikacja działa płynnie (≥ 30 FPS przy typowych scenariuszach) na komputerach nie starszych niż 10 lat.
3. Wszystkie podstawowe operacje (dodanie elementu, zmiana wymiaru, obrót, SNAP) mają czas reakcji < 200 ms.
4. ≥ 80 % użytkowników testowych ocenia łatwość obsługi jako „łatwą” lub „bardzo łatwą”.
5. Zapisywanie i ponowne wczytanie JSON odtwarza scenę bez utraty danych w 100 % przypadków.
6. Wygenerowany plik graficzny (PNG/JPG) otwiera się poprawnie i zawiera: rysunek, numerację, legendę. Eksport do PDF (gdy zostanie zaimplementowany) również spełnia te kryteria.
