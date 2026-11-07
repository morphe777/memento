// H-19: `pnpm db:verify <file>` — read only: integrity check and contents of a database or a backup, to check a
// backup before restoring it and the database after (same figures expected).
import { resolve } from 'node:path';
import { describeDb, openDbReadonly } from './client.ts';

const file = resolve(process.env.INIT_CWD ?? process.cwd(), process.argv[2] ?? '');
const db = openDbReadonly(file);
const d = describeDb(db);
db.close();
console.log(JSON.stringify(d));
process.exit(d.ok ? 0 : 1);
