"use client";

import React, { useEffect, useState } from "react";
import { RotateCcw } from "lucide-react";
import { assetUrl } from "@/lib/config";
import type { VoiceSubtitlePayload } from "@/types/trebuchet";

interface SwiadekLiveToastProps {
  subtitle: VoiceSubtitlePayload | null;
  isDragging3D: boolean;
  isMuted: boolean;
  onReplay: () => void;
}

const PRIMARY_PORTRAIT_URL = assetUrl("/swiadek-portrait.jpg");
const FALLBACK_PORTRAIT_URL = assetUrl("/swiadek-ref.jpg");

export function SwiadekLiveToast({
  subtitle,
  isDragging3D,
  isMuted,
  onReplay,
}: SwiadekLiveToastProps) {
  const [imgStage, setImgStage] = useState<"primary" | "fallback" | "monogram">(
    "primary"
  );

  // Wstępne podgrzanie portretu w pamięci przeglądarki jeszcze przed 1. dymkiem
  useEffect(() => {
    if (typeof window === "undefined") return;
    const pre = new window.Image();
    pre.src = PRIMARY_PORTRAIT_URL;
  }, []);

  if (!subtitle) return null;

  return (
    <div
      className={`pointer-events-none fixed left-1/2 z-30 w-[min(93vw,430px)] -translate-x-1/2 transition-opacity duration-200 lg:left-4 lg:translate-x-0 ${
        isDragging3D ? "opacity-35" : "opacity-100"
      }`}
      style={{ top: "calc(env(safe-area-inset-top, 0px) + 52px)" }}
      role="status"
      aria-live="polite"
    >
      <div
        key={subtitle.clipId + "-" + subtitle.subtitlePl.slice(0, 12)}
        className="animate-toast flex items-center gap-2.5 rounded-2xl border border-[#d4a054]/35 bg-[#0c0a08]/86 px-2.5 py-2 shadow-[0_14px_38px_rgba(0,0,0,0.68)] backdrop-blur-md"
      >
        {/* Klikalny medalion Świadka do powtórzenia kwestii */}
        <button
          type="button"
          onClick={onReplay}
          title="Powtórz komentarz Świadka Dziejów"
          aria-label="Powtórz komentarz Świadka Dziejów"
          className={`pointer-events-auto relative h-10 w-10 shrink-0 overflow-hidden rounded-full border bg-[#161310] transition ${
            subtitle.isAudioPlaying && !isMuted
              ? "border-[#f0c878] shadow-[0_0_18px_rgba(240,200,120,0.5)]"
              : "border-[#d4a054]/55 hover:border-[#f0c878]"
          }`}
        >
          {imgStage !== "monogram" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={
                imgStage === "primary"
                  ? PRIMARY_PORTRAIT_URL
                  : FALLBACK_PORTRAIT_URL
              }
              alt=""
              loading="eager"
              decoding="sync"
              onError={() =>
                setImgStage((prev) =>
                  prev === "primary" ? "fallback" : "monogram"
                )
              }
              className="h-full w-full object-cover object-top"
            />
          ) : (
            <span className="font-serif-brand flex h-full w-full items-center justify-center text-xs font-bold text-[#f0c878]">
              ŚD
            </span>
          )}
          <span className="absolute right-0 bottom-0 flex h-3.5 w-3.5 items-center justify-center rounded-tl-md bg-[#08070a]/90 text-[#f0c878]">
            {subtitle.isAudioPlaying && !isMuted ? (
              <span className="flex h-2.5 items-end gap-[1.5px]">
                <span className="eq-bar-1 h-2 w-[2px] origin-bottom bg-[#f0c878]" />
                <span className="eq-bar-2 h-2.5 w-[2px] origin-bottom bg-[#f0c878]" />
                <span className="eq-bar-3 h-2 w-[2px] origin-bottom bg-[#f0c878]" />
              </span>
            ) : (
              <RotateCcw className="h-2.5 w-2.5" />
            )}
          </span>
        </button>

        {/* Kompaktowy dymek napisów PL (max 2-3 zwięzłe linijki) */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono-brand text-[9.5px] font-bold tracking-[0.16em] text-[#d4a054] uppercase">
              Świadek Dziejów
            </span>
            <span className="text-[9px] text-[#9e9383]">•</span>
            <span className="font-mono-brand truncate text-[9.5px] tracking-[0.12em] text-[#4ecdc4] uppercase">
              {subtitle.categoryLabel}
            </span>
          </div>
          <p className="font-serif-brand mt-0.5 line-clamp-3 text-[12.5px] leading-snug text-[#f3ede2] italic sm:text-[13.5px]">
            „{subtitle.subtitlePl}”
          </p>
        </div>
      </div>
    </div>
  );
}
