import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const { Pool } = pg;
const migrationDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const repositories = new Set();
let pool;

function poolOptions() {
    if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
    const sslMode = process.env.PGSSLMODE || 'require';
    return {
        connectionString: process.env.DATABASE_URL,
        ssl: sslMode === 'disable' ? false : { rejectUnauthorized: sslMode === 'verify-full' },
        max: Number(process.env.PGPOOL_MAX || 10),
    };
}

async function migrate(client) {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const files = (await fs.readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).sort();
    for (const file of files) {
        const sql = await fs.readFile(path.join(migrationDirectory, file), 'utf8');
        const checksum = crypto.createHash('sha256').update(sql).digest('hex');
        const applied = await client.query('SELECT checksum FROM schema_migrations WHERE name = $1', [file]);
        if (applied.rowCount) {
            if (applied.rows[0].checksum !== checksum) throw new Error(`Applied migration changed: ${file}`);
            continue;
        }

        await client.query('BEGIN');
        try {
            await client.query(sql);
            await client.query('INSERT INTO schema_migrations(name, checksum) VALUES ($1, $2)', [file, checksum]);
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        }
    }
}

export async function initializeDatabase() {
    pool = new Pool(poolOptions());
    const client = await pool.connect();
    try {
        await client.query('SELECT pg_advisory_lock($1)', [524031]);
        try {
            await migrate(client);
        } finally {
            await client.query('SELECT pg_advisory_unlock($1)', [524031]);
        }
    } finally {
        client.release();
    }
}

export function createStudentRepository(courseId) {
    if (!pool) throw new Error('Database is not initialized');
    const state = {
        data: { students: {} },
        scheduledHashes: new Set(),
        pending: Promise.resolve(),
    };

    const repository = {
        get data() { return state.data; },
        set data(value) { state.data = value; },
        async read() {
            const result = await pool.query(
                'SELECT student_hash, payload FROM students WHERE course_id = $1',
                [courseId],
            );
            state.data = { students: Object.fromEntries(result.rows.map((row) => [row.student_hash, row.payload])) };
            state.scheduledHashes = new Set(result.rows.map((row) => row.student_hash));
        },
        write() {
            const entries = Object.entries(state.data.students).map(([hash, payload]) => [hash, JSON.stringify(payload)]);
            const currentHashes = new Set(entries.map(([hash]) => hash));
            const removedHashes = [...state.scheduledHashes].filter((hash) => !currentHashes.has(hash));
            state.scheduledHashes = currentHashes;

            state.pending = state.pending.catch(() => undefined).then(async () => {
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    await client.query(
                        `INSERT INTO courses(id, updated_at) VALUES ($1, now())
                         ON CONFLICT (id) DO UPDATE SET updated_at = now()`,
                        [courseId],
                    );
                    for (const [hash, payload] of entries) {
                        await client.query(
                            `INSERT INTO students(course_id, student_hash, payload, updated_at)
                             VALUES ($1, $2, $3::jsonb, now())
                             ON CONFLICT (course_id, student_hash) DO UPDATE
                             SET payload = EXCLUDED.payload, updated_at = now()`,
                            [courseId, hash, payload],
                        );
                    }
                    if (removedHashes.length) {
                        await client.query(
                            'DELETE FROM students WHERE course_id = $1 AND student_hash = ANY($2::text[])',
                            [courseId, removedHashes],
                        );
                    }
                    await client.query('COMMIT');
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            });
            state.pending.catch((error) => console.error(`Failed to persist course ${courseId}`, error));
            return state.pending;
        },
    };
    repositories.add(state);
    return repository;
}

export async function closeDatabase() {
    await Promise.all([...repositories].map((state) => state.pending.catch(() => undefined)));
    if (pool) await pool.end();
}
