import { chooseMessages, specFromChoice } from "@/lib/charts/choose";
import { resolveSpec, rowsFromTable, suggestSpec } from "@/lib/charts/spec";
import { parseCsv } from "./artifacts";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { callModel } from "./model";

/** Pure. A workspace file by the name a model gives it: exact, or with the artifacts/ prefix, or the file name alone. */
export function findFile(files: Readonly<Record<string, string>>, name: string): { path: string; text: string } | null {
  const n = name.trim().replace(/^\/?(workspace\/)?/, "");
  const keys = Object.keys(files);
  const hit = keys.find((k) => k === n) ?? keys.find((k) => k === `artifacts/${n}`) ?? keys.find((k) => k.endsWith(`/${n}`) || k.split("/").pop() === n.split("/").pop());
  return hit ? { path: hit, text: files[hit] } : null;
}

/**
 * UltraPal's `chart` action. A model looks at the table's columns and the question and PICKS the chart type and which columns go where; the numbers
 * are read from the file by code, and the pick is checked against the data (resolveSpec). If the model is unavailable or answers badly, a rule-based
 * pick is used. Read-only: it draws, it does not write.
 */
export async function* runChart(ctx: SubCtx, fileName: string, question: string): AsyncGenerator<CEvent, string> {
  const { agent, deps, session, signal } = ctx;
  const id = `${agent}-chart-${++session.seq}`;
  const label = `Choosing a chart for ${fileName.split("/").pop()}`;
  const f = findFile(session.files, fileName);
  if (!f) {
    yield { kind: "step", agent, id, label, state: "error", detail: "no such file" };
    return `There is no file called "${fileName}" in the workspace. Files: ${Object.keys(session.files).join(", ") || "(none)"}.`;
  }
  const rows = rowsFromTable(parseCsv(f.text, 201));
  if (rows.length === 0) {
    yield { kind: "step", agent, id, label, state: "error", detail: "the file has no data rows" };
    return `${f.path} has no data rows to chart (it needs a header line and at least one row, as CSV).`;
  }
  yield { kind: "step", agent, id, label, state: "running" };
  const t0 = Date.now();
  const res = yield* callModel(agent, chooseMessages(f.path, question, rows), deps.model, { signal, round: session.seq, maxTokens: 500, accept: (t) => specFromChoice(t, rows) !== null });
  const picked = res.ok ? specFromChoice(res.text, rows) : null;
  const requested = picked ?? suggestSpec(rows, f.path.split("/").pop());
  const r = resolveSpec(requested);
  const by = picked ? `chosen by ${res.ok ? res.model : "the model"}` : "chosen by rule (the model's choice was not usable)";
  const spec = { ...r.spec, title: r.spec.title ?? f.path.split("/").pop(), why: r.spec.why ?? requested.why };
  yield { kind: "chart", agent, id, spec, note: r.note, source: f.path };
  yield { kind: "step", agent, id, label: `Drew a ${spec.type} chart of ${f.path.split("/").pop()}`, state: "ok", detail: by, ms: Date.now() - t0 };
  return `Drew a ${spec.type} chart of ${f.path} (${rows.length} rows; ${by}).${spec.why ? ` Why: ${spec.why}` : ""}${r.note ? ` Note: ${r.note}` : ""} The chart is shown to the user; describe what it shows from the data, do not repeat the numbers table.`;
}

