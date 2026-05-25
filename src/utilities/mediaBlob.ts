import { Pool } from 'pg'

// Shared pg pool for media_blob writes. Lives alongside Payload's own pool
// (in the postgres adapter) on purpose — Payload doesn't expose its pool
// for raw SQL outside its query layer, and a second small pool is cheaper
// than reaching into adapter internals.
const globalForPool = globalThis as unknown as { mediaBlobPool?: Pool }

const pool =
  globalForPool.mediaBlobPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    idleTimeoutMillis: 10_000,
  })

if (process.env.NODE_ENV !== 'production') globalForPool.mediaBlobPool = pool

let ensured = false
async function ensureTable() {
  if (ensured) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_blob (
      filename   text PRIMARY KEY,
      data       bytea NOT NULL,
      mime_type  text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)
  ensured = true
}

export async function syncMediaBlob(filename: string, data: Buffer, mimeType: string) {
  await ensureTable()
  await pool.query(
    `INSERT INTO media_blob (filename, data, mime_type, updated_at)
     VALUES ($1, $2, $3, now())
     ON CONFLICT (filename)
     DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type, updated_at = now()`,
    [filename, data, mimeType],
  )
}
