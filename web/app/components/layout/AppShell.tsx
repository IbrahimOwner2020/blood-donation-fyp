import { useState } from "react";
import { Outlet } from "react-router";

import { DashboardAssistant } from "~/components/assistant/DashboardAssistant";
import { Sidebar } from "~/components/layout/Sidebar";
import { TopBar } from "~/components/layout/TopBar";
import type { AuthSession } from "~/lib/auth";

type AppShellProps = {
  session: AuthSession;
};

export function AppShell({ session }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-nbts-surface">
      <TopBar
        session={session}
        onMenuClick={() => setSidebarOpen((value) => !value)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
        />
        <main className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5 sm:py-5 lg:px-6">
          <Outlet />
        </main>
      </div>
      <DashboardAssistant />
    </div>
  );
}
