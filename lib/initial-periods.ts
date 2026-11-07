export const INITIAL_PERIODS = ['daily', 'weekly', 'monthly', 'reportMonth'] as const;

/** Prefetch summaries without letting one slow/unavailable period block login. */
export async function buildInitialPeriods(
  load: (period: string) => Promise<any>, budgetMs = 4000
): Promise<Record<string, any>> {
  const ready: Record<string, any> = {};
  let next = 0, expired = false;
  const lane = async () => {
    while (next < INITIAL_PERIODS.length && !expired) {
      const period = INITIAL_PERIODS[next++];
      try {
        const payload = await load(period);
        if (payload?.summary && Array.isArray(payload.summary.advisors) && Array.isArray(payload.campaignOptions)) {
          ready[period] = payload;
        }
      } catch { /* A missing period keeps the existing on-demand loading path. */ }
    }
  };
  // Each summary already has parallel SQL lanes; keep shared PostgreSQL load bounded.
  const work = Promise.all([lane(), lane()]);
  let timer: ReturnType<typeof setTimeout>;
  try {
    await Promise.race([work, new Promise<void>(resolve => { timer = setTimeout(() => { expired = true; resolve(); }, budgetMs); })]);
    return {...ready}; // Never mutate a response after the time budget expires.
  } finally { clearTimeout(timer); }
}
