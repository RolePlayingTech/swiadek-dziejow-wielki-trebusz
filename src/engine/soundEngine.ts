"use client";

import { VOICE_CLIPS, VOICE_MANIFEST, type VoiceClipMeta } from "@/data/voiceManifest";
import type { ShotOutcomeKind, ShotSimulationResult, VoiceEventId, VoiceSubtitlePayload } from "@/types/trebuchet";

export const MUTE_STORAGE_KEY = "swiadek_trebusz_muted" as const;

/** -5 dB sidechain ducking gain: 10^(-5/20) ≈ 0.5623413 */
const DUCK_LINEAR_GAIN = Math.pow(10, -5 / 20);
/** 80 ms linear fade-out when interrupting an active Świadek voiceover */
const VOICE_FADEOUT_SEC = 0.08;
/** Post-speech reading grace period for subtitles in HUD [ms] */
const SUBTITLE_HOLD_AFTER_END_MS = 1350;

export interface TriggerVoiceOptions {
  /** Pomiń cooldown i przebij priorytet (np. ręczny przycisk Powtórz lub finał kampanii) */
  force?: boolean;
  /** Odcisz automatycznie przy jawnym kliknięciu użytkownika w medalion Świadka */
  unmuteIfExplicit?: boolean;
}

interface ActiveUtterance {
  generation: number;
  clip: VoiceClipMeta;
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAtMs: number;
}

type SubtitleListener = (payload: VoiceSubtitlePayload | null) => void;
type MuteListener = (muted: boolean) => void;

function clamp(val: number, min: number, max: number): number {
  if (!Number.isFinite(val)) return min;
  return Math.min(max, Math.max(min, val));
}

function readStoredMute(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage.getItem(MUTE_STORAGE_KEY);
    return raw === "1" || raw === "true";
  } catch {
    return false;
  }
}

function writeStoredMute(muted: boolean): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(MUTE_STORAGE_KEY, muted ? "1" : "0");
  } catch {
    // Ignore storage quota / private mode restrictions
  }
}

/**
 * Reżyser Głosu Świadka Dziejów (HostVoiceDirector):
 * - Dekoduje klipy MP3 do AudioBuffer w tle (cache ArrayBuffer + AudioBuffer)
 * - Przerywa starszą kwestię miękką rampą liniową 80 ms (ZERO nakładania się dwóch głosów)
 * - Arbitruje priorytety (1..3) oraz indywidualne czasy odnowienia (cooldownMs)
 * - Steruje automatycznym sidechain duckingiem szyny SFX o -5 dB podczas mowy
 * - Obsługuje zapis Mute w localStorage ("swiadek_trebusz_muted")
 * - Emituje napisy PL (subtitlePl) także przy wyciszonym dźwięku
 */
export class HostVoiceDirector {
  private getContext: () => AudioContext | null;
  private getVoiceBus: () => GainNode | null;
  private setSfxDucked: (ducked: boolean) => void;
  private onMuteChangedInternal?: (muted: boolean) => void;

  private muted: boolean = false;
  private hydratedMute: boolean = false;

  private rawBufferCache = new Map<string, Promise<ArrayBuffer>>();
  private decodedBufferCache = new Map<string, AudioBuffer>();
  private preloadStarted = false;

  private playGeneration = 0;
  private fadeOutEndsAtCtxTime = 0;
  private activeUtterance: ActiveUtterance | null = null;
  private activeLogicalClip: { clip: VoiceClipMeta; startedAtMs: number; expiresAtMs: number } | null = null;
  private lastTriggeredClip: VoiceClipMeta | null = null;
  private lastPlayedAtByEvent = new Map<VoiceEventId, number>();

  private currentSubtitle: VoiceSubtitlePayload | null = null;
  private subtitleEndTimer: ReturnType<typeof setTimeout> | null = null;
  private subtitleClearTimer: ReturnType<typeof setTimeout> | null = null;

  private subtitleListeners = new Set<SubtitleListener>();
  private muteListeners = new Set<MuteListener>();

  constructor(deps: {
    getContext: () => AudioContext | null;
    getVoiceBus: () => GainNode | null;
    setSfxDucked: (ducked: boolean) => void;
    onMuteChanged?: (muted: boolean) => void;
  }) {
    this.getContext = deps.getContext;
    this.getVoiceBus = deps.getVoiceBus;
    this.setSfxDucked = deps.setSfxDucked;
    this.onMuteChangedInternal = deps.onMuteChanged;
  }

  public syncMuteFromStorage(): boolean {
    if (!this.hydratedMute && typeof window !== "undefined") {
      this.hydratedMute = true;
      this.muted = readStoredMute();
    }
    return this.muted;
  }

  public isMuted(): boolean {
    return this.syncMuteFromStorage();
  }

  public setMuted(muted: boolean): void {
    this.hydratedMute = true;
    const prev = this.muted;
    this.muted = muted;
    writeStoredMute(muted);
    this.onMuteChangedInternal?.(muted);

    if (muted) {
      const muteGen = ++this.playGeneration;
      this.clearSubtitleTimers();
      this.fadeOutActiveAudioOnly();
      this.setSfxDucked(false);
      if (this.currentSubtitle) {
        this.emitSubtitle({
          ...this.currentSubtitle,
          isAudioPlaying: false,
        });
        this.subtitleClearTimer = setTimeout(() => {
          if (this.playGeneration !== muteGen) return;
          this.activeLogicalClip = null;
          this.emitSubtitle(null);
        }, SUBTITLE_HOLD_AFTER_END_MS + 650);
      } else {
        this.activeLogicalClip = null;
      }
    }

    if (prev !== muted) {
      this.muteListeners.forEach((fn) => fn(muted));
    }
  }

  public toggleMute(): boolean {
    const next = !this.isMuted();
    this.setMuted(next);
    return next;
  }

  public subscribeMute(listener: MuteListener): () => void {
    this.syncMuteFromStorage();
    this.muteListeners.add(listener);
    listener(this.muted);
    return () => {
      this.muteListeners.delete(listener);
    };
  }

  public subscribeSubtitle(listener: SubtitleListener): () => void {
    this.subtitleListeners.add(listener);
    listener(this.currentSubtitle);
    return () => {
      this.subtitleListeners.delete(listener);
    };
  }

  public getCurrentSubtitle(): VoiceSubtitlePayload | null {
    return this.currentSubtitle;
  }

  public getLastClip(): VoiceClipMeta | null {
    return this.lastTriggeredClip;
  }

  /**
   * Asynchroniczne ładowanie i dekodowanie klipów w tle (najpierw kluczowe kwestie startowe,
   * potem reszta z niską współbieżnością).
   */
  public preloadInBackground(): void {
    if (typeof window === "undefined" || this.preloadStarted) return;
    this.preloadStarted = true;

    const ordered: VoiceClipMeta[] = [
      VOICE_MANIFEST.intro,
      VOICE_MANIFEST.first_touch,
      VOICE_MANIFEST.prong_adjust,
      VOICE_MANIFEST.direct_hit,
      ...VOICE_CLIPS.filter(
        (c) =>
          c.event !== "intro" &&
          c.event !== "first_touch" &&
          c.event !== "prong_adjust" &&
          c.event !== "direct_hit"
      ),
    ];

    let index = 0;
    const worker = async (): Promise<void> => {
      while (index < ordered.length) {
        const current = ordered[index];
        index += 1;
        if (!current) continue;
        try {
          const raw = await this.fetchRawArrayBuffer(current);
          const ctx = this.getContext();
          if (ctx && !this.decodedBufferCache.has(current.clipId)) {
            const decoded = await ctx.decodeAudioData(raw.slice(0));
            this.decodedBufferCache.set(current.clipId, decoded);
          }
        } catch {
          // Ciche pominięcie błędu sieciowego w preloadzie; ponowi próbę przy odtworzeniu
        }
      }
    };

    // Dwa lekkie strumienie w tle bez blokowania głównego wątku
    void worker();
    void worker();
  }

  private fetchRawArrayBuffer(clip: VoiceClipMeta): Promise<ArrayBuffer> {
    const existing = this.rawBufferCache.get(clip.clipId);
    if (existing) return existing;

    const promise = fetch(clip.fileUrl, { cache: "force-cache" })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`HTTP ${res.status} for ${clip.fileUrl}`);
        }
        return res.arrayBuffer();
      })
      .catch((err) => {
        this.rawBufferCache.delete(clip.clipId);
        throw err;
      });

    this.rawBufferCache.set(clip.clipId, promise);
    return promise;
  }

  private async getDecodedAudioBuffer(clip: VoiceClipMeta, ctx: AudioContext): Promise<AudioBuffer> {
    const cached = this.decodedBufferCache.get(clip.clipId);
    if (cached) return cached;

    const raw = await this.fetchRawArrayBuffer(clip);
    const decoded = await ctx.decodeAudioData(raw.slice(0));
    this.decodedBufferCache.set(clip.clipId, decoded);
    return decoded;
  }

  private clearSubtitleTimers(): void {
    if (this.subtitleEndTimer !== null) {
      clearTimeout(this.subtitleEndTimer);
      this.subtitleEndTimer = null;
    }
    if (this.subtitleClearTimer !== null) {
      clearTimeout(this.subtitleClearTimer);
      this.subtitleClearTimer = null;
    }
  }

  private emitSubtitle(payload: VoiceSubtitlePayload | null): void {
    this.currentSubtitle = payload;
    this.subtitleListeners.forEach((fn) => fn(payload));
  }

  /**
   * Miękkie wyciszenie aktualnie grającego źródła głosu rampą liniową 80 ms.
   * Zapewnia absolutny brak nakładania się dwóch kwestii naraz.
   */
  private fadeOutActiveAudioOnly(): void {
    const active = this.activeUtterance;
    if (!active) return;
    this.activeUtterance = null;

    const ctx = this.getContext();
    if (!ctx) {
      try {
        active.source.stop();
        active.source.disconnect();
        active.gain.disconnect();
      } catch {
        // Ignoruj błędy zamkniętego kontekstu
      }
      return;
    }

    const now = ctx.currentTime;
    const fadeEnd = now + VOICE_FADEOUT_SEC;
    this.fadeOutEndsAtCtxTime = Math.max(this.fadeOutEndsAtCtxTime, fadeEnd);

    try {
      const currentGain = clamp(active.gain.gain.value, 0.0001, 1.2);
      active.gain.gain.cancelScheduledValues(now);
      active.gain.gain.setValueAtTime(currentGain, now);
      active.gain.gain.linearRampToValueAtTime(0.0001, fadeEnd);
      active.source.onended = null;
      active.source.stop(fadeEnd + 0.004);
    } catch {
      // Jeśli źródło już się zatrzymało
    }

    setTimeout(() => {
      try {
        active.source.disconnect();
        active.gain.disconnect();
      } catch {
        // Bezpieczne sprzątanie węzłów
      }
    }, Math.ceil(VOICE_FADEOUT_SEC * 1000) + 30);
  }

  public stop(): void {
    this.playGeneration += 1;
    this.clearSubtitleTimers();
    this.fadeOutActiveAudioOnly();
    this.activeLogicalClip = null;
    this.setSfxDucked(false);
    this.emitSubtitle(null);
  }

  public dismissSubtitle(): void {
    this.clearSubtitleTimers();
    this.emitSubtitle(null);
  }

  /**
   * Powtarza ostatnią kwestię Świadka Dziejów (np. po kliknięciu w medalion w HUD).
   */
  public replayLast(): boolean {
    const clip = this.lastTriggeredClip ?? VOICE_MANIFEST.intro;
    return this.trigger(clip.event, { force: true, unmuteIfExplicit: true });
  }

  /**
   * Główny punkt wyzwalania komentarza głosowego Świadka Dziejów z arbitrażem priorytetów i cooldownów.
   */
  public trigger(event: VoiceEventId, options: TriggerVoiceOptions = {}): boolean {
    if (typeof window === "undefined") return false;
    this.syncMuteFromStorage();

    const clip = VOICE_MANIFEST[event];
    if (!clip) return false;

    if (options.unmuteIfExplicit && this.muted) {
      this.setMuted(false);
    }

    const nowMs = performance.now();
    const force = Boolean(options.force);

    if (!force) {
      // 1. Sprawdzenie cooldownu dla tego konkretnego zdarzenia
      const prevPlayedAt = this.lastPlayedAtByEvent.get(event);
      if (prevPlayedAt !== undefined && nowMs - prevPlayedAt < clip.cooldownMs) {
        return false;
      }

      // 2. Arbitraż priorytetów wobec aktualnie trwającej kwestii
      if (this.activeLogicalClip && nowMs < this.activeLogicalClip.expiresAtMs - 140) {
        if (clip.priority < this.activeLogicalClip.clip.priority) {
          return false;
        }
      }
    }

    // Zaakceptowano kwestię do emisji!
    this.lastPlayedAtByEvent.set(event, nowMs);
    this.lastTriggeredClip = clip;
    this.preloadInBackground();

    const myGen = ++this.playGeneration;
    this.clearSubtitleTimers();
    this.fadeOutActiveAudioOnly();

    this.activeLogicalClip = {
      clip,
      startedAtMs: nowMs,
      expiresAtMs: nowMs + clip.durationMs,
    };

    // Jeśli wyciszone — emitujemy pełne napisy PL bez odtwarzania audio
    if (this.muted) {
      this.setSfxDucked(false);
      this.emitSubtitleOnlyWindow(clip, myGen);
      return true;
    }

    void this.playClipBufferAsync(clip, myGen);
    return true;
  }

  private emitSubtitleOnlyWindow(clip: VoiceClipMeta, generation: number): void {
    this.emitSubtitle({
      clipId: clip.clipId,
      event: clip.event,
      categoryLabel: clip.categoryLabel,
      subtitlePl: clip.subtitlePl,
      durationMs: clip.durationMs,
      isAudioPlaying: false,
    });

    this.subtitleClearTimer = setTimeout(() => {
      if (this.playGeneration !== generation) return;
      this.activeLogicalClip = null;
      this.emitSubtitle(null);
    }, clip.durationMs + SUBTITLE_HOLD_AFTER_END_MS);
  }

  private async playClipBufferAsync(clip: VoiceClipMeta, generation: number): Promise<void> {
    const ctx = this.getContext();
    const voiceBus = this.getVoiceBus();

    if (!ctx || !voiceBus) {
      if (this.playGeneration === generation) {
        this.emitSubtitleOnlyWindow(clip, generation);
      }
      return;
    }

    // Próba wybudzenia AudioContext; jeśli przeglądarka blokuje autoplay przed pierwszym gestem,
    // natychmiast pokazujemy napisy bez kolejkowania zamrożonego źródła audio.
    if (ctx.state === "suspended") {
      try {
        await Promise.race([
          ctx.resume(),
          new Promise<void>((resolve) => setTimeout(resolve, 75)),
        ]);
      } catch {
        // Ignoruj błąd autoplay
      }
    }

    if (this.playGeneration !== generation) return;

    if (ctx.state !== "running" || this.muted) {
      this.setSfxDucked(false);
      this.emitSubtitleOnlyWindow(clip, generation);
      return;
    }

    // Pokaż napisy od razu na starcie dekodowania
    this.emitSubtitle({
      clipId: clip.clipId,
      event: clip.event,
      categoryLabel: clip.categoryLabel,
      subtitlePl: clip.subtitlePl,
      durationMs: clip.durationMs,
      isAudioPlaying: true,
    });

    let audioBuffer: AudioBuffer;
    try {
      audioBuffer = await this.getDecodedAudioBuffer(clip, ctx);
    } catch {
      if (this.playGeneration === generation) {
        this.setSfxDucked(false);
        this.emitSubtitleOnlyWindow(clip, generation);
      }
      return;
    }

    if (this.playGeneration !== generation || this.muted || ctx.state !== "running") {
      if (this.playGeneration === generation) {
        this.setSfxDucked(false);
        this.emitSubtitleOnlyWindow(clip, generation);
      }
      return;
    }

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;

    const utteranceGain = ctx.createGain();
    const now = ctx.currentTime;
    const startAt = Math.max(now + 0.004, this.fadeOutEndsAtCtxTime);

    utteranceGain.gain.setValueAtTime(0.0001, now);
    utteranceGain.gain.setValueAtTime(0.0001, startAt);
    utteranceGain.gain.linearRampToValueAtTime(1.0, startAt + 0.012);

    source.connect(utteranceGain);
    utteranceGain.connect(voiceBus);

    const realDurationMs = Math.max(clip.durationMs, Math.round(audioBuffer.duration * 1000));
    const waitDelayMs = Math.max(0, Math.round((startAt - now) * 1000));

    this.activeLogicalClip = {
      clip,
      startedAtMs: performance.now(),
      expiresAtMs: performance.now() + waitDelayMs + realDurationMs,
    };

    this.activeUtterance = {
      generation,
      clip,
      source,
      gain: utteranceGain,
      startedAtMs: performance.now() + waitDelayMs,
    };

    // Włącz sidechain ducking -5 dB na szynie efektów fizycznych
    this.setSfxDucked(true);

    this.emitSubtitle({
      clipId: clip.clipId,
      event: clip.event,
      categoryLabel: clip.categoryLabel,
      subtitlePl: clip.subtitlePl,
      durationMs: realDurationMs,
      isAudioPlaying: true,
    });

    source.onended = () => {
      try {
        source.disconnect();
        utteranceGain.disconnect();
      } catch {
        // Bezpieczne odłączenie
      }

      if (this.playGeneration !== generation) return;

      this.activeUtterance = null;
      this.activeLogicalClip = null;
      this.setSfxDucked(false);

      if (this.currentSubtitle && this.currentSubtitle.clipId === clip.clipId) {
        this.emitSubtitle({
          ...this.currentSubtitle,
          isAudioPlaying: false,
        });
      }

      this.subtitleClearTimer = setTimeout(() => {
        if (this.playGeneration !== generation) return;
        this.emitSubtitle(null);
      }, SUBTITLE_HOLD_AFTER_END_MS);
    };

    source.start(startAt);
  }
}

/**
 * Kompletny proceduralny silnik dźwiękowy Web Audio API dla „Wielkiego Trebusza”
 * (zero zewnętrznych plików SFX) + integracja z HostVoiceDirector i sidechain duckingiem -5 dB.
 */
export class TrebuchetSoundEngine {
  private ctx: AudioContext | null = null;
  private sfxDuckGain: GainNode | null = null;
  private sfxBusGain: GainNode | null = null;
  private voiceBusGain: GainNode | null = null;
  private masterCompressor: DynamicsCompressorNode | null = null;
  private masterMuteGain: GainNode | null = null;

  private whiteNoiseBuffer: AudioBuffer | null = null;
  private saturationCurve: Float32Array<ArrayBuffer> | null = null;

  private gestureUnlockBound = false;
  private isSfxCurrentlyDucked = false;

  private lastWinchTickMs = 0;
  private winchRatchetParity = false;
  private lastWoodCreakMs = 0;
  private lastProngBendMs = 0;
  private prevProngAngleDeg = 35;

  public readonly voice: HostVoiceDirector;

  constructor() {
    this.voice = new HostVoiceDirector({
      getContext: () => this.ensureContext(),
      getVoiceBus: () => {
        this.ensureContext();
        return this.voiceBusGain;
      },
      setSfxDucked: (ducked) => this.applySfxDucking(ducked),
      onMuteChanged: (muted) => this.applyMasterMute(muted),
    });

    if (typeof window !== "undefined") {
      this.bindFirstGestureUnlock();
    }
  }

  private bindFirstGestureUnlock(): void {
    if (this.gestureUnlockBound || typeof window === "undefined") return;
    this.gestureUnlockBound = true;

    const unlock = (): void => {
      const ctx = this.ensureContext();
      if (ctx && ctx.state === "suspended") {
        ctx.resume().catch(() => {});
      }
      this.voice.preloadInBackground();
      if (ctx && ctx.state === "running") {
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
        window.removeEventListener("touchstart", unlock);
      }
    };

    window.addEventListener("pointerdown", unlock, { passive: true });
    window.addEventListener("keydown", unlock, { passive: true });
    window.addEventListener("touchstart", unlock, { passive: true });
  }

  public init(): void {
    if (typeof window === "undefined") return;
    this.bindFirstGestureUnlock();
    const ctx = this.ensureContext();
    if (ctx && ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    this.voice.preloadInBackground();
  }

  public unlock(): void {
    this.init();
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === "undefined") return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      // Szyna efektów fizycznych z automatycznym sidechain duckingiem (-5 dB gdy mówi Świadek)
      const sfxDuck = ctx.createGain();
      sfxDuck.gain.value = this.isSfxCurrentlyDucked ? DUCK_LINEAR_GAIN : 1.0;

      const sfxBus = ctx.createGain();
      sfxBus.gain.value = 0.92;

      // Szyna głosu lektorskiego (-16 LUFS znormalizowane pliki MP3)
      const voiceBus = ctx.createGain();
      voiceBus.gain.value = 1.0;

      // Delikatny kompresor sumy chroniący przed przesterem przy jednoczesnym wybuchu muru i głosie
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -4.0;
      comp.knee.value = 8.0;
      comp.ratio.value = 4.0;
      comp.attack.value = 0.003;
      comp.release.value = 0.14;

      // Globalny wyłącznik Mute z płynną rampą
      const masterMute = ctx.createGain();
      masterMute.gain.value = this.voice.isMuted() ? 0.0 : 1.0;

      sfxDuck.connect(sfxBus);
      sfxBus.connect(comp);
      voiceBus.connect(comp);
      comp.connect(masterMute);
      masterMute.connect(ctx.destination);

      this.sfxDuckGain = sfxDuck;
      this.sfxBusGain = sfxBus;
      this.voiceBusGain = voiceBus;
      this.masterCompressor = comp;
      this.masterMuteGain = masterMute;

      this.whiteNoiseBuffer = this.createWhiteNoiseBuffer(ctx, 2.0);
      this.saturationCurve = this.createWarmSaturationCurve(512);
    }

    return this.ctx;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * seconds);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    // Deterministyczny LCG dla powtarzalnej tekstury szumu bez skoków amplitudy
    let seed = 0x9e3779b9;
    for (let i = 0; i < length; i++) {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      data[i] = (seed / 0xffffffff) * 2 - 1;
    }
    return buffer;
  }

  private createWarmSaturationCurve(samples: number): Float32Array<ArrayBuffer> {
    const buf = new ArrayBuffer(samples * 4);
    const curve = new Float32Array(buf);
    const k = 2.4;
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / (samples - 1) - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  private spawnNoiseSource(ctx: AudioContext): AudioBufferSourceNode {
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer ?? this.createWhiteNoiseBuffer(ctx, 2.0);
    src.loop = true;
    return src;
  }

  private applySfxDucking(ducked: boolean): void {
    this.isSfxCurrentlyDucked = ducked;
    if (!this.ctx || !this.sfxDuckGain) return;

    const now = this.ctx.currentTime;
    const param = this.sfxDuckGain.gain;
    const currentVal = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(currentVal, now);

    if (ducked) {
      param.linearRampToValueAtTime(DUCK_LINEAR_GAIN, now + 0.045);
    } else {
      param.linearRampToValueAtTime(1.0, now + 0.22);
    }
  }

  private applyMasterMute(muted: boolean): void {
    if (!this.ctx || !this.masterMuteGain) return;
    const now = this.ctx.currentTime;
    const param = this.masterMuteGain.gain;
    const currentVal = param.value;
    param.cancelScheduledValues(now);
    param.setValueAtTime(currentVal, now);
    param.linearRampToValueAtTime(muted ? 0.0 : 1.0, now + 0.025);
  }

  private getReadySfxTarget(): { ctx: AudioContext; out: AudioNode } | null {
    if (this.voice.isMuted()) return null;
    const ctx = this.ensureContext();
    if (!ctx || !this.sfxDuckGain || ctx.state === "closed") return null;
    if (ctx.state === "suspended") {
      ctx.resume().catch(() => {});
    }
    return { ctx, out: this.sfxDuckGain };
  }

  private vibrate(pattern: number | number[]): void {
    if (this.voice.isMuted() || typeof navigator === "undefined" || !navigator.vibrate) return;
    try {
      navigator.vibrate(pattern);
    } catch {
      // Ignoruj na przeglądarkach bez wsparcia Haptics API
    }
  }

  // ===========================================================================
  // Fasada sterowania głosem i wyciszeniem (wygodne metody dla komponentów UI)
  // ===========================================================================

  public isMuted(): boolean {
    return this.voice.isMuted();
  }

  public setMuted(muted: boolean): void {
    this.voice.setMuted(muted);
  }

  public toggleMute(): boolean {
    this.init();
    return this.voice.toggleMute();
  }

  public subscribeMute(listener: MuteListener): () => void {
    return this.voice.subscribeMute(listener);
  }

  public subscribeSubtitle(listener: SubtitleListener): () => void {
    return this.voice.subscribeSubtitle(listener);
  }

  public triggerVoice(event: VoiceEventId, options?: TriggerVoiceOptions): boolean {
    this.ensureContext();
    return this.voice.trigger(event, options);
  }

  public playVoice(event: VoiceEventId, options?: TriggerVoiceOptions): boolean {
    return this.triggerVoice(event, options);
  }

  public replayLastVoice(): boolean {
    this.init();
    return this.voice.replayLast();
  }

  public stopVoice(): void {
    this.voice.stop();
  }

  // ===========================================================================
  // 10 PROCEDURALNYCH EFEKTÓW FIZYCZNYCH WEB AUDIO API
  // ===========================================================================

  /**
   * 1. Terkot żelaznej zapadki kołowrotu przy zmianie naciągu / masy lub długości procy.
   * @param tension01 Znormalizowane naprężenie [0..1]
   */
  public playWinchTick(tension01: number): void {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowMs - this.lastWinchTickMs < 28) return;
    this.lastWinchTickMs = nowMs;

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;

    const t01 = clamp(tension01, 0, 1);
    const now = ctx.currentTime;
    this.winchRatchetParity = !this.winchRatchetParity;
    const parityDetune = this.winchRatchetParity ? 1.0 : 0.91;

    // Żelazny ząb zapadki uderzający o koło zapadkowe
    const pawlOsc = ctx.createOscillator();
    const pawlFilter = ctx.createBiquadFilter();
    const pawlGain = ctx.createGain();

    pawlOsc.type = "triangle";
    const baseFreq = (640 + t01 * 480) * parityDetune;
    pawlOsc.frequency.setValueAtTime(baseFreq, now);
    pawlOsc.frequency.exponentialRampToValueAtTime(175 + t01 * 70, now + 0.026);

    pawlFilter.type = "bandpass";
    pawlFilter.frequency.setValueAtTime(1550 + t01 * 1150, now);
    pawlFilter.Q.setValueAtTime(5.2, now);

    const amp = 0.13 + t01 * 0.08;
    pawlGain.gain.setValueAtTime(amp, now);
    pawlGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);

    pawlOsc.connect(pawlFilter);
    pawlFilter.connect(pawlGain);
    pawlGain.connect(out);

    pawlOsc.start(now);
    pawlOsc.stop(now + 0.035);

    // Dębowy bęben kołowrotu (niski rezonans drewna)
    const woodOsc = ctx.createOscillator();
    const woodGain = ctx.createGain();
    woodOsc.type = "sine";
    woodOsc.frequency.setValueAtTime(165 + t01 * 55, now);
    woodOsc.frequency.exponentialRampToValueAtTime(72, now + 0.034);
    woodGain.gain.setValueAtTime(0.09, now);
    woodGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.038);

    woodOsc.connect(woodGain);
    woodGain.connect(out);
    woodOsc.start(now);
    woodOsc.stop(now + 0.04);
  }

  /**
   * 2. Trzeszczenie sezonowanego dębu pod ciężarem wielotonowej skrzyni przeciwwagi.
   * @param load01 Obciążenie belki [0..1]
   */
  public playWoodCreak(load01: number): void {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowMs - this.lastWoodCreakMs < 95) return;
    this.lastWoodCreakMs = nowMs;

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;

    const load = clamp(load01, 0, 1);
    const now = ctx.currentTime;
    const dur = 0.24 + load * 0.16;

    // Tarcie włókien dębowych (stick-slip FM + podwójny formant pudła drewnianego)
    const carrier = ctx.createOscillator();
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();

    carrier.type = "sawtooth";
    const startPitch = 56 + load * 34;
    carrier.frequency.setValueAtTime(startPitch, now);
    carrier.frequency.linearRampToValueAtTime(startPitch * 1.24, now + dur * 0.45);
    carrier.frequency.exponentialRampToValueAtTime(startPitch * 0.82, now + dur);

    lfo.type = "triangle";
    lfo.frequency.setValueAtTime(14 + load * 11, now);
    lfoGain.gain.setValueAtTime(18 + load * 14, now);
    lfo.connect(lfoGain);
    lfoGain.connect(carrier.frequency);

    const formantLow = ctx.createBiquadFilter();
    formantLow.type = "bandpass";
    formantLow.frequency.setValueAtTime(320 + load * 110, now);
    formantLow.Q.setValueAtTime(6.0, now);

    const formantHigh = ctx.createBiquadFilter();
    formantHigh.type = "bandpass";
    formantHigh.frequency.setValueAtTime(790 + load * 290, now);
    formantHigh.Q.setValueAtTime(7.5, now);

    const env = ctx.createGain();
    const peak = 0.085 + load * 0.075;
    env.gain.setValueAtTime(0.0001, now);
    env.gain.linearRampToValueAtTime(peak, now + 0.035);
    env.gain.setValueAtTime(peak * 0.85, now + dur * 0.55);
    env.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    carrier.connect(formantLow);
    carrier.connect(formantHigh);
    formantLow.connect(env);
    formantHigh.connect(env);
    env.connect(out);

    lfo.start(now);
    carrier.start(now);
    lfo.stop(now + dur + 0.01);
    carrier.stop(now + dur + 0.01);
  }

  /**
   * 3. Metaliczne wyginanie kutego żelaznego palca spustowego (prong).
   * @param angleDeg Kąt wygięcia palca spustowego [0..80 stopni]
   */
  public playProngBend(angleDeg: number): void {
    const nowMs = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (nowMs - this.lastProngBendMs < 32) return;
    this.lastProngBendMs = nowMs;

    const clampedDeg = clamp(angleDeg, 0, 80);
    const bendDirection = clampedDeg >= this.prevProngAngleDeg ? 1 : -1;
    this.prevProngAngleDeg = clampedDeg;

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;

    const now = ctx.currentTime;
    const baseHz = 470 + clampedDeg * 6.4;
    const partials = [1.0, 2.31, 3.84];

    // Nieharmoniczne mody kutego żelaza z subtelnym poślizgiem częstotliwości
    partials.forEach((ratio, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? "triangle" : "sine";

      const f0 = baseHz * ratio;
      const f1 = f0 * (1 + bendDirection * 0.038);
      osc.frequency.setValueAtTime(f0, now);
      osc.frequency.linearRampToValueAtTime(f1, now + 0.055);

      const level = (0.075 / (idx + 1)) * (idx === 0 ? 1.15 : 0.85);
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(level, now + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.085 - idx * 0.015);

      osc.connect(gain);
      gain.connect(out);
      osc.start(now);
      osc.stop(now + 0.095);
    });

    // Krótkie metaliczne tarcie pierścienia o żelazny trzpień
    const scrape = this.spawnNoiseSource(ctx);
    const hp = ctx.createBiquadFilter();
    const scrapeGain = ctx.createGain();
    hp.type = "bandpass";
    hp.frequency.setValueAtTime(2650 + clampedDeg * 18, now);
    hp.Q.setValueAtTime(4.5, now);

    scrapeGain.gain.setValueAtTime(0.032, now);
    scrapeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.036);

    scrape.connect(hp);
    hp.connect(scrapeGain);
    scrapeGain.connect(out);
    scrape.start(now, (clampedDeg / 80) * 0.8);
    scrape.stop(now + 0.04);
  }

  /**
   * 4. Szczęk żelaznej przetyczki i zwolnienie zapadki przy szarpnięciu sznura spustowego!
   */
  public playTriggerSnap(): void {
    this.init();
    this.vibrate([16, 20, 28]);

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;
    const now = ctx.currentTime;

    // Etap 1: Ostry szczęk wyszarpywanej żelaznej przetyczki
    const pinModes = [1140, 2480, 3890];
    pinModes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = idx === 0 ? "triangle" : "sine";
      osc.frequency.setValueAtTime(freq, now);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.92, now + 0.09);

      gain.gain.setValueAtTime(0.14 / (idx + 1), now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.11 - idx * 0.02);

      osc.connect(gain);
      gain.connect(out);
      osc.start(now);
      osc.stop(now + 0.12);
    });

    // Transjent uderzenia metalu o okucie
    const clinkNoise = this.spawnNoiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    const clinkGain = ctx.createGain();
    bp.type = "bandpass";
    bp.frequency.setValueAtTime(3100, now);
    bp.Q.setValueAtTime(3.2, now);
    clinkGain.gain.setValueAtTime(0.16, now);
    clinkGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);

    clinkNoise.connect(bp);
    bp.connect(clinkGain);
    clinkGain.connect(out);
    clinkNoise.start(now, 0.15);
    clinkNoise.stop(now + 0.05);

    // Etap 2 (+18 ms): Ciężkie zwolnienie dębowego zaczepu i szarpnięcie liny
    const latchOsc = ctx.createOscillator();
    const latchGain = ctx.createGain();
    latchOsc.type = "triangle";
    latchOsc.frequency.setValueAtTime(195, now + 0.018);
    latchOsc.frequency.exponentialRampToValueAtTime(48, now + 0.135);

    latchGain.gain.setValueAtTime(0.24, now + 0.018);
    latchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);

    latchOsc.connect(latchGain);
    latchGain.connect(out);
    latchOsc.start(now + 0.018);
    latchOsc.stop(now + 0.16);
  }

  /**
   * 5. Świst konopnej procy i pocisku rozcinającego powietrze z efektem Dopplera.
   * @param speedMs Prędkość wylotowa pocisku [m/s], typowo 25..85 m/s
   */
  public playSlingWhoosh(speedMs: number): void {
    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;

    const speedNorm = clamp((speedMs - 20) / 65, 0.1, 1.0);
    const now = ctx.currentTime;
    const dur = 0.44 + (1 - speedNorm) * 0.18;
    const apexT = now + dur * 0.38;

    // Szum aerodynamiczny z przesunięciem pasma i panoramy (efekt Dopplera)
    const noise = this.spawnNoiseSource(ctx);
    const bp = ctx.createBiquadFilter();
    const whooshGain = ctx.createGain();

    bp.type = "bandpass";
    const peakHz = 480 + speedNorm * 760;
    bp.frequency.setValueAtTime(170, now);
    bp.frequency.exponentialRampToValueAtTime(peakHz, apexT);
    bp.frequency.exponentialRampToValueAtTime(195, now + dur);
    bp.Q.setValueAtTime(2.8 + speedNorm * 1.4, now);

    const peakAmp = 0.18 + speedNorm * 0.14;
    whooshGain.gain.setValueAtTime(0.0001, now);
    whooshGain.gain.linearRampToValueAtTime(peakAmp, apexT);
    whooshGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    // Panorama stereo od stanowiska blidy (-0.42) w stronę przedpola (+0.52)
    let tailNode: AudioNode = whooshGain;
    if (typeof ctx.createStereoPanner === "function") {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(-0.42, now);
      panner.pan.linearRampToValueAtTime(0.52, now + dur);
      whooshGain.connect(panner);
      tailNode = panner;
    }

    noise.connect(bp);
    bp.connect(whooshGain);
    tailNode.connect(out);

    noise.start(now, 0.35);
    noise.stop(now + dur + 0.02);

    // Niski wir powietrza wirującej liny procy
    const vortex = ctx.createOscillator();
    const vortexGain = ctx.createGain();
    vortex.type = "sine";
    vortex.frequency.setValueAtTime(78, now);
    vortex.frequency.exponentialRampToValueAtTime(145 + speedNorm * 75, apexT);
    vortex.frequency.exponentialRampToValueAtTime(62, now + dur);

    vortexGain.gain.setValueAtTime(0.0001, now);
    vortexGain.gain.linearRampToValueAtTime(0.11 + speedNorm * 0.06, apexT);
    vortexGain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    vortex.connect(vortexGain);
    vortexGain.connect(tailNode);
    vortex.start(now);
    vortex.stop(now + dur + 0.02);
  }

  /**
   * 6. Potężny huk kruszonej gotyckiej cegły (opus emplectum) i pękających dębowych hurdycji!
   * @param intensity01 Siła uderzenia [0..1]
   * @param bricksCount Liczba wybitych cegieł / belek z symulacji
   */
  public playImpactBrick(intensity01: number, bricksCount: number): void {
    const intensity = clamp(intensity01, 0.15, 1.0);
    this.vibrate(intensity > 0.65 ? [35, 25, 65] : [22, 20, 35]);

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;
    const now = ctx.currentTime;

    // Warstwa 1: Sejsmiczny sub-bas uderzenia granitowej kuli w mur
    const subOsc = ctx.createOscillator();
    const subShaper = ctx.createWaveShaper();
    const subGain = ctx.createGain();
    if (this.saturationCurve) {
      subShaper.curve = this.saturationCurve;
    }

    subOsc.type = "sine";
    subOsc.frequency.setValueAtTime(108 + intensity * 28, now);
    subOsc.frequency.exponentialRampToValueAtTime(28, now + 0.46);

    subGain.gain.setValueAtTime(0.28 + intensity * 0.16, now);
    subGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.52);

    subOsc.connect(subShaper);
    subShaper.connect(subGain);
    subGain.connect(out);
    subOsc.start(now);
    subOsc.stop(now + 0.54);

    // Warstwa 2: Kruszenie zaprawy wapiennej i płaszcza ceglanego
    const crunchNoise = this.spawnNoiseSource(ctx);
    const crunchFilter = ctx.createBiquadFilter();
    const crunchGain = ctx.createGain();

    crunchFilter.type = "bandpass";
    crunchFilter.frequency.setValueAtTime(720 + intensity * 480, now);
    crunchFilter.frequency.exponentialRampToValueAtTime(240, now + 0.36);
    crunchFilter.Q.setValueAtTime(1.4, now);

    crunchGain.gain.setValueAtTime(0.22 + intensity * 0.14, now);
    crunchGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    crunchNoise.connect(crunchFilter);
    crunchFilter.connect(crunchGain);
    crunchGain.connect(out);
    crunchNoise.start(now, 0.5);
    crunchNoise.stop(now + 0.4);

    // Warstwa 3: Kaskada sypiących się odłamków ceramicznej cegły i drzazg dębowych
    const debrisCount = Math.round(clamp(4 + bricksCount * 0.42, 4, 15));
    for (let i = 0; i < debrisCount; i++) {
      const ratio = i / debrisCount;
      const delay = 0.035 + ratio * 0.58 + ((i * 37) % 11) * 0.007;
      const t = now + delay;
      const isWoodSplinter = i % 3 === 1;

      const shardOsc = ctx.createOscillator();
      const shardGain = ctx.createGain();
      shardOsc.type = isWoodSplinter ? "sawtooth" : "triangle";

      const shardFreq = isWoodSplinter
        ? 580 + ((i * 173) % 540)
        : 1280 + ((i * 317) % 1650);
      shardOsc.frequency.setValueAtTime(shardFreq, t);
      shardOsc.frequency.exponentialRampToValueAtTime(shardFreq * 0.46, t + 0.048);

      const shardAmp = (0.085 + intensity * 0.05) * (1 - ratio * 0.62);
      shardGain.gain.setValueAtTime(shardAmp, t);
      shardGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.055);

      shardOsc.connect(shardGain);
      shardGain.connect(out);
      shardOsc.start(t);
      shardOsc.stop(t + 0.06);
    }
  }

  /**
   * 7. Ciężki plusk głazu wpadającego do krzyżackiej fosy przed kurtyną muru.
   */
  public playImpactSplash(): void {
    this.vibrate([18, 30, 20]);

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;
    const now = ctx.currentTime;

    // Bąbel kawitacyjny ciężkiego kamienia pod powierzchnią wody
    const plunge = ctx.createOscillator();
    const plungeGain = ctx.createGain();
    plunge.type = "sine";
    plunge.frequency.setValueAtTime(145, now);
    plunge.frequency.exponentialRampToValueAtTime(42, now + 0.11);
    plunge.frequency.exponentialRampToValueAtTime(108, now + 0.27);

    plungeGain.gain.setValueAtTime(0.24, now);
    plungeGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);

    plunge.connect(plungeGain);
    plungeGain.connect(out);
    plunge.start(now);
    plunge.stop(now + 0.32);

    // Fontanna rozbryzgu wody (dwufazowy filtr pasmowy szumu)
    const splashNoise = this.spawnNoiseSource(ctx);
    const splashFilter = ctx.createBiquadFilter();
    const splashGain = ctx.createGain();

    splashFilter.type = "bandpass";
    splashFilter.frequency.setValueAtTime(1350, now);
    splashFilter.frequency.exponentialRampToValueAtTime(460, now + 0.28);
    splashFilter.frequency.linearRampToValueAtTime(980, now + 0.45);
    splashFilter.frequency.exponentialRampToValueAtTime(340, now + 0.82);
    splashFilter.Q.setValueAtTime(1.8, now);

    splashGain.gain.setValueAtTime(0.0001, now);
    splashGain.gain.linearRampToValueAtTime(0.24, now + 0.018);
    splashGain.gain.exponentialRampToValueAtTime(0.09, now + 0.25);
    splashGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.85);

    splashNoise.connect(splashFilter);
    splashFilter.connect(splashGain);
    splashGain.connect(out);
    splashNoise.start(now, 0.8);
    splashNoise.stop(now + 0.88);
  }

  /**
   * 8. Komediowy brzdęk miedziano-żeliwnego kotła z grochówką we własnym obozie oblężniczym!
   */
  public playCampCauldronClang(): void {
    this.vibrate([30, 25, 45, 25, 30]);

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;
    const now = ctx.currentTime;

    // Uderzenie w ziemię obozowiska
    const thump = ctx.createOscillator();
    const thumpGain = ctx.createGain();
    thump.type = "triangle";
    thump.frequency.setValueAtTime(125, now);
    thump.frequency.exponentialRampToValueAtTime(36, now + 0.24);
    thumpGain.gain.setValueAtTime(0.24, now);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);
    thump.connect(thumpGain);
    thumpGain.connect(out);
    thump.start(now);
    thump.stop(now + 0.28);

    // Mody dzwonowe przewracanego kotła obozowego z grochówką (nieharmoniczne dudnienie!)
    const kettleModes = [292, 463, 778, 1196, 1785];
    kettleModes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const wobbler = ctx.createOscillator();
      const wobbleGain = ctx.createGain();
      const gain = ctx.createGain();

      osc.type = idx % 2 === 0 ? "sine" : "triangle";
      osc.frequency.setValueAtTime(freq, now + 0.015);
      osc.frequency.exponentialRampToValueAtTime(freq * 0.975, now + 1.15);

      wobbler.type = "sine";
      wobbler.frequency.setValueAtTime(6.5 + idx * 1.9, now + 0.015);
      wobbleGain.gain.setValueAtTime(3.2 + idx * 1.4, now + 0.015);
      wobbler.connect(wobbleGain);
      wobbleGain.connect(osc.frequency);

      const amp = 0.16 / (idx * 0.75 + 1);
      const decay = 1.18 - idx * 0.16;
      gain.gain.setValueAtTime(0.0001, now);
      gain.gain.linearRampToValueAtTime(amp, now + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + decay);

      osc.connect(gain);
      gain.connect(out);
      wobbler.start(now + 0.015);
      osc.start(now + 0.015);
      wobbler.stop(now + decay + 0.03);
      osc.stop(now + decay + 0.03);
    });

    // Trzy podskoki żelaznej pokrywki / chochli toczącej się po obozie
    const lidBounces = [0.16, 0.31, 0.44];
    lidBounces.forEach((offset, idx) => {
      const t = now + offset;
      const lidOsc = ctx.createOscillator();
      const lidGain = ctx.createGain();
      lidOsc.type = "square";
      lidOsc.frequency.setValueAtTime(940 + idx * 185, t);
      lidOsc.frequency.exponentialRampToValueAtTime(610, t + 0.065);

      const lp = ctx.createBiquadFilter();
      lp.type = "bandpass";
      lp.frequency.setValueAtTime(1450, t);
      lp.Q.setValueAtTime(4.0, t);

      lidGain.gain.setValueAtTime(0.075 * (1 - idx * 0.22), t);
      lidGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.075);

      lidOsc.connect(lp);
      lp.connect(lidGain);
      lidGain.connect(out);
      lidOsc.start(t);
      lidOsc.stop(t + 0.08);
    });
  }

  /**
   * 9. Głuchy łomot głazu wbitego w rozmokłą ziemię tuż przed machiną („kopanie studni”).
   */
  public playGroundThud(): void {
    this.vibrate([32, 20, 25]);

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;
    const now = ctx.currentTime;

    // Ciężkie wbicie w darń i glinę
    const earth = ctx.createOscillator();
    const earthGain = ctx.createGain();
    earth.type = "sine";
    earth.frequency.setValueAtTime(112, now);
    earth.frequency.exponentialRampToValueAtTime(26, now + 0.34);

    earthGain.gain.setValueAtTime(0.32, now);
    earthGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    earth.connect(earthGain);
    earthGain.connect(out);
    earth.start(now);
    earth.stop(now + 0.4);

    // Mlask rozmokłego błota i wyrzuconych brył darni
    const mudNoise = this.spawnNoiseSource(ctx);
    const mudFilter = ctx.createBiquadFilter();
    const mudGain = ctx.createGain();

    mudFilter.type = "lowpass";
    mudFilter.frequency.setValueAtTime(690, now);
    mudFilter.frequency.exponentialRampToValueAtTime(135, now + 0.24);
    mudFilter.Q.setValueAtTime(2.4, now);

    mudGain.gain.setValueAtTime(0.22, now);
    mudGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.26);

    mudNoise.connect(mudFilter);
    mudFilter.connect(mudGain);
    mudGain.connect(out);
    mudNoise.start(now, 1.1);
    mudNoise.stop(now + 0.28);
  }

  /**
   * 10. Rycerska fanfara heroldów na pobicie rekordu rywala (naturalne rogi + kotły).
   */
  public playRivalBeatFanfare(): void {
    this.vibrate([25, 30, 25, 30, 70]);

    const target = this.getReadySfxTarget();
    if (!target) return;
    const { ctx, out } = target;
    const now = ctx.currentTime;

    // Uderzenie w średniowieczne kotły rycerskie (timpani D3 -> A2)
    const timpaniHits = [
      { t: 0.0, freq: 146.83, amp: 0.22 },
      { t: 0.36, freq: 220.0, amp: 0.18 },
    ];
    timpaniHits.forEach(({ t, freq, amp }) => {
      const start = now + t;
      const drum = ctx.createOscillator();
      const drumGain = ctx.createGain();
      drum.type = "sine";
      drum.frequency.setValueAtTime(freq * 1.18, start);
      drum.frequency.exponentialRampToValueAtTime(freq, start + 0.045);
      drum.frequency.exponentialRampToValueAtTime(freq * 0.72, start + 0.34);

      drumGain.gain.setValueAtTime(amp, start);
      drumGain.gain.exponentialRampToValueAtTime(0.0001, start + 0.36);

      drum.connect(drumGain);
      drumGain.connect(out);
      drum.start(start);
      drum.stop(start + 0.38);
    });

    // Heroldowa fanfara rogów naturalnych w D-dur (D4 -> A4 -> D5 + tercja F#5/A5)
    const brassNotes: Array<{ start: number; dur: number; hz: number; gain: number }> = [
      { start: 0.0, dur: 0.16, hz: 293.66, gain: 0.11 },  // D4
      { start: 0.17, dur: 0.16, hz: 440.0, gain: 0.12 },  // A4
      { start: 0.35, dur: 0.58, hz: 587.33, gain: 0.13 }, // D5
      { start: 0.36, dur: 0.56, hz: 440.0, gain: 0.085 }, // A4 (kwinta pod spodem)
      { start: 0.37, dur: 0.55, hz: 739.99, gain: 0.075 }, // F#5 (jasna tercja wielka)
    ];

    brassNotes.forEach((note) => {
      const t0 = now + note.start;
      const tEnd = t0 + note.dur;

      const oscSaw = ctx.createOscillator();
      const oscTri = ctx.createOscillator();
      const brassFilter = ctx.createBiquadFilter();
      const noteGain = ctx.createGain();

      oscSaw.type = "sawtooth";
      oscTri.type = "triangle";

      // Subtelne zadęcie ustnika na ataku rogu
      oscSaw.frequency.setValueAtTime(note.hz * 0.975, t0);
      oscSaw.frequency.exponentialRampToValueAtTime(note.hz, t0 + 0.028);

      oscTri.frequency.setValueAtTime(note.hz * 1.003, t0);

      brassFilter.type = "lowpass";
      brassFilter.frequency.setValueAtTime(460, t0);
      brassFilter.frequency.exponentialRampToValueAtTime(2350, t0 + 0.055);
      brassFilter.frequency.exponentialRampToValueAtTime(1380, tEnd);
      brassFilter.Q.setValueAtTime(2.1, t0);

      noteGain.gain.setValueAtTime(0.0001, t0);
      noteGain.gain.linearRampToValueAtTime(note.gain, t0 + 0.025);
      noteGain.gain.setValueAtTime(note.gain * 0.88, t0 + note.dur * 0.65);
      noteGain.gain.exponentialRampToValueAtTime(0.0001, tEnd);

      oscSaw.connect(brassFilter);
      oscTri.connect(brassFilter);
      brassFilter.connect(noteGain);
      noteGain.connect(out);

      oscSaw.start(t0);
      oscTri.start(t0);
      oscSaw.stop(tEnd + 0.02);
      oscTri.stop(tEnd + 0.02);
    });
  }

  /**
   * Pomocniczy dispatcher dobierający odpowiedni efekt uderzenia i komentarz Świadka
   * na podstawie wyniku symulacji strzału (opcjonalne ułatwienie dla warstwy UI/3D).
   */
  public playImpactForOutcome(result: Pick<ShotSimulationResult, "outcome" | "impactSpeedMs" | "bricksDislodged">): void {
    const intensity = clamp(result.impactSpeedMs / 75, 0.2, 1.0);
    const outcome: ShotOutcomeKind = result.outcome;

    switch (outcome) {
      case "direct_target":
      case "gdanisko_hit":
      case "wall_hit":
        this.playImpactBrick(intensity, result.bricksDislodged);
        break;
      case "short_moat":
        this.playImpactSplash();
        break;
      case "camp_backfire":
        this.playCampCauldronClang();
        break;
      case "ground_slam":
      case "zenith_self_hit":
      case "overshot":
      case "beam_overload":
      default:
        this.playGroundThud();
        break;
    }
  }
}

export const soundEngine = new TrebuchetSoundEngine();
export const hostVoiceDirector = soundEngine.voice;
