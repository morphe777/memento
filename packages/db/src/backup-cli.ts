// H-19: `pnpm db:backup <destination>` — hot copy of the database (MEMENTO_DB_FILE), checked afterwards.
// In production: docker exec memento node_modules/.bin/tsx packages/db/src/backup-cli.ts /data/sauvegardes/AAAA-MM-JJ.db
import { resolve } from 'node:path';
import { backupDb, resolveDbFile } from './client.ts';

const dest = process.argv[2];
if (!dest) {
  console.error('Usage : backup-cli.ts <fichier de destination>');
  process.exit(2);
}
const r = await backupDb(resolveDbFile(), resolve(process.env.INIT_CWD ?? process.cwd(), dest));
const same = JSON.stringify({ ...r.source, integrity: 0 }) === JSON.stringify({ ...r.copy, integrity: 0 });
console.log(JSON.stringify(r.copy));
if (!r.copy.ok || !same) {
  console.error('❌ Copie incomplète ou endommagée : ne pas s’y fier.', JSON.stringify(r.source));
  process.exit(1);
}
console.log(`✅ Sauvegarde vérifiée : ${resolve(process.env.INIT_CWD ?? process.cwd(), dest)}`);
