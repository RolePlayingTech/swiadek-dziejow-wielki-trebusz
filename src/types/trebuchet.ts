export type ProjectileTypeId = "granit_65" | "granit_100" | "glaz_145" | "smola_85";

export interface ProjectileSpec {
  id: ProjectileTypeId;
  namePl: string;
  shortNamePl: string;
  massKg: number;
  radiusM: number;
  dragCoeff: number;
  isIncendiary: boolean;
  descriptionPl: string;
}

export interface TrebuchetConfig {
  /** Masa skrzyni przeciwwagi [kg], np. 3000..16000 */
  counterweightMassKg: number;
  /** Kąt wygięcia żelaznego palca spustowego względem przedłużenia belki [stopnie], 0..80 */
  prongAngleDeg: number;
  /** Długość liny procy [m], 8.0..14.5 */
  slingLengthM: number;
  /** Czy skrzynia przeciwwagi jest wahliwa (true = historyczna blida), czy zablokowana na sztywno (false = eksperyment porównawczy) */
  hingedCounterweight: boolean;
  /** Wybrany typ pocisku */
  projectileId: ProjectileTypeId;
  /** Prędkość wiatru wzdłuż osi strzału [m/s] (+ z wiatrem, - pod wiatr) */
  windSpeedMs: number;
}

export interface SimKeyframe {
  t: number;
  /** Kąt głównej belki [rad] (0 = pionowo, ramię długie w górze = pi? Zdefiniowane spójnie ze współrzędnymi xy) */
  beamAngleRad: number;
  /** Pozycja środka masy skrzyni przeciwwagi [m] względem osi podparcia (0, axleHeightM) */
  boxX: number;
  boxY: number;
  boxWorldAngleRad: number;
  /** Pozycja czubka długiego ramienia (palca spustowego) [m] w układzie świata (y=0 to ziemia) */
  tipX: number;
  tipY: number;
  /** Pozycja pocisku [m] w układzie świata (x > 0 w stronę zamku, x < 0 w stronę własnego obozu, y >= 0 nad ziemią) */
  projX: number;
  projY: number;
  projVx: number;
  projVy: number;
  /** Czy pierścień procy nadal znajduje się na palcu spustowym */
  attachedToSling: boolean;
}

export type ShotOutcomeKind =
  | "direct_target"      // Trafienie w główny cel misji!
  | "gdanisko_hit"       // Sekretne trafienie w krzyżackie gdanisko (wieżę ustępową)!
  | "wall_hit"           // Trafienie w mur/przedmurze poza idealnym środkiem celu
  | "overshot"           // Przestrzelenie za zamek
  | "short_moat"         // Zbyt krótko — fosa lub przedpole
  | "ground_slam"        // Zbyt zagięty palec — wbicie kuli w ziemię tuż przed machiną
  | "zenith_self_hit"    // Świeca pionowa nad machiną spadająca niebezpiecznie blisko trebusza!
  | "camp_backfire"      // Strzał DO TYŁU (x < -8 m) prosto we własny obóz oblężniczy!
  | "beam_overload";     // Przeciążenie dębowej belki przy ekstremalnej masie i sztywnej skrzyni

export interface ShotSimulationResult {
  frames: SimKeyframe[];
  releaseTimeS: number;
  impactTimeS: number;
  releaseSpeedMs: number;
  releaseSpeedKmh: number;
  releaseAngleDeg: number;
  kineticEnergyKj: number;
  /** Energia kinetyczna w chwili uderzenia w cel/ podłoże [kJ] (po stratach oporu powietrza i wzniosie celu) */
  impactKineticEnergyKj: number;
  potentialEnergyDropKj: number;
  /** Sprawność transferu energii z opadającej skrzyni do pocisku [%] */
  energyEfficiencyPct: number;
  maxHeightM: number;
  /** Punkt uderzenia na osi X [m] (dodatni = w stronę zamku, ujemny = w własny obóz!) */
  impactDistanceM: number;
  impactHeightM: number;
  impactSpeedMs: number;
  outcome: ShotOutcomeKind;
  /** Liczba skruszonych bloków cegieł / belek w zamku */
  bricksDislodged: number;
  /** Wynik punktowy pojedynczej salwy (0..250) */
  salvoScore: number;
  /** Dokładna odległość od środka celu misji [m] */
  distanceErrorM: number;
}

export type TargetZoneKind = "hurdycje" | "kurtyna" | "wieza_bramna" | "gdanisko_wykusz";

export interface SiegeMission {
  index: number; // 0..3
  id: string;
  titlePl: string;
  subtitlePl: string;
  historicalContextPl: string;
  /** Odległość zamku / osi celu od osi trebusza [m], np. 165..265 */
  castleDistanceM: number;
  /** Wysokość środka celu nad poziomem gruntu [m] */
  targetCenterYM: number;
  /** Promień strefy idealnego trafienia [m] */
  targetRadiusM: number;
  targetZone: TargetZoneKind;
  windSpeedMs: number;
  recommendedProjectileId: ProjectileTypeId;
  hintPl: string;
}

export type RankId =
  | "agent_zakonu"
  | "kopacz_studni"
  | "czeladnik"
  | "puszkarz"
  | "mistrz_kowna"
  | "postrach_zakonu";

export interface PlayerRank {
  id: RankId;
  minScore: number;
  titlePl: string;
  badgeIcon: string;
  epigraphPl: string;
  swiadekVerdictPl: string;
}

export type VoiceEventId =
  | "intro"
  | "first_touch"
  | "prong_adjust"
  | "hinge_locked"
  | "camp_backfire"
  | "zenith_self_hit"
  | "ground_slam"
  | "short_moat"
  | "overshot"
  | "wall_bounce"
  | "near_miss"
  | "direct_hit"
  | "gdanisko_hit"
  | "campaign_high"
  | "campaign_low"
  | "beat_rival";

export interface VoiceSubtitlePayload {
  clipId: string;
  event: VoiceEventId;
  categoryLabel: string;
  subtitlePl: string;
  durationMs: number;
  isAudioPlaying: boolean;
}
