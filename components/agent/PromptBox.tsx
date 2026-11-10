"use client";
import { useEffect, useRef, useState } from "react";
import { IconArrowUp, IconImage, IconPlus, IconStop, IconX } from "@/components/ui/icons";
import { MAX_IMAGES } from "@/lib/computer/images";
import { useAgent } from "./AgentProvider";
import { ModelPill } from "./ModelPill";

const ACCEPT = "image/png,image/jpeg,image/webp,image/gif";

/** Pure. Whether the send button is live: some text, or at least one picture. */
export const canSend = (text: string, pictures: number): boolean => text.trim().length >= 2 || pictures > 0;

/**
 * The input: text, pictures (button, paste or drop), selections added from the page, the model pill and send/stop.
 * `hero` is the big centred box of the empty home screen; `dock` is the compact one under a thread.
 */
export function PromptBox({ variant, placeholder, boxRef }: { variant: "hero" | "dock"; placeholder?: string; boxRef?: React.RefObject<HTMLTextAreaElement | null> }) {
  const { busy, send, stop, attachments, removeAttachment, images, removeImage, addImages, model, setModel, notice, clearNotice, focusTick } = useAgent();
  const [text, setText] = useState("");
  const [drag, setDrag] = useState(false);
  const own = useRef<HTMLTextAreaElement>(null);
  const ref = boxRef ?? own;
  const file = useRef<HTMLInputElement>(null);
  const hero = variant === "hero";

  // grow with the text, up to about 9 lines
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [text, ref]);
  useEffect(() => { ref.current?.focus(); }, [focusTick, ref]);

  const go = () => {
    if (busy || !canSend(text, images.length)) return;
    const m = text;
    setText("");
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
        {(images.length > 0 || attachments.length > 0) && (
          <ul className="mb-2 flex flex-wrap gap-2 px-1" data-testid="attachments">
            {images.map((im) => (
              <li key={im.id} className="group relative size-16 overflow-hidden rounded-xl border border-line bg-canvas" data-testid="image-attachment">
                <img src={im.url} alt={im.name} className="size-full object-cover" />
                <button type="button" onClick={() => removeImage(im.id)} aria-label={`Remove ${im.name}`} className="absolute right-1 top-1 grid size-5 place-items-center rounded-full bg-black/70 text-white opacity-90 hover:bg-black"><IconX className="size-3" /></button>
              </li>
            ))}
            {attachments.map((a) => (
              <li key={a.id} className="flex max-w-full items-center gap-1.5 self-start rounded-lg bg-surface-2 py-1 pl-2 pr-1 text-[12px] text-fg-muted">
                <span className="truncate">“{a.text.replace(/\s+/g, " ").slice(0, 60)}”</span>
                <button type="button" onClick={() => removeAttachment(a.id)} aria-label="Remove attachment" className="grid size-5 shrink-0 place-items-center rounded hover:bg-line hover:text-fg"><IconX className="size-3" /></button>
              </li>
            ))}
          </ul>
        )}
        <textarea
          ref={ref}
          value={text}
          onChange={(e) => { setText(e.target.value); if (notice) clearNotice(); }}
          rows={hero ? 3 : 2}
          maxLength={2000}
          aria-label="Message UltraPal"
          placeholder={placeholder ?? (busy ? "Send a follow-up when it finishes…" : "Type a command…")}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); go(); } }}
          onPaste={(e) => { if (e.clipboardData.files.length) { e.preventDefault(); take(e.clipboardData.files); } }}
          className={`block w-full resize-none bg-transparent px-1.5 py-1 text-fg outline-none placeholder:text-fg-dim ${hero ? "min-h-[4.5rem] text-[16px]" : "min-h-12 text-[14px]"}`}
        />
        <div className="mt-1 flex items-center gap-1.5">
          <input ref={file} type="file" accept={ACCEPT} multiple hidden onChange={(e) => { take(e.target.files); e.target.value = ""; }} data-testid="image-input" />
          <button type="button" onClick={() => file.current?.click()} disabled={images.length >= MAX_IMAGES} aria-label="Attach images" title={images.length >= MAX_IMAGES ? `At most ${MAX_IMAGES} images` : "Attach images (or paste or drop them)"}
            className="grid size-9 place-items-center rounded-full text-fg-muted hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40">
            {images.length > 0 ? <IconImage className="size-[18px]" /> : <IconPlus className="size-[18px]" />}
          </button>
          <span className="flex-1" />
          <ModelPill value={model} onChange={setModel} disabled={busy} />
          {busy ? (
            <button type="button" onClick={stop} aria-label="Stop" className="grid size-9 place-items-center rounded-full bg-surface-2 text-fg hover:bg-line"><IconStop className="size-4" /></button>
          ) : (
            <button type="submit" disabled={!canSend(text, images.length)} aria-label="Send" className="grid size-9 place-items-center rounded-full bg-fg text-canvas transition-colors hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted"><IconArrowUp className="size-[18px]" /></button>
          )}
        </div>
      </div>
      {notice && <p role="alert" className="mt-2 px-2 text-[12.5px] text-bad">{notice}</p>}
    </form>
  );
}
