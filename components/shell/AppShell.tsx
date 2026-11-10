"use client";
import { createContext, Suspense, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AgentPanel } from "@/components/agent/AgentPanel";
import { AgentProvider } from "@/components/agent/AgentProvider";
import { SelectionPopover } from "@/components/agent/SelectionPopover";
import { BrowserPip } from "@/components/agent/BrowserPip";
import { ArtifactPanel } from "@/components/agent/ArtifactPanel";
import { CommandPalette } from "./CommandPalette";
import { Rail, ResizeHandle, useResizable } from "./Resizable";
import { Sidebar } from "./Sidebar";

const ShellCtx = createContext<{ openSidebar: () => void; openPalette: () => void }>({ openSidebar: () => {}, openPalette: () => {} });
export const useShell = () => useContext(ShellCtx);

export function AppShell({ children }: { children: React.ReactNode }) {
  const [drawer, setDrawer] = useState(false);
  const [palette, setPalette] = useState(false);
  const path = usePathname();
  const home = path === "/";
  const left = useResizable("sidebar", "left");
  useEffect(() => {
    setDrawer(false);
    setPalette(false);
  }, [path]);
  // Ctrl/Cmd+K opens the command palette from anywhere, including while typing in the prompt box
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, []);
  return (
    <ShellCtx.Provider value={{ openSidebar: () => setDrawer(true), openPalette: () => setPalette(true) }}>
      <AgentProvider>
      <div className="flex h-dvh overflow-hidden bg-canvas text-fg" data-testid="shell">
        {drawer && <button type="button" aria-label="Close sidebar" className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={() => setDrawer(false)} />}
        <aside data-testid="shell-sidebar" style={left.style} className={`fixed inset-y-0 left-0 z-50 w-[272px] bg-sidebar transition-transform duration-200 lg:static lg:w-[var(--panel-w)] lg:translate-x-0 lg:transition-none ${left.collapsed ? "lg:hidden" : ""} ${drawer ? "translate-x-0" : "-translate-x-full"}`}>
          <Suspense fallback={null}><Sidebar onCollapse={() => left.setCollapsed(true)} /></Suspense>
        </aside>
        {left.collapsed && <Rail title="UltraPals" side="left" onOpen={() => left.setCollapsed(false)} />}
        <ResizeHandle r={left} label="sidebar" side="left" />
        <div className="relative min-h-0 min-w-0 flex-1" data-testid="shell-main">{children}{!home && <ArtifactPanel docked={false} />}</div>
        {home ? <ArtifactPanel docked /> : <AgentPanel />}
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      <BrowserPip />
      <SelectionPopover />
      </AgentProvider>
    </ShellCtx.Provider>
  );
}
