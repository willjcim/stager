// fullscreen lightbox for run photos
// shows ONE image filling the viewport
// click or space toggles before <-> after
// arrow keys move between photos
// esc closes
"use client";

import { useCallback, useEffect, useState } from "react";

export type LightboxPhoto = {
  id: string;
  index: number;
  inputUrl: string;
  outputUrl: string | null;
  classifiedTheme: string | null;
  matchedBoardTitle: string | null;
};

type Props = {
  photos: LightboxPhoto[];
  startId: string | null; // open the lightbox on the photo with this id
  onClose: () => void;
};

export function PhotoLightbox({ photos, startId, onClose }: Props) {
  // index into photos array (-1 means closed)
  const [active, setActive] = useState<number>(() =>
    startId ? Math.max(0, photos.findIndex((p) => p.id === startId)) : -1,
  );
  // false=before true=after (defaults to after when available otherwise before)
  const [showAfter, setShowAfter] = useState(true);

  // sync internal active index with the startId prop so re-opens land on the
  // right photo every time
  useEffect(() => {
    if (startId == null) {
      setActive(-1);
      return;
    }
    const idx = photos.findIndex((p) => p.id === startId);
    if (idx >= 0) {
      setActive(idx);
      // start on AFTER if there is one otherwise BEFORE
      setShowAfter(Boolean(photos[idx]?.outputUrl));
    }
  }, [startId, photos]);

  const next = useCallback(() => {
    setActive((i) => {
      if (i < 0) return i;
      const n = (i + 1) % photos.length;
      // when navigating default to AFTER if it exists for the new photo
      setShowAfter(Boolean(photos[n]?.outputUrl));
      return n;
    });
  }, [photos]);

  const prev = useCallback(() => {
    setActive((i) => {
      if (i < 0) return i;
      const n = (i - 1 + photos.length) % photos.length;
      setShowAfter(Boolean(photos[n]?.outputUrl));
      return n;
    });
  }, [photos]);

  const toggle = useCallback(() => {
    const photo = photos[active];
    if (!photo?.outputUrl) return; // nothing to toggle to
    setShowAfter((v) => !v);
  }, [active, photos]);

  // global key handlers while the lightbox is open
  useEffect(() => {
    if (active < 0) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        toggle();
      }
    }
    window.addEventListener("keydown", onKey);
    // lock background scroll while open
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [active, next, prev, toggle, onClose]);

  if (active < 0) return null;
  const photo = photos[active];
  if (!photo) return null;

  const url = showAfter && photo.outputUrl ? photo.outputUrl : photo.inputUrl;
  const label = showAfter && photo.outputUrl ? "AFTER" : "BEFORE";

  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex flex-col bg-black/95 backdrop-blur"
      onClick={(e) => {
        // backdrop clicks toggle while interactive elements stop propagation via data-stop
        if ((e.target as HTMLElement).dataset.stop) return;
        if ((e.target as HTMLElement).closest("[data-stop]")) return;
        toggle();
      }}
    >
      {/* top bar */}
      <div className="flex items-center justify-between gap-4 border-b border-white/10 px-4 py-3 text-xs text-white/70">
        <div className="flex min-w-0 items-center gap-3">
          <span className="rounded bg-white/10 px-2 py-0.5 font-mono text-[10px]">{label}</span>
          <span className="truncate">
            Photo {active + 1} of {photos.length}
            {photo.classifiedTheme ? ` · ${toTitle(photo.classifiedTheme)}` : ""}
            {photo.matchedBoardTitle ? ` · ${photo.matchedBoardTitle}` : ""}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-[10px] text-white/40 sm:inline">
            ← / → photos · space to toggle · esc to close
          </span>
          <button
            type="button"
            data-stop
            onClick={onClose}
            className="rounded p-1 text-white/70 hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <svg width="18" height="18" viewBox="0 0 20 20" fill="none">
              <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      {/* image area */}
      <div className="relative flex flex-1 items-center justify-center overflow-hidden">
        {/* prev */}
        {photos.length > 1 ? (
          <button
            type="button"
            data-stop
            onClick={prev}
            className="absolute left-4 z-10 rounded-full bg-white/10 p-3 text-white/80 hover:bg-white/20 hover:text-white"
            aria-label="Previous photo"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M12 4l-6 6 6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          key={url}
          src={url}
          alt={label.toLowerCase()}
          className="max-h-full max-w-full select-none object-contain"
          draggable={false}
        />

        {/* next */}
        {photos.length > 1 ? (
          <button
            type="button"
            data-stop
            onClick={next}
            className="absolute right-4 z-10 rounded-full bg-white/10 p-3 text-white/80 hover:bg-white/20 hover:text-white"
            aria-label="Next photo"
          >
            <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
              <path d="M8 4l6 6-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        ) : null}
      </div>

      {/* bottom toggle bar */}
      <div className="flex items-center justify-center gap-2 border-t border-white/10 px-4 py-3 text-xs text-white/70">
        {photo.outputUrl ? (
          <div data-stop className="inline-flex overflow-hidden rounded-full border border-white/20">
            <button
              type="button"
              onClick={() => setShowAfter(false)}
              className={`px-4 py-1 text-[11px] uppercase tracking-wide ${!showAfter ? "bg-white text-black" : "text-white/70 hover:text-white"}`}
            >
              Before
            </button>
            <button
              type="button"
              onClick={() => setShowAfter(true)}
              className={`px-4 py-1 text-[11px] uppercase tracking-wide ${showAfter ? "bg-white text-black" : "text-white/70 hover:text-white"}`}
            >
              After
            </button>
          </div>
        ) : (
          <span className="text-[11px] text-white/50">No staged version available</span>
        )}
      </div>
    </div>
  );
}

function toTitle(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
