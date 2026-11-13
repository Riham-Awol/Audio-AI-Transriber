import mysql from 'mysql2/promise';
import { env } from './env.js';

let pool;

/**
 * Returns the shared MySQL connection pool, creating it lazily.
 */
export function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: env.db.host,
      port: env.db.port,
      database: env.db.database,
      user: env.db.user,
      password: env.db.password,
      waitForConnections: true,
      connectionLimit: env.db.connectionLimit,
      queueLimit: 0,
      timezone: 'Z',
      dateStrings: false,
      multipleStatements: false,
    });
  }
  return pool;
}

/**
 * Executes a parameterized SQL query and returns the result rows.
 */
export async function query(sql, params = []) {
  const [rows] = await getPool().execute(sql, params);
  return rows;
}

/**
 * Executes a parameterized SQL query and returns the first row or null.
 */
export async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
}

/**
 * Runs a callback inside an ACID MySQL transaction.
 */
export async function withTransaction(callback) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const tx = {
      execute: (sql, params = []) => connection.execute(sql, params),
      query: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return rows;
      },
      queryOne: async (sql, params = []) => {
        const [rows] = await connection.execute(sql, params);
        return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
      },
    };
    const result = await callback(tx);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

/**
 * Checks MySQL connectivity for health checks.
 */
export async function checkDatabaseHealth() {
  try {
    await getPool().query('SELECT 1 AS ok');
    return { connected: true };
  } catch (error) {
    return { connected: false, error: error.message };
  }
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

