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
    return res.status(503).json({
      ok: false,
      database: 'not_configured',
      error: 'Database is not configured',
    })
  }

  try {
    const sql = neon(process.env.DATABASE_URL)
    const rows = await sql`
      select
        current_database() as database_name,
        current_schema() as schema_name,
        to_regclass('public.tm_profiles') is not null as profiles,
        to_regclass('public.sellers') is not null as sellers,
        to_regclass('public.suppliers') is not null as suppliers,
        to_regclass('public.ticket_receipts') is not null as ticket_receipts,
        to_regclass('public.distributions') is not null as distributions,
        to_regclass('public.sales') is not null as sales,
        to_regclass('public.remittances') is not null as remittances
    `

    const schema = rows[0] as Record<string, string | boolean>
    const required = [
      'profiles',
      'sellers',
      'suppliers',
      'ticket_receipts',
      'distributions',
      'sales',
      'remittances',
    ]
    const missing = required.filter((table) => schema[table] !== true)
    const databaseInfo = {
      database_name: schema.database_name,
      schema_name: schema.schema_name,
    }

    if (missing.length > 0) {
      return res.status(503).json({
        ok: false,
        database: 'connected',
        ...databaseInfo,
        schema: 'incomplete',
        missing,
      })
    }

    return res.status(200).json({
      ok: true,
      database: 'connected',
      ...databaseInfo,
      schema: 'ready',
    })
  } catch {
    return res.status(503).json({
      ok: false,
      database: 'unavailable',
      error: 'Database connection failed',
    })
  }
}
