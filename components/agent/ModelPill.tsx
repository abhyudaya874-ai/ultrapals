"use client";
import { useRef, useState } from "react";
import { effortOf } from "@/components/orbs/effort";
import { useDismiss } from "@/components/thread/Dock";
import { IconCheck, IconChevronDown, IconChevronRight } from "@/components/ui/icons";
import { LEVELS, LEVEL_INFO, PICKABLE, describeChoice, type Level, type ModelChoice } from "@/lib/computer/models";

/** Pure. How many of the nine dots are lit for a choice: the pill shows effort at a glance. */
export const litDots = (c: ModelChoice): number => (c.pin ? 5 : [2, 4, 6, 9][LEVELS.indexOf(c.level)]);

function Dots({ lit, className = "size-4" }: { lit: number; className?: string }) {
  return (
    <svg viewBox="0 0 12 12" className={className} aria-hidden="true">
      {Array.from({ length: 9 }, (_, i) => <circle key={i} cx={2 + (i % 3) * 4} cy={2 + Math.floor(i / 3) * 4} r="1.1" fill="currentColor" opacity={i < lit ? 1 : 0.28} />)}
    </svg>
  );
}

/** Pure. Where stop `i` of `n` sits along the track, as a CSS length (the thumb never overhangs the ends). */
export const stopLeft = (i: number, n: number): string => `calc(14px + (100% - 28px) * ${n > 1 ? i / (n - 1) : 0})`;

function LevelSlider({ level, onPick }: { level: Level; onPick: (l: Level) => void }) {
  const track = useRef<HTMLDivElement>(null);
  const n = LEVELS.length;
  const idx = LEVELS.indexOf(level);
  const color = effortOf(level).color;
  const from = (clientX: number): Level => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 28) return level;
    const f = Math.min(1, Math.max(0, (clientX - r.left - 14) / (r.width - 28)));
    return LEVELS[Math.round(f * (n - 1))];
  };
  return (
    <div
      ref={track}
      role="slider"
      tabIndex={0}
      aria-label="Effort"
      aria-valuemin={0}
      aria-valuemax={n - 1}
      aria-valuenow={idx}
      aria-valuetext={LEVEL_INFO[level].label}
      data-testid="effort-slider"
      className="relative h-9 cursor-pointer touch-none select-none rounded-full border border-dock-line bg-canvas/70 outline-none focus-visible:ring-2 focus-visible:ring-accent"
      onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); onPick(from(e.clientX)); }}
      onPointerMove={(e) => { if (e.buttons) onPick(from(e.clientX)); }}
      onKeyDown={(e) => {
        const step = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
        if (step) { e.preventDefault(); onPick(LEVELS[Math.min(n - 1, Math.max(0, idx + step))]); }
        else if (e.key === "Home") onPick(LEVELS[0]);
        else if (e.key === "End") onPick(LEVELS[n - 1]);
      }}
    >
      <div className="absolute inset-y-0 left-0 rounded-full transition-[width,background-color] duration-150" data-testid="effort-fill" style={{ width: `calc(14px + ${stopLeft(idx, n)})`, backgroundColor: color, backgroundImage: "radial-gradient(rgba(255,255,255,0.28) 1px, transparent 1.3px)", backgroundSize: "6px 6px" }} />
      {LEVELS.map((l, i) => i !== idx && <span key={l} className="absolute top-1/2 size-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-fg-dim/70" style={{ left: stopLeft(i, n) }} />)}
      <span className="absolute top-1/2 size-6 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white transition-[left,box-shadow] duration-150" style={{ left: stopLeft(idx, n), boxShadow: `0 0 0 3px color-mix(in srgb, ${color} 45%, transparent), 0 1px 3px rgba(0,0,0,0.45)` }} />
    </div>
  );
}

/** The Perplexity-style pill in the input box: effort slider with the model that leads at that level, or "Custom" to pin one model. */
export function ModelPill({ value, onChange, disabled, allowCustom = true }: { value: ModelChoice; onChange: (c: ModelChoice) => void; disabled?: boolean; allowCustom?: boolean }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useDismiss(open, () => { setOpen(false); setCustom(false); }, box);
  const d = describeChoice(value);
  return (
    <div className="relative" ref={box}>
      <button type="button" disabled={disabled} onClick={() => { setOpen((o) => !o); setCustom(false); }} aria-haspopup="dialog" aria-expanded={open} data-testid="model-pill" title="Model and effort"
        className="press inline-flex h-9 items-center gap-1.5 rounded-full bg-surface-2/70 pl-2.5 pr-2 text-[13px] text-fg-muted hover:bg-surface-2 hover:text-fg disabled:opacity-50">
        <span style={{ color: effortOf(value.level).color }} className="transition-colors duration-150"><Dots lit={litDots(value)} /></span>
        <span className="max-w-[9rem] truncate">{d.pill}</span>
        <IconChevronDown className={`size-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div role="dialog" aria-label="Model and effort" className="pop-in absolute bottom-full right-0 z-30 mb-2 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-dock-line bg-surface p-3 shadow-2xl" data-testid="model-popover">
          {!custom ? (
            <>
              <p className="px-1 pb-3 text-[13.5px] leading-snug text-fg-muted"><span className="font-medium text-fg">{d.title}</span> {d.blurb}</p>
              <LevelSlider level={value.level} onPick={(level) => onChange({ level })} />
              <div className="relative mt-2 h-4 text-[11.5px] text-fg-dim">{LEVELS.map((l, i) => <span key={l} className="absolute top-0 -translate-x-1/2 transition-colors duration-150" style={{ left: stopLeft(i, LEVELS.length), ...(l === value.level && !value.pin ? { color: effortOf(l).color } : {}) }}>{LEVEL_INFO[l].label}</span>)}</div>
              {allowCustom && <div className="mt-3 border-t border-line pt-1">
                <button type="button" onClick={() => setCustom(true)} className="flex w-full items-center justify-between rounded-lg px-1 py-2 text-[13.5px] text-fg-muted hover:text-fg">
                  <span>Custom{value.pin ? <span className="ml-2 text-fg-dim">{d.pill}</span> : null}</span><IconChevronRight className="size-4" />
                </button>
              </div>}
            </>
          ) : (
            <>
              <button type="button" onClick={() => setCustom(false)} className="mb-1 flex items-center gap-1 px-1 py-1 text-[12.5px] text-fg-dim hover:text-fg"><IconChevronRight className="size-3.5 rotate-180" />Effort</button>
              <ul className="max-h-72 overflow-y-auto" role="listbox" aria-label="Models">
                {PICKABLE.map((m) => {
                  const on = value.pin?.provider === m.provider && value.pin.model === m.model;
                  return (
                    <li key={`${m.provider}:${m.model}`} role="option" aria-selected={on}>
                      <button type="button" onClick={() => { onChange({ level: value.level, pin: { provider: m.provider, model: m.model } }); setOpen(false); setCustom(false); }} className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-surface-2">
                        <span className="min-w-0 flex-1"><span className="block truncate text-[13.5px] text-fg">{m.label}</span><span className="block truncate text-[12px] text-fg-dim">{m.note}</span></span>
                        {on && <IconCheck className="size-4 shrink-0 text-accent" />}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {value.pin && <button type="button" onClick={() => onChange({ level: value.level })} className="mt-1 w-full rounded-lg px-2 py-2 text-left text-[12.5px] text-fg-muted hover:bg-surface-2 hover:text-fg">Use the effort slider instead</button>}
            </>
          )}
        </div>
      )}
    </div>
  );
}
