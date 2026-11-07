import { neon } from '@neondatabase/serverless'
import { createRemoteJWKSet, jwtVerify } from 'jose'

type Req = {
  method?: string
  headers: Record<string, string | string[] | undefined>
  query?: Record<string, string | string[] | undefined>
  body?: Record<string, unknown>
}
type Res = {
  status(code: number): Res
  json(body: unknown): void
  setHeader(name: string, value: string): void
}

const jwksUrl = process.env.NEON_AUTH_JWKS_URL
const authBaseUrl = process.env.NEON_AUTH_BASE_URL
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null
const resources = new Set(['sellers', 'suppliers', 'receipts', 'distributions', 'sales', 'remittances'])

function fail(res: Res, status: number, error: string) {
  return res.status(status).json({ ok: false, error })
}

export default async function handler(req: Req, res: Res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET' && req.method !== 'POST') return fail(res, 405, 'Méthode non autorisée')
  if (!process.env.DATABASE_URL || !jwks || !authBaseUrl) return fail(res, 503, 'API ou authentification Neon non configurée')

  const authorization = req.headers.authorization
  const bearer = Array.isArray(authorization) ? authorization[0] : authorization
  if (!bearer?.startsWith('Bearer ')) return fail(res, 401, 'Session requise')

  let userId: string
  try {
    const verified = await jwtVerify(bearer.slice(7), jwks, { issuer: new URL(authBaseUrl).origin })
    if (typeof verified.payload.sub !== 'string') return fail(res, 401, 'Jeton invalide')
    userId = verified.payload.sub
  } catch {
    return fail(res, 401, 'Session expirée ou invalide')
  }

  const resourceValue = req.query?.resource
  const resource = Array.isArray(resourceValue) ? resourceValue[0] : resourceValue
  if (!resource || !resources.has(resource)) return fail(res, 400, 'Ressource inconnue')

  const sql = neon(process.env.DATABASE_URL)
  try {
    const profiles = await sql`
      select role, is_active from public.tm_profiles where user_id = ${userId}::uuid limit 1
    `
    const profile = profiles[0] as { role: string; is_active: boolean } | undefined
    if (!profile || !profile.is_active) return fail(res, 403, 'Compte sans profil actif. Contactez le super administrateur.')
    const readRoles = ['super_admin', 'admin', 'sales_manager', 'cashier', 'seller', 'auditor']
    const writeRoles = ['super_admin', 'admin', 'sales_manager', 'cashier']
    if (!readRoles.includes(profile.role)) return fail(res, 403, 'Accès refusé')
    if (req.method === 'POST' && !writeRoles.includes(profile.role)) return fail(res, 403, 'Droits insuffisants')

    if (req.method === 'GET') {
      let rows: unknown[]
      switch (resource) {
        case 'sellers':
          rows = await sql`select id, full_name as name, phone, commission_rate as rate, is_active as active from public.sellers order by created_at desc`
          break
        case 'suppliers':
          rows = await sql`select id, name, contact_name as contact, phone, email, address, tax_id as "taxId", is_active as active from public.suppliers order by created_at desc`
          break
        case 'receipts':
          rows = await sql`select id, supplier_id as "supplierId", received_at::date::text as date, quantity, unit_cost as "unitCost", reference from public.ticket_receipts where status = 'validated' order by received_at desc`
          break
        case 'distributions':
          rows = await sql`select d.id, d.seller_id as "sellerId", d.supplier_id as "supplierId", d.distributed_at::date::text as date, di.quantity, di.reference_unit_price as price, 'Validée' as status from public.distributions d join public.distribution_items di on di.distribution_id=d.id where d.status='validated' order by d.distributed_at desc`
          break
        case 'sales':
          rows = await sql`select s.id, s.seller_id as "sellerId", s.supplier_id as "supplierId", s.sold_at::date::text as date, si.quantity, si.unit_price as price, 'Validée' as status from public.sales s join public.sale_items si on si.sale_id=s.id where s.status='validated' order by s.sold_at desc`
          break
        default:
          rows = await sql`select id, seller_id as "sellerId", paid_at::date::text as date, amount, payment_method as method, transaction_reference as reference from public.remittances order by paid_at desc`
      }
      return res.status(200).json({ ok: true, data: rows })
    }

    const body = req.body || {}
    const requiredText = (key: string) => typeof body[key] === 'string' ? (body[key] as string).trim() : ''
    const positiveInt = (key: string) => Number.isSafeInteger(Number(body[key])) && Number(body[key]) > 0 ? Number(body[key]) : 0
    const date = requiredText('date') || new Date().toISOString().slice(0, 10)

    switch (resource) {
      case 'sellers': {
        const name = requiredText('name')
        if (!name) return fail(res, 400, 'Nom du vendeur obligatoire')
        const rate = Number(body.rate)
        if (!Number.isFinite(rate) || rate < 0 || rate > 100) return fail(res, 400, 'Taux de commission invalide')
        const result = await sql`insert into public.sellers (seller_code, full_name, phone, commission_rate) values (${'VEN-' + crypto.randomUUID().slice(0, 8).toUpperCase()}, ${name}, ${requiredText('phone') || null}, ${rate}) returning id`
        return res.status(201).json({ ok: true, id: result[0].id })
      }
      case 'suppliers': {
        const name = requiredText('name')
        if (!name) return fail(res, 400, 'Nom du fournisseur obligatoire')
        const result = await sql`insert into public.suppliers (name, contact_name, phone, email, address, tax_id) values (${name}, ${requiredText('contact') || null}, ${requiredText('phone') || null}, ${requiredText('email') || null}, ${requiredText('address') || null}, ${requiredText('taxId') || null}) returning id`
        return res.status(201).json({ ok: true, id: result[0].id })
      }
      case 'receipts': {
        const supplierId = requiredText('supplierId'), quantity = positiveInt('quantity'), unitCost = Number(body.unitCost)
        if (!supplierId || !quantity || !Number.isSafeInteger(unitCost) || unitCost < 0) return fail(res, 400, 'Données de réception invalides')
        const reference = requiredText('reference') || 'REC-' + crypto.randomUUID().slice(0, 8).toUpperCase()
        const result = await sql`insert into public.ticket_receipts (reference, supplier_id, received_at, quantity, unit_cost, created_by) values (${reference}, ${supplierId}::uuid, ${date}::date, ${quantity}, ${unitCost}, ${userId}::uuid) returning id`
        return res.status(201).json({ ok: true, id: result[0].id })
      }
      case 'distributions':
      case 'sales':
        return fail(res, 501, 'Cette opération nécessite la validation transactionnelle du stock. Elle sera activée après le contrôle des types de tickets et des données existantes.')
      case 'remittances': {
        const sellerId = requiredText('sellerId'), amount = positiveInt('amount')
        const methods: Record<string, string> = { 'Espèces': 'cash', 'Virement bancaire': 'bank_transfer', 'Mobile Money': 'mobile_money', 'Autre': 'other' }
        const method = methods[requiredText('method')] || requiredText('method')
        if (!sellerId || !amount || !['cash','bank_transfer','mobile_money','other'].includes(method)) return fail(res, 400, 'Données de reversement invalides')
        const reference = requiredText('reference') || 'REV-' + crypto.randomUUID().slice(0, 8).toUpperCase()
        const result = await sql`insert into public.remittances (reference, seller_id, amount, payment_method, transaction_reference, paid_at, received_by) values (${reference}, ${sellerId}::uuid, ${amount}, ${method}, ${requiredText('reference') || null}, ${date}::date, ${userId}::uuid) returning id`
        return res.status(201).json({ ok: true, id: result[0].id })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur base de données'
    return fail(res, 500, message.includes('duplicate key') ? 'Cette référence existe déjà' : 'Erreur lors de l’accès aux données')
  }
}
