import { neon } from '@neondatabase/serverless'
import { createRemoteJWKSet, jwtVerify } from 'jose'

type Req={method?:string;headers:Record<string,string|string[]|undefined>;body?:Record<string,unknown>}
type Res={status(code:number):Res;json(body:unknown):void;setHeader(name:string,value:string):void}
const base=process.env.NEON_AUTH_BASE_URL||process.env.VITE_NEON_AUTH_URL
const jwksUrl=process.env.NEON_AUTH_JWKS_URL||(base?new URL('.well-known/jwks.json',base.endsWith('/')?base:base+'/').toString():'')
const jwks=jwksUrl?createRemoteJWKSet(new URL(jwksUrl)):null
const fail=(res:Res,status:number,error:string)=>res.status(status).json({ok:false,error})

export default async function handler(req:Req,res:Res){
 res.setHeader('Cache-Control','no-store')
 if(!['GET','PATCH'].includes(req.method||''))return fail(res,405,'Méthode non autorisée')
 if(!process.env.DATABASE_URL||!base||!jwks)return fail(res,503,'Configuration Neon incomplète')
 const auth=req.headers.authorization,bearer=Array.isArray(auth)?auth[0]:auth
 if(!bearer?.startsWith('Bearer '))return fail(res,401,'Session requise')
 let userId:string
 try{const v=await jwtVerify(bearer.slice(7),jwks,{issuer:new URL(base).origin});if(typeof v.payload.sub!=='string')return fail(res,401,'Jeton invalide');userId=v.payload.sub}catch{return fail(res,401,'Session expirée ou invalide')}
 const sql=neon(process.env.DATABASE_URL)
 try{
  const current=await sql`select role,is_active from public.tm_profiles where user_id=${userId}::uuid limit 1`
  if(!current.length||!current[0].is_active||!['admin','super_admin'].includes(String(current[0].role)))return fail(res,403,'Accès réservé aux administrateurs actifs.')
  if(req.method==='GET'){
   const rows=await sql`select u.id,u.email,u.name,p.full_name as "fullName",coalesce(p.role,'sans_profil') as role,coalesce(p.is_active,false) as "isActive" from neon_auth."user" u left join public.tm_profiles p on p.user_id=u.id order by u.email asc`
   return res.status(200).json({ok:true,data:rows})
  }
  const body=req.body||{},target=typeof body.userId==='string'?body.userId:'',role=typeof body.role==='string'?body.role:'',active=body.isActive
  const roles=['admin','sales_manager','cashier','seller','auditor']
  if(!target)return fail(res,400,'Identifiant utilisateur manquant')
  if(role&&!roles.includes(role))return fail(res,400,'Rôle non autorisé')
  if(role==='admin'&&current[0].role!=='super_admin')return fail(res,403,'Seul un super administrateur peut attribuer le rôle administrateur.')
  if(typeof active!=='boolean'&&!role)return fail(res,400,'Aucune modification demandée')
  if(target===userId&&active===false)return fail(res,400,'Vous ne pouvez pas désactiver votre propre compte.')
  if(target===userId&&role&&role!=='admin'&&role!=='super_admin')return fail(res,400,'Vous ne pouvez pas retirer vos propres droits administrateur.')
  const exists=await sql`select id from neon_auth."user" where id=${target}::uuid limit 1`
  if(!exists.length)return fail(res,404,'Utilisateur introuvable')
  if(role){
   await sql`insert into public.tm_profiles(user_id,full_name,role,is_active) select id,coalesce(nullif(trim(name),''),email),${role},true from neon_auth."user" where id=${target}::uuid on conflict(user_id) do update set role=excluded.role`
  }
  if(typeof active==='boolean'){
   const changed=await sql`update public.tm_profiles set is_active=${active} where user_id=${target}::uuid returning user_id`
   if(!changed.length)return fail(res,409,'Le profil doit être créé avant de modifier son statut.')
  }
  return res.status(200).json({ok:true})
 }catch(error){console.error('[admin-users]',error);return fail(res,500,error instanceof Error?error.message:'Erreur lors de la gestion des utilisateurs')}
}
