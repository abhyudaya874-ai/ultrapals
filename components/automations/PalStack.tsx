"use client";
import { effortOf } from "@/components/orbs/effort";
import { FlatOrb } from "@/components/orbs/Orbs";
import { lookFor, roleOf, type OrbLook } from "@/components/orbs/palette";
import { PERSONAS } from "@/lib/arena/personas";
import { TEAM_OF, type Kind } from "@/lib/automations/kinds";
import { palName } from "@/lib/computer/pals";
import type { Level } from "@/lib/computer/models";

const FRONT = 34;
const BACK = 27;
const OVERLAP = 9;

/** Pure. A name for a member of a team: a Pal's own name, or the persona that a Battle team or a Loop round is played by ("c2-skeptic" -> Skeptic). */
export function memberName(id: string): string {
  const persona = /^[cr]\d-(.+)$/.exec(id);
  if (persona) return PERSONAS.find((p) => p.id === persona[1])?.name ?? persona[1];
  return palName(id);
}

/**
 * The agents that work on a kind of automation, drawn as a stack of orbs that overlap: the one that does the job first is in front and a little bigger,
 * the others sit behind it, each peeking out further along. UltraPal wears the colours of the effort level that is chosen.
 */
export function PalStack({ kind, level, className }: { kind: Kind; level: Level; className?: string }) {
  const team = TEAM_OF[kind];
  const ultra: OrbLook = { kind: "gradient", colors: effortOf(level).orb, eye: "#0C0C10" };
  return (
    <span className={`inline-flex shrink-0 items-center ${className ?? ""}`} role="img" aria-label={`Works with ${team.map(memberName).join(", ")}`} data-testid="pal-stack" key={kind}>
      {team.map((id, i) => {
        const size = i === 0 ? FRONT : BACK;
        const look = id === "main" ? ultra : lookFor(id, /^[cr]\d-/.test(id) ? "battle" : roleOf(id));
        return (
          <span key={id} title={memberName(id)} data-agent={id} className="chip-in relative inline-flex rounded-full ring-2 ring-canvas" style={{ marginLeft: i === 0 ? 0 : -OVERLAP, zIndex: team.length - i, animationDelay: `${i * 28}ms` }}>
            <FlatOrb size={size} look={look} level={level} interactive={false} />
          </span>
        );
      })}
    </span>
  );
}
