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
 try{const verified=await jwtVerify(bearer.slice(7),jwks,{issuer:new URL(base).origin});if(typeof verified.payload.sub!=='string')return fail(res,401,'Jeton invalide');userId=verified.payload.sub}catch{return fail(res,401,'Session expirée ou invalide')}
 const sql=neon(process.env.DATABASE_URL)
 try{
  const rows=await sql`select p.full_name as "fullName",p.phone,u.email,p.role,p.is_active as "isActive",p.date_of_birth as "dateOfBirth",p.address,p.city,p.country,p.job_title as "jobTitle",p.department,p.employee_code as "employeeCode",p.avatar_url as "avatarUrl",p.preferred_language as "preferredLanguage",p.theme,p.email_notifications as "emailNotifications" from public.tm_profiles p join neon_auth."user" u on u.id=p.user_id where p.user_id=${userId}::uuid limit 1`
  const profile=rows[0] as {fullName:string;phone:string|null;email:string;role:string;isActive:boolean;[key:string]:unknown}|undefined
  if(!profile)return fail(res,403,'Profil applicatif absent. Contactez un administrateur.')
  if(!profile.isActive)return fail(res,403,'Ce compte est désactivé.')
  if(req.method==='GET')return res.status(200).json({ok:true,data:profile})
  const b=req.body||{}
  const fullName=typeof b.fullName==='string'?b.fullName.trim():''
  const phone=typeof b.phone==='string'?b.phone.trim():''
  const dateOfBirth=typeof b.dateOfBirth==='string'&&b.dateOfBirth?b.dateOfBirth:null
  const address=typeof b.address==='string'?b.address.trim():''
  const city=typeof b.city==='string'?b.city.trim():''
  const country=typeof b.country==='string'?b.country.trim():''
  const jobTitle=typeof b.jobTitle==='string'?b.jobTitle.trim():''
  const department=typeof b.department==='string'?b.department.trim():''
  const avatarUrl=typeof b.avatarUrl==='string'?b.avatarUrl:''
  const preferredLanguage=b.preferredLanguage==='en'?'en':'fr'
  const theme=b.theme==='dark'?'dark':'light'
  const emailNotifications=b.emailNotifications===true
  if(!fullName)return fail(res,400,'Le nom complet est obligatoire.')
  if(fullName.length>120||phone.length>30||address.length>240||city.length>100||country.length>100||jobTitle.length>120||department.length>120)return fail(res,400,'Une des informations dépasse la longueur autorisée.')
  if(avatarUrl.length>2200000|| (avatarUrl&&!/^data:image\/(png|jpeg|webp);base64,/.test(avatarUrl)))return fail(res,400,'Photo invalide ou trop volumineuse (maximum 1,5 Mo).')
  await sql`update public.tm_profiles set full_name=${fullName},phone=${phone||null},date_of_birth=${dateOfBirth}::date,address=${address||null},city=${city||null},country=${country||null},job_title=${jobTitle||null},department=${department||null},avatar_url=${avatarUrl||null},preferred_language=${preferredLanguage},theme=${theme},email_notifications=${emailNotifications} where user_id=${userId}::uuid`
  const updated=await sql`select employee_code as "employeeCode",preferred_language as "preferredLanguage",theme,email_notifications as "emailNotifications" from public.tm_profiles where user_id=${userId}::uuid limit 1`
  return res.status(200).json({ok:true,data:updated[0]})
 }catch(error){console.error('[profile]',error);return fail(res,500,'Erreur lors de la lecture ou de la mise à jour du profil.')}
}
