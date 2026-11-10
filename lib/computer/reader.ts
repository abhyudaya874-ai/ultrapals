import { needsHuman } from "@/lib/browse/handoff";
import { shq } from "@/lib/integrations/kterm";
import { assertPublicHttpUrl } from "@/lib/integrations/url-guard";
import { htmlToText } from "@/lib/research/htmltext";
import { ensureVm, type SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { hostOfUrl, readVisit } from "./visits";

export const MAX_BROWSER_READS = 3;

// One live browser per conversation: readers take turns, so two pages never fight over the same tab.
const tails = new WeakMap<object, Promise<void>>();
async function takeBrowser(key: object): Promise<() => void> {
  const prev = tails.get(key) ?? Promise.resolve();
  let release!: () => void;
  const mine = new Promise<void>((res) => { release = res; });
  tails.set(key, prev.then(() => mine));
  await prev;
  return release;
}
export const MIN_CHARS = 400;
const TEXT_CAP = 6_000;

export interface ReadResult {
  text: string;
  via: "fetch" | "browser" | "terminal";
  url: string;
}

/**
 * Reads ONE public page in full, the way a careful person would: a plain fetch first; if that is blocked, empty or too thin (a script-
 * rendered page), open it in the live browser (the user watches it navigate); if the browser cannot get it either, curl it from the
 * terminal. Every hop is an event, so the Browser and Terminal tabs show real work. Capped: the browser is slow and shared.
 * Returns the best text found, or null when nothing could be read. A URL that fails the SSRF guard is never opened by anything.
 */
export async function* readPage(ctx: SubCtx, url: string, o: { allowBrowser?: boolean; minChars?: number; agent?: string } = {}): AsyncGenerator<CEvent, ReadResult | null> {
  const { deps, session, signal } = ctx;
  const agent = o.agent ?? ctx.agent;
  const min = o.minChars ?? MIN_CHARS;
  let safe: string;
  try {
    safe = assertPublicHttpUrl(url);
  } catch {
    return null;
  }
  const host = hostOfUrl(safe);
  const id = `read-${host}`;
  yield { kind: "step", agent, id, label: `Reading ${host}`, state: "running" };
  const t0 = Date.now();
  let best = "";

  const fetched = await deps.fetchPage(safe, signal);
  if (fetched.ok) {
    best = fetched.data.text.slice(0, TEXT_CAP);
    // A security-check page is not the page: its few lines must never be quoted or cited as what the site says. A reader works in the background, so it
    // reports the wall and moves on (it never interrupts the person; the browser agent is the one that asks for help).
    const wall = needsHuman({ url: safe, title: "", text: best, elements: [] });
    if (wall?.stop) {
      yield { kind: "step", agent, id, label: `Reading ${host}`, state: "error", detail: `blocked: ${wall.reason}`, ms: Date.now() - t0 };
      return null;
    }
    if (best.length >= min) {
      yield readVisit(agent, safe, undefined, "fetch");
      yield { kind: "step", agent, id, label: `Read ${host}`, state: "ok", detail: `${best.length} characters`, ms: Date.now() - t0 };
      return { text: best, via: "fetch", url: safe };
    }
  } else if (fetched.reason.startsWith("blocked")) {
    yield { kind: "step", agent, id, label: `Reading ${host}`, state: "error", detail: fetched.reason, ms: Date.now() - t0 };
    return null;
  }

  if (o.allowBrowser && session.browserReads < MAX_BROWSER_READS) {
    const release = await takeBrowser(session);
    try {
    const vm = session.browserReads < MAX_BROWSER_READS ? yield* ensureVm({ ...ctx, agent }) : null;
    if (vm) {
      session.browserReads++;
      yield { kind: "step", agent, id: `${id}-browser`, label: `Opening ${host} in the browser`, state: "running", detail: fetched.ok ? "the plain page was too thin" : fetched.reason };
      const went = await deps.vm.goto(vm, safe);
      const snap = went.ok ? await deps.vm.snapshot(vm) : null;
      const wall = snap?.ok ? needsHuman(snap.data) : null;
      if (snap?.ok && wall?.stop) {
        // The site put a CAPTCHA or a block page in front of the browser. The terminal would meet the same wall, so stop here.
        yield { kind: "page", url: snap.data.url, title: snap.data.title };
        yield { kind: "step", agent, id: `${id}-browser`, label: `Opened ${host} in the browser`, state: "error", detail: `blocked: ${wall.reason}`, ms: Date.now() - t0 };
        yield { kind: "step", agent, id, label: `Read ${host}`, state: best ? "ok" : "error", detail: best ? `only ${best.length} characters; the site blocked the browser` : "blocked by a security check", ms: Date.now() - t0 };
        if (best) {
          yield readVisit(agent, safe, undefined, "fetch", "ok");
          return { text: best, via: "fetch", url: safe };
        }
        return null;
      }
      if (snap?.ok) {
        yield { kind: "page", url: snap.data.url, title: snap.data.title };
        const t = snap.data.text.replace(/\n{3,}/g, "\n\n").slice(0, TEXT_CAP);
        if (t.length > best.length) best = t;
        if (best.length >= min) {
          yield readVisit(agent, safe, snap.data.title, "browser");
          yield { kind: "step", agent, id: `${id}-browser`, label: `Opened ${host} in the browser`, state: "ok", detail: `${best.length} characters`, ms: Date.now() - t0 };
          return { text: best, via: "browser", url: safe };
        }
      }
      yield { kind: "step", agent, id: `${id}-browser`, label: `Opened ${host} in the browser`, state: "error", detail: went.ok ? "the page had no readable text" : went.reason, ms: Date.now() - t0 };

      // The browser did not give a good answer: ask the page for its raw text from the terminal (works for JSON, docs sources, API specs).
      const cmd = `curl -sL --max-time 20 -A 'Mozilla/5.0 UltraPals' ${shq(safe)} | head -c 80000`;
      const tid = `${id}-curl`;
      yield { kind: "term", agent, id: tid, command: cmd, state: "running" };
      const r = await deps.term.exec(vm.id, cmd, 40);
      if (r.ok) {
        const t = htmlToText(r.data.out).slice(0, TEXT_CAP);
        yield { kind: "term", agent, id: tid, command: cmd, state: r.data.exit === 0 ? "ok" : "error", out: r.data.out.slice(0, 1500), exit: r.data.exit, ms: r.data.ms };
        if (t.length > best.length) best = t;
        if (best.length >= min) {
          yield readVisit(agent, safe, undefined, "terminal");
          return { text: best, via: "terminal", url: safe };
        }
      } else {
        yield { kind: "term", agent, id: tid, command: cmd, state: "error", out: r.reason, exit: -1 };
      }
    }
    } finally {
      release();
    }
  }

  yield { kind: "step", agent, id, label: `Read ${host}`, state: best ? "ok" : "error", detail: best ? `only ${best.length} characters` : "nothing readable", ms: Date.now() - t0 };
  if (best) {
    yield readVisit(agent, safe, undefined, "fetch", "ok");
    return { text: best, via: "fetch", url: safe };
  }
  return null;
}
