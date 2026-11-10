import Link from "next/link";
import { Composer } from "@/components/Composer";
import { getEnv } from "@/lib/env";
import { capabilityReport, isOn } from "@/lib/integrations/registry";

export const dynamic = "force-dynamic";

export default function NewPromise() {
  const caps = capabilityReport();
  return (
    <main className="h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[720px] flex-col justify-center gap-6 px-6 py-10">
        <header>
          <h1 className="font-serif text-[40px] leading-tight text-fg">New promise</h1>
          <p className="mt-1 text-[15px] text-fg-muted">A pal for every job. Money moves only when a verdict computed in code says so.</p>
        </header>
        <Composer />
        <nav className="flex flex-wrap items-center gap-4 text-[13px]">
          <Link href="/" className="text-fg-muted hover:text-fg">Ask UltraPal instead</Link>
          {isOn("astropods") && (
            <a href={getEnv().ASTROPODS_AGENT_URL} target="_blank" rel="noreferrer" className="text-fg-muted hover:text-fg">Ask the Promise concierge</a>
          )}
        </nav>
        <ul className="flex flex-wrap gap-2" aria-label="Capabilities">
          {caps.map((c) => (
            <li key={c.id} title={c.note} className="inline-flex items-center gap-1.5 rounded-full bg-surface px-2.5 py-1 text-[12px] text-fg-muted">
              <span className={`size-1.5 rounded-full ${c.on ? "bg-ok" : "bg-fg-dim"}`} />
              {c.id} {c.on ? "on" : "off"}
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}
