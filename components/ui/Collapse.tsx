"use client";
import type { ReactNode } from "react";
import { usePresent } from "./presence";

/**
 * A body that opens and closes by growing its own height and fading in (the grid-rows trick, `.snap-grow`). The wrapper is always in the page, so a
 * change is a single CSS transition that can turn around half way. The children are mounted only while it is open and for a moment after, so a
 * long body costs nothing while shut. Put the spacing inside `children`, not around the Collapse: a shut one still takes its parent's gap.
 */
export function Collapse({ open, children, id, className = "" }: { open: boolean; children: ReactNode; id?: string; className?: string }) {
  const present = usePresent(open);
  return (
    <div id={id} className={`snap-grow ${className}`.trim()} data-open={open} inert={!open}>
      <div>{present ? children : null}</div>
    </div>
  );
}
