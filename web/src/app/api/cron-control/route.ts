import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const g = globalThis as any;

  // Standardized mapping of all global cron states
  const statuses = {
    inbox: {
      xavier: {
        running: !!g.xavier_inbox_running,
        suspended: !!g.xavier_inbox_sessionSuspended,
        lastRun: g.xavier_inbox_lastRun,
      },
      instar: {
        running: !!g.instar_inbox_cronRunning,
        suspended: !!g.instar_inbox_sessionSuspended,
        lastRun: g.instar_inbox_lastCronRun,
      },
      felix: {
        running: !!g.felix_cronRunning,
        suspended: !!g.felix_sessionSuspended,
        lastRun: g.felix_lastCronRun,
      },
      cindy: {
        running: !!g.cindy_inbox_running,
        suspended: !!g.cindy_inbox_sessionSuspended,
        lastRun: g.cindy_inbox_lastRun,
      },
    },
    grow: {
      xavier: {
        running: !!g.xavier_grow_running,
        suspended: !!g.xavier_grow_sessionSuspended,
        lastRun: g.xavier_grow_lastRun,
      },
      instar: {
        running: !!g.instar_grow_growRunning,
        suspended: !!g.instar_grow_sessionSuspended,
        lastRun: g.instar_grow_lastGrowRun,
      },
    },
  };

  // Helper to check if any are active
  const anyInboxRunning = Object.values(statuses.inbox).some(s => s.running);
  const anyGrowRunning = Object.values(statuses.grow).some(s => s.running);

  return NextResponse.json({
    statuses,
    anyInboxRunning,
    anyGrowRunning,
  });
}
