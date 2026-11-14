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

const authBaseUrl = process.env.NEON_AUTH_BASE_URL || process.env.VITE_NEON_AUTH_URL
const jwksUrl = process.env.NEON_AUTH_JWKS_URL || (authBaseUrl ? new URL('.well-known/jwks.json', authBaseUrl.endsWith('/') ? authBaseUrl : authBaseUrl + '/').toString() : '')
const jwks = jwksUrl ? createRemoteJWKSet(new URL(jwksUrl)) : null
const resources = new Set(['me', 'sellers', 'suppliers', 'receivers', 'receiver-assignments', 'receipts', 'distributions', 'sales', 'remittances', 'commissions', 'settings'])

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
      select role, is_active, seller_id from public.tm_profiles where user_id = ${userId}::uuid limit 1
    `
    const profile = profiles[0] as { role: string; is_active: boolean; seller_id: string | null } | undefined
    if (!profile) return fail(res, 403, 'PROFIL_ABSENT: aucun profil applicatif n’est associé à ce compte Neon Auth. Un administrateur doit créer son entrée dans tm_profiles.')
    if (!profile.is_active) return fail(res, 403, 'PROFIL_INACTIF: ce compte est désactivé dans tm_profiles. Un administrateur doit vérifier is_active.')
    if (resource === 'me') {
      if (req.method !== 'GET') return fail(res, 405, 'Méthode non autorisée pour le profil courant')
      return res.status(200).json({ ok: true, data: { role: profile.role, sellerId: profile.seller_id } })
    }
    if (profile.role === 'seller' && !profile.seller_id) return fail(res, 403, 'VENDEUR_NON_ASSOCIE: ce compte vendeur doit être associé à une fiche vendeur par un administrateur.')
    const scopedSellerId = profile.role === 'seller' ? profile.seller_id : null
    // Autorisations explicites par rôle et par ressource.
    // Un profil vendeur doit être lié à une fiche unique ; ses lectures sont filtrées par cet identifiant.
    const readAccess: Record<string, string[]> = {
      super_admin: [...resources],
      admin: [...resources],
      sales_manager: ['sellers', 'suppliers', 'receivers', 'receiver-assignments', 'receipts', 'distributions', 'sales', 'commissions'],
      cashier: ['sellers', 'sales', 'remittances'],
      auditor: [...resources],
      seller: ['sellers', 'suppliers', 'distributions', 'sales', 'remittances'],
    }
    const writeAccess: Record<string, string[]> = {
      super_admin: [...resources],
      admin: [...resources],
      sales_manager: ['sellers', 'suppliers', 'receivers', 'receiver-assignments', 'receipts', 'distributions', 'sales', 'commissions'],
      cashier: ['sales', 'remittances'],
      auditor: [],
      seller: ['sales'],
    }
    if (!(readAccess[profile.role] || []).includes(resource)) {
      return fail(res, 403, 'Votre rôle ne permet pas de consulter cette ressource.')
    }
    if (req.method === 'POST' && !(writeAccess[profile.role] || []).includes(resource)) {
      return fail(res, 403, 'Votre rôle ne permet pas de modifier cette ressource.')
    }

    if (req.method === 'GET') {
      let rows: unknown[]
      switch (resource) {
        case 'sellers':
          rows = await sql`select id, full_name as name, phone, commission_rate as rate, is_active as active from public.sellers where (${scopedSellerId}::uuid is null or id=${scopedSellerId}::uuid) order by created_at desc`
          break
        case 'suppliers':
          rows = await sql`select id, name, contact_name as contact, phone, email, address, tax_id as "taxId", is_active as active from public.suppliers where (${scopedSellerId}::uuid is null or id in (select supplier_id from public.distributions where seller_id=${scopedSellerId}::uuid and status='validated')) order by created_at desc`
          break
        case 'receivers':
          rows = await sql`select id, receiver_code as code, full_name as name, phone, email, address, is_active as active, (select count(*)::int from public.seller_receiver_assignments a where a.receiver_id=r.id and a.valid_to is null) as "activeSellerCount" from public.receivers r order by full_name asc`
          break
        case 'receiver-assignments':
          rows = await sql`select a.id, a.seller_id as "sellerId", s.full_name as "sellerName", a.receiver_id as "receiverId", r.full_name as "receiverName", a.valid_from::text as "validFrom", a.valid_to::text as "validTo" from public.seller_receiver_assignments a join public.sellers s on s.id=a.seller_id join public.receivers r on r.id=a.receiver_id order by a.valid_from desc, s.full_name`
          break
        case 'receipts':
          rows = await sql`select id, supplier_id as "supplierId", received_at::date::text as date, quantity, unit_cost as "unitCost", reference from public.ticket_receipts where status = 'validated' order by received_at desc`
          break
        case 'distributions':
          rows = await sql`select d.id, d.seller_id as "sellerId", d.supplier_id as "supplierId", d.receiver_id as "receiverId", r.full_name as "receiverName", d.distributed_at::date::text as date, di.quantity, di.reference_unit_price as price, 'Validée' as status from public.distributions d join public.distribution_items di on di.distribution_id=d.id left join public.receivers r on r.id=d.receiver_id where d.status='validated' and (${scopedSellerId}::uuid is null or d.seller_id=${scopedSellerId}::uuid) order by d.distributed_at desc`
          break
        case 'commissions':
          rows = await sql`select c.id, c.supplier_id as "supplierId", s.name as "supplierName", c.receiver_id as "receiverId", r.full_name as "receiverName", c.commission_rate as rate, c.valid_from::text as "validFrom", c.valid_to::text as "validTo" from public.receiver_supplier_commissions c join public.suppliers s on s.id=c.supplier_id join public.receivers r on r.id=c.receiver_id order by s.name, r.full_name, c.valid_from desc`
          break
        case 'settings': {
          let configured: any[] = []
          try { configured = await sql`select app_name as "appName", organization_name as "organizationName", support_email as "supportEmail", support_phone as "supportPhone", timezone, ticket_name as "ticketName", ticket_price as "ticketPrice", default_commission_rate as "defaultCommissionRate" from public.tm_app_settings where id = true limit 1` } catch { configured = [] }
          rows = configured.length ? configured.map((row:any)=>({...row,canManageSettings:['super_admin','admin'].includes(profile.role)})) : [{appName:'Ticket Manager',organizationName:'',supportEmail:'',supportPhone:'',timezone:'Africa/Conakry',ticketName:'Ticket standard',ticketPrice:5000,defaultCommissionRate:10,canManageSettings:['super_admin','admin'].includes(profile.role)}]
          break
        }
        case 'sales':
          rows = await sql`select s.id, s.seller_id as "sellerId", s.supplier_id as "supplierId", s.receiver_id as "receiverId", r.full_name as "receiverName", s.sold_at::date::text as date, si.quantity, si.unit_price as price, si.commission_rate as "commissionRate", si.supplier_receiver_commission_rate as "supplierReceiverRate", 'Validée' as status from public.sales s join public.sale_items si on si.sale_id=s.id left join public.receivers r on r.id=s.receiver_id where s.status='validated' and (${scopedSellerId}::uuid is null or s.seller_id=${scopedSellerId}::uuid) order by s.sold_at desc`
          break
        default:
          rows = await sql`select id, seller_id as "sellerId", paid_at::date::text as date, amount, payment_method as method, transaction_reference as reference from public.remittances where (${scopedSellerId}::uuid is null or seller_id=${scopedSellerId}::uuid) order by paid_at desc`
      }
      return res.status(200).json({ ok: true, data: rows })
    }

    const body = req.body || {}
    const requiredText = (key: string) => typeof body[key] === 'string' ? (body[key] as string).trim() : ''
    const positiveInt = (key: string) => Number.isSafeInteger(Number(body[key])) && Number(body[key]) > 0 ? Number(body[key]) : 0
    const date = requiredText('date') || new Date().toISOString().slice(0, 10)

    switch (resource) {
      case 'settings': {
        if (!['super_admin','admin'].includes(profile.role)) return fail(res,403,'Seuls les administrateurs autorisés peuvent modifier les paramètres.')
        const appName = requiredText('appName')
        const organizationName = requiredText('organizationName')
        const supportEmail = requiredText('supportEmail')
        const supportPhone = requiredText('supportPhone')
        const timezone = requiredText('timezone')
        const ticketName = requiredText('ticketName')
        const ticketPrice = Number(body.ticketPrice)
        const defaultRate = Number(body.defaultCommissionRate)
        if (!appName || appName.length > 100) return fail(res,400,'Nom de l’application obligatoire (100 caractères maximum).')
        if (organizationName.length > 160 || supportEmail.length > 254 || supportPhone.length > 40) return fail(res,400,'Les coordonnées de l’application sont trop longues.')
        if (!['Africa/Conakry','Africa/Dakar','UTC'].includes(timezone)) return fail(res,400,'Fuseau horaire non autorisé.')
        if (!ticketName || ticketName.length > 120) return fail(res,400,'Nom du type de ticket obligatoire (120 caractères maximum).')
        if (!Number.isSafeInteger(ticketPrice) || ticketPrice < 0) return fail(res,400,'Prix de référence invalide.')
        if (!Number.isFinite(defaultRate) || defaultRate < 0 || defaultRate > 100) return fail(res,400,'Taux de commission invalide.')
        const rows = await sql`insert into public.tm_app_settings (id,app_name,organization_name,support_email,support_phone,timezone,ticket_name,ticket_price,default_commission_rate,updated_by,updated_at) values (true,${appName},${organizationName},${supportEmail},${supportPhone},${timezone},${ticketName},${ticketPrice},${defaultRate},${userId}::uuid,now()) on conflict (id) do update set app_name=excluded.app_name,organization_name=excluded.organization_name,support_email=excluded.support_email,support_phone=excluded.support_phone,timezone=excluded.timezone,ticket_name=excluded.ticket_name,ticket_price=excluded.ticket_price,default_commission_rate=excluded.default_commission_rate,updated_by=excluded.updated_by,updated_at=now() returning app_name as "appName",organization_name as "organizationName",support_email as "supportEmail",support_phone as "supportPhone",timezone,ticket_name as "ticketName",ticket_price as "ticketPrice",default_commission_rate as "defaultCommissionRate"`
        return res.status(200).json({ok:true,data:rows[0]})
      }
      case 'receivers': {
        const receiverId=requiredText('receiverId')
        if(receiverId){
          const active=body.active
          if(typeof active!=='boolean') return fail(res,400,'Statut du receveur invalide.')
          if(!active){const assigned=await sql`select id from public.seller_receiver_assignments where receiver_id=${receiverId}::uuid and valid_to is null limit 1`;if(assigned.length)return fail(res,409,'Ce receveur a encore des vendeurs actifs. Réaffectez-les avant de le désactiver.')}
          const updated=await sql`update public.receivers set is_active=${active}, updated_at=now() where id=${receiverId}::uuid returning id`
          if(!updated.length)return fail(res,404,'Receveur introuvable.')
          return res.status(200).json({ok:true,id:updated[0].id})
        }
        const name=requiredText('name')
        if(!name)return fail(res,400,'Nom complet du receveur obligatoire.')
        const result=await sql`insert into public.receivers(receiver_code,full_name,phone,email,address,notes) values(${'REC-'+crypto.randomUUID().slice(0,8).toUpperCase()},${name},${requiredText('phone')||null},${requiredText('email')||null},${requiredText('address')||null},${requiredText('notes')||null}) returning id, receiver_code as code`
        return res.status(201).json({ok:true,...result[0]})
      }
      case 'receiver-assignments': {
        const sellerId=requiredText('sellerId'),receiverId=requiredText('receiverId'),validFrom=requiredText('validFrom')
        if(!sellerId||!receiverId||!/^\d{4}-\d{2}-\d{2}$/.test(validFrom))return fail(res,400,'Vendeur, receveur et date d’affectation obligatoires.')
        const refs=await sql`select s.id,r.id from public.sellers s cross join public.receivers r where s.id=${sellerId}::uuid and s.is_active=true and r.id=${receiverId}::uuid and r.is_active=true`
        if(!refs.length)return fail(res,400,'Vendeur ou receveur introuvable/inactif.')
        const overlaps=await sql`select id from public.seller_receiver_assignments where seller_id=${sellerId}::uuid and valid_from<=${validFrom}::date and (valid_to is null or valid_to>=${validFrom}::date) limit 1`
        if(overlaps.length)return fail(res,409,'Une affectation couvre déjà cette date. Choisissez une date après la fin de l’affectation existante.')
        const conflicts=await sql`select id from public.seller_receiver_assignments where seller_id=${sellerId}::uuid and valid_from>=${validFrom}::date limit 1`
        if(conflicts.length)return fail(res,409,'Une affectation existe déjà à cette date ou après. Vérifiez l’historique avant de continuer.')
        const current=await sql`select id,valid_from::text as valid_from from public.seller_receiver_assignments where seller_id=${sellerId}::uuid and valid_to is null order by valid_from desc limit 1`
        if(current.length&&String(current[0].valid_from)>=validFrom)return fail(res,409,'La nouvelle affectation doit commencer après la date de début de l’affectation actuelle.')
        await sql.transaction([
          sql`select id from public.sellers where id=${sellerId}::uuid for update`,
          sql`update public.seller_receiver_assignments set valid_to=(${validFrom}::date-interval '1 day')::date where seller_id=${sellerId}::uuid and valid_to is null`,
          sql`insert into public.seller_receiver_assignments(seller_id,receiver_id,valid_from,created_by) values(${sellerId}::uuid,${receiverId}::uuid,${validFrom}::date,${userId}::uuid)`
        ])
        return res.status(201).json({ok:true})
      }
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
      case 'distributions': {
        const sellerId = requiredText('sellerId'), supplierId = requiredText('supplierId'), quantity = positiveInt('quantity'), price = Number(body.price)
        if (!sellerId || !supplierId || !quantity || !Number.isSafeInteger(price) || price < 0) return fail(res, 400, 'Données de distribution invalides')
        const assignmentRows=await sql`select receiver_id from public.seller_receiver_assignments where seller_id=${sellerId}::uuid and valid_from<=${date}::date and (valid_to is null or valid_to>=${date}::date) order by valid_from desc limit 2`
        if(assignmentRows.length!==1)return fail(res,409,'Affectez exactement un receveur à ce vendeur pour la date de distribution avant de continuer.')
        const receiverId=String(assignmentRows[0].receiver_id)
        let configuredTicketName = 'Ticket standard'
        try { const configuredName = await sql`select ticket_name from public.tm_app_settings where id=true limit 1`; if (configuredName[0]?.ticket_name) configuredTicketName = String(configuredName[0].ticket_name) } catch { /* paramètres non migrés : conserver le type standard historique */ }
        const ticketTypes = await sql`insert into public.ticket_types (name) values (${configuredTicketName}) on conflict (name) do update set name=excluded.name returning id`
        const ref = 'DST-' + crypto.randomUUID().slice(0, 8).toUpperCase()
        const rows = await sql`
          with locked_supplier as materialized (
            select id from public.suppliers where id=${supplierId}::uuid for update
          ), available as (
            select coalesce((select sum(quantity) from public.ticket_receipts where supplier_id=${supplierId}::uuid and status='validated'),0)
              - coalesce((select sum(di.quantity) from public.distributions d join public.distribution_items di on di.distribution_id=d.id where d.supplier_id=${supplierId}::uuid and d.status='validated'),0) as qty
            from locked_supplier
          ), created as (
            insert into public.distributions(reference,seller_id,supplier_id,receiver_id,distributed_at,status,created_by)
            select ${ref},${sellerId}::uuid,${supplierId}::uuid,${receiverId}::uuid,${date}::date,'validated',${userId}::uuid
            from available where qty >= ${quantity} returning id
          ), item as (
            insert into public.distribution_items(distribution_id,ticket_type_id,quantity,reference_unit_price)
            select created.id,${ticketTypes[0].id}::uuid,${quantity},${price} from created returning distribution_id
          )
          select distribution_id as id from item
        `
        if (!rows.length) return fail(res, 409, 'Stock fournisseur insuffisant ou opération impossible')
        return res.status(201).json({ok:true,id:rows[0].id})
      }
      case 'commissions': {
        if (!['super_admin','admin','sales_manager'].includes(profile.role)) return fail(res, 403, 'Votre rôle ne permet pas de configurer les commissions.')
        const supplierId=requiredText('supplierId'), receiverId=requiredText('receiverId'), rate=Number(body.rate), validFrom=requiredText('validFrom')||date
        if(!supplierId||!receiverId||!/^\d{4}-\d{2}-\d{2}$/.test(validFrom)||!Number.isFinite(rate)||rate<0||rate>100) return fail(res,400,'Fournisseur, receveur, date d’effet ou taux invalide.')
        const refs=await sql`select s.id, r.id from public.suppliers s cross join public.receivers r where s.id=${supplierId}::uuid and r.id=${receiverId}::uuid and r.is_active=true`
        if(!refs.length) return fail(res,400,'Fournisseur ou receveur introuvable/inactif.')
        const current=await sql`select id, valid_from::text as valid_from from public.receiver_supplier_commissions where supplier_id=${supplierId}::uuid and receiver_id=${receiverId}::uuid and valid_to is null order by valid_from desc limit 1`
        if(current.length && String(current[0].valid_from)>=validFrom){
          if(String(current[0].valid_from)===validFrom){
            const updated=await sql`update public.receiver_supplier_commissions set commission_rate=${rate}, created_by=${userId}::uuid where id=${current[0].id}::uuid returning id, commission_rate as rate, valid_from::text as "validFrom", valid_to::text as "validTo"`
            return res.status(200).json({ok:true,data:updated[0]})
          }
          return fail(res,409,'La date d’effet doit être postérieure au dernier taux configuré pour ce couple.')
        }
        if(current.length){
          const closeCurrent = sql`update public.receiver_supplier_commissions set valid_to=(${validFrom}::date - interval '1 day')::date where id=${current[0].id}::uuid`
          const insertCurrent = sql`insert into public.receiver_supplier_commissions(supplier_id,receiver_id,commission_rate,valid_from,created_by) values(${supplierId}::uuid,${receiverId}::uuid,${rate},${validFrom}::date,${userId}::uuid)`
          await sql.transaction([closeCurrent,insertCurrent])
        }else{
          await sql`insert into public.receiver_supplier_commissions(supplier_id,receiver_id,commission_rate,valid_from,created_by) values(${supplierId}::uuid,${receiverId}::uuid,${rate},${validFrom}::date,${userId}::uuid)`
        }
        const inserted=await sql`select id, commission_rate as rate, valid_from::text as "validFrom", valid_to::text as "validTo" from public.receiver_supplier_commissions where supplier_id=${supplierId}::uuid and receiver_id=${receiverId}::uuid and valid_from=${validFrom}::date limit 1`
        return res.status(201).json({ok:true,data:inserted[0]})

      }
      case 'sales': {
        const sellerId = profile.role === 'seller' ? String(profile.seller_id) : requiredText('sellerId'), supplierId = requiredText('supplierId'), quantity = positiveInt('quantity'), price = Number(body.price)
        if (!sellerId || !supplierId || !quantity || !Number.isSafeInteger(price) || price < 0) return fail(res, 400, 'Données de vente invalides')
        let configuredTicketName = 'Ticket standard'
        try { const configuredName = await sql`select ticket_name from public.tm_app_settings where id=true limit 1`; if (configuredName[0]?.ticket_name) configuredTicketName = String(configuredName[0].ticket_name) } catch { /* paramètres non migrés : conserver le type standard historique */ }
        const ticketTypes = await sql`insert into public.ticket_types (name) values (${configuredTicketName}) on conflict (name) do update set name=excluded.name returning id`
        const rateRows = await sql`select commission_rate from public.sellers where id=${sellerId}::uuid and is_active=true`
        if (!rateRows.length) return fail(res, 400, 'Vendeur introuvable ou inactif')
        const assignmentRows = await sql`select receiver_id from public.seller_receiver_assignments where seller_id=${sellerId}::uuid and valid_from<=${date}::date and (valid_to is null or valid_to>=${date}::date) order by valid_from desc limit 2`
        if (assignmentRows.length !== 1) return fail(res, 409, 'Affectez exactement un receveur à ce vendeur pour la date de vente avant de déclarer une vente.')
        const receiverId = String(assignmentRows[0].receiver_id)
        const supplierRateRows = receiverId ? await sql`select commission_rate from public.receiver_supplier_commissions where supplier_id=${supplierId}::uuid and receiver_id=${receiverId}::uuid and valid_from<=${date}::date and (valid_to is null or valid_to>=${date}::date) order by valid_from desc limit 1` : []
        const supplierReceiverRate = supplierRateRows.length ? Number(supplierRateRows[0].commission_rate) : null
        const ref = 'VTE-' + crypto.randomUUID().slice(0, 8).toUpperCase()
        const rows = await sql`
          with locked_pair as materialized (
            select seller.id
            from public.sellers seller
            join public.suppliers supplier on supplier.id=${supplierId}::uuid
            where seller.id=${sellerId}::uuid and seller.is_active=true
            for update of seller, supplier
          ), available as (
            select coalesce((select sum(di.quantity) from public.distributions d join public.distribution_items di on di.distribution_id=d.id where d.seller_id=${sellerId}::uuid and d.supplier_id=${supplierId}::uuid and d.status='validated'),0)
              - coalesce((select sum(si.quantity) from public.sales s join public.sale_items si on si.sale_id=s.id where s.seller_id=${sellerId}::uuid and s.supplier_id=${supplierId}::uuid and s.status='validated'),0) as qty
            from locked_pair
          ), created as (
            insert into public.sales(reference,seller_id,supplier_id,receiver_id,sold_at,status,created_by)
            select ${ref},${sellerId}::uuid,${supplierId}::uuid,${receiverId}::uuid,${date}::date,'validated',${userId}
            from available where qty >= ${quantity} returning id
          ), item as (
            insert into public.sale_items(sale_id,ticket_type_id,quantity,unit_price,commission_rate,supplier_receiver_commission_rate)
            select created.id,${ticketTypes[0].id}::uuid,${quantity},${price},${Number(rateRows[0].commission_rate)},${supplierReceiverRate} from created returning sale_id
          )
          select sale_id as id from item
        `
        if (!rows.length) return fail(res, 409, 'Stock invendu insuffisant pour ce vendeur et ce fournisseur')
        return res.status(201).json({ok:true,id:rows[0].id})
      }
      case 'remittances': {
        const sellerId = profile.role === 'seller' ? String(profile.seller_id) : requiredText('sellerId'), amount = positiveInt('amount')
        const methods: Record<string, string> = { 'Espèces': 'cash', 'Virement bancaire': 'bank_transfer', 'Mobile Money': 'mobile_money', 'Autre': 'other' }
        const method = methods[requiredText('method')] || requiredText('method')
        if (!sellerId || !amount || !['cash','bank_transfer','mobile_money','other'].includes(method)) return fail(res, 400, 'Données de reversement invalides')
        const reference = requiredText('reference') || 'REV-' + crypto.randomUUID().slice(0, 8).toUpperCase()
        const result = await sql`
          with locked_seller as materialized (
            select id from public.sellers where id=${sellerId}::uuid for update
          ), due as (
            select greatest(0, coalesce(summary.balance_to_remit,0)) as balance
            from public.seller_financial_summary summary
            join locked_seller on locked_seller.id=summary.seller_id
          ), inserted as (
            insert into public.remittances (reference, seller_id, amount, payment_method, transaction_reference, paid_at, received_by)
            select ${reference}, ${sellerId}::uuid, ${amount}, ${method}, ${requiredText('reference') || null}, ${date}::date, ${userId}::uuid
            from due where balance >= ${amount}
            returning id
          )
          select id from inserted
        `
        if (!result.length) return fail(res, 409, 'Reversement supérieur au solde dû ou vendeur sans solde disponible')
        return res.status(201).json({ ok: true, id: result[0].id })
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Erreur base de données'
    return fail(res, 500, message.includes('duplicate key') ? 'Cette référence existe déjà' : 'Erreur lors de l’accès aux données')
  }
}
