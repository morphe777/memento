// C-05, C-06: `pnpm db:check` — lists the impossible dates and unreadable recurrence rules of a database, opened
// read only (no migration, nothing written). Exit code 1 when something must be corrected.
// In production: docker exec memento node_modules/.bin/tsx packages/domain/src/cli/check-data.ts
import { openDbReadonly, resolveDbFile } from '@memento/db';
import { findInvalidData } from '../services/integrity.ts';

const file = resolveDbFile(process.argv[2]);
const sqlite = openDbReadonly(file);
const found = findInvalidData(sqlite);
sqlite.close();
if (found.length === 0) {
  console.log(`${file} : aucune date impossible ni règle de récurrence illisible.`);
  process.exit(0);
}
console.log(`${file} : ${found.length} valeur(s) à corriger à la main :`);
for (const f of found) console.log(`- ${f.table} ${f.id} · ${f.column} = ${JSON.stringify(f.value)}`);
process.exit(1);
