// Worker: runs the scheduled jobs of @memento/domain every minute (no business logic here).
import { openDb, runMigrations } from '@memento/db';
import { runDueJobs, seed } from '@memento/domain';

const { db, sqlite } = openDb();
runMigrations(db);
seed({ db, sqlite, actor: 'me' });

function tick() {
  try {
    const r = runDueJobs({ db, sqlite, actor: 'me' });
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
tick();
const timer = setInterval(tick, 60_000);
const stop = () => {
  clearInterval(timer);
  sqlite.close();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
console.log(JSON.stringify({ level: 30, time: Date.now(), msg: 'worker started (Europe/Paris)' }));
