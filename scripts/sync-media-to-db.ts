/**
 * One-shot backfill: for every row in the `media` table, read the file off
 * disk (public/media/<filename>) and upsert its bytes into a sibling
 * `media_blob` table. The portfolio's /api/bloggz-media/[filename] route
 * serves from that table, so once this script runs the portfolio no longer
 * needs Bloggz running anywhere.
 *
 * Creates `media_blob` if it doesn't exist. Idempotent — re-runs overwrite.
 *
 *   pnpm migrate:media
 */
import 'dotenv/config'
import { Pool } from 'pg'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const MEDIA_DIR = path.resolve(__dirname, '../public/media')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) throw new Error('DATABASE_URL is not set')

  const pool = new Pool({ connectionString })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS media_blob (
      filename   text PRIMARY KEY,
      data       bytea NOT NULL,
      mime_type  text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
  `)

  const { rows } = await pool.query<{ filename: string; mime_type: string | null }>(
    `SELECT filename, mime_type FROM media WHERE filename IS NOT NULL`,
  )

  console.log(`Found ${rows.length} media rows`)

  let ok = 0
  let missing = 0
  for (const row of rows) {
    const abs = path.join(MEDIA_DIR, row.filename)
    try {
      const data = await fs.readFile(abs)
      await pool.query(
        `INSERT INTO media_blob (filename, data, mime_type, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (filename)
         DO UPDATE SET data = EXCLUDED.data, mime_type = EXCLUDED.mime_type, updated_at = now()`,
        [row.filename, data, row.mime_type ?? 'application/octet-stream'],
      )
      ok++
      console.log(`  ✓ ${row.filename}`)
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        missing++
        console.log(`  · ${row.filename} — not on disk, skipping`)
        continue
      }
      throw err
    }
  }

  await pool.end()
  console.log(`done — ${ok} synced, ${missing} missing`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
