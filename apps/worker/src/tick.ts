// One worker tick (H-14: testable apart from the timer): every due job, then the frozen reports' notices, the
// daily recap (D-77) and the nightly backup (D-135). A failure is logged, never thrown: the next tick retries.
import type { Ctx } from '@memento/domain';
import { notifyFrozenReports, runBackupJob, runDailyRecapJob, runDueJobs } from '@memento/domain';

type Log = (line: Record<string, unknown>) => void;
const stdout: Log = (line) => console.log(JSON.stringify({ time: Date.now(), ...line }));

export async function tick(ctx: Ctx, backupDir: string, env: NodeJS.ProcessEnv = process.env, log = stdout) {
  try {
    const r: Record<string, string> = runDueJobs(ctx);
    Object.assign(r, await notifyFrozenReports(ctx, env, r));
    r.daily_recap = await runDailyRecapJob(ctx, env); // D-77
    r.backup = await runBackupJob(ctx, backupDir); // D-135
    const ran = Object.entries(r).filter(([, v]) => v !== 'skipped');
    if (ran.length) log({ level: 30, msg: 'jobs', jobs: Object.fromEntries(ran) });
    return r;
  } catch (e) {
    log({ level: 50, msg: 'tick failed', err: (e as Error).message });
    return null;
  }
}
