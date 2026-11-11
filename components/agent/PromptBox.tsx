"use client";
import { useEffect, useRef, useState } from "react";
import { IconArrowUp, IconImage, IconPlus, IconStop, IconX } from "@/components/ui/icons";
import { MODE_INFO } from "@/lib/arena/mode";
import { MAX_IMAGES } from "@/lib/computer/images";
import { useAgent } from "./AgentProvider";
import { ContextRings } from "./ContextRings";
import { ModeBar } from "./ModeBar";
import { FILL_EVENT, canSend, placeholderFor } from "./prompt-model";
import { ModelPill } from "./ModelPill";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/**
 * The input: text, pictures (button, paste or drop), selections added from the page, the model pill and send/stop.
 * `hero` is the big centred box of the empty home screen; `dock` is the compact one under a thread.
 */
export function PromptBox({ variant, placeholder, boxRef }: { variant: "hero" | "dock"; placeholder?: string; boxRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const { busy, send, stop, attachments, removeAttachment, images, drafts, removeImage, addImages, model, setModel, notice, clearNotice, focusTick, mode, pendingPlan, handoff } = useAgent();
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = boxRef ?? own;
  const file = useRef<HTMLInputElement>(null);
  const hero = variant === "hero";
  const contest = mode.kind !== "chat";
  const needsPlan = contest && mode.plan !== "auto";
  const picturesOn = images.length + drafts.length;
  const hasStrip = picturesOn > 0 || attachments.length > 0;
  const hadPlan = useRef(false);

  // grow with the text, up to about 9 lines
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text, ref]);
  useEffect(() => { ref.current?.focus(); }, [focusTick, ref]);
  // a suggestion that opens a Battle or Loop only fills the box: the person reads it, edits it if they like, and presses Enter
  useEffect(() => {
    const on = (e: Event) => {
      const t = (e as CustomEvent<unknown>).detail;
      if (typeof t !== "string") return;
      setText(t.slice(0, 2000));
      ref.current?.focus();
    };
    window.addEventListener(FILL_EVENT, on);
    return () => window.removeEventListener(FILL_EVENT, on);
  }, [ref]);
  // a scenario waiting for approval stays in the box until it is approved, so cancelling the editor loses nothing
  useEffect(() => {
    if (hadPlan.current && !pendingPlan && busy) setText("");
    hadPlan.current = !!pendingPlan;
  }, [pendingPlan, busy]);

  const go = () => {
    if (busy || !canSend(text, contest ? 0 : images.length, drafts.length)) return;
    const m = text;
    if (!needsPlan) setText("");
    void send(m);
  };
  const take = (list: FileList | File[] | null | undefined) => {
    const files = [...(list ?? [])].filter((f) => f.type.startsWith("image/"));
    if (files.length) void addImages(files);
  };

  return (
    <form
      data-agent-dock
      onSubmit={(e) => { e.preventDefault(); go(); }}
      onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDrag(true); } }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => { setDrag(false); if (e.dataTransfer.files.length) { e.preventDefault(); take(e.dataTransfer.files); } }}
      className="w-full"
    >
      <div className={`rounded-dock border bg-dock shadow-[0_8px_32px_rgba(0,0,0,0.35)] transition-colors ${drag ? "border-accent" : "border-dock-line"} ${hero ? "p-4" : "p-2.5"}`}>
        {contest && hero && <p className="px-1.5 pb-1 text-[12.5px] text-fg-dim" data-testid="mode-blurb">{MODE_INFO[mode.kind].blurb}.</p>}
        <div className="snap-grow" data-open={hasStrip}>
          <div>
            <ul className="flex flex-wrap gap-2 px-1 pb-2" data-testid="attachments">
              {images.map((im) => (
                <li key={im.id} className="chip-in group relative size-16 overflow-hidden rounded-xl border border-line bg-canvas" data-testid="image-attachment">
                  <img src={im.url} alt={im.name} className="size-full object-cover" />
                  <button type="button" onClick={() => removeImage(im.id)} aria-label={`Remove ${im.name}`} className="press absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-90 hover:bg-black"><IconX className="size-3" /></button>
                </li>
              ))}
              {drafts.map((d) => (
                <li key={d.id} className="chip-in relative size-16 overflow-hidden rounded-xl border border-line bg-canvas" data-testid="image-draft" aria-busy="true">
                  <img src={d.url} alt={d.name} className="size-full object-cover opacity-70" />
                  <span aria-hidden className="shimmer absolute inset-0" />
                </li>
              ))}
              {attachments.map((a) => (
                <li key={a.id} className="chip-in flex max-w-full items-center gap-1.5 self-start rounded-lg bg-surface-2 py-1 pl-2 pr-1 text-[12px] text-fg-muted">
                  <span className="truncate">“{a.text.replace(/\s+/g, " ").slice(0, 60)}”</span>
                  <button type="button" onClick={() => removeAttachment(a.id)} aria-label="Remove attachment" className="press grid size-5 shrink-0 place-items-center rounded hover:bg-line hover:text-fg"><IconX className="size-3" /></button>
                </li>
              ))}
            </ul>
          </div>
        </div>
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); if (notice) clearNotice(); }}
          rows={hero ? 3 : 2}
          maxLength={2000}
          aria-label="Message UltraPal"
          placeholder={placeholder && !contest && !handoff ? placeholder : placeholderFor(mode.kind, busy, !!handoff)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); take(e.clipboardData.files); } }}
          className={`block w-full resize-none bg-transparent px-1.5 py-1 text-fg outline-none placeholder:text-fg-dim ${hero ? "min-h-[4.5rem] text-[16px]" : "min-h-12 text-[14px]"}`}
        />
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <input ref={file} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} data-testid="image-input" />
          <button type="button" onClick={() => file.current?.click()} disabled={picturesOn >= MAX_IMAGES || contest} aria-label="Attach images" title={contest ? "Pictures are for chat" : picturesOn >= MAX_IMAGES ? `At most ${MAX_IMAGES} images` : "Attach images (or paste or drop them)"}
            className="press grid size-9 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40">
            {picturesOn > 0 ? <IconImage className="size-[18px]" /> : <IconPlus className="size-[18px]" />}
          </button>
          <ModeBar disabled={busy} />
          <span className="flex-1" />
          <ModelPill value={model} onChange={setModel} disabled={busy} />
          <ContextRings draft={text} />
          {busy ? (
            <button type="button" onClick={stop} aria-label="Stop" className="press grid size-9 place-items-center rounded-full bg-surface-2 text-fg hover:bg-line"><IconStop className="size-4" /></button>
          ) : (
            <button type="submit" disabled={!canSend(text, contest ? 0 : images.length, drafts.length)} aria-label="Send" title={drafts.length ? "Preparing pictures…" : needsPlan ? "Review the scenarios, then start" : undefined} className="press grid size-9 place-items-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted"><IconArrowUp className="size-[18px]" /></button>
          )}
        </div>
      </div>
      {notice && <p role="alert" className="mt-2 px-2 text-[12.5px] text-bad">{notice}</p>}
    </form>
  );
}
