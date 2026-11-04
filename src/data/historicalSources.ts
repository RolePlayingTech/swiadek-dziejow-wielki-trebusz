import { SITE_ORIGIN } from "@/lib/config";

export type SourceBadgeKind = "fakt" | "mit" | "rekonstrukcja";

export interface HistoricalFactEntry {
  id: string;
  badge: "fakt";
  yearLabel: string;
  titlePl: string;
  sourceCitationPl: string;
  summaryPl: string;
  keyTakeawayPl: string;
}

export interface CinemaMythEntry {
  id: string;
  badge: "mit";
  mythClaimPl: string;
  historicalRealityPl: string;
  sourceEvidencePl: string;
  engineeringVerdictPl: string;
}

export interface PhysicsModelEntry {
  id: string;
  badge: "rekonstrukcja";
  titlePl: string;
  formulaLatexLike: string;
  explanationPl: string;
  browserSimplificationNotePl?: string;
}

export interface EcosystemProjectLink {
  id: string;
  titlePl: string;
  subtitlePl: string;
  href: string;
  tagPl: string;
}

/**
 * Udokumentowane fakty źródłowe z pogranicza polsko-litewsko-krzyżackiego (1362–1409)
 * oraz traktatów inżynieryjnych z przełomu XIV i XV stulecia.
 */
export const HISTORICAL_FACTS: HistoricalFactEntry[] = [
  {
    id: "kowno-1362",
    badge: "fakt",
    yearLabel: "Kwiecień 1362",
    titlePl: "Wielkie Oblężenie Kowna i blidy mistrza Marquarda",
    sourceCitationPl:
      "Wigand z Marburga, Chronica nova Prutenica (relacja o wyprawie wielkiego mistrza Winrycha von Kniprode na Kowno, marzec–kwiecień 1362).",
    summaryPl:
      "Wiosną 1362 r. pod pierwszym murowanym zamkiem litewskim u ujścia Wilii do Niemna (bronionym przez księcia Wojdata, syna Kiejstuta) stanął największy w XIV wieku park oblężniczy Zakonu. Naczelny cieśla z Malborka, mistrz Marquard, wzniósł potężne grawitacyjne blidy (machinae / bliden), które dzień i noc rozbijały drewniane hurdycje oraz ceglane kurtyny aż do krwawego szturmu w Wielkanoc 16–17 kwietnia 1362 r.",
    keyTakeawayPl:
      "Pod Kownem pojawiły się już pierwsze niewielkie puszki prochowe (bussen), lecz to wciąż wielkie blidy przeciwwagowe były jedyną bronią zdolną wybić wyłom w ceglanym murze!",
  },
  {
    id: "wilno-tresslerbuch-blidenhaus",
    badge: "fakt",
    yearLabel: "1390 • 1399–1409",
    titlePl: "Oblężenie Wilna, Marienburger Tresslerbuch i składy Blidenhaus",
    sourceCitationPl:
      "Das Marienburger Tresslerbuch der Jahre 1399–1409 (wyd. E. Joachim, 1896) oraz rachunki wyprawy hrabiego Henryka Derby pod Wilno (1390).",
    summaryPl:
      "Księga podskarbiego malborskiego z lat 1399–1409 skrupulatnie wylicza srebrne grzywny wydawane na konopne liny (hanfseile), łój do smarowania czopów osi (schmer), żelazne okucia skrzyń oraz pensje dla mistrzów blid (Blidenmeister). Aby 16-metrowe dębowe belki nie gniły na deszczu, przechowywano je w stanie rozłożonym w specjalnych krytych wozowniach — Blidenhausach (m.in. w Malborku, Toruniu, Elblągu i Królewcu) — i spławiano szkutami w dół Wisły lub Niemna.",
    keyTakeawayPl:
      "Średniowieczna blida była precyzyjną, modułową maszyną inżynieryjną przewożoną w częściach na wozach i barkach, a nie budowaną naprędce z mokrych pni z lasu.",
  },
  {
    id: "bellifortis-1405",
    badge: "fakt",
    yearLabel: "ok. 1405",
    titlePl: "Traktat „Bellifortis” Konrada Kyesera z Eichstätt",
    sourceCitationPl:
      "Konrad Kyeser, Bellifortis (ok. 1405), rękopis pergaminowy SUB Göttingen, Cod. Ms. Philos. 63, fol. 30r (Domena Publiczna).",
    summaryPl:
      "Najsłynniejszy ilustrowany traktat techniki wojennej przełomu XIV i XV w. (fol. 30r) wymiaruje wielką blidę w stopach roboczych: belka główna (rutta) liczy 54 stopy (46 + 8 stóp, ok. 5,75:1), bok trójkątnego kozła 46 stóp, wahliwa skrzynia przeciwwagi (arca) oraz długie drewniane koryto prowadzące pod belką. W naszym modelu przyjęliśmy skalibrowany wariant bojowy 15,9 m (13,25 m : 2,65 m, klasyczne przełożenie 5,0:1 z analizy D. B. Siano 2001) z osią na wysokości 11,4 m.",
    keyTakeawayPl:
      "Geometria naszej blidy (`TREBUCHET_DIMENSIONS`) łączy konstrukcję kozła, skrzyni i koryta z traktatu Kyesera ze skalibrowanym przełożeniem 5,0:1.",
  },
  {
    id: "opus-emplectum-gdanisko",
    badge: "fakt",
    yearLabel: "XIV / pocz. XV w.",
    titlePl: "Mur ceglany opus emplectum oraz krzyżackie Gdanisko (Dansker)",
    sourceCitationPl:
      "Badania architektoniczne zamków w Kownie, Kwidzynie, Malborku i Toruniu (m.in. M. Arszyński, S. Jóźwiak, J. Trupinda).",
    summaryPl:
      "Mury warowni krzyżackich i nadniemeńskich wznoszono w technice opus emplectum: dwie zewnętrzne skorupy z mocno wypalonej cegły gotyckiej spinały rdzeń z polnych kamieni (eratyków) zalanych gorącą zaprawą wapienną. Charakterystycznym elementem zamków Zakonu było też gdanisko (Dansker) — wysunięta daleko nad fosę lub rzekę na murowanych arkadach wieża ustępowa (latrynowa), pełniąca zarazem rolę ostatniego bastionu obrony.",
    keyTakeawayPl:
      "Pojedynczy lekki kamień odbijał się od ceglanego lica — do skruszenia skorupy i odsłonięcia gruzowego rdzenia potrzebny był skoncentrowany ostrzał kulami 100–145 kg.",
  },
];

/**
 * Obalone mity filmowe i popkulturowe.
 */
export const DEBUNKED_MYTHS: CinemaMythEntry[] = [
  {
    id: "mit-malbork-1410",
    badge: "mit",
    mythClaimPl:
      "Mit #1: Latem 1410 roku pod Malborkiem armia Władysława Jagiełły ostrzeliwała zamek z wielkich trebuszy.",
    historicalRealityPl:
      "FAŁSZ! Latem 1410 r., niespełna pół wieku po oblężeniu Kowna, wojska polsko-litewskie pod Malborkiem NIE używały już blid grawitacyjnych, lecz wyłącznie artylerii prochowej — dział zwanych puszkami (bombardami) miotających kamienne kule!",
    sourceEvidencePl:
      "Jan Długosz (Roczniki, ks. X–XI) oraz współczesny wydarzeniom Kontynuator kroniki Jana z Posilge zgodnie opisują ostrzał Malborka w lipcu–wrześniu 1410 r. z ciężkich puszek prochowych (pixides / bussen), a nie z machin przeciwwagowych.",
    engineeringVerdictPl:
      "Lata 1362–1410 nad Bałtykiem i Niemnem to fascynujący moment technologicznego przełomu: w 1362 r. pod Kownem królowała jeszcze grawitacja i mechanika dźwigni, a w 1410 r. pod Malborkiem rządziła już chemia czarnego prochu!",
  },
  {
    id: "mit-belka-zderzakowa",
    badge: "mit",
    mythClaimPl:
      "Mit #2: Ramię trebusza uderza z hukiem w poziomą belkę zderzakową na szczycie kozła, by wyrzucić pocisk.",
    historicalRealityPl:
      "KATASTROFALNY BŁĄD KINA! Poziomą poprzeczkę zderzakową miał rzymski onager (katapulta skrętna z jedną łyżką), nigdy zaś średniowieczny trebusz z procą!",
    sourceEvidencePl:
      "Ani ryciny w Bellifortis (ok. 1405), ani szkice Villarda de Honnecourt (ok. 1230), ani żadna działająca rekonstrukcja (Middelaldercentret, Warwick) nie posiadają belki oporowej przed ramieniem.",
    engineeringVerdictPl:
      "Gdyby 1450-kilogramowe dębowe ramię napędzane 9–16 tonami przeciwwagi uderzyło w drewnianą poprzeczkę, ścięłoby czopy i złamało się w pierwszej salwie! Prawdziwa blida hamuje bezdotykowo: oddając pęd biczowemu szarpnięciu procy oraz przeciwfazowemu wahnięciu skrzyni.",
  },
  {
    id: "mit-miecz-i-benzyna",
    badge: "mit",
    mythClaimPl:
      "Mit #3: Dowódca przecina linę mieczem przy każdym strzale, a trebusze miotają wybuchające kule z benzyny.",
    historicalRealityPl:
      "ABSURD EKONOMICZNY I CHEMICZNY! Gruba lina konopna kosztowała w rachunkach zamkowych kilka grzywien srebra — przecięcie jej mieczem pod wielotonowym naciągiem okaleczyłoby obsługę i zrujnowało skarbiec po pięciu strzałach.",
    sourceEvidencePl:
      "Spust stanowiła żelazna zapadka dźwigniowa (hak spustowy / slip-hook) wybijana szarpnięciem sznura lub pobijakiem. Pociski zapalające sporządzano zaś z dziegciu, smoły drzewnej, łoju, pakuł konopnych i siarki w beczułkach.",
    engineeringVerdictPl:
      "Beczka smolna nie wybuchała jak filmowy napalm w locie — miała rozbić się na suchym gontowym dachu lub drewnianej hurdycji i wzniecić trudny do ugaszenia pożar żywicy i dziegciu.",
  },
];

/**
 * Jawny opis modelu matematyczno-fizycznego i uczciwe wyszczególnienie uproszczeń symulacji.
 */
export const PHYSICS_MODEL_NOTES: PhysicsModelEntry[] = [
  {
    id: "lagrange-3dof",
    badge: "rekonstrukcja",
    titlePl: "Równania Eulera-Lagrange’a potrójnego wahadła (Siano 2001) + RK4",
    formulaLatexLike:
      "L(θ, α, φ, θ̇, α̇, φ̇) = T − V   ⇒   M(q) q̈ = Q(q, q̇) + J_yᵀ N,   Δt = 0.004 s (RK4)",
    explanationPl:
      "Symulator całkuje w pełnym rygorze trzy stopnie swobody: kąt dębowej belki θ, kąt wahliwej skrzyni przeciwwagi α oraz kąt liny procy φ. W fazie startowej mnożnik Lagrange’a N ≥ 0 utrzymuje pocisk w poziomym drewnianym korycie (y = r_kuli) aż do chwili, gdy pionowa składowa napięcia liny uniesie głaz w powietrze.",
  },
  {
    id: "wahliwa-vs-sztywna",
    badge: "rekonstrukcja",
    titlePl: "Dlaczego wahliwa skrzynia bije sztywną o ok. 30% zasięgu?",
    formulaLatexLike:
      "hinged = false  ⇒  θ + α = 1,48 rad,   I_eff = M₁₁ − 2M₁₂ + M₂₂   (9 t: spadek zasięgu z 245 m do 170 m, η z 34,3% do 28,4%)",
    explanationPl:
      "Gdy zablokujesz skrzynię ciesielskimi zastrzałami pod krótkim ramieniem, wielotonowy kufer (I_box = 0,9 M) musi obracać się razem z belką, jego środek masy opada po płytszym łuku (mniejsze Δy), a pod koniec suwu znika efekt dynamicznego wyhamowania ramienia przez wahadło skrzyni. Czysta mechanika obniża zasięg o 28,6%–32,1% (dla 9 t: o 30,6%)!",
  },
  {
    id: "palec-spustowy-i-aerodynamika",
    badge: "rekonstrukcja",
    titlePl: "Geometria żelaznego palca spustowego (δ) i opór aerodynamiczny z wiatrem",
    formulaLatexLike:
      "φ_slip = θ_ref + δ_eff(δ) − π/2,     F⃗_d = −½ ρ_air C_d A |v⃗ − w⃗| (v⃗ − w⃗)",
    explanationPl:
      "Ciągła charakterystyka kutego palca δ (0°–80°) decyduje o chwili zsunięcia pierścienia procy: zbyt prosty bolec (0°–7°) zwalnia kulę w ruchu wstecznym prosto we własny obóz, 8°–13° strzela świecą w zenit nad kozłem, okno 26°–46° daje optymalny kąt wyrzutu 38°–47°, a zagięty hak (62°–80°) wbija głaz w ziemię przed machiną.",
    browserSimplificationNotePl:
      "Uczciwe uproszczenia symulacji w przeglądarce: (1) ruch rozwiązujemy w pionowej płaszczyźnie strzału 2D z krokiem RK4 Δt = 4 ms (wiatr działa wzdłuż osi X jako czołowy lub tylny bez bocznego znoszenia Z), (2) opór aerodynamiczny zależy od pocisku (C_d = 0,47 dla kuli, 0,52 dla eratyka 145 kg, 0,60 dla beczki smolnej), (3) dębowe ramię traktujemy jako bryłę sztywną z nieliniowym tłumieniem czopów i drganiem przeciążeniowym, (4) kruszenie muru wyliczamy dyskretnie z energii uderzenia E_k = ½mv² w chwili kontaktu.",
  },
];

/**
 * Klikalne linki do pozostałych projektów ekosystemu edukacyjnego Świadka Dziejów.
 */
export const SWIADEK_ECOSYSTEM_LINKS: EcosystemProjectLink[] = [
  {
    id: "historia-polski",
    titlePl: "Historia Polski",
    subtitlePl: "Interaktywne opowieści i przełomy dziejowe od Piastów i Jagiellonów po XX wiek",
    href: `${SITE_ORIGIN}/historia-polski/`,
    tagPl: "Portal główny",
  },
  {
    id: "historia-technologii",
    titlePl: "Historia Technologii",
    subtitlePl: "Jak maszyny, metalurgia, proch i inżynieria zmieniały losy cywilizacji",
    href: `${SITE_ORIGIN}/historia-technologii/`,
    tagPl: "Inżynieria",
  },
  {
    id: "atlas",
    titlePl: "Atlas Historyczny Świadka Dziejów",
    subtitlePl: "Granice, twierdze, szlaki wypraw krzyżackich i kampanie na żywej mapie",
    href: "https://atlas.swiadek-dziejow.pl",
    tagPl: "Kartografia",
  },
  {
    id: "milionerzy-1923",
    titlePl: "Milionerzy 1923",
    subtitlePl: "Symulator hiperinflacji marki polskiej i reformy walutowej Władysława Grabskiego",
    href: `${SITE_ORIGIN}/milionerzy-1923`,
    tagPl: "Gra historyczna",
  },
  {
    id: "artykuly-historyczne",
    titlePl: "Artykuły Historyczne",
    subtitlePl: "Pogłębione eseje źródłowe, analizy kronik i obalanie mitów popkultury",
    href: `${SITE_ORIGIN}/artykuly-historyczne`,
    tagPl: "Czytelnia",
  },
];
