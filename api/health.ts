import { neon } from '@neondatabase/serverless'

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (body: Record<string, unknown>) => void
}

export default async function handler(
  req: { method?: string },
  res: ApiResponse,
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  if (!process.env.DATABASE_URL) {
    return res.status(503).json({ ok: false, error: 'Database is not configured' })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    await sql`select 1`
    return res.status(200).json({ ok: true, database: 'connected' })
  } catch {
    return res.status(503).json({ ok: false, error: 'Database connection failed' })
  }
}
