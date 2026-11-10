"use client";
import { useEffect, useRef } from "react";
import { REST, blinkAmount, eyeLayout, lookAt, type Look } from "./gaze";
import { glanceEvery, moodLook, squint, type Mood } from "./mood";

const IDLE_MS = 3000;

/** One pointer listener for every pair of eyes on the page, however many there are. */
const pointer = { x: 0, y: 0, at: -Infinity };
const subs = new Set<() => void>();
function onMove(e: PointerEvent) {
  pointer.x = e.clientX;
  pointer.y = e.clientY;
  pointer.at = performance.now();
  subs.forEach((f) => f());
}
function subscribe(f: () => void): () => void {
  if (subs.size === 0) window.addEventListener("pointermove", onMove, { passive: true });
  subs.add(f);
  return () => {
    subs.delete(f);
    if (subs.size === 0) window.removeEventListener("pointermove", onMove);
  };
}

/**
 * Two capsule eyes drawn over any round thing: they follow the pointer, look around by themselves when it rests (where depends on the mood),
 * and blink. Same model as the WebGL orb, in plain DOM, so a flat orb or a dot-sphere can have the same face. Frames run only while visible.
 */
export function Eyes({ size, color, mood = "idle", interactive = true }: { size: number; color: string; mood?: Mood; interactive?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const left = useRef<HTMLSpanElement>(null);
  const right = useRef<HTMLSpanElement>(null);
  const moodRef = useRef(mood);
  moodRef.current = mood;
  const interactiveRef = useRef(interactive);
  interactiveRef.current = interactive;

  useEffect(() => {
    const el = root.current;
    const eyes = [left.current, right.current];
    if (!el || !eyes[0] || !eyes[1]) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const look: Look = { ...REST };
    const glance: Look = { ...REST };
    let clock = 0;
    let last = 0;
    let raf = 0;
    let visible = true;
    let nextGlance = 500 + Math.random() * 800;
    let nextBlink = 1500 + Math.random() * 2500;
    let blinkAt = -10_000;

    const paint = (blink: number) => {
      const [l, r] = eyeLayout(look, size, Math.min(1, Math.max(blink, squint(moodRef.current))));
      [l, r].forEach((e, i) => {
        const s = eyes[i]!.style;
        s.width = `${e.w.toFixed(2)}px`;
        s.height = `${e.h.toFixed(2)}px`;
        s.transform = `translate(${(e.cx - e.w / 2).toFixed(2)}px, ${(e.cy - e.h / 2).toFixed(2)}px)`;
        s.opacity = String(e.o);
      });
    };

    const tick = (now: number) => {
      raf = 0;
      const dt = Math.min(50, Math.max(0, now - last));
      last = now;
      const live = visible && !mq.matches && document.visibilityState !== "hidden";
      if (live) clock += dt;
      const steering = interactiveRef.current && now - pointer.at < IDLE_MS;
      if (!steering && live && clock >= nextGlance) {
        const m = moodRef.current;
        const g = moodLook(m, Math.random(), Math.random());
        glance.x = Math.random() < 0.25 ? 0 : g.x;
        glance.y = Math.random() < 0.25 ? 0.08 : g.y;
        const [lo, hi] = glanceEvery(m);
        nextGlance = clock + lo + Math.random() * (hi - lo);
      }
      const goal = steering ? lookAt(pointer, el.getBoundingClientRect()) : mq.matches ? REST : glance;
      const ease = live ? (steering ? 0.18 : 0.1) : 1;
      look.x += (goal.x - look.x) * ease;
      look.y += (goal.y - look.y) * ease;
      if (!mq.matches && clock >= nextBlink) {
        blinkAt = clock;
        nextBlink = clock + 2200 + Math.random() * 3800;
      }
      paint(mq.matches ? 0 : blinkAmount((clock - blinkAt) / 1000));
      if (live) raf = requestAnimationFrame(tick);
    };
    const wake = () => {
      if (raf) return;
      last = performance.now();
      raf = requestAnimationFrame(tick);
    };
    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      wake();
    });
    io.observe(el);
    const unsub = subscribe(wake);
    document.addEventListener("visibilitychange", wake);
    mq.addEventListener("change", wake);
    paint(0);
    wake();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      unsub();
      document.removeEventListener("visibilitychange", wake);
      mq.removeEventListener("change", wake);
    };
  }, [size]);

  const eye = { position: "absolute", left: 0, top: 0, borderRadius: 999, backgroundColor: color, willChange: "transform" } as const;
  return (
    <div ref={root} aria-hidden className="pointer-events-none absolute inset-0">
      <span ref={left} style={eye} />
      <span ref={right} style={eye} />
    </div>
  );
}
