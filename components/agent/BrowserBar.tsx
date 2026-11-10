"use client";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { IconArrowUp, IconBack, IconRefresh, IconStop } from "@/components/ui/icons";
import { displayAddress } from "./browser-client";

const BTN = "press grid size-8 shrink-0 place-items-center rounded-lg text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent disabled:hover:text-fg-muted";

/**
 * The controls of a browser, drawn by the app because the cloud browser runs without its own toolbar: back, forward, reload and an address bar that
 * takes a web address or words to search for. While the box is not being edited it shows the page's real address, kept current by the parent.
 */
export function AddressBar({ url, canBack, canForward, loading, disabled, error, onGo, onOp }: {
  url: string;
  canBack: boolean;
  canForward: boolean;
  loading: boolean;
  disabled: boolean;
  error: string | null;
  onGo: (address: string) => void;
  onOp: (op: "back" | "forward" | "reload") => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const editing = draft !== null;
  useEffect(() => { if (error) input.current?.focus(); }, [error]);

  const submit = () => {
    const a = (draft ?? "").trim();
    setDraft(null);
    input.current?.blur();
    if (a) onGo(a);
  };
  const key = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
    else if (e.key === "Escape") { setDraft(null); input.current?.blur(); }
  };
  return (
    <div className="border-b border-line px-2 py-1.5" data-testid="address-bar">
      <div className="flex items-center gap-0.5">
        <button type="button" onClick={() => onOp("back")} disabled={disabled || !canBack} aria-label="Back" title="Back" className={BTN}><IconBack className="size-4" /></button>
        <button type="button" onClick={() => onOp("forward")} disabled={disabled || !canForward} aria-label="Forward" title="Forward" className={BTN}><IconBack className="size-4 rotate-180" /></button>
        <button type="button" onClick={() => onOp("reload")} disabled={disabled} aria-label="Reload" title="Reload" className={BTN}><IconRefresh className={`size-4 ${loading ? "animate-spin" : ""}`} /></button>
        <input
          ref={input}
          value={editing ? draft : displayAddress(url)}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => { setDraft(url); requestAnimationFrame(() => e.target.select()); }}
          onBlur={() => setDraft(null)}
          onKeyDown={key}
          disabled={disabled}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Address or search"
          placeholder="Search or type a web address"
          data-testid="address-input"
          className="ml-1 h-8 min-w-0 flex-1 rounded-lg bg-canvas/70 px-3 text-[13px] text-fg outline-none placeholder:text-fg-dim focus:bg-canvas focus:ring-1 focus:ring-accent disabled:opacity-50"
        />
      </div>
      {error && <p role="alert" className="px-1.5 pb-0.5 pt-1.5 text-[12px] text-bad">{error}</p>}
    </div>
  );
}

/** Asks the browser agent to do something on the page that is open. Enter sends; while the agent works the button stops it. */
export function AgentBox({ busy, disabled, onSend, onStop }: { busy: boolean; disabled: boolean; onSend: (task: string) => void; onStop: () => void }) {
  const [text, setText] = useState("");
  const can = !disabled && !busy && text.trim().length >= 2;
  const send = () => {
    if (!can) return;
    const t = text.trim();
    setText("");
    onSend(t);
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); send(); }} className="flex items-center gap-2 border-t border-line px-3 py-2.5" data-testid="agent-box">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={disabled}
        maxLength={600}
        aria-label="Tell the agent what to do on this page"
        placeholder={busy ? "The agent is working…" : "Tell the agent what to do on this page…"}
        className="h-9 min-w-0 flex-1 rounded-full bg-canvas/70 px-4 text-[13.5px] text-fg outline-none placeholder:text-fg-dim focus:bg-canvas focus:ring-1 focus:ring-accent disabled:opacity-50"
      />
      {busy ? (
        <button type="button" onClick={onStop} aria-label="Stop the agent" title="Stop" className="press grid size-9 shrink-0 place-items-center rounded-full bg-surface-2 text-fg hover:bg-line"><IconStop className="size-4" /></button>
      ) : (
        <button type="submit" disabled={!can} aria-label="Send to the agent" className="press grid size-9 shrink-0 place-items-center rounded-full bg-fg text-canvas hover:bg-white disabled:cursor-not-allowed disabled:bg-send-idle disabled:text-fg-muted"><IconArrowUp className="size-[18px]" /></button>
      )}
    </form>
  );
}
