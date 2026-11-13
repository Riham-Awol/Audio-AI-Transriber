import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mysql from 'mysql2/promise';
import { env } from '../config/env.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Runs all pending SQL files in backend/src/db/migrations in lexical order.
 */
export async function runMigrations() {
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = (await fs.readdir(migrationsDir))
    .filter((f) => f.endsWith('.sql'))
    .sort();

  const connection = await mysql.createConnection({
    host: env.db.host,
    port: env.db.port,
    user: env.db.user,
    password: env.db.password,
    multipleStatements: true,
    timezone: 'Z',
  });

  try {
    await connection.query(
      `CREATE DATABASE IF NOT EXISTS \`${env.db.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    await connection.query(`USE \`${env.db.database}\``);

    await connection.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id INT UNSIGNED NOT NULL AUTO_INCREMENT,
        filename VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uq_schema_migrations_filename (filename)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `);

    const [appliedRows] = await connection.query('SELECT filename FROM schema_migrations');
    const appliedSet = new Set(appliedRows.map((row) => row.filename));

    const appliedNow = [];
    for (const filename of files) {
      if (appliedSet.has(filename)) {
        continue;
      }
      const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
      await connection.beginTransaction();
      try {
        await connection.query(sql);
        await connection.query('INSERT INTO schema_migrations (filename) VALUES (?)', [filename]);
        await connection.commit();
        appliedNow.push(filename);
      } catch (err) {
        await connection.rollback();
        throw new Error(`Migration ${filename} failed: ${err.message}`);
      }
    }

    return appliedNow;
  } finally {
    await connection.end();
  }
}

const isCliEntry = process.argv[1] && path.resolve(process.argv[1]) === __filename;
if (isCliEntry) {
  runMigrations()
    .then((applied) => {
      if (applied.length === 0) {
        console.log('Database schema is already up to date.');
      } else {
        console.log('Applied migrations:', applied.join(', '));
      }
      process.exit(0);
    })
    .catch((err) => {
      console.error('Migration error:', err.message);
      process.exit(1);
    });
}

