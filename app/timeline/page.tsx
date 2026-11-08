"use client";
import dynamic from "next/dynamic";

const PromiseTimeline = dynamic(() => import("@/components/PromiseTimeline"), {
  ssr: false,
  loading: () => <div className="h-full animate-pulse rounded-card bg-surface-2" />,
});

export default function TimelinePage() {
  return (
    <main className="h-full overflow-y-auto p-3">
      <PromiseTimeline />
    </main>
  );
}
