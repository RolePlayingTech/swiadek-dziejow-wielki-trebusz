import { SCORE_CAP } from "@/lib/config";
import type { PlayerRank, SiegeMission } from "@/types/trebuchet";

/** Domyślny seed klasycznej kampanii „Kowno 1362” */
export const DEFAULT_CAMPAIGN_SEED = 13620416;

/**
 * Deterministyczny generator liczb pseudolosowych 32-bit Mulberry32.
 * Gwarantuje 100% identyczny scenariusz pojedynku na każdej przeglądarce i serwerze dla tego samego seeda.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randRange(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(2));
}

/**
 * Zwraca klucz daty kalendarzowej YYYY-MM-DD w strefie czasowej `Europe/Warsaw`.
 */
export function getDailyChallengeDateLabel(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Warsaw",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

/**
 * Wylicza deterministyczny 32-bitowy seed Wyzwania Dnia według daty w strefie `Europe/Warsaw`.
 */
export function getDailyChallengeSeed(now: Date = new Date()): number {
  const dateKey = getDailyChallengeDateLabel(now); // np. "2026-11-04"
  let hash = 2166136261 >>> 0;
  const salted = `wielki-trebusz:${dateKey}`;
  for (let i = 0; i < salted.length; i++) {
    hash ^= salted.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash === 0 ? DEFAULT_CAMPAIGN_SEED : hash;
}

/**
 * Generuje deterministyczny zestaw 4 salw kampanii lub pojedynku dziennego.
 * Dystanse mieszczą się w przedziale 160–265 m, a wiatr w przedziale -8.0..+6.0 m/s,
 * przy pełnej rozwiązywalności każdego scenariusza w silniku RK4.
 */
export function generateCampaignMissions(seed: number): SiegeMission[] {
  const rng = mulberry32(seed);

  // Salwa I: Rozgrzewka pod zamkiem kowieńskim — umiarkowany dystans i łagodny powiew znad Wilii
  const dist1 = Math.round(randRange(rng, 164, 184));
  const wind1 = roundToStep(randRange(rng, -1.6, 2.0), 0.5);

  // Salwa II: Kurtyna ceglana opus emplectum — wyraźny wiatr czołowy znad Niemna
  const dist2 = Math.round(randRange(rng, 196, 218));
  const wind2 = roundToStep(randRange(rng, -6.5, -2.5), 0.5);

  // Salwa III: Daleka wieża bramna na skarpie — ciężki głaz i porywisty wicher
  const wind3 = roundToStep(randRange(rng, -4.5, 6.0), 0.5);
  // Jeśli wieje silny wiatr w twarz, trzymamy dystans w granicach pełnego zasięgu głazu 145 kg
  const maxDist3 = wind3 < -2.0 ? 246 : 262;
  const dist3 = Math.round(randRange(rng, 232, maxDist3));

  // Salwa IV: Mistrzowski strzał w wykusz Gdaniska Komtura zawieszonego nad fosą
  const dist4 = Math.round(randRange(rng, 182, 212));
  const wind4 = roundToStep(randRange(rng, -8.0, 5.5), 0.5);

  return [
    {
      index: 0,
      id: "salwa-1-hurdycje",
      titlePl: "Salwa I: Drewniane Hurdycje Przedmurza",
      subtitlePl: "Kowno, kwiecień 1362 — rozgrzewka pod zamkiem u ujścia Wilii",
      historicalContextPl:
        "W Wielkim Tygodniu 1362 r., jak zapisał kronikarz Wigand z Marburga, blidy mistrza ciesielskiego Marquarda najpierw strącały drewniane ganki bojowe (hurdycje) z korony murów, by odebrać wojownikom księcia Wojdata osłonę nad skarpą.",
      castleDistanceM: dist1,
      targetCenterYM: 14.4,
      targetRadiusM: 4.1,
      targetZone: "hurdycje",
      windSpeedMs: wind1,
      recommendedProjectileId: "smola_85",
      hintPl:
        "Drewniany ganek na szczycie kurtyny łatwo zająć ogniem beczki smolnej (85 kg) albo rozbić lekkim głazem (65 kg). Kąt palca ok. 34°–40° i średnia masa skrzyni dadzą czystą parabolę.",
    },
    {
      index: 1,
      id: "salwa-2-kurtyna",
      titlePl: "Salwa II: Kurtyna Ceglana Opus Emplectum",
      subtitlePl: "Rozbicie lica gotyckiego muru pod czołowy wiatr znad Niemna",
      historicalContextPl:
        "Mur w technice opus emplectum ma dwie twarde skorupy z cegły palcówki, a wewnątrz rdzeń z polnych głazów zalanych gorącą zaprawą wapienną. Lekkie kamienie tylko krzeszą iskry — dopiero powtarzalne uderzenia kalibrowanych kul 100 kg wybijają wyłom.",
      castleDistanceM: dist2,
      targetCenterYM: 8.2,
      targetRadiusM: 3.8,
      targetZone: "kurtyna",
      windSpeedMs: wind2,
      recommendedProjectileId: "granit_100",
      hintPl:
        "Czołowy wiatr znad rzeki wyhamowuje lot kuli. Dociąż wahliwą skrzynię przeciwwagi (ok. 9,5–11,5 t) i użyj kalibrowanej kuli granitowej 100 kg.",
    },
    {
      index: 2,
      id: "salwa-3-wieza-bramna",
      titlePl: "Salwa III: Wieża Bramna na Skarpie",
      subtitlePl: "Daleki strzał ciężkim głazem burzącym przy porywistym wietrze",
      historicalContextPl:
        "Wysoka wieża bramna góruje nad obwodem obronnym niczym w nadniemeńskich warowniach i podczas oblężenia Wilna w 1390 r. Posłanie 145-kilogramowego eratyka na ponad dwieście trzydzieści metrów wymaga pełnej mocy wahliwej skrzyni z traktatu Bellifortis.",
      castleDistanceM: dist3,
      targetCenterYM: 17.8,
      targetRadiusM: 3.7,
      targetZone: "wieza_bramna",
      windSpeedMs: wind3,
      recommendedProjectileId: "glaz_145",
      hintPl:
        "Ciężki głaz burzący 145 kg niesie olbrzymią energię kinetyczną, ale potrzebuje dużej masy przeciwwagi (13–16 t), wahliwej skrzyni i kąta palca w oknie 34°–44°.",
    },
    {
      index: 3,
      id: "salwa-4-gdanisko",
      titlePl: "Salwa IV: Wykusz i Gdanisko Komtura",
      subtitlePl: "Precyzyjny strzał mistrzowski w arkadę nad fosą",
      historicalContextPl:
        "Wysunięte daleko nad fosę na murowanych arkadach gdanisko (Dansker) pełniło w zamkach zakonnych rolę wieży ustępowej oraz ostatniej reduty. Rozbicie wykusza nad fosą daje premię mistrzowską i osobisty dyshonor dla komtura!",
      castleDistanceM: dist4,
      targetCenterYM: 9.0,
      targetRadiusM: 3.3,
      targetZone: "gdanisko_wykusz",
      windSpeedMs: wind4,
      recommendedProjectileId: "granit_100",
      hintPl:
        "Uwaga na prześwit pod arkadą (poniżej 4 m kula wpadnie do fosy, a za wysoko przeleci w kurtynę za gdaniskiem!). Skoryguj dokładnie masę skrzyni pod aktualny wiatr.",
    },
  ];
}

/**
 * Sześć historyczno-satyrycznych rang Mistrza Blidy ocenianych przez Świadka Dziejów.
 */
export const RANKS: PlayerRank[] = [
  {
    id: "agent_zakonu",
    minScore: 0,
    titlePl: "Tajny Agent Wielkiego Mistrza",
    badgeIcon: "✠",
    epigraphPl:
      "„Kula ze świstem pomknęła na zachód — prosto w namioty własnej czeladzi i wozy z sucharami!”",
    swiadekVerdictPl:
      "Winrych von Kniprode już kazał wypisać Ci w Marienburger Tresslerbuch premię w grzywnach pruskich! Zbyt prosty palec spustowy wypuścił procę, zanim ramię minęło zenit — klasyczna katastrofa młodego cieśli.",
  },
  {
    id: "kopacz_studni",
    minScore: 0,
    titlePl: "Kopacz Studni Obozowych",
    badgeIcon: "⛏",
    epigraphPl:
      "„Fosa pod zamkiem rozpryskuje się od Twoich głazów, a bracia zakonni z murów biją brawo.”",
    swiadekVerdictPl:
      "Zamiast kruszyć ceglane lico, pogłębiłeś krzyżakom fosę i zaorałeś przedpole! Zanim znów dotkniesz zapadki spustowej, sprawdź kąt żelaznego palca (28°–44°) oraz odblokuj wahliwą skrzynię.",
  },
  {
    id: "czeladnik",
    minScore: 280,
    titlePl: "Czeladnik Ciesielski",
    badgeIcon: "📐",
    epigraphPl:
      "„Dębowy kozioł stoi prosto, liny konopne nie pękły, a pierwsze blanki posypały się w dół.”",
    swiadekVerdictPl:
      "Znasz już różnicę między procą a cepem i wiesz, po co smaruje się czopy łojem. Jeszcze gubisz poprawkę na wiatr znad Niemna, ale mistrz Marquard wpuściłby Cię już pod dach Blidenhausu.",
  },
  {
    id: "puszkarz",
    minScore: 520,
    titlePl: "Puszkarz Chorągwi Królewskiej",
    badgeIcon: "⚙",
    epigraphPl:
      "„Cegły palcówki pękają pod Twoją ręką, a obrońcy w pośpiechu opuszczają drewniane hurdycje.”",
    swiadekVerdictPl:
      "Solidne rzemiosło z przełomu epok! Rozumiesz bezwładność przeciwwagi i pęd ciężkiego głazu — gdy za kilkadziesiąt lat pod Malborkiem 1410 blidy ustąpią miejsca puszkom prochowym, król Jagiełło weźmie Cię na żołd.",
  },
  {
    id: "mistrz_kowna",
    minScore: 740,
    titlePl: "Mistrz Blidy spod Kowna",
    badgeIcon: "🏰",
    epigraphPl:
      "„Dzień i noc dębowa belka pracowała bez pudła, aż gotycka kurtyna runęła w gruz do fosy!”",
    swiadekVerdictPl:
      "Wigand z Marburga zapisałby Twoje imię w kronice obok mistrza Marquarda! Perfekcyjnie wyczułeś biczowy zamach procy i rezonans wahliwej skrzyni według prawideł Konrada Kyesera.",
  },
  {
    id: "postrach_zakonu",
    minScore: 900,
    titlePl: "Postrach Zamków Zakonu",
    badgeIcon: "👑",
    epigraphPl:
      "„Od Kowna po gdaniska nad Wisłą żaden mur opus emplectum nie ostoi się przed Twoją geometrią!”",
    swiadekVerdictPl:
      "Arcymistrzostwo inżynierii średniowiecza! Opanowałeś mechanikę Lagrange’a na pięć stuleci przed jej spisaniem — komturowie na sam widok Twoich wozów z belkami otwierają bramy bez szturmu.",
  },
];

/**
 * Zwraca rangę gracza na podstawie łącznego wyniku 4 salw (0..1000) oraz flagi trafienia we własny obóz.
 */
export function getRankForScore(score: number, hadCampBackfire = false): PlayerRank {
  if (hadCampBackfire) {
    return RANKS[0]; // Tajny Agent Wielkiego Mistrza
  }

  const clampedScore = Math.max(0, Math.min(SCORE_CAP, Math.round(score)));
  let bestRank = RANKS[1]; // Kopacz Studni Obozowych

  for (let i = 1; i < RANKS.length; i++) {
    const candidate = RANKS[i];
    if (clampedScore >= candidate.minScore) {
      bestRank = candidate;
    }
  }

  return bestRank;
}
