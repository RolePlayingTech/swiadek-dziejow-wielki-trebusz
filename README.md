# Wielki Trebusz: Tajemnica Palca Spustowego (`Świadek Dziejów`)

Interaktywny eksponat inżynieryjny 3D WebGL i gra oblężnicza dla marki **Świadek Dziejów** (`https://swiadek-dziejow.pl/wielki-trebusz`), osadzona w udokumentowanej złotej epoce wielkich machin przeciwwagowych (*blid*) na pograniczu polsko-litewsko-krzyżackim (**1362–1409**).

## Koncepcja i mechanika 3D („Zasada pierwszych 5 sekund”)

Zamiast statycznego artykułu użytkownik od pierwszej sekundy bez ekranów powitalnych manipuluje trójwymiarową *blidą* z wahliwą skrzynią przeciwwagi i odkrywa na własnej skórze największy paradoks średniowiecznej mechaniki — **kilkunastocentymetrowy kuty żelazny palec spustowy (*prong*) na końcu 16-metrowej dębowej belki**:

1. **Bezpośrednia manipulacja 3D (mysz i dotyk 1 palcem od `375 px`)** — chwytanie i wyginanie żelaznego palca spustowego (`0°–80°` z kamerą makro i kątomierzem mosiężnym), dociążanie dębowej skrzyni z ołowiem i tłuczniem (`3–16 t`) oraz szarpnięcie konopnego sznura zawleczki spustowej z podglądem naciągu i trajektorii.
2. **Spektakularna fizyka błędów i odkryć (3-DOF Euler-Lagrange RK4)**:
   - wyprostowany palec (`0°–7°`) zwalnia pętlę na samym szczycie łuku — głaz leci **wstecz** w obóz oblężniczy i rozbija kuty kocioł obozowy z grochówką (`-10 m .. -123 m`),
   - zbyt mały kąt (`8°–13°`) wyrzuca głaz pionowo nad kozioł machiny,
   - zbyt duży hak (`62°–80°`) nie wypuszcza pętli na czas i wbija pocisk w ziemię tuż przed trebuszem,
   - zablokowanie skrzyni ciesielskimi zastrzałami pod krótkim ramieniem (*eksperyment wahliwej skrzyni*) natychmiast obniża zasięg o **ok. 30%** (dla `9 t`: z `245,0 m` do `170,0 m`, spadek sprawności energetycznej $\eta$ z `34,3%` do `28,4%`), udowadniając w kilka sekund sens wynalazku wahliwego zawiesia.
3. **4-salwowa Kampania Puszkarza, Rozkaz Dnia i Warsztat Inżyniera** — deterministyczne scenariusze (`mulberry32`, strefa `Europe/Warsaw`) z wiatrem czołowym lub tylnym i czterema celami gotyckiej warowni ceglanej (*Hurdycje*, *Kurtyna Opus Emplectum*, *Wieża Bramna*, *Gdanisko Komtura — Wieża Ustępowa nad fosą*).
4. **Żywy Gospodarz — Świadek Dziejów** — 16 autentycznych, ekspresyjnych wypowiedzi głosowych (`-16 LUFS`, zweryfikowanych automatycznie modelem Whisper PL) sterowanych przez `HostVoiceDirector` (preempcja `80 ms` bez nakładania ścieżek, sidechain ducking efektów fizycznych o `-5 dB`, napisy na żywo i trwały przełącznik wyciszenia) w parze z proceduralnym silnikiem foley **Web Audio API** (skrzyp dębu, zapadka kołowrotu, wyginanie żelaza, świst procy, kruszenie cegieł, plusk fosy, brzdęk kotła z grochówką).
5. **Wirusowość i społeczność** — wyzwania z podpisem kryptograficznym HMAC-SHA256 (`?w=...`) wyświetlające od startu w scenie 3D **złoty łuk ducha rywala**, dynamiczna karta OpenGraph (`1200×630`), generator kart PNG w formatach **`4:5` (`1080×1350`)** oraz **`9:16` (`1080×1920`)** z zachowaniem stref bezpiecznych Instagram Stories/Reels/TikTok oraz uczciwy serwerowy rozkład wyników społeczności (20 przedziałów wyniku `0..1000 pkt`).

## Źródła historyczne, fizyczne i rozdzielenie modelu symulacyjnego

Panel **„Skąd to wiemy?”** ([`src/data/historicalSources.ts`](src/data/historicalSources.ts)) rygorystycznie oddziela udokumentowane źródła pierwotne od mitów filmowych i uproszczeń symulacji:

- **Źródła historyczne (1362–1409)**:
  - **Wigand z Marburga**, *Chronica nova Prutenica* (ok. 1394) — opis oblężenia zamku w Kownie w kwietniu 1362 r. i użycia machin miotających (*bliden*) wzniesionych przez naczelnego cieślę malborskiego, mistrza Marquarda, oraz oddział mistrza inflanckiego.
  - **Erich Joachim (wyd.)**, *Das Marienburger Tresslerbuch der Jahre 1399–1409* (Königsberg 1896) — rachunki podskarbiego malborskiego dokumentujące utrzymanie *Blidenhaus*, zakup lin konopnych (*hanfseile*), łoju do smarowania czopów (*schmer*) i żołd dla *Blidenmeister*.
  - **Konrad Kyeser z Eichstätt**, *Bellifortis* (ok. 1405, rękopis SUB Göttingen `Cod. Ms. Philos. 63, fol. 30r`) — traktat inżynierii wojskowej wymiarujący wielką blidę w stopach roboczych (`54 = 46 + 8` stóp dla belki głównej, `46` stóp boku kozła, wahliwa skrzynia *arca* i koryto startowe); w symulatorze przyjęto skalibrowany wariant bojowy `15,9 m` (`13,25 m : 2,65 m`, przełożenie `5,0 : 1`).
  - **Jan Długosz**, *Annales seu Cronicae incliti Regni Poloniae* (Ks. X–XI) oraz *Kontynuator Jana z Posilge* — weryfikacja faktu, że pod **Malborkiem latem 1410 r.** armia Władysława Jagiełły używała już artylerii prochowej (*puszek* / bombard), a nie tradycyjnych *blid* (obalenie popularnego mitu popkulturowego).
- **Model matematyczny i archeologia eksperymentalna**:
  - **Donald B. Siano**, *Trebuchet Mechanics* (2001) — równania Eulera-Lagrange’a o 3 stopniach swobody ($\theta, \alpha, \varphi$) całkowane metodą **Rungego-Kutty 4. rzędu (RK4)** z krokiem $\Delta t = 4\text{ ms}$, więzem normalnym podłoża dla ślizgu głazu w korycie oraz ciągłym geometrycznym warunkiem ześlizgu pierścienia z palca spustowego o kącie $\delta$.
  - **Peter Vemming Hansen**, *Experimental Reconstruction of a Medieval Trébuchet*, *Acta Archaeologica* 63 (1992) — dane porównawcze z rekonstrukcji w *Middelaldercentret* (Nykøbing Falster) oraz zamku *Warwick*.
- **Uczciwe uproszczenia symulacji**: ruch belki, wahliwej skrzyni ($I_{\text{box}} = 0{,}9\,M$) i procy obliczany jest w pionowej płaszczyźnie strzału 2D z wiatrem wzdłuż osi strzału X (czołowym lub tylnym) i kwadratowym oporem aerodynamicznym zależnym od pocisku ($C_d = 0{,}47$ dla kuli kamiennej, $0{,}52$ dla eratyka `145 kg`, $0{,}60$ dla beczki smolnej; $\rho = 1{,}225\text{ kg/m}^3$); belka dębowa traktowana jest jako bryła sztywna z tłumieniem czopów; destrukcja muru ceglanego w scenie 3D jest wizualizacją kinematyczną w `InstancedMesh` zsynchronizowaną z energią kinetyczną uderzenia $E_k = \frac{1}{2}mv_{\text{imp}}^2$.

## Licencje zasobów

Pełne zestawienie licencji znajduje się w pliku [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) oraz [`public/fonts/OFL.txt`](public/fonts/OFL.txt):

- **Kod źródłowy, silnik fizyki RK4, materiały proceduralne PBR i syntezator Web Audio**: autorskie oprogramowanie projektu *Świadek Dziejów* (`RolePlayingTech`).
- **Czcionki (`public/fonts/`)**: *Playfair Display*, *Space Grotesk*, *JetBrains Mono* — **SIL Open Font License 1.1** ([`public/fonts/OFL.txt`](public/fonts/OFL.txt)).
- **Ikony interfejsu**: `lucide-react` (**ISC License**).
- **Silnik i framework**: `three`, `@react-three/fiber`, `@react-three/drei`, `next`, `react` (**MIT License**).
- **Oprawa głosowa i wizualna**: kanoniczny głos i wizerunek postaci **Świadka Dziejów** z licencjonowanego zestawu produkcyjnego marki.

## Architektura techniczna i endpointy

- **Stack**: Next.js 16 (`output: "standalone"`, `basePath: "/wielki-trebusz"`), React 19, TypeScript, Three.js + `@react-three/fiber` + `@react-three/drei`, Tailwind CSS v4, GSAP, Web Audio API.
- **Endpointy**:
  - `GET /wielki-trebusz/api/community` — zagregowane statystyki społeczności i 20-przedziałowy histogram wyników kampanii `0..1000 pkt` (oraz kontrola zdrowia `?health=1`).
  - `POST /wielki-trebusz/api/community` — atomowy zapis wyniku kampanii/wyzwania z limitem rozmiaru strumienia (`2048 B`), walidacją zakresów fizycznych, idempotentną aktualizacją `callsign` po `runId`, podpisem HMAC-SHA256 i rate-limiterem per IP (`PERSISTENT_DATA_DIR/wielki-trebusz-community.json`).
  - `GET /wielki-trebusz/api/og` — dynamiczny generator kart OpenGraph `1200×630` PNG (`next/og` z lokalnymi fontami `.ttf` obsługującymi polskie znaki diakrytyczne i weryfikacją podpisu HMAC `?w=`).

## Uruchomienie lokalne i wdrożenie produkcyjne (`standalone`)

```bash
npm install
npm run dev
```

Budowa produkcyjna (`standalone`, domyślnie port `127.0.0.1:3007`):

```bash
npm run build
rm -rf .next/standalone/public/public
cp -a public/. .next/standalone/public/
mkdir -p .next/standalone/.next/static
cp -a .next/static/. .next/standalone/.next/static/

PERSISTENT_DATA_DIR=/var/www/swiadek-wielki-trebusz/persistent-data \
CHALLENGE_HMAC_SECRET="<losowy-klucz-hex-32B>" \
PORT=3007 HOSTNAME=127.0.0.1 NODE_ENV=production \
node .next/standalone/server.js
```
