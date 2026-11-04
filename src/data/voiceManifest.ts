import { assetUrl } from "@/lib/config";
import type { VoiceEventId } from "@/types/trebuchet";

export type VoicePriority = 1 | 2 | 3;

export interface VoiceClipMeta {
  clipId: string;
  event: VoiceEventId;
  categoryLabel: string;
  fileUrl: string;
  /** Rzeczywisty czas trwania pliku MP3 zmierzony przez ffprobe [ms] */
  durationMs: number;
  /** Priorytet arbitrażu: 1 = wskazówka eksploracyjna, 2 = taktyka/wynik salwy, 3 = kulminacja/alarm */
  priority: VoicePriority;
  /** Minimalny odstęp czasu przed ponownym automatycznym wyzwoleniem tej samej kwestii [ms] */
  cooldownMs: number;
  /** Czysty tekst napisów PL wyświetlany w HUD (także przy wyciszonym dźwięku) */
  subtitlePl: string;
}

export const VOICE_MANIFEST: Record<VoiceEventId, VoiceClipMeta> = {
  intro: {
    clipId: "vo-01",
    event: "intro",
    categoryLabel: "Wzgórze oblężnicze",
    fileUrl: assetUrl("/audio/vo-01.mp3"),
    durationMs: 7600,
    priority: 2,
    cooldownMs: 15000,
    subtitlePl:
      "Czternasty wiek, a przed tobą naładowana blida! Wygnij żelazny palec albo od razu szarpnij sznur spustowy.",
  },
  first_touch: {
    clipId: "vo-02",
    event: "first_touch",
    categoryLabel: "Mechanika dźwigni",
    fileUrl: assetUrl("/audio/vo-02.mp3"),
    durationMs: 5920,
    priority: 1,
    cooldownMs: 20000,
    subtitlePl:
      "Słyszysz, jak trzeszczy dębowa belka? Kilka ton kamieni w skrzyni już czeka na twój znak.",
  },
  prong_adjust: {
    clipId: "vo-03",
    event: "prong_adjust",
    categoryLabel: "Palec spustowy",
    fileUrl: assetUrl("/audio/vo-03.mp3"),
    durationMs: 8240,
    priority: 1,
    cooldownMs: 18000,
    subtitlePl:
      "Cały sekret tkwi w żelaznym palcu! Ułamek kąta decyduje, kiedy siła odśrodkowa zsunie pierścień procy.",
  },
  hinge_locked: {
    clipId: "vo-04",
    event: "hinge_locked",
    categoryLabel: "Fizyka przeciwwagi",
    fileUrl: assetUrl("/audio/vo-04.mp3"),
    durationMs: 6600,
    priority: 2,
    cooldownMs: 12000,
    subtitlePl:
      "Skrzynia zablokowana na sztywno? Odważny eksperyment — bez wahadła ucieknie ci prawie jedna trzecia mocy rzutu!",
  },
  camp_backfire: {
    clipId: "vo-05",
    event: "camp_backfire",
    categoryLabel: "Alarm w obozie!",
    fileUrl: assetUrl("/audio/vo-05.mp3"),
    durationMs: 7106,
    priority: 3,
    cooldownMs: 4000,
    subtitlePl:
      "Kryć się! Posłałeś głaz we własny obóz, prosto w kocioł grochówki! Zamek stoi w drugą stronę!",
  },
  zenith_self_hit: {
    clipId: "vo-06",
    event: "zenith_self_hit",
    categoryLabel: "Świeca nad blidą!",
    fileUrl: assetUrl("/audio/vo-06.mp3"),
    durationMs: 7812,
    priority: 3,
    cooldownMs: 4000,
    subtitlePl:
      "Patrz w górę, pionowa świeca! Uciekaj spod belki, bo ten granit zaraz wróci nam na głowy!",
  },
  ground_slam: {
    clipId: "vo-07",
    event: "ground_slam",
    categoryLabel: "Kopanie studni",
    fileUrl: assetUrl("/audio/vo-07.mp3"),
    durationMs: 5802,
    priority: 2,
    cooldownMs: 5000,
    subtitlePl:
      "Piękny lej w błocie! Jeśli nie kopiemy tu studni, zmniejsz nieco kąt na palcu spustowym.",
  },
  short_moat: {
    clipId: "vo-08",
    event: "short_moat",
    categoryLabel: "Plusk w fosie",
    fileUrl: assetUrl("/audio/vo-08.mp3"),
    durationMs: 6199,
    priority: 2,
    cooldownMs: 5000,
    subtitlePl:
      "Karpie w krzyżackiej fosie ogłuszone, ale kurtyna cała! Dołóż kamieni do skrzyni albo skoryguj palec.",
  },
  wall_bounce: {
    clipId: "vo-09",
    event: "wall_bounce",
    categoryLabel: "Mur ceglany",
    fileUrl: assetUrl("/audio/vo-09.mp3"),
    durationMs: 7851,
    priority: 2,
    cooldownMs: 4500,
    subtitlePl:
      "Ceglana kurtyna zadrżała, lecz gruby rdzeń muru stłumił uderzenie! Skoryguj kąt i bij prosto w cel.",
  },
  near_miss: {
    clipId: "vo-10",
    event: "near_miss",
    categoryLabel: "O włos od celu!",
    fileUrl: assetUrl("/audio/vo-10.mp3"),
    durationMs: 6006,
    priority: 2,
    cooldownMs: 4500,
    subtitlePl:
      "O włos od celu! Dosłownie dwa stopnie na palcu spustowym i zamek Zakonu zadrży w posadach!",
  },
  direct_hit: {
    clipId: "vo-11",
    event: "direct_hit",
    categoryLabel: "Celne trafienie!",
    fileUrl: assetUrl("/audio/vo-11.mp3"),
    durationMs: 6013,
    priority: 3,
    cooldownMs: 3000,
    subtitlePl:
      "W sam środek! Gotycka cegła i dębowe hurdycje pękają w drzazgi jak pod murami Kowna!",
  },
  gdanisko_hit: {
    clipId: "vo-12",
    event: "gdanisko_hit",
    categoryLabel: "Sekret: Gdanisko!",
    fileUrl: assetUrl("/audio/vo-12.mp3"),
    durationMs: 6674,
    priority: 3,
    cooldownMs: 3000,
    subtitlePl:
      "Trafiłeś w samo krzyżackie gdanisko nad fosą! Morale załogi właśnie runęło prosto do wody!",
  },
  campaign_high: {
    clipId: "vo-13",
    event: "campaign_high",
    categoryLabel: "Triumf Mistrza Blidy",
    fileUrl: assetUrl("/audio/vo-13.mp3"),
    durationMs: 7034,
    priority: 3,
    cooldownMs: 2000,
    subtitlePl:
      "Mistrzowska robota, puszkarzu! Mury Zakonu leżą w gruzach — rzuć teraz rękawicę znajomym i sprawdź ich celność!",
  },
  campaign_low: {
    clipId: "vo-14",
    event: "campaign_low",
    categoryLabel: "Czas na rewanż",
    fileUrl: assetUrl("/audio/vo-14.mp3"),
    durationMs: 6878,
    priority: 3,
    cooldownMs: 2000,
    subtitlePl:
      "Zamek jeszcze stoi, ale każdy mistrz blidy zaczynał od dziur w łące. Naciągaj linę do rewanżu!",
  },
  beat_rival: {
    clipId: "vo-15",
    event: "beat_rival",
    categoryLabel: "Rekord pobity!",
    fileUrl: assetUrl("/audio/vo-15.mp3"),
    durationMs: 6630,
    priority: 3,
    cooldownMs: 2000,
    subtitlePl:
      "Rekord pobity! Twój rywal właśnie stracił tytuł mistrza oblężeń — odeślij mu wynik, niech sam zobaczy!",
  },
};

export const VOICE_CLIPS: readonly VoiceClipMeta[] = Object.values(VOICE_MANIFEST);

export function getVoiceClip(event: VoiceEventId): VoiceClipMeta {
  return VOICE_MANIFEST[event];
}

export function getVoiceClipById(clipId: string): VoiceClipMeta | undefined {
  return VOICE_CLIPS.find((clip) => clip.clipId === clipId);
}
