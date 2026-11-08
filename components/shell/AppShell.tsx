"use client";
import { createContext, Suspense, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { AgentProvider } from "@/components/agent/AgentProvider";
import { SelectionPopover } from "@/components/agent/SelectionPopover";
import { Workspace } from "@/components/agent/Workspace";
import { Sidebar } from "./Sidebar";

const ShellCtx = createContext<{ openSidebar: () => void }>({ openSidebar: () => {} });
export const useShell = () => useContext(ShellCtx);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const path = usePathname();
  useEffect(() => {
    setDrawer(false);
  }, [path]);
  return (
    <ShellCtx.Provider value={{ openSidebar: () => setDrawer(true) }}>
      <AgentProvider>
      <div className="flex h-dvh overflow-hidden bg-canvas text-fg" data-testid="shell">
        {drawer && <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setDrawer(false)} />}
        <aside data-testid="shell-sidebar" className={`fixed inset-y-0 left-0 z-50 w-[272px] border-r border-line bg-sidebar transition-transform duration-200 lg:static lg:translate-x-0 ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
          <Suspense fallback={null}><Sidebar /></Suspense>
        </aside>
        <div className="relative min-h-0 min-w-0 flex-1" data-testid="shell-main">{children}<Workspace /></div>
        <AgentPanel />
      </div>
      <SelectionPopover />
      </AgentProvider>
    </ShellCtx.Provider>
  );
}
