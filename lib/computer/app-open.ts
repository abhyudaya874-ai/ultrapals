import { writeArtifact } from "./artifacts";
import { automationRunsCsv, automationsCsv, openedSummary, newsroomCsv, proctorCsv, timelineCsv, verdictsCsv, type AppName } from "./app-data";
import type { SubCtx } from "./ctx";
import type { CEvent } from "./events";
import { APP_TITLES } from "./pals";

const rowsIn = (csv: string): number => Math.max(0, csv.trim().split("\n").length - 1);

/**
 * UltraPal opens one of the app's own screens: the data goes into the workspace as CSV (so the planner and TerminalPal can read it) and the
 * UI opens the matching tab. Read-only: nothing here writes to the database or moves money. Returns what the planner should know.
 */
export async function* openAppArtifact(ctx: SubCtx, name: AppName): AsyncGenerator<CEvent, string> {
  const { agent, deps } = ctx;
  const id = `${agent}-open-${name}`;
  yield { kind: "step", agent, id, label: `Opening ${APP_TITLES[name]}`, state: "running" };
  const files: { name: string; csv: string }[] = [];
  try {
    if (name === "newsroom") files.push({ name: "app/newsroom.csv", csv: newsroomCsv(deps.appData.articles()) });
    else if (name === "dashboard") {
      files.push({ name: "app/verdicts.csv", csv: verdictsCsv(await deps.appData.verdicts(200)) });
      files.push({ name: "app/automations.csv", csv: automationsCsv(await deps.appData.automations()) });
    } else if (name === "timeline") {
      files.push({ name: "app/timeline.csv", csv: timelineCsv(await deps.appData.verdicts(200)) });
      files.push({ name: "app/automation-runs.csv", csv: automationRunsCsv(await deps.appData.automations()) });
    }
    else {
      const p = proctorCsv(deps.appData.proctor());
      files.push({ name: "app/proctor-jobs.csv", csv: p.jobs }, { name: "app/proctor-events.csv", csv: p.events });
    }
  } catch (e) {
    const why = e instanceof Error ? e.message : "failed";
    yield { kind: "step", agent, id, label: `Opening ${APP_TITLES[name]}`, state: "error", detail: why };
    yield { kind: "open", artifact: name, title: APP_TITLES[name] };
    return `Could not read the ${name} data (${why}). The tab is open but may be empty; say so instead of guessing.`;
  }
  const done: { name: string; rows: number }[] = [];
  for (const f of files) {
    if (yield* writeArtifact(ctx, f.name, f.csv)) done.push({ name: f.name, rows: rowsIn(f.csv) });
  }
  yield { kind: "step", agent, id, label: `Opened ${APP_TITLES[name]}`, state: "ok", detail: done.map((d) => `${d.rows} rows`).join(", ") };
  yield { kind: "open", artifact: name, title: APP_TITLES[name] };
  return openedSummary(name, done);
}
