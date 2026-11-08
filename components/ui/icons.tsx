import type { SVGProps } from "react";

// One factory, same stroke everywhere: 24x24 grid, 1.75 stroke, round caps, currentColor.
// Needed set only — no mic, bell, thumbs or fork (no backing feature, see the task mapping).

const circ = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 0 1 ${r * 2} 0a${r} ${r} 0 0 1 ${-r * 2} 0`;

const make = (d: string | string[]) =>
  function Icon(props: SVGProps<SVGSVGElement>) {
    const paths = Array.isArray(d) ? d : [d];
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" width="1em" height="1em" {...props}>
        {paths.map((p) => (
          <path key={p} d={p} />
        ))}
      </svg>
    );
  };

export const IconPlus = make("M12 5v14M5 12h14");
export const IconSearch = make("M11 4a7 7 0 100 14 7 7 0 000-14zM20 20l-4-4");
export const IconPanelLeft = make(["M5 4h14a1 1 0 011 1v14a1 1 0 01-1 1H5a1 1 0 01-1-1V5a1 1 0 011-1z", "M9.5 4v16"]);
export const IconBack = make("M19 12H5M12 19l-7-7 7-7");
export const IconMore = make([circ(5, 12, 1.1), circ(12, 12, 1.1), circ(19, 12, 1.1)]);
export const IconList = make(["M8 6h13M8 12h13M8 18h13", circ(3.6, 6, 1.1), circ(3.6, 12, 1.1), circ(3.6, 18, 1.1)]);
export const IconShare = make("M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8M16 6l-4-4-4 4M12 2v13");
export const IconChevronDown = make("M6 9l6 6 6-6");
export const IconChevronRight = make("M9 18l6-6-6-6");
export const IconCopy = make(["M9 9h10a1 1 0 011 1v10a1 1 0 01-1 1H9a1 1 0 01-1-1V10a1 1 0 011-1z", "M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"]);
export const IconCheck = make("M5 12.5l4.5 4.5L19 7.5");
export const IconTerminal = make("M4 17l6-5-6-5M12 19h8");
export const IconAgent = make(["M22 2l-7 20-4-9-9-4 20-7z", "M22 2L11 13"]);
export const IconFile = make(["M5 2h9l5 5v13a2 2 0 01-2 2H5a2 2 0 01-2-2V4a2 2 0 012-2z", "M14 2v5h5"]);
export const IconDownload = make("M12 3v12M7 10l5 5 5-5M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4");
export const IconExpand = make("M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7");
export const IconX = make("M6 6l12 12M18 6L6 18");
export const IconArrowUp = make("M12 19V5M6 11l6-6 6 6");
export const IconArrowDown = make("M12 5v14M6 13l6 6 6-6");
export const IconReturnArrow = make("M9 10l-5 5 5 5M20 4v7a4 4 0 01-4 4H4");
export const IconBoard = make(["M4 4h6v6H4z", "M14 4h6v6h-6z", "M4 14h6v6H4z", "M14 14h6v6h-6z"]);
export const IconClock = make([circ(12, 12, 8.5), "M12 7v5l3.5 2"]);
export const IconPlug = make(["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a4 4 0 01-4 4h-4a4 4 0 01-4-4V8z"]);
export const IconPencil = make(["M17 3l4 4L8 20l-5 1 1-5L17 3z", "M14.5 5.5l4 4"]);
export const IconGlobe = make(["M12 3a9 9 0 100 18 9 9 0 000-18z", "M3 12h18", "M12 3c2.5 2.4 3.8 5.4 3.8 9s-1.3 6.6-3.8 9c-2.5-2.4-3.8-5.4-3.8-9S9.5 5.4 12 3z"]);
export const IconStop = make("M7 7h10v10H7z");
