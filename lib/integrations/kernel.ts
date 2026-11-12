import Kernel from "@onkernel/sdk";
import { z } from "zod";
import { releaseCloudComputer, startedCloudComputer, takeCloudComputer } from "@/lib/budget/kernel";
import { getEnv } from "@/lib/env";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult, PageFact } from "./types";
import { assertPublicHttpUrl } from "./url-guard";

const Result = z.object({ text: z.string() });

/**
 * Real headful Chromium in the cloud: open the page, record a replay, read the body text, ALWAYS delete the session.
 * `replayUrl` is the demo evidence ("here is the actual page"). The verdict compares only `text`.
 */
export async function observePage(url: string, signal?: AbortSignal): Promise<AdapterResult<PageFact>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    const safe = assertPublicHttpUrl(url);
    const kernel = new Kernel({ apiKey: getEnv().KERNEL_API_KEY });
    // The same spending guard as the live browser (lib/budget): a place is taken before anything is created, and given back when the page has been read.
    const key = `observe-${crypto.randomUUID()}`;
    const place = takeCloudComputer(key);
    if (!place.ok) return degrade(`kernel: ${place.why}`);
    const browser = await kernel.browsers.create({ headless: false, timeout_seconds: 60 }, { signal }).catch((e: unknown) => {
      releaseCloudComputer(key);
      throw e;
    });
    const id = browser.session_id;
    startedCloudComputer(key, id);
    try {
      let replayUrl: string | undefined;
      let replayId: string | undefined;
      try {
        const replay = await kernel.browsers.replays.start(id, {}, { signal });
        replayId = replay.replay_id;
        replayUrl = replay.replay_view_url;
      } catch {
        /* a missing replay never blocks the observation */
      }

      const exec = await kernel.browsers.playwright.execute(
        id,
        {
          timeout_sec: 20,
          code:
            `await page.goto(${JSON.stringify(safe)}, { waitUntil: "domcontentloaded", timeout: 15000 });` +
            ` const text = (await page.innerText("body")).slice(0, 4000); return { text };`,
        },
        { signal },
      );
      if (replayId) await kernel.browsers.replays.stop(replayId, { id_or_name: id }, { signal }).catch(() => undefined);
      if (!exec.success) return degrade(`kernel exec: ${exec.error ?? "failed"}`);

      const r = Result.safeParse(exec.result);
      if (!r.success) return degrade("kernel empty result");
      return { ok: true, data: { url: safe, text: r.data.text, replayUrl } };
    } finally {
      await kernel.browsers.deleteByID(id).catch(() => undefined); // never browser.close(): that only drops the local connection
      releaseCloudComputer(id);
    }
  });
}

/** Degrade target for KERNEL. Follows at most 3 redirects, re-validating every hop (SSRF). */
export async function fetchPage(url: string, signal?: AbortSignal): Promise<AdapterResult<PageFact>> {
  return guard("kernel", async () => {
    let current = assertPublicHttpUrl(url);
    for (let hop = 0; hop < 4; hop++) {
      const res = await fetch(current, { redirect: "manual", signal: signal ?? AbortSignal.timeout(5_000), headers: { "user-agent": "standing-promise-demo/1.0" } });
      if (res.status >= 300 && res.status < 400) {
        const loc = res.headers.get("location");
        if (!loc) return degrade("redirect without location");
        current = assertPublicHttpUrl(new URL(loc, current).toString());
        continue;
      }
      if (!res.ok) return degrade(`fetch http ${res.status}`);
      const html = await res.text();
      const text = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000);
      return { ok: true, data: { url: current, text } };
    }
    return degrade("too many redirects");
  });
}
