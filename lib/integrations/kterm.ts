import Kernel from "@onkernel/sdk";
import { getEnv } from "@/lib/env";
import { degrade, guard, isOn } from "./registry";
import type { AdapterResult } from "./types";

/** The agent's shell lives in the SAME cloud VM as the live browser (KERNEL browsers.process / exec), never on this machine. */
export const WORKDIR = "/workspace";
const OUT_CAP = 20_000;
const MAX_FILE = 60_000;

export interface ExecResult {
  exit: number;
  out: string; // stdout then stderr, tail-capped
  ms: number;
}

const b64d = (s?: string): string => (s ? Buffer.from(s, "base64").toString("utf8") : "");

/** Pure. Keeps the TAIL: the end of an npm/test log is where the error is. */
export function clipOutput(s: string, cap = OUT_CAP): string {
  return s.length > cap ? `…[${s.length - cap} chars cut]\n${s.slice(-cap)}` : s;
}

/** Pure. Confines file paths to the workspace (or /tmp); relative paths are workspace-relative; `..` cannot escape. Returns null if refused. */
export function workPath(p: string): string | null {
  if (!p || p.includes("\0") || p.length > 300) return null;
  const parts: string[] = [];
  for (const seg of (p.startsWith("/") ? p : `${WORKDIR}/${p}`).split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  const abs = `/${parts.join("/")}`;
  return abs === WORKDIR || abs.startsWith(`${WORKDIR}/`) || abs.startsWith("/tmp/") ? abs : null;
}

/** Pure. Line diff (LCS) for the "+87 -0" file cards; very large files fall back to a length estimate. */
export function lineDiffStats(oldText: string, newText: string): { adds: number; removes: number } {
  const lines = (t: string) => (t === "" ? [] : t.replace(/\n$/, "").split("\n")); // a final newline ends the last line, it does not start another
  const a = lines(oldText);
  const b = lines(newText);
  if (a.length * b.length > 4_000_000) return { adds: Math.max(b.length - a.length, 0), removes: Math.max(a.length - b.length, 0) };
  const dp = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  return { adds: b.length - dp[0][0], removes: a.length - dp[0][0] };
}

/** Pure. Single-quote for bash: nothing a model writes can break out of the quoted string. */
export const shq = (s: string): string => `'${s.replace(/'/g, `'\\''`)}'`;

const client = () => new Kernel({ apiKey: getEnv().KERNEL_API_KEY });

async function sh(vm: string, command: string, timeoutSec: number, cwd: string | null = WORKDIR): Promise<ExecResult> {
  const r = await client().browsers.process.exec(vm, { command: "/bin/bash", args: ["-lc", command], cwd, timeout_sec: timeoutSec });
  const err = b64d(r.stderr_b64);
  return { exit: r.exit_code ?? -1, out: clipOutput(b64d(r.stdout_b64) + (err ? `${b64d(r.stdout_b64) ? "\n" : ""}${err}` : "")), ms: r.duration_ms ?? 0 };
}

/** Runs a command to completion (max 120s). A non-zero exit is a normal result the agent reads; only transport failures degrade. */
export async function execInVm(vm: string, command: string, timeoutSec = 90): Promise<AdapterResult<ExecResult>> {
  if (!isOn("kernel")) return degrade("kernel off");
  return guard("kernel", async () => {
    await sh(vm, `mkdir -p ${WORKDIR}`, 10, "/");
    return { ok: true, data: await sh(vm, command, Math.min(Math.max(timeoutSec, 5), 120)) };
  });
}

/** Starts a long-running server detached and waits until the port answers, so the live browser can open http://localhost:<port>. */
export async function serveInVm(vm: string, command: string, port: number): Promise<AdapterResult<ExecResult>> {
  if (!isOn("kernel")) return degrade("kernel off");
  if (!Number.isInteger(port) || port < 1024 || port > 65535) return degrade("port must be 1024-65535");
  return guard("kernel", async () => {
    const log = `/tmp/serve-${port}.log`;
    const script = `mkdir -p ${WORKDIR}; cd ${WORKDIR}; (setsid nohup bash -lc ${shq(command)} > ${log} 2>&1 &); for i in $(seq 1 40); do if curl -s -m 2 -o /dev/null http://localhost:${port}/; then echo "listening on :${port}"; tail -n 5 ${log}; exit 0; fi; sleep 0.75; done; echo "not listening on :${port} after 30s"; tail -n 30 ${log}; exit 1`;
    return { ok: true, data: await sh(vm, script, 60, "/") };
  });
}

export interface WriteResult {
  path: string;
  created: boolean;
  adds: number;
  removes: number;
}

export async function writeFileInVm(vm: string, path: string, content: string): Promise<AdapterResult<WriteResult>> {
  if (!isOn("kernel")) return degrade("kernel off");
  const abs = workPath(path);
  if (!abs) return degrade(`path outside ${WORKDIR}: ${path}`);
  if (content.length > MAX_FILE) return degrade(`file too large (${content.length} > ${MAX_FILE} chars): write it in pieces`);
  return guard("kernel", async () => {
    const before = await sh(vm, `test -f ${shq(abs)} && cat ${shq(abs)}; echo __EXISTS=$(test -f ${shq(abs)} && echo 1 || echo 0)`, 15, "/");
    const created = /__EXISTS=0\s*$/.test(before.out);
    const old = created ? "" : before.out.replace(/\n?__EXISTS=1\s*$/, "");
    const w = await sh(vm, `mkdir -p "$(dirname ${shq(abs)})" && echo ${shq(Buffer.from(content, "utf8").toString("base64"))} | base64 -d > ${shq(abs)}`, 20, "/");
    if (w.exit !== 0) return degrade(`write failed: ${w.out.slice(0, 200)}`);
    return { ok: true, data: { path: abs, created, ...lineDiffStats(old, content) } };
  });
}

export async function readFileInVm(vm: string, path: string): Promise<AdapterResult<string>> {
  if (!isOn("kernel")) return degrade("kernel off");
  const abs = workPath(path);
  if (!abs) return degrade(`path outside ${WORKDIR}: ${path}`);
  return guard("kernel", async () => {
    const r = await sh(vm, `head -c ${OUT_CAP} ${shq(abs)}`, 15, "/");
    return r.exit === 0 ? { ok: true, data: r.out } : degrade(`read failed: ${r.out.slice(0, 200)}`);
  });
}
