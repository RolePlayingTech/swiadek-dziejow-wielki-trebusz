import type {
  ProjectileSpec,
  ProjectileTypeId,
  ShotOutcomeKind,
  ShotSimulationResult,
  SiegeMission,
  SimKeyframe,
  TargetZoneKind,
  TrebuchetConfig,
} from "@/types/trebuchet";

/** Przyspieszenie ziemskie [m/s^2] */
const GRAVITY_MS2 = 9.81;

/** Gęstość chłodnego wiosennego powietrza nad Niemnem [kg/m^3] */
const AIR_DENSITY_KGM3 = 1.225;

/** Krok całkowania numerycznego Rungego-Kutty 4. rzędu [s] */
const RK4_DT_S = 0.004;

/** Co ile kroków RK4 zapisujemy klatkę animacji (4 * 0.004 s = 0.016 s ≈ 62.5 FPS) */
const KEYFRAME_STRIDE = 4;

/** Maksymalny czas symulacji pojedynczego strzału [s] */
const MAX_SIM_TIME_S = 22.0;

/**
 * Wymiary geometryczne i masowe wielkiej blidy (trebusza przeciwwagowego)
 * zrekonstruowane na podstawie traktatu Konrada Kyesera „Bellifortis” (ok. 1405,
 * Cod. Ms. Philos. 63, Getynga): przełożenie ramion 5 : 1 (13.25 m : 2.65 m).
 */
export const TREBUCHET_DIMENSIONS = {
  longArmM: 13.25,
  shortArmM: 2.65,
  axleHeightM: 11.4,
  hangerLengthM: 2.5,
  beamMassKg: 1450,
} as const;

/** Kąt napięcia dębowej belki w pozycji spoczynkowej (kołowrót napięty, t = 0) [rad] */
export const COCKED_BEAM_ANGLE_RAD = 0.8;

/** Suma kątów (theta + alpha) przy zablokowaniu skrzyni ciesielskimi zastrzałami pod krótkim ramieniem [rad] */
export const RIGID_LOCK_ANGLE_SUM_RAD = 1.48;

/** Katalog historycznych pocisków oblężniczych z pogranicza XIV/XV w. */
export const PROJECTILES: Record<ProjectileTypeId, ProjectileSpec> = {
  granit_65: {
    id: "granit_65",
    namePl: "Ociosany głaz polny (65 kg)",
    shortNamePl: "Głaz 65 kg",
    massKg: 65,
    radiusM: 0.18,
    dragCoeff: 0.47,
    isIncendiary: false,
    descriptionPl:
      "Lżejszy narzutowy kamień polny o dużej prędkości wylotowej — daleki zasięg do strącania drewnianych hurdycji i blankowania.",
  },
  granit_100: {
    id: "granit_100",
    namePl: "Kalibrowana kula granitowa (100 kg)",
    shortNamePl: "Kula 100 kg",
    massKg: 100,
    radiusM: 0.21,
    dragCoeff: 0.47,
    isIncendiary: false,
    descriptionPl:
      "Standardowy pocisk oblężniczy spod Kowna (1362), obtłukiwany przez kamieniarzy według szablonu dla powtarzalnej celności.",
  },
  glaz_145: {
    id: "glaz_145",
    namePl: "Ciężki głaz burzący (145 kg)",
    shortNamePl: "Głaz 145 kg",
    massKg: 145,
    radiusM: 0.24,
    dragCoeff: 0.52,
    isIncendiary: false,
    descriptionPl:
      "Potężny eratyk o niszczycielskim pędzie — zdolny rozbijać ceglane lico muru opus emplectum i filary wież bramnych.",
  },
  smola_85: {
    id: "smola_85",
    namePl: "Beczka smolna zapalająca (85 kg)",
    shortNamePl: "Smoła 85 kg",
    massKg: 85,
    radiusM: 0.25,
    dragCoeff: 0.6,
    isIncendiary: true,
    descriptionPl:
      "Dębowa beczułka z dziegciem, smołą sosnową, łojem, pakułami i siarką — do podpalania gontowych dachów i drewnianych hurdycji.",
  },
};

/** Uporządkowana lista pocisków do selektora w interfejsie */
export const PROJECTILE_LIST: ProjectileSpec[] = [
  PROJECTILES.granit_65,
  PROJECTILES.granit_100,
  PROJECTILES.glaz_145,
  PROJECTILES.smola_85,
];

/** Domyślna konfiguracja startowa blidy (zbalansowana pod ok. 220–230 m) */
export const DEFAULT_TREBUCHET_CONFIG: TrebuchetConfig = {
  counterweightMassKg: 9000,
  prongAngleDeg: 34,
  slingLengthM: 11.2,
  hingedCounterweight: true,
  projectileId: "granit_100",
  windSpeedMs: 0,
};

/** Prostokątny segment kolizyjny bryły zamku w płaszczyźnie strzału (X, Y) */
export interface CastleStructureBox {
  id: "gdanisko" | "przedmurze" | "kurtyna" | "hurdycje" | "wieza_bramna";
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Podatność materiału na wybijanie cegieł / belek (1.0 = lity mur ceglany) */
  fragilityFactor: number;
}

/**
 * Zwraca deterministyczny układ brył kolizyjnych zamku krzyżackiego / nadniemeńskiego
 * dopasowany do aktywnej strefy celu misji (lub domyślnego zamku w trybie piaskownicy).
 */
export function getCastleCollisionBoxes(
  castleDistanceM: number,
  targetZone: TargetZoneKind = "kurtyna"
): CastleStructureBox[] {
  // Dopasowujemy położenie głównej kurtyny identycznie z układem 3D w FortressAndCamp.tsx,
  // tak aby przednie lico aktywnego celu leżało dokładnie w X = castleDistanceM!
  if (targetZone === "gdanisko_wykusz") {
    const curtainX = castleDistanceM + 8.5;
    return [
      {
        // Gdanisko (Dansker) — wieża ustępowa zawieszona nad fosą na ceglanej arkadzie (w płaszczyźnie strzału z=0)
        id: "gdanisko",
        xMin: castleDistanceM,
        xMax: castleDistanceM + 4.8,
        yMin: 4.0,
        yMax: 12.6,
        fragilityFactor: 1.35,
      },
      {
        // Kurtyna zamku w głębi za arkadą gdaniska
        id: "kurtyna",
        xMin: curtainX,
        xMax: curtainX + 4.8,
        yMin: 0,
        yMax: 12.6,
        fragilityFactor: 0.95,
      },
      {
        id: "hurdycje",
        xMin: curtainX,
        xMax: curtainX + 5.2,
        yMin: 12.6,
        yMax: 16.4,
        fragilityFactor: 1.55,
      },
    ];
  }

  if (targetZone === "wieza_bramna") {
    // Wieża bramna wystaje o 1.4 m PRZED lico kurtyny (zgodnie z geometrią 3D w FortressAndCamp.tsx)
    const curtainX = castleDistanceM + 1.4;
    return [
      {
        id: "przedmurze",
        xMin: curtainX - 6.5,
        xMax: curtainX - 4.0,
        yMin: 0,
        yMax: 5.2,
        fragilityFactor: 0.9,
      },
      {
        id: "wieza_bramna",
        xMin: castleDistanceM,
        xMax: castleDistanceM + 8.0,
        yMin: 0,
        yMax: 23.5,
        fragilityFactor: 0.88,
      },
      {
        id: "kurtyna",
        xMin: curtainX,
        xMax: curtainX + 4.8,
        yMin: 0,
        yMax: 12.6,
        fragilityFactor: 0.95,
      },
    ];
  }

  const curtainX = castleDistanceM;
  return [
    {
      // Niskie przedmurze (zwinger) nad skarpą fosy
      id: "przedmurze",
      xMin: curtainX - 6.5,
      xMax: curtainX - 4.0,
      yMin: 0,
      yMax: 5.2,
      fragilityFactor: 0.9,
    },
    {
      // Główna kurtyna ceglana w wątku gotyckim (opus emplectum)
      id: "kurtyna",
      xMin: curtainX,
      xMax: curtainX + 4.8,
      yMin: 0,
      yMax: 12.6,
      fragilityFactor: 0.95,
    },
    {
      // Drewniane hurdycje (kryty ganek bojowy na koronie muru)
      id: "hurdycje",
      xMin: curtainX,
      xMax: curtainX + 5.2,
      yMin: 12.6,
      yMax: 16.4,
      fragilityFactor: 1.55,
    },
    {
      // Wysoka ceglana wieża bramna w głębi obwodu obronnego
      id: "wieza_bramna",
      xMin: curtainX + 6.5,
      xMax: curtainX + 15.5,
      yMin: 0,
      yMax: 23.5,
      fragilityFactor: 0.88,
    },
  ];
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Rozwiązuje symetryczny układ 3x3 M * x = b, w którym M_23 = M_32 = 0
 * (dokładna struktura macierzy mas potrójnego wahadła blidy).
 */
function solveMassMatrix3x3(
  m11: number,
  m12: number,
  m13: number,
  m22: number,
  m33: number,
  b1: number,
  b2: number,
  b3: number
): [number, number, number] {
  const det = m11 * m22 * m33 - m12 * m12 * m33 - m13 * m13 * m22;
  const safeDet = Math.abs(det) > 1e-9 ? det : 1e-9;
  const x1 = (b1 * m22 * m33 - m12 * b2 * m33 - m13 * b3 * m22) / safeDet;
  const x2 = (b2 - m12 * x1) / m22;
  const x3 = (b3 - m13 * x1) / m33;
  return [x1, x2, x3];
}

/**
 * Wyznacza kąt procy phi [rad], przy którym żelazny pierścień procy zsuwa się
 * z wygiętego palca spustowego (prongAngleDeg w zakresie 0..80 stopni).
 *
 * Zgodnie z mechaniką kontaktu pierścienia na kutym rogu (Siano 2001):
 * - 0°–7°: prosty bolec bez progu oporowego -> przedwczesny ześlizg w tył (camp_backfire < -10 m),
 * - 8°–13°: minimalne odgięcie -> świeca niemal pionowo w zenit (zenith_self_hit -10..+14 m),
 * - 26°–46°: optymalne wyprofilowanie z epoki Bellifortis -> wyrzut pod kątem ~38°–47° w przód,
 * - 62°–80°: nadmiernie zagięty hak -> przetrzymanie pierścienia za szczytem i wbicie głazu w ziemię (+8..+55 m).
 */
function computeSlipSlingAngleRad(
  beamThetaRad: number,
  prongAngleDeg: number,
  slingLengthM: number,
  hingedCounterweight: boolean,
  isBeamOverload: boolean
): number {
  const p = clamp(prongAngleDeg, 0, 80);
  const beamCoupledRef = 0.35 * beamThetaRad + 0.65 * 2.75;

  let hornOffsetDeg: number;
  if (p <= 7) {
    // 0..7° -> strzał wsteczny do własnego obozu (< -8 m), ciągłe przejście C^0 w p = 7° (+4.5°)
    hornOffsetDeg = -21.0 + (p / 7) * 25.5; // -21.0 .. +4.5
  } else if (p <= 13) {
    // 7..13° -> pionowa świeca nad machiną (-8..+14 m), ciągłe przejście bez skoku
    hornOffsetDeg = 4.5 + ((p - 7) / 6) * 3.5; // +4.5 .. +8.0
  } else if (p < 26) {
    // 13..26° -> przejście z lotu stromego do balistycznego
    hornOffsetDeg = 8.0 + ((p - 13) / 13) * 50.8; // +8.0 .. +58.8
  } else if (p <= 46) {
    // 26..46° -> optymalne okno inżynieryjne (kąt wyrzutu ok. 46.6° -> 38.8°)
    hornOffsetDeg = 58.8 + ((p - 26) / 20) * 8.4; // +58.8 .. +67.2
  } else if (p < 62) {
    // 46..62° -> narastające zakleszczenie pierścienia na haku
    const u = (p - 46) / 16;
    hornOffsetDeg = 67.2 + 77.8 * Math.pow(u, 1.35); // +67.2 .. +145.0
  } else {
    // 62..80° -> hak trzyma za długo, ciskając głaz z góry prosto w ziemię przed machiną (+8..+55 m)
    const u = (p - 62) / 18;
    hornOffsetDeg = 145.0 + 33.0 * u; // +145.0 .. +178.0
  }

  const dynamicShiftDeg =
    (isBeamOverload ? -14.0 : 0) +
    (slingLengthM - 11.2) * 0.8 -
    (hingedCounterweight ? 0 : 2.2);

  return beamCoupledRef + ((hornOffsetDeg + dynamicShiftDeg) * Math.PI) / 180 - Math.PI / 2;
}

/**
 * Sprawdza przecięcie odcinka ruchu pocisku (x0, y0) -> (x1, y1) z prostokątem struktury zamku.
 * Zwraca parametr u w [0, 1] metodą Liang-Barsky'ego lub null przy braku trafienia.
 */
function intersectSegmentWithBox(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  box: CastleStructureBox,
  projRadiusM: number
): number | null {
  const minX = box.xMin - projRadiusM * 0.5;
  const maxX = box.xMax + projRadiusM * 0.5;
  const minY = box.yMin;
  const maxY = box.yMax + projRadiusM * 0.5;

  const dx = x1 - x0;
  const dy = y1 - y0;

  let tMin = 0;
  let tMax = 1;

  const checks: Array<[number, number]> = [
    [-dx, x0 - minX],
    [dx, maxX - x0],
    [-dy, y0 - minY],
    [dy, maxY - y0],
  ];

  for (const [p, q] of checks) {
    if (Math.abs(p) < 1e-12) {
      if (q < 0) return null;
    } else {
      const r = q / p;
      if (p < 0) {
        if (r > tMax) return null;
        if (r > tMin) tMin = r;
      } else {
        if (r < tMin) return null;
        if (r < tMax) tMax = r;
      }
    }
  }

  return tMin <= tMax ? tMin : null;
}

/**
 * Główny deterministyczny symulator strzału z wielkiego trebusza (blidy).
 *
 * Układ współrzędnych świata:
 * - X = 0 to oś podparcia kozła blidy; X > 0 prowadzi w stronę zamku Zakonu, X < 0 w stronę własnego obozu.
 * - Y = 0 to poziom gruntu; oś główna belki leży w punkcie (0, axleHeightM = 11.4 m).
 * - Kąt belki beamAngleRad (theta): 0 = krótkie ramię pionowo w górze, pi = długie ramię pionowo w górze;
 *   podczas strzału theta rośnie płynnie zgodnie z ruchem wskazówek zegara (brak skoków atan2).
 */
export function simulateTrebuchetShot(
  rawConfig: TrebuchetConfig,
  mission?: SiegeMission
): ShotSimulationResult {
  const {
    longArmM: Ll,
    shortArmM: Ls,
    axleHeightM: Ha,
    hangerLengthM: Lh,
    beamMassKg: mb,
  } = TREBUCHET_DIMENSIONS;

  // Bezpieczna normalizacja wejścia w granicach fizycznych maszyny
  const M = clamp(rawConfig.counterweightMassKg, 3000, 16000);
  const prongAngleDeg = clamp(rawConfig.prongAngleDeg, 0, 80);
  const Lp = clamp(rawConfig.slingLengthM, 8.0, 14.5);
  const hinged = Boolean(rawConfig.hingedCounterweight);
  const windSpeedMs = clamp(rawConfig.windSpeedMs, -15, 15);
  const proj = PROJECTILES[rawConfig.projectileId] ?? PROJECTILES.granit_100;
  const m = proj.massKg;
  const projAreaM2 = Math.PI * proj.radiusM * proj.radiusM;

  // Przeciążenie dębowej belki przy ekstremalnej masie, zablokowanej na sztywno skrzyni i lekkim głazie
  const isBeamOverload = M >= 14500 && !hinged && m <= 70;

  // Parametry bezwładnościowe dębowej belki (zwężanej ku czubkowi), skrzyni (I_box = 1/12 * M * (w^2 + h^2) ≈ 0.9 * M) i procy
  const beamCgOffsetM = 0.55;
  const beamInertiaKgM2 = 52_000;
  const boxSelfInertiaKgM2 = 0.9 * M;
  const slingInertiaKgM2 = 2.4 * Lp * Lp;

  // Pozycja napięta (kołowrót ściąga długie ramię do wys. ~2.17 m nad ziemią po stronie obozu X < 0)
  const theta0 = COCKED_BEAM_ANGLE_RAD;
  const yGroundRel = proj.radiusM - Ha;

  // Początkowy kąt procy spoczywającej w poziomym drewnianym korycie startowym pod kozłem
  const cosPhi0 = clamp((-yGroundRel - Ll * Math.cos(theta0)) / Lp, -0.995, 0.995);
  const phi0 = -Math.acos(cosPhi0);

  // Przy zablokowanej skrzyni (hinged === false) ciesielskie zastrzały wiążą kufer na sztywno
  // pod brzuchem krótkiego ramienia (theta + alpha = const = RIGID_LOCK_ANGLE_SUM_RAD = 1.48 rad),
  // co zwiększa moment bezwładności układu, spłyca pionowy spadek ŚM skrzyni i obniża zasięg o ~30%.
  const lockAngleSumRad = RIGID_LOCK_ANGLE_SUM_RAD;
  const alpha0 = hinged ? 0 : lockAngleSumRad - theta0;

  let theta = theta0;
  let dtheta = 0;
  let alpha = alpha0;
  let dalpha = 0;
  let phi = phi0;
  let dphi = 0;

  let onTrough = true;
  let attachedToSling = true;
  let t = 0;

  // Straty w łożyskach czopowych smarowanych łojem + opór turbulentny powietrza na 16-metrowej belce i linach
  const axleBearingTorqueNm = (M + mb + m) * GRAVITY_MS2 * 0.16 * 0.017;
  const cAxleViscous = 1_050 + (isBeamOverload ? 215_000 : 0);
  const cBeamAero = 28_500 + Math.max(0, M - 7_000) * 7.6;
  const cRopeAero = 0.155 * Math.pow(Lp, 3.4);
  const cHingeViscous = 1_550;

  /**
   * Równania Eulera-Lagrange'a 3-DOF (theta, alpha, phi) z więzem koryta startowego (mnożnik N >= 0).
   */
  const computeAttachedAccelerations = (
    th: number,
    dth: number,
    al: number,
    dal: number,
    ph: number,
    dph: number,
    troughActive: boolean
  ): [number, number, number, number] => {
    const m11 = beamInertiaKgM2 + M * Ls * Ls + m * Ll * Ll;
    const m22 = M * Lh * Lh + boxSelfInertiaKgM2;
    const m33 = m * Lp * Lp + slingInertiaKgM2;

    const cosThAl = Math.cos(th + al);
    const sinThAl = Math.sin(th + al);
    const cosThPh = Math.cos(th - ph);
    const sinThPh = Math.sin(th - ph);

    const m12 = M * Ls * Lh * cosThAl;
    const m13 = m * Ll * Lp * cosThPh;

    // Kwadratowy opór aerodynamiczny działający na pocisk już podczas zamachu procy
    const vx = -Ll * Math.cos(th) * dth - Lp * Math.cos(ph) * dph;
    const vy = Ll * Math.sin(th) * dth + Lp * Math.sin(ph) * dph;
    const vRelX = vx - windSpeedMs;
    const vRelY = vy;
    const vRelMag = Math.hypot(vRelX, vRelY);
    const dragFactor = -0.5 * AIR_DENSITY_KGM3 * proj.dragCoeff * projAreaM2 * vRelMag;
    const fdx = dragFactor * vRelX;
    const fdy = dragFactor * vRelY;

    const qDrag1 = fdx * (-Ll * Math.cos(th)) + fdy * (Ll * Math.sin(th));
    const qDrag3 = fdx * (-Lp * Math.cos(ph)) + fdy * (Lp * Math.sin(ph));

    const bearingFriction = axleBearingTorqueNm * Math.tanh(dth * 8);
    const aeroBeam = cBeamAero * Math.abs(dth) * dth;
    const aeroRope = cRopeAero * Math.abs(dph) * dph;

    const q1 =
      M * Ls * Lh * sinThAl * dal * dal -
      m * Ll * Lp * sinThPh * dph * dph +
      (M * Ls - mb * beamCgOffsetM - m * Ll) * GRAVITY_MS2 * Math.sin(th) -
      cAxleViscous * dth -
      bearingFriction -
      aeroBeam +
      qDrag1;

    const q2 =
      M * Ls * Lh * sinThAl * dth * dth -
      M * GRAVITY_MS2 * Lh * Math.sin(al) -
      cHingeViscous * (dal + dth);

    const q3 =
      m * Ll * Lp * sinThPh * dth * dth -
      m * GRAVITY_MS2 * Lp * Math.sin(ph) -
      aeroRope +
      qDrag3;

    if (hinged) {
      let [ddth, ddal, ddph] = solveMassMatrix3x3(m11, m12, m13, m22, m33, q1, q2, q3);
      let normalN = 0;

      if (troughActive) {
        const j1 = Ll * Math.sin(th);
        const j3 = Lp * Math.sin(ph);
        const yp = -Ll * Math.cos(th) - Lp * Math.cos(ph);
        const dyp = j1 * dth + j3 * dph;
        const jdQd = Ll * Math.cos(th) * dth * dth + Lp * Math.cos(ph) * dph * dph;
        const [z1, , z3] = solveMassMatrix3x3(m11, m12, m13, m22, m33, j1, 0, j3);
        const jMinvJt = j1 * z1 + j3 * z3;

        if (jMinvJt > 1e-8) {
          const rhs = j1 * ddth + j3 * ddph + jdQd + 35 * dyp + 350 * (yp - yGroundRel);
          normalN = -rhs / jMinvJt;
          if (normalN > 0) {
            const fSliding = -0.03 * normalN * Math.tanh(vx * 5);
            const q1Trough = q1 + j1 * normalN + fSliding * (-Ll * Math.cos(th));
            const q3Trough = q3 + j3 * normalN + fSliding * (-Lp * Math.cos(ph));
            [ddth, ddal, ddph] = solveMassMatrix3x3(m11, m12, m13, m22, m33, q1Trough, q2, q3Trough);
          }
        }
      }
      return [ddth, ddal, ddph, normalN];
    }

    // Zredukowany układ holonomiczny 2-DOF przy zablokowanej skrzyni (dal = -dth, ddal = -ddth)
    const r11 = m11 - 2 * m12 + m22;
    const r13 = m13;
    const r33 = m33;
    const rq1 = q1 - q2;
    const rq3 = q3;
    const det2 = Math.max(1e-9, r11 * r33 - r13 * r13);

    let ddth = (rq1 * r33 - r13 * rq3) / det2;
    let ddph = (r11 * rq3 - r13 * rq1) / det2;
    let normalN = 0;

    if (troughActive) {
      const j1 = Ll * Math.sin(th);
      const j3 = Lp * Math.sin(ph);
      const yp = -Ll * Math.cos(th) - Lp * Math.cos(ph);
      const dyp = j1 * dth + j3 * dph;
      const jdQd = Ll * Math.cos(th) * dth * dth + Lp * Math.cos(ph) * dph * dph;
      const z1 = (j1 * r33 - r13 * j3) / det2;
      const z3 = (r11 * j3 - r13 * j1) / det2;
      const jMinvJt = j1 * z1 + j3 * z3;

      if (jMinvJt > 1e-8) {
        const rhs = j1 * ddth + j3 * ddph + jdQd + 35 * dyp + 350 * (yp - yGroundRel);
        normalN = -rhs / jMinvJt;
        if (normalN > 0) {
          const fSliding = -0.03 * normalN * Math.tanh(vx * 5);
          const rq1Trough = rq1 + j1 * normalN + fSliding * (-Ll * Math.cos(th));
          const rq3Trough = rq3 + j3 * normalN + fSliding * (-Lp * Math.cos(ph));
          ddth = (rq1Trough * r33 - r13 * rq3Trough) / det2;
          ddph = (r11 * rq3Trough - r13 * rq1Trough) / det2;
        }
      }
    }

    return [ddth, -ddth, ddph, normalN];
  };

  /**
   * Swobodne wygaszanie wahań samej machiny po wyrzucie kuli (ZERO poprzeczki zderzakowej!).
   * Belka hamuje wyłącznie dynamicznie przez wahnięcie skrzyni przeciwwagi oraz tarcie czopów.
   */
  const computeUnloadedBeamAccelerations = (
    th: number,
    dth: number,
    al: number,
    dal: number,
    timeSinceRelease: number
  ): [number, number] => {
    const m11 = beamInertiaKgM2 + M * Ls * Ls;
    const m22 = M * Lh * Lh + boxSelfInertiaKgM2;
    const cosThAl = Math.cos(th + al);
    const sinThAl = Math.sin(th + al);
    const m12 = M * Ls * Lh * cosThAl;

    // Przy przeciążeniu sztywnej belki symulujemy drganie skrętne dębowego dźwigara po szarpnięciu
    const overloadShudderNm = isBeamOverload
      ? 95_000 * Math.exp(-timeSinceRelease * 3.5) * Math.sin(timeSinceRelease * 34)
      : 0;

    const postDamping = 6_800 + (isBeamOverload ? 45_000 : 0);
    const aeroBeam = cBeamAero * Math.abs(dth) * dth;

    const q1 =
      M * Ls * Lh * sinThAl * dal * dal +
      (M * Ls - mb * beamCgOffsetM) * GRAVITY_MS2 * Math.sin(th) -
      postDamping * dth -
      aeroBeam +
      overloadShudderNm;

    const q2 =
      M * Ls * Lh * sinThAl * dth * dth -
      M * GRAVITY_MS2 * Lh * Math.sin(al) -
      (cHingeViscous + 2_400) * (dal + dth);

    if (hinged) {
      const det = Math.max(1e-9, m11 * m22 - m12 * m12);
      const ddth = (q1 * m22 - m12 * q2) / det;
      const ddal = (m11 * q2 - m12 * q1) / det;
      return [ddth, ddal];
    }

    const r11 = Math.max(1e-9, m11 - 2 * m12 + m22);
    const ddth = (q1 - q2) / r11;
    return [ddth, -ddth];
  };

  const frames: SimKeyframe[] = [];

  const pushKeyframe = (
    timeS: number,
    th: number,
    al: number,
    px: number,
    py: number,
    pvx: number,
    pvy: number,
    attached: boolean
  ): void => {
    const boxX = Ls * Math.sin(th) + Lh * Math.sin(al);
    const boxY = Ls * Math.cos(th) - Lh * Math.cos(al);
    const tipX = -Ll * Math.sin(th);
    const tipY = Ha - Ll * Math.cos(th);

    frames.push({
      t: Number(timeS.toFixed(4)),
      beamAngleRad: th,
      boxX,
      boxY,
      boxWorldAngleRad: al,
      tipX,
      tipY,
      projX: px,
      projY: Math.max(0, py),
      projVx: pvx,
      projVy: pvy,
      attachedToSling: attached,
    });
  };

  let projX = -Ll * Math.sin(theta0) - Lp * Math.sin(phi0);
  let projY = Ha - Ll * Math.cos(theta0) - Lp * Math.cos(phi0);
  let projVx = 0;
  let projVy = 0;
  let maxHeightM = projY;

  const initialBoxY = Ls * Math.cos(theta0) - Lh * Math.cos(alpha0);
  let minBoxY = initialBoxY;

  // Klatka początkowa t = 0
  pushKeyframe(0, theta, alpha, projX, projY, 0, 0, true);

  let stepCount = 0;
  let releaseTimeS = 0;
  let releaseSpeedMs = 0;
  let releaseAngleDeg = 0;
  let slammedWhileAttached = false;

  // ==================== ETAP 1 & 2: ŚLIZG W KORYCIE + ZAMACH PROCY ====================
  const maxSwingSteps = Math.floor(4.5 / RK4_DT_S);
  for (let step = 0; step < maxSwingSteps; step++) {
    if (onTrough) {
      const tipYWorld = Ha - Ll * Math.cos(theta);
      const [, , , normalN] = computeAttachedAccelerations(
        theta,
        dtheta,
        alpha,
        dalpha,
        phi,
        dphi,
        true
      );
      if (normalN <= 0 || phi >= -0.08 || tipYWorld - proj.radiusM >= 0.94 * Lp) {
        onTrough = false;
      }
    }

    // Krok RK4 układu powiązanego
    const [k1_ddth, k1_ddal, k1_ddph] = computeAttachedAccelerations(
      theta,
      dtheta,
      alpha,
      dalpha,
      phi,
      dphi,
      onTrough
    );

    const th2 = theta + 0.5 * RK4_DT_S * dtheta;
    const dth2 = dtheta + 0.5 * RK4_DT_S * k1_ddth;
    const al2 = hinged ? alpha + 0.5 * RK4_DT_S * dalpha : lockAngleSumRad - th2;
    const dal2 = hinged ? dalpha + 0.5 * RK4_DT_S * k1_ddal : -dth2;
    const ph2 = phi + 0.5 * RK4_DT_S * dphi;
    const dph2 = dphi + 0.5 * RK4_DT_S * k1_ddph;
    const [k2_ddth, k2_ddal, k2_ddph] = computeAttachedAccelerations(
      th2,
      dth2,
      al2,
      dal2,
      ph2,
      dph2,
      onTrough
    );

    const th3 = theta + 0.5 * RK4_DT_S * dth2;
    const dth3 = dtheta + 0.5 * RK4_DT_S * k2_ddth;
    const al3 = hinged ? alpha + 0.5 * RK4_DT_S * dal2 : lockAngleSumRad - th3;
    const dal3 = hinged ? dalpha + 0.5 * RK4_DT_S * k2_ddal : -dth3;
    const ph3 = phi + 0.5 * RK4_DT_S * dph2;
    const dph3 = dphi + 0.5 * RK4_DT_S * k2_ddph;
    const [k3_ddth, k3_ddal, k3_ddph] = computeAttachedAccelerations(
      th3,
      dth3,
      al3,
      dal3,
      ph3,
      dph3,
      onTrough
    );

    const th4 = theta + RK4_DT_S * dth3;
    const dth4 = dtheta + RK4_DT_S * k3_ddth;
    const al4 = hinged ? alpha + RK4_DT_S * dal3 : lockAngleSumRad - th4;
    const dal4 = hinged ? dalpha + RK4_DT_S * k3_ddal : -dth4;
    const ph4 = phi + RK4_DT_S * dph3;
    const dph4 = dphi + RK4_DT_S * k3_ddph;
    const [k4_ddth, k4_ddal, k4_ddph] = computeAttachedAccelerations(
      th4,
      dth4,
      al4,
      dal4,
      ph4,
      dph4,
      onTrough
    );

    theta += (RK4_DT_S / 6) * (dtheta + 2 * dth2 + 2 * dth3 + dth4);
    dtheta += (RK4_DT_S / 6) * (k1_ddth + 2 * k2_ddth + 2 * k3_ddth + k4_ddth);
    if (hinged) {
      alpha += (RK4_DT_S / 6) * (dalpha + 2 * dal2 + 2 * dal3 + dal4);
      dalpha += (RK4_DT_S / 6) * (k1_ddal + 2 * k2_ddal + 2 * k3_ddal + k4_ddal);
    } else {
      alpha = lockAngleSumRad - theta;
      dalpha = -dtheta;
    }
    phi += (RK4_DT_S / 6) * (dphi + 2 * dph2 + 2 * dph3 + dph4);
    dphi += (RK4_DT_S / 6) * (k1_ddph + 2 * k2_ddph + 2 * k3_ddph + k4_ddph);

    t += RK4_DT_S;
    stepCount += 1;

    const currentBoxY = Ls * Math.cos(theta) - Lh * Math.cos(alpha);
    if (currentBoxY < minBoxY) minBoxY = currentBoxY;

    projX = -Ll * Math.sin(theta) - Lp * Math.sin(phi);
    projY = Ha - Ll * Math.cos(theta) - Lp * Math.cos(phi);
    if (onTrough && projY < proj.radiusM) {
      projY = proj.radiusM;
    }
    projVx = -Ll * Math.cos(theta) * dtheta - Lp * Math.cos(phi) * dphi;
    projVy = Ll * Math.sin(theta) * dtheta + Lp * Math.sin(phi) * dphi;
    if (projY > maxHeightM) maxHeightM = projY;

    const slipPhi = computeSlipSlingAngleRad(theta, prongAngleDeg, Lp, hinged, isBeamOverload);
    const shouldRelease = !onTrough && phi >= slipPhi && dphi > 0;
    const hitGroundOnHook = !onTrough && t > 0.55 && projY <= proj.radiusM && projVy < 0;

    if (shouldRelease || hitGroundOnHook) {
      attachedToSling = false;
      releaseTimeS = t;
      releaseSpeedMs = Math.hypot(projVx, projVy);
      releaseAngleDeg = (Math.atan2(projVy, projVx) * 180) / Math.PI;
      if (hitGroundOnHook) {
        slammedWhileAttached = true;
        projY = 0;
      }
      pushKeyframe(t, theta, alpha, projX, projY, projVx, projVy, false);
      break;
    }

    if (stepCount % KEYFRAME_STRIDE === 0) {
      pushKeyframe(t, theta, alpha, projX, projY, projVx, projVy, true);
    }
  }

  // Zabezpieczenie na wypadek skrajnego braku zwolnienia w oknie czasowym
  if (attachedToSling) {
    attachedToSling = false;
    releaseTimeS = t;
    releaseSpeedMs = Math.hypot(projVx, projVy);
    releaseAngleDeg = (Math.atan2(projVy, projVx) * 180) / Math.PI;
  }

  // Bilans energetyczny w chwili wyrzutu pocisku (mierzony jednorodnie względem faktycznego spadku ŚM skrzyni Δy_box)
  const kineticEnergyKj = (0.5 * m * releaseSpeedMs * releaseSpeedMs) / 1000;
  const actualBoxDropM = Math.max(0.5, initialBoxY - minBoxY);
  const potentialEnergyDropKj = (M * GRAVITY_MS2 * actualBoxDropM) / 1000;
  const energyEfficiencyPct = clamp((kineticEnergyKj / Math.max(1e-3, potentialEnergyDropKj)) * 100, 0, 95);

  // ==================== ETAP 3: LOT BALISTYCZNY Z OPOREM POWIETRZA I KOLIZJAMI ====================
  const targetDistanceM = mission?.castleDistanceM ?? 205;
  const targetCenterYM = mission?.targetCenterYM ?? 9.5;
  const targetRadiusM = mission?.targetRadiusM ?? 3.8;
  const targetZone: TargetZoneKind = mission?.targetZone ?? "kurtyna";

  const castleBoxes = getCastleCollisionBoxes(targetDistanceM, targetZone);

  const computeBallisticAccel = (vx: number, vy: number): [number, number] => {
    const vRelX = vx - windSpeedMs;
    const vRelY = vy;
    const vRelMag = Math.hypot(vRelX, vRelY);
    const kDrag = (-0.5 * AIR_DENSITY_KGM3 * proj.dragCoeff * projAreaM2 * vRelMag) / m;
    return [kDrag * vRelX, -GRAVITY_MS2 + kDrag * vRelY];
  };

  let hitBox: CastleStructureBox | null = null;
  let impactTimeS = t;
  let impactDistanceM = projX;
  let impactHeightM = Math.max(0, projY);
  let impactSpeedMs = releaseSpeedMs;

  if (!slammedWhileAttached) {
    while (t < MAX_SIM_TIME_S) {
      const prevX = projX;
      const prevY = projY;
      const prevVx = projVx;
      const prevVy = projVy;
      const prevT = t;

      // 1) Krok RK4 pocisku w powietrzu
      const [ax1, ay1] = computeBallisticAccel(projVx, projVy);
      const vx2 = projVx + 0.5 * RK4_DT_S * ax1;
      const vy2 = projVy + 0.5 * RK4_DT_S * ay1;
      const [ax2, ay2] = computeBallisticAccel(vx2, vy2);
      const vx3 = projVx + 0.5 * RK4_DT_S * ax2;
      const vy3 = projVy + 0.5 * RK4_DT_S * ay2;
      const [ax3, ay3] = computeBallisticAccel(vx3, vy3);
      const vx4 = projVx + RK4_DT_S * ax3;
      const vy4 = projVy + RK4_DT_S * ay3;
      const [ax4, ay4] = computeBallisticAccel(vx4, vy4);

      projX += (RK4_DT_S / 6) * (projVx + 2 * vx2 + 2 * vx3 + vx4);
      projY += (RK4_DT_S / 6) * (projVy + 2 * vy2 + 2 * vy3 + vy4);
      projVx += (RK4_DT_S / 6) * (ax1 + 2 * ax2 + 2 * ax3 + ax4);
      projVy += (RK4_DT_S / 6) * (ay1 + 2 * ay2 + 2 * ay3 + ay4);

      // 2) Równoległy krok RK4 swobodnie wahającej się belki i skrzyni po wyrzucie
      const dtRel = t - releaseTimeS;
      const [b1_ddth, b1_ddal] = computeUnloadedBeamAccelerations(theta, dtheta, alpha, dalpha, dtRel);
      const b_th2 = theta + 0.5 * RK4_DT_S * dtheta;
      const b_dth2 = dtheta + 0.5 * RK4_DT_S * b1_ddth;
      const b_al2 = hinged ? alpha + 0.5 * RK4_DT_S * dalpha : lockAngleSumRad - b_th2;
      const b_dal2 = hinged ? dalpha + 0.5 * RK4_DT_S * b1_ddal : -b_dth2;
      const [b2_ddth, b2_ddal] = computeUnloadedBeamAccelerations(
        b_th2,
        b_dth2,
        b_al2,
        b_dal2,
        dtRel + 0.5 * RK4_DT_S
      );

      const b_th3 = theta + 0.5 * RK4_DT_S * b_dth2;
      const b_dth3 = dtheta + 0.5 * RK4_DT_S * b2_ddth;
      const b_al3 = hinged ? alpha + 0.5 * RK4_DT_S * b_dal2 : lockAngleSumRad - b_th3;
      const b_dal3 = hinged ? dalpha + 0.5 * RK4_DT_S * b2_ddal : -b_dth3;
      const [b3_ddth, b3_ddal] = computeUnloadedBeamAccelerations(
        b_th3,
        b_dth3,
        b_al3,
        b_dal3,
        dtRel + 0.5 * RK4_DT_S
      );

      const b_th4 = theta + RK4_DT_S * b_dth3;
      const b_dth4 = dtheta + RK4_DT_S * b3_ddth;
      const b_al4 = hinged ? alpha + RK4_DT_S * b_dal3 : lockAngleSumRad - b_th4;
      const b_dal4 = hinged ? dalpha + RK4_DT_S * b3_ddal : -b_dth4;
      const [b4_ddth, b4_ddal] = computeUnloadedBeamAccelerations(
        b_th4,
        b_dth4,
        b_al4,
        b_dal4,
        dtRel + RK4_DT_S
      );

      theta += (RK4_DT_S / 6) * (dtheta + 2 * b_dth2 + 2 * b_dth3 + b_dth4);
      dtheta += (RK4_DT_S / 6) * (b1_ddth + 2 * b2_ddth + 2 * b3_ddth + b4_ddth);
      if (hinged) {
        alpha += (RK4_DT_S / 6) * (dalpha + 2 * b_dal2 + 2 * b_dal3 + b_dal4);
        dalpha += (RK4_DT_S / 6) * (b1_ddal + 2 * b2_ddal + 2 * b3_ddal + b4_ddal);
      } else {
        alpha = lockAngleSumRad - theta;
        dalpha = -dtheta;
      }

      t += RK4_DT_S;
      stepCount += 1;
      if (projY > maxHeightM) maxHeightM = projY;

      // 3) Detekcja kolizji z bryłami zamku (szukamy najwcześniejszego przecięcia w kroku)
      let bestU = 2.0;
      let candidateBox: CastleStructureBox | null = null;
      for (const box of castleBoxes) {
        const uHit = intersectSegmentWithBox(prevX, prevY, projX, projY, box, proj.radiusM);
        if (uHit !== null && uHit < bestU) {
          bestU = uHit;
          candidateBox = box;
        }
      }

      if (candidateBox !== null) {
        hitBox = candidateBox;
        impactTimeS = prevT + bestU * RK4_DT_S;
        impactDistanceM = prevX + bestU * (projX - prevX);
        impactHeightM = Math.max(0, prevY + bestU * (projY - prevY));
        const hitVx = prevVx + bestU * (projVx - prevVx);
        const hitVy = prevVy + bestU * (projVy - prevVy);
        impactSpeedMs = Math.hypot(hitVx, hitVy);
        pushKeyframe(impactTimeS, theta, alpha, impactDistanceM, impactHeightM, hitVx, hitVy, false);
        break;
      }

      // 4) Detekcja uderzenia w grunt / fosę (y <= 0)
      if (projY <= 0) {
        const denom = prevY - projY;
        const uGround = denom > 1e-9 ? clamp(prevY / denom, 0, 1) : 1;
        impactTimeS = prevT + uGround * RK4_DT_S;
        impactDistanceM = prevX + uGround * (projX - prevX);
        impactHeightM = 0;
        const gVx = prevVx + uGround * (projVx - prevVx);
        const gVy = prevVy + uGround * (projVy - prevVy);
        impactSpeedMs = Math.hypot(gVx, gVy);
        pushKeyframe(impactTimeS, theta, alpha, impactDistanceM, 0, gVx, gVy, false);
        break;
      }

      if (stepCount % KEYFRAME_STRIDE === 0) {
        pushKeyframe(t, theta, alpha, projX, projY, projVx, projVy, false);
      }
    }
  }

  // ==================== ETAP 4: KLASYFIKACJA WYNIKU, CEGŁY I PUNKTACJA ====================
  const distanceErrorM = Math.hypot(impactDistanceM - targetDistanceM, impactHeightM - targetCenterYM);
  const impactEnergyKj = (0.5 * m * impactSpeedMs * impactSpeedMs) / 1000;

  const rearOfCastleX = Math.max(...castleBoxes.map((b) => b.xMax));

  let outcome: ShotOutcomeKind;
  if (impactDistanceM < -8) {
    outcome = "camp_backfire";
  } else if (
    (prongAngleDeg >= 8 && prongAngleDeg <= 13 && impactDistanceM <= 18) ||
    (Math.abs(impactDistanceM) <= 14 && maxHeightM > 45)
  ) {
    outcome = "zenith_self_hit";
  } else if (isBeamOverload) {
    outcome = "beam_overload";
  } else if (
    slammedWhileAttached ||
    prongAngleDeg >= 62 ||
    (releaseAngleDeg < 6 && impactDistanceM >= 6 && impactDistanceM <= 60 && hitBox === null)
  ) {
    outcome = "ground_slam";
  } else if (hitBox !== null) {
    if (hitBox.id === "gdanisko") {
      outcome = "gdanisko_hit";
    } else if (distanceErrorM <= targetRadiusM) {
      outcome = "direct_target";
    } else {
      outcome = "wall_hit";
    }
  } else if (impactDistanceM > rearOfCastleX) {
    outcome = "overshot";
  } else {
    outcome = "short_moat";
  }

  // Liczba skruszonych bloków cegieł / belek — zależna od energii kinetycznej uderzenia [kJ] i materiału
  let bricksDislodged = 0;
  if (hitBox !== null && outcome !== "beam_overload") {
    let materialMultiplier = hitBox.fragilityFactor;
    if (proj.isIncendiary) {
      // Beczka ze smołą i dziegciem niszczy drewniane hurdycje i ganki, lecz słabiej kruszy lity mur ceglany
      materialMultiplier *= hitBox.id === "hurdycje" || hitBox.id === "gdanisko" ? 1.45 : 0.42;
    } else if (m >= 140) {
      // Ciężki eratyk 145 kg rozsadza spoiny wapienne w murze opus emplectum
      materialMultiplier *= 1.28;
    }
    bricksDislodged = Math.max(4, Math.round((impactEnergyKj / 3.2) * materialMultiplier));
  }

  // Punktacja pojedynczej salwy (0..250 pkt, tak by 4 perfekcyjne salwy dawały 1000 pkt)
  let salvoScore = 0;
  if (
    outcome === "camp_backfire" ||
    outcome === "zenith_self_hit" ||
    outcome === "ground_slam"
  ) {
    salvoScore = 0;
  } else if (outcome === "beam_overload") {
    salvoScore = hitBox !== null ? 25 : 0;
  } else if (outcome === "gdanisko_hit") {
    if (targetZone === "gdanisko_wykusz") {
      // Salwa IV: główne trafienie mistrzowskie w wykusz i arkadę Gdaniska!
      const coreErrorM = Math.max(0, distanceErrorM - 1.1);
      const effectiveSpan = Math.max(1, targetRadiusM - 1.1);
      const bullseyeRatio = clamp(coreErrorM / effectiveSpan, 0, 2.5);
      const accuracyPts =
        bullseyeRatio <= 1
          ? 250 - bullseyeRatio * 28
          : 222 - (bullseyeRatio - 1) * 42;
      salvoScore = clamp(Math.round(accuracyPts), 165, 250);
    } else {
      // Sekretne trafienie w Gdanisko podczas innej salwy — solidna premia honorowa!
      salvoScore = clamp(Math.round(178 - Math.min(35, distanceErrorM * 0.6)), 140, 185);
    }
  } else if (outcome === "direct_target") {
    const coreErrorM = Math.max(0, distanceErrorM - 1.1);
    const effectiveSpan = Math.max(1, targetRadiusM - 1.1);
    const ratio = clamp(coreErrorM / effectiveSpan, 0, 1);
    const synergyBonus =
      (targetZone === "hurdycje" && (proj.isIncendiary || m <= 70)) ||
      (targetZone === "kurtyna" && !proj.isIncendiary && m >= 100) ||
      (targetZone === "wieza_bramna" && m >= 100)
        ? 6
        : 0;
    const rawPts = 250 - ratio * 40 + synergyBonus;
    salvoScore = clamp(Math.round(rawPts), 205, 250);
  } else if (outcome === "wall_hit") {
    const excessErr = Math.max(0, distanceErrorM - targetRadiusM);
    const rawPts = 198 - excessErr * 7.2;
    salvoScore = clamp(Math.round(rawPts), 95, 198);
  } else {
    // Bliskie obramowanie celu w fosie (short_moat) lub tuż za murem (overshot)
    const rawNearMiss = 92 - distanceErrorM * 3.1;
    salvoScore = clamp(Math.round(rawNearMiss), 0, 88);
  }

  return {
    frames,
    releaseTimeS: Number(releaseTimeS.toFixed(3)),
    impactTimeS: Number(impactTimeS.toFixed(3)),
    releaseSpeedMs: Number(releaseSpeedMs.toFixed(2)),
    releaseSpeedKmh: Number((releaseSpeedMs * 3.6).toFixed(1)),
    releaseAngleDeg: Number(releaseAngleDeg.toFixed(1)),
    kineticEnergyKj: Number(kineticEnergyKj.toFixed(1)),
    impactKineticEnergyKj: Number(impactEnergyKj.toFixed(1)),
    potentialEnergyDropKj: Number(potentialEnergyDropKj.toFixed(1)),
    energyEfficiencyPct: Number(energyEfficiencyPct.toFixed(1)),
    maxHeightM: Number(maxHeightM.toFixed(1)),
    impactDistanceM: Number(impactDistanceM.toFixed(1)),
    impactHeightM: Number(impactHeightM.toFixed(1)),
    impactSpeedMs: Number(impactSpeedMs.toFixed(2)),
    outcome,
    bricksDislodged,
    salvoScore,
    distanceErrorM: Number(distanceErrorM.toFixed(1)),
  };
}
