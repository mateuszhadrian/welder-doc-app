# Koncepcja MVP – podstawa do stworzenia PRD

## Główny problem
Inżynierowie spawalnicy oraz technolodzy produkcji nie dysponują prostym i tanim, wyspecjalizowanym narzędziem do szybkiego tworzenia przekrojów złączy spawanych i planowania kolejności spawania. Obecnie posługują się ogólnymi programami CAD lub rysują ręcznie, co jest czasochłonne, wymaga dużych umiejętności i utrudnia przygotowanie czytelnej dokumentacji technicznej.

## Najmniejszy zestaw funkcjonalności (MVP)
1. **Przeglądarkowa aplikacja on-line** działająca na Chrome, Edge, Firefox, Safari (desktop) bez instalacji.
2. **Biblioteka prymitywów parametrycznych**
   * Płyty prostokątne (szerokość, grubość)
   * Rury (średnica zewnętrzna, grubość ścianki)
   * Profile L/C/I (dowolne wymiary)
3. **Manipulacja i parametryzacja**
   * Suwaki z dokładnością 0,1 mm dla wszystkich wymiarów
   * Możliwość ręcznego wpisania wartości
   * Obrót (o zadaną wartość), przesuwanie i zoom
   * SNAP magnetyczny do krawędzi i wierzchołków
4. **Tryb sekwencji spawania (uproszczony)**
   * Wstawianie symboli ściegu (elipsy/kółka)
   * Ręczne lub automatyczne numerowanie (1, 2, 3 …)
5. **Eksport dokumentacji**
   * Generacja jednoplanszowego raportu PDF: rysunek złącza + numeracja + prosta legenda tekstowa
6. **Zarządzanie projektami**
   * Zapisywanie i wczytywanie projektów w formacie JSON w chmurze/bazie danych
7. **Architektura modułowa** przygotowana pod przyszłe rozszerzenia (mobile, normy, DXF, SVG)

## Co NIE wchodzi w zakres MVP
- Wersja offline (PWA) oraz pełna obsługa tabletów/smartfonów
- Import/eksport DXF, SVG lub innych formatów CAD
- Zaawansowane modele geometryczne spoin (penetracja, wielowarstwowość)
- Automatyczne odniesienia do norm ISO/AWS w dokumentacji
- Integracje z systemami ERP/PLM, symulatorami spawalniczymi itp.
- Profile materiałowe, bazy danych parametrów technologicznych
- Zaawansowane narzędzia wymiarowania (kotenie) i tolerancji

## Kryteria sukcesu
1. Użytkownik początkujący tworzy proste złącze z trzech elementów, definiuje kolejność spawania i generuje raport PDF w **mniej niż 15 minut**.
2. Aplikacja działa płynnie (≥ 30 FPS przy typowych scenariuszach) na komputerach nie starszych niż 10 lat.
3. Wszystkie podstawowe operacje (dodanie elementu, zmiana wymiaru, obrót, SNAP) mają czas reakcji < 200 ms.
4. ≥ 80 % użytkowników testowych ocenia łatwość obsługi jako „łatwą” lub „bardzo łatwą”.
5. Zapisywanie i ponowne wczytanie JSON odtwarza scenę bez utraty danych w 100 % przypadków.
6. Wygenerowany PDF otwiera się poprawnie w popularnych czytnikach i zawiera: rysunek, numerację, legendę.
