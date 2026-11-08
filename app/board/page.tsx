"use client";
import dynamic from "next/dynamic";

// Studio is browser-only; keep it out of the server render.
const StudioBoard = dynamic(() => import("@/components/studio/StudioBoard").then((m) => m.StudioBoard), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-card bg-surface-2" />,
});

export default function BoardPage() {
  return (
    <main className="h-full overflow-y-auto p-3">
      <StudioBoard />
    </main>
  );
}
