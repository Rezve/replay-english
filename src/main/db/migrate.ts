import Database from 'better-sqlite3';
import { app } from 'electron';
import path from 'node:path';
import { applySchema } from './apply-schema';

export { TARGET_SCHEMA_VERSION } from './apply-schema';

export function runMigrations(): { reset: boolean } {
  const dbPath = path.join(app.getPath('userData'), 'mempill.db');
  const sqlite = new Database(dbPath);


  const result = applySchema(sqlite);

  sqlite.close();
  return result;
}
