# Wielki Trebusz: Tajemnica Palca Spustowego (`Świadek Dziejów`)

Interaktywny eksponat inżynieryjny 3D WebGL i gra oblężnicza dla marki **Świadek Dziejów** (`https://swiadek-dziejow.pl/wielki-trebusz`), osadzona w udokumentowanej złotej epoce wielkich machin przeciwwagowych (*blid*) na pograniczu polsko-litewsko-krzyżackim (**1362–1405**).

## Koncepcja i mechanika 3D („Zasada pierwszych 5 sekund”)

Zamiast statycznego artykułu użytkownik od pierwszej sekundy bez ekranów powitalnych manipuluje trójwymiarową *blidą* z wahliwą skrzynią przeciwwagi i odkrywa na własnej skórze największy paradoks średniowiecznej mechaniki — **kilkunastocentymetrowy żelazny palec spustowy (*prong*) na końcu belki**:

1. **Bezpośrednia manipulacja 3D (mysz i dotyk 1 palcem od `375 px`)** — chwytanie i wyginanie mosiężnego palca spustowego (`0°–80°` z kamerą makro), dociążanie dębowej skrzyni z ołowiem i tłuczniem (`2–10 t`) oraz szarpnięcie konopnego sznura zawleczki spustowej z podglądem naciągu i trajektorii.
2. **Spektakularna fizyka błędów i odkryć (3-DOF Euler-Lagrange RK4)**:
   - wyprostowany palec (`0°–7°`) zwalnia pętlę na samym szczycie łuku — głaz leci **wstecz** w obóz oblężniczy i rozbija żeliwny kociołek z grochówką (`-30 m .. -120 m`),
   - zbyt mały kąt (`8°–13°`) wyrzuca głaz pionowo nad kozioł machiny,
   - zbyt duży hak (`62°–80°`) nie wypuszcza pętli na czas i wbija pocisk w ziemię tuż przed trebuszem,
   - zablokowanie skrzyni na sztywno do belki (*eksperyment wahliwej skrzyni*) natychmiast obniża zasięg o **ok. 30%** i sprawność energetyczną z **~34% do ~21%**, udowadniając w 5 sekund sens wynalazku wahliwego zawiesia.
3. **4-salwowa Kampania Puszkarza, Rozkaz Dnia i Piaskownica Inżyniera** — deterministyczne scenariusze (`mulberry32`) z wiatrem bocznym/czołowym i czterema celami gotyckiej warowni ceglanej (*Hurdycje*, *Kurtyna Opus Emplectum*, *Wieża Bramna*, *Wykusz i Gdanisko Komtura*), w tym rozbiciem murowanego wykusza latrynowego (**gdaniska**).
4. **Żywy Gospodarz — Świadek Dziejów** — 15 autentycznych, ekspresyjnych wypowiedzi głosowych (`-16 LUFS`, zweryfikowanych automatycznie modelem Whisper PL) sterowanych przez `HostVoiceDirector` (preempcja `80 ms` bez nakładania ścieżek, sidechain ducking efektów fizycznych o `-5 dB`, napisy na żywo i trwały przełącznik wyciszenia) w parze z proceduralnym silnikiem foley **Web Audio API** (skrzyp dębu, zapadka kołowrotu, świst procy, kruszenie cegieł, plusk grochówki).
5. **Wirusowość i społeczność** — wyzwania z podpisem kryptograficznym HMAC-SHA256 (`?w=...`) wyświetlające w scenie 3D **złoty łuk ducha rywala**, dynamiczna karta OpenGraph (`1200×630`), generator kart PNG w formatach **`4:5` (`1080×1350`)** oraz **`9:16` (`1080×1920`)** z zachowaniem stref bezpiecznych Instagram/TikTok oraz serwerowy histogram percentyli graczy.

## Źródła historyczne, fizyczne i rozdzielenie modelu symulacyjnego

Panel **„Skąd to wiemy?”** ([`src/data/historicalSources.ts`](src/data/historicalSources.ts)) rygorystycznie oddziela udokumentowane źródła pierwotne od mitów filmowych i uproszczeń symulacji:

- **Źródła historyczne (1362–1409)**:
  - **Wigand z Marburga**, *Chronica nova Prutenica* (ok. 1394) — opis oblężenia zamku w Kownie w kwietniu 1362 r. i użycia machin miotających (*bliden*) przez mistrza krajowego i budowniczych z Malborka oraz Królewca.
  - **Erich Joachim (wyd.)**, *Das Marienburger Tresslerbuch der Jahre 1399–1409* (Königsberg 1896) — rachunki podskarbiego malborskiego dokumentujące utrzymanie *Blidenhaus*, zakup lin konopnych, łoju do smarowania czopów i ołowiu do skrzyń przeciwwagowych.
  - **Konrad Kyeser z Eichstätt**, *Bellifortis* (ok. 1405, rękopis SUB Göttingen `Cod. Ms. philos. 63`) — traktat inżynierii wojskowej z wymiarowaniem belki asymetrycznej (proporcje ok. `1 : 4` – `1 : 5`), kozła i wahliwej skrzyni.
  - **Jan Długosz**, *Annales seu Cronicae incliti Regni Poloniae* (Ks. X–XI) oraz *Kontynuator Jana z Posilge* — weryfikacja faktu, że pod **Malborkiem latem 1410 r.** armia Władysława Jagiełły używała już głównie artylerii prochowej (*puszek* / bombard), a nie tradycyjnych *blid* (obalenie popularnego mitu popkulturowego).
- **Model matematyczny i archeologia eksperymentalna**:
  - **Donald B. Siano**, *Trebuchet Mechanics* (2001) — równania Eulera-Lagrange’a o 3 stopniach swobody ($\theta, \phi, \psi$) całkowane metodą **Rungego-Kutty 4. rzędu (RK4)** z krokiem $\Delta t = 1\text{ ms}$, więzem normalnym podłoża dla ślizgu głazu w korycie oraz geometrycznym warunkiem ześlizgu pętli z palca spustowego o kącie $\delta$.
  - **Peter Vemming Hansen**, *Experimental Reconstruction of a Medieval Trébuchet*, *Acta Archaeologica* 63 (1992) — dane porównawcze z rekonstrukcji w *Middelaldercentret* (Nykøbing Falster) oraz zamku *Warwick* (`18 m`, `~6 t`).
- **Uczciwe uproszczenia symulacji**: ruch główny belki, skrzyni i procy obliczany jest w płaszczyźnie strzału 2D z odchyleniem bocznym wiatru i kwadratowym oporem aerodynamicznym kuli kamiennej ($C_d = 0.47$, $\rho = 1.225\text{ kg/m}^3$) po zwolnieniu pocisku; belka dębowa traktowana jest jako bryła sztywna; destrukcja muru ceglanego w scenie 3D jest wizualizacją kinematyczną w `InstancedMesh` zsynchronizowaną z energią kinetyczną uderzenia w dżulach/megadżulach.

## Licencje zasobów

- **Kod źródłowy, silnik fizyki RK4, materiały proceduralne PBR i syntezator Web Audio**: autorskie oprogramowanie projektu *Świadek Dziejów* (`RolePlayingTech`).
- **Czcionki (`public/fonts/`)**:
  - *Playfair Display* — **SIL Open Font License 1.1** (Claus Eggers Sørensen),
  - *Space Grotesk* — **SIL Open Font License 1.1** (Florian Karsten),
  - *JetBrains Mono* — **SIL Open Font License 1.1** (JetBrains s.r.o.).
- **Ikony interfejsu**: `lucide-react` (**ISC License**).
- **Oprawa głosowa i wizualna**: kanoniczny głos i wizerunek postaci **Świadka Dziejów** wygenerowane w ramach licencjonowanego zestawu produkcyjnego marki.

## Architektura techniczna i endpointy

- **Stack**: Next.js 16 (`output: "standalone"`, `basePath: "/wielki-trebusz"`), React 19, TypeScript, Three.js + `@react-three/fiber` + `@react-three/drei`, Tailwind CSS v4, Web Audio API.
- **Endpointy**:
  - `GET /wielki-trebusz/api/community` — zagregowane statystyki społeczności, rekord zasięgu i 20-przedziałowy histogram energii uderzenia (lub kontrola zdrowia `?health=1`).
  - `POST /wielki-trebusz/api/community` — atomowy zapis wyniku kampanii/wyzwania z limitem rozmiaru strumienia (`2048 B`), walidacją zakresów fizycznych, ochroną przed duplikatami `runId` i rate-limiterem per IP (`PERSISTENT_DATA_DIR/wielki-trebusz-community.json`).
  - `GET /wielki-trebusz/api/og` — dynamiczny generator kart OpenGraph `1200×630` PNG (`next/og` z lokalnymi fontami `.ttf` obsługującymi polskie znaki diakrytyczne i weryfikacją podpisu HMAC `?w=`).

## Uruchomienie lokalne i wdrożenie produkcyjne (`standalone`)

```bash
npm install
npm run dev
```

Budowa produkcyjna (`standalone`, domyślnie port `127.0.0.1:3007`):

```bash
npm run build
cp -r public .next/standalone/public
cp -r .next/static .next/standalone/.next/static

PERSISTENT_DATA_DIR=/var/www/swiadek-wielki-trebusz/persistent-data \
CHALLENGE_HMAC_SECRET="<losowy-klucz-hex-32B>" \
PORT=3007 HOSTNAME=127.0.0.1 NODE_ENV=production \
node .next/standalone/server.js
```
