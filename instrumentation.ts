// Fail at startup with a readable message instead of a runtime `undefined`.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { getEnv } = await import("./lib/env");
    const env = getEnv();
    // Automations are checked by a timer inside the server. It only reads the automations file until something is due.
    if (env.AUTOMATIONS_SCHEDULER === "on") (await import("./lib/automations/scheduler")).startScheduler();
  }
}
