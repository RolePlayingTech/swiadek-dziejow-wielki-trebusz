"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import gsap from "gsap";
import {
  BookOpen,
  Compass,
  ExternalLink,
  Scale,
  ShieldAlert,
  Sparkles,
  X,
} from "lucide-react";
import {
  DEBUNKED_MYTHS,
  HISTORICAL_FACTS,
  PHYSICS_MODEL_NOTES,
  SWIADEK_ECOSYSTEM_LINKS,
} from "@/data/historicalSources";
import { TREBUCHET_DIMENSIONS } from "@/engine/trebuchetPhysics";

export type HistoricalDrawerTabId = "wszystkie" | "fakty" | "mity" | "fizyka";

export interface HistoricalSourcesDrawerProps {
  /** Stan otwarcia szuflady (tryb kontrolowany) */
  open?: boolean;
  /** Alias stanu otwarcia dla kompatybilności komponentów nadrzędnych */
  isOpen?: boolean;
  /** Callback zamknięcia szuflady */
  onClose?: () => void;
  /** Domyślna zakładka przy otwarciu */
  initialTab?: HistoricalDrawerTabId;
  /** Czy wyrenderować wbudowany przycisk otwierający (domyślnie true w trybie niekontrolowanym) */
  showTriggerButton?: boolean;
  /** Dodatkowe klasy CSS dla przycisku wyzwalającego */
  triggerClassName?: string;
}

const TAB_ITEMS: ReadonlyArray<{
  id: HistoricalDrawerTabId;
  labelPl: string;
  accentHex: string;
}> = [
  { id: "wszystkie", labelPl: "Pełne kompendium", accentHex: "#d4a054" },
  { id: "fakty", labelPl: "Fakty źródłowe", accentHex: "#d4a054" },
  { id: "mity", labelPl: "Obalone mity", accentHex: "#e05a47" },
  { id: "fizyka", labelPl: "Model RK4 Lagrange’a", accentHex: "#4ecdc4" },
];

export function HistoricalSourcesDrawer({
  open,
  isOpen,
  onClose,
  initialTab = "wszystkie",
  showTriggerButton,
  triggerClassName = "",
}: HistoricalSourcesDrawerProps): React.JSX.Element {
  const isControlled = open !== undefined || isOpen !== undefined;
  const [internalOpen, setInternalOpen] = useState<boolean>(false);
  const effectiveOpen = isControlled ? Boolean(open ?? isOpen) : internalOpen;

  const [activeTab, setActiveTab] = useState<HistoricalDrawerTabId>(initialTab);
  const titleId = useId();

  const overlayRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  const handleClose = (): void => {
    if (!isControlled) {
      setInternalOpen(false);
    }
    onClose?.();
  };

  useEffect(() => {
    if (effectiveOpen) {
      setActiveTab(initialTab);
    }
  }, [effectiveOpen, initialTab]);

  // Obsługa klawisza Escape oraz blokada przewijania tła
  useEffect(() => {
    if (!effectiveOpen) return;

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === "Escape") {
        event.preventDefault();
        handleClose();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  });

  // Animacja wejścia szuflady (GSAP) z poszanowaniem prefers-reduced-motion
  useEffect(() => {
    if (!effectiveOpen) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const ctx = gsap.context(() => {
      if (overlayRef.current) {
        gsap.fromTo(
          overlayRef.current,
          { opacity: 0 },
          { opacity: 1, duration: 0.38, ease: "power2.out" }
        );
      }
      if (panelRef.current) {
        gsap.fromTo(
          panelRef.current,
          { x: 56, opacity: 0 },
          { x: 0, opacity: 1, duration: 0.55, ease: "expo.out" }
        );
      }
    });

    return () => ctx.revert();
  }, [effectiveOpen]);

  // Kaskadowe odsłanianie kart po zmianie filtra
  useEffect(() => {
    if (!effectiveOpen || !contentRef.current) return;
    const prefersReduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReduced) return;

    const cards = contentRef.current.querySelectorAll("[data-archival-card]");
    if (cards.length === 0) return;

    const tween = gsap.fromTo(
      cards,
      { y: 16, opacity: 0 },
      {
        y: 0,
        opacity: 1,
        duration: 0.45,
        stagger: 0.055,
        ease: "power3.out",
        clearProps: "transform",
      }
    );

    return () => {
      tween.kill();
    };
  }, [effectiveOpen, activeTab]);

  const shouldRenderTrigger = showTriggerButton ?? !isControlled;

  const showFacts = activeTab === "wszystkie" || activeTab === "fakty";
  const showMyths = activeTab === "wszystkie" || activeTab === "mity";
  const showPhysics = activeTab === "wszystkie" || activeTab === "fizyka";

  return (
    <>
      {shouldRenderTrigger && (
        <button
          type="button"
          onClick={() => setInternalOpen(true)}
          className={`inline-flex items-center gap-2 rounded-lg border border-[#d4a054]/40 bg-[#08070a]/90 px-3.5 py-2 text-xs font-medium tracking-wide text-[#f3ead8] shadow-[0_0_24px_rgba(212,160,84,0.12)] transition-all hover:border-[#d4a054] hover:bg-[#14111a] hover:text-[#d4a054] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a054] ${triggerClassName}`}
        >
          <BookOpen className="h-3.5 w-3.5 text-[#d4a054]" aria-hidden="true" />
          <span>Skąd to wiemy? Fakty kontra mity</span>
        </button>
      )}

      {effectiveOpen && (
        <div className="fixed inset-0 z-50 flex justify-end">
          {/* Przydymione tło Archival Obsidian */}
          <div
            ref={overlayRef}
            onClick={handleClose}
            aria-hidden="true"
            className="fixed inset-0 bg-[#08070a]/82 backdrop-blur-md"
          />

          {/* Panel szuflady */}
          <aside
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            className="relative z-10 flex h-full w-full max-w-2xl flex-col border-l border-[#d4a054]/30 bg-[#08070a] text-[#ede5d5] shadow-[-24px_0_64px_rgba(0,0,0,0.85)]"
          >
            {/* Górny pasek nagłówkowy z mosiężnym akcentem */}
            <header className="shrink-0 border-b border-[#d4a054]/20 bg-gradient-to-b from-[#131019] to-[#08070a] px-5 py-4 sm:px-7 sm:py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="mb-1.5 flex flex-wrap items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#d4a054]">
                    <Scale className="h-3.5 w-3.5" aria-hidden="true" />
                    <span>Kompendium źródłowe • Pogranicze 1362–1405</span>
                  </div>
                  <h2
                    id={titleId}
                    className="font-serif text-xl font-semibold leading-snug text-[#f7f1e3] sm:text-2xl"
                  >
                    Skąd to wiemy? Fakty źródłowe kontra mity
                  </h2>
                  <p className="mt-1 text-xs leading-relaxed text-[#b9ae9b] sm:text-sm">
                    Rygor kronikarski (Wigand z Marburga,{" "}
                    <em className="text-[#e4d5bc]">Marienburger Tresslerbuch</em>,{" "}
                    <em className="text-[#e4d5bc]">Bellifortis</em> ok. 1405) oddzielony od
                    hollywoodzkich klisz i opisany jawnym modelem fizycznym.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handleClose}
                  aria-label="Zamknij kompendium źródłowe"
                  className="rounded-lg border border-[#d4a054]/30 bg-[#120f18] p-2 text-[#d4a054] transition-colors hover:border-[#d4a054] hover:bg-[#1d1826] hover:text-[#fff6e5] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d4a054]"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              {/* Pigułki filtrujące */}
              <nav
                aria-label="Sekcje kompendium historycznego"
                className="mt-4 flex flex-wrap gap-2"
              >
                {TAB_ITEMS.map((tab) => {
                  const isSelected = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium tracking-wide transition-all ${
                        isSelected
                          ? "border-[#d4a054] bg-[#d4a054]/18 text-[#fff5e4] shadow-[0_0_16px_rgba(212,160,84,0.2)]"
                          : "border-white/10 bg-[#110e16] text-[#a99e8c] hover:border-[#d4a054]/45 hover:text-[#ede5d5]"
                      }`}
                    >
                      <span
                        className="mr-1.5 inline-block h-1.5 w-1.5 rounded-full align-middle"
                        style={{ backgroundColor: tab.accentHex }}
                      />
                      {tab.labelPl}
                    </button>
                  );
                })}
              </nav>
            </header>

            {/* Przewijana treść merytoryczna */}
            <div
              ref={contentRef}
              className="flex-1 space-y-8 overflow-y-auto px-5 py-6 sm:px-7"
            >
              {/* SEKCJA 1: UDOKUMENTOWANE FAKTY ŹRÓDŁOWE */}
              {showFacts && (
                <section aria-label="Udokumentowane fakty źródłowe" className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#d4a054]/20 pb-2">
                    <div className="flex items-center gap-2">
                      <BookOpen className="h-4 w-4 text-[#d4a054]" aria-hidden="true" />
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#d4a054]">
                        Udokumentowane fakty źródłowe
                      </h3>
                    </div>
                    <span className="rounded border border-[#d4a054]/40 bg-[#d4a054]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#d4a054]">
                      FAKT
                    </span>
                  </div>

                  {/* Pasek wymiarów Kyesera (Bellifortis ok. 1405) */}
                  <div
                    data-archival-card
                    className="grid grid-cols-2 gap-2.5 rounded-xl border border-[#d4a054]/25 bg-[#100d15] p-3.5 sm:grid-cols-5"
                  >
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#9d9280]">
                        Ramię długie
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold text-[#d4a054]">
                        {TREBUCHET_DIMENSIONS.longArmM} m
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#9d9280]">
                        Ramię krótkie
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold text-[#d4a054]">
                        {TREBUCHET_DIMENSIONS.shortArmM} m
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#9d9280]">
                        Przełożenie
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold text-[#f7f1e3]">
                        5.0 : 1
                      </div>
                    </div>
                    <div>
                      <div className="text-[10px] uppercase tracking-wider text-[#9d9280]">
                        Wys. osi
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold text-[#d4a054]">
                        {TREBUCHET_DIMENSIONS.axleHeightM} m
                      </div>
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <div className="text-[10px] uppercase tracking-wider text-[#9d9280]">
                        Masa belki
                      </div>
                      <div className="mt-0.5 font-mono text-sm font-bold text-[#f7f1e3]">
                        {TREBUCHET_DIMENSIONS.beamMassKg} kg
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3.5">
                    {HISTORICAL_FACTS.map((fact) => (
                      <article
                        key={fact.id}
                        data-archival-card
                        className="rounded-xl border border-[#d4a054]/22 bg-[#100e15]/95 p-4 shadow-[inset_0_1px_0_rgba(212,160,84,0.08)]"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="rounded bg-[#d4a054]/16 px-2 py-0.5 font-mono text-[11px] font-semibold text-[#d4a054]">
                            {fact.yearLabel}
                          </span>
                          <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#d4a054]">
                            ● FAKT ŹRÓDŁOWY
                          </span>
                        </div>
                        <h4 className="mt-2 font-serif text-base font-semibold text-[#f8f2e6]">
                          {fact.titlePl}
                        </h4>
                        <p className="mt-1.5 text-xs leading-relaxed text-[#cfc5b4] sm:text-[13px]">
                          {fact.summaryPl}
                        </p>
                        <div className="mt-3 rounded-lg border-l-2 border-[#d4a054] bg-[#17131f] px-3 py-2 text-xs text-[#eadcc3]">
                          <strong className="text-[#d4a054]">Wniosek: </strong>
                          {fact.keyTakeawayPl}
                        </div>
                        <p className="mt-2 text-[11px] italic text-[#998e7c]">
                          Źródło: {fact.sourceCitationPl}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {/* SEKCJA 2: OBALONE MITY FILMOWE */}
              {showMyths && (
                <section aria-label="Obalone mity filmowe" className="space-y-4">
                  <div className="flex items-center justify-between border-b border-[#e05a47]/25 pb-2">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="h-4 w-4 text-[#e05a47]" aria-hidden="true" />
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#e05a47]">
                        Obalone mity filmowe i popkulturowe
                      </h3>
                    </div>
                    <span className="rounded border border-[#e05a47]/45 bg-[#e05a47]/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#ff8b7b]">
                      MIT OBALONY
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    {DEBUNKED_MYTHS.map((myth) => (
                      <article
                        key={myth.id}
                        data-archival-card
                        className="rounded-xl border border-[#e05a47]/28 bg-gradient-to-br from-[#160e12] to-[#0d0b11] p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="rounded bg-[#e05a47]/20 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#ff8b7b]">
                            ✕ MIT KINA
                          </span>
                        </div>
                        <h4 className="mt-2 font-serif text-base font-semibold text-[#ffd8d1]">
                          {myth.mythClaimPl}
                        </h4>
                        <p className="mt-2 text-xs font-medium leading-relaxed text-[#f5ece0] sm:text-[13px]">
                          {myth.historicalRealityPl}
                        </p>
                        <p className="mt-2 text-xs leading-relaxed text-[#c6bbb0]">
                          {myth.engineeringVerdictPl}
                        </p>
                        <p className="mt-2.5 border-t border-white/8 pt-2 text-[11px] italic text-[#a79a8e]">
                          Podstawa źródłowa: {myth.sourceEvidencePl}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {/* SEKCJA 3: MODEL FIZYCZNY LAGRANGE'A RK4 I UPROSZCZENIA */}
              {showPhysics && (
                <section
                  aria-label="Model fizyczny i uproszczenia symulacji"
                  className="space-y-4"
                >
                  <div className="flex items-center justify-between border-b border-[#4ecdc4]/25 pb-2">
                    <div className="flex items-center gap-2">
                      <Compass className="h-4 w-4 text-[#4ecdc4]" aria-hidden="true" />
                      <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-[#4ecdc4]">
                        Model fizyczny Lagrange’a (RK4) i uproszczenia
                      </h3>
                    </div>
                    <span className="rounded border border-[#4ecdc4]/40 bg-[#4ecdc4]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-[#4ecdc4]">
                      REKONSTRUKCJA
                    </span>
                  </div>

                  <div className="space-y-3.5">
                    {PHYSICS_MODEL_NOTES.map((note) => (
                      <article
                        key={note.id}
                        data-archival-card
                        className="rounded-xl border border-[#4ecdc4]/25 bg-[#0b1215]/95 p-4"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-serif text-base font-semibold text-[#e6fbf9]">
                            {note.titlePl}
                          </h4>
                          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#4ecdc4]">
                            ● FIZYKA
                          </span>
                        </div>

                        <pre className="mt-2.5 overflow-x-auto rounded-lg border border-[#4ecdc4]/20 bg-[#060a0d] px-3 py-2 font-mono text-xs text-[#4ecdc4]">
                          <code>{note.formulaLatexLike}</code>
                        </pre>

                        <p className="mt-2.5 text-xs leading-relaxed text-[#c9d6d5] sm:text-[13px]">
                          {note.explanationPl}
                        </p>

                        {note.browserSimplificationNotePl && (
                          <div className="mt-3 rounded-lg border border-[#d4a054]/25 bg-[#121016] px-3 py-2.5 text-xs leading-relaxed text-[#dfd3be]">
                            <strong className="text-[#d4a054]">
                              Granice modelu w przeglądarce:{" "}
                            </strong>
                            {note.browserSimplificationNotePl}
                          </div>
                        )}
                      </article>
                    ))}
                  </div>
                </section>
              )}

              {/* SEKCJA 4: EKOSYSTEM ŚWIADKA DZIEJÓW */}
              <section
                aria-label="Pozostałe projekty ekosystemu Świadek Dziejów"
                className="space-y-3.5 border-t border-[#d4a054]/20 pt-6"
              >
                <div className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-[#d4a054]" aria-hidden="true" />
                  <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-[#d4a054]">
                    Odkryj cały ekosystem Świadka Dziejów
                  </h3>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  {SWIADEK_ECOSYSTEM_LINKS.map((item) => (
                    <a
                      key={item.id}
                      href={item.href}
                      target="_blank"
                      rel="noopener noreferrer"
                      data-archival-card
                      className="group flex flex-col justify-between rounded-xl border border-[#d4a054]/20 bg-[#100e15] p-3.5 transition-all hover:border-[#d4a054]/65 hover:bg-[#171320]"
                    >
                      <div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-semibold uppercase tracking-widest text-[#4ecdc4]">
                            {item.tagPl}
                          </span>
                          <ExternalLink
                            className="h-3.5 w-3.5 text-[#8f8473] transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:text-[#d4a054]"
                            aria-hidden="true"
                          />
                        </div>
                        <div className="mt-1 font-serif text-sm font-semibold text-[#f6efe2] group-hover:text-[#d4a054]">
                          {item.titlePl}
                        </div>
                        <p className="mt-1 text-[11px] leading-snug text-[#a99f8e]">
                          {item.subtitlePl}
                        </p>
                      </div>
                    </a>
                  ))}
                </div>
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default HistoricalSourcesDrawer;
