// Worker: runs the scheduled jobs of @memento/domain every minute (no business logic here).
import { dirname, join } from 'node:path';
import { openDb, resolveDbFile, runMigrations } from '@memento/db';
import { notifyFrozenReports, runBackupJob, runDailyRecapJob, runDueJobs, seed } from '@memento/domain';

const { db, sqlite } = openDb();
const backupDir = join(dirname(resolveDbFile()), 'backups'); // D-135: <data folder>/backups (the bind in Docker)
runMigrations(db);
seed({ db, sqlite, actor: 'me' });

async function tick() {
  try {
    const r: Record<string, string> = runDueJobs({ db, sqlite, actor: 'me' });
    Object.assign(r, await notifyFrozenReports({ db, sqlite, actor: 'me' }, process.env, r));
    r.daily_recap = await runDailyRecapJob({ db, sqlite, actor: 'me' }, process.env); // D-77
    r.backup = await runBackupJob({ db, sqlite, actor: 'me' }, backupDir); // D-135
    const ran = Object.entries(r).filter(([, v]) => v !== 'skipped');
    if (ran.length)
      console.log(
        JSON.stringify({ level: 30, time: Date.now(), msg: 'jobs', jobs: Object.fromEntries(ran) }),
      );
  } catch (e) {
    console.error(
      JSON.stringify({ level: 50, time: Date.now(), msg: 'tick failed', err: (e as Error).message }),
    );
  }
}
void tick();
const timer = setInterval(() => void tick(), 60_000);
const stop = () => {
  clearInterval(timer);
  sqlite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'worker started (Europe/Paris)' }));
