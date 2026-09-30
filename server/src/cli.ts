/**
 * Command-line tools:
 *   migrate            apply database migrations
 *   seed               create the admin account and demo data (if missing)
 *   backup [file]      write a full JSON backup (default: backups/backup-<date>.json)
 *   restore <file>     REPLACE all data with a JSON backup (asks for confirmation)
 */
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { migrate, pool } from './db.js';
import { ensureAdmin, seedDemo } from './seed.js';
import { exportBackup, restoreBackup } from './services/backup.js';

const [cmd, arg] = process.argv.slice(2);

async function run() {
  switch (cmd) {
    case 'migrate': await migrate(); console.log('Migrations up to date.'); break;
    case 'seed': await migrate(false); await ensureAdmin(); console.log((await seedDemo()) ? 'Demo data created.' : 'Demo data already exists.'); break;
    case 'backup': {
      const file = arg || path.join('backups', `backup-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(await exportBackup()));
      console.log(`Backup written to ${file}`);
      break;
    }
    case 'restore': {
      if (!arg) throw new Error('Usage: npm run restore -- <backup-file.json>');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = process.env.CONFIRM_RESTORE === 'yes' ? 'RESTORE' : await rl.question('This REPLACES all current data. Type RESTORE to continue: ');
      rl.close();
      if (answer.trim() !== 'RESTORE') { console.log('Cancelled.'); break; }
      await migrate(false);
      await restoreBackup(JSON.parse(fs.readFileSync(arg, 'utf8')));
      console.log('Restore complete.');
      break;
    }
    default:
      console.log('Commands: migrate | seed | backup [file] | restore <file>');
  }
}

run().then(() => pool.end()).catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
