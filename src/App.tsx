import { useEffect, useMemo, useState } from 'react'
import { authClient, isNeonAuthConfigured } from './lib/auth-client'
import { LayoutDashboard, Users, Package, Ticket, Wallet, ChartNoAxesCombined, Settings, Search, Bell, Plus, ArrowUpRight, MoreHorizontal, CalendarDays, ChevronDown, Menu, X, CircleDollarSign, LogOut, Download, FileText, CheckCircle2, AlertCircle, Truck } from 'lucide-react'

type Tab='dashboard'|'sellers'|'suppliers'|'receipts'|'distributions'|'sales'|'commissions'|'remittances'|'reports'|'settings'
type Seller={id:string;name:string;phone:string;rate:number;active:boolean}
type Distribution={id:string;sellerId:string;supplierId:string;date:string;quantity:number;price:number;status:'Validée'|'Brouillon'}
type Sale={id:string;sellerId:string;supplierId:string;date:string;quantity:number;price:number;status:'Validée'|'Brouillon';supplierReceiverRate:number|null}
type Remittance={id:string;sellerId:string;date:string;amount:number;method:string;reference:string}
type Supplier={id:string;name:string;contact:string;phone:string;email:string;address:string;taxId:string;active:boolean}
type Receipt={id:string;supplierId:string;date:string;quantity:number;unitCost:number;reference:string}
const money=(n:number)=>new Intl.NumberFormat('fr-FR').format(Math.round(n))+' GNF'
const nav:{id:Tab;label:string;icon:any}[]=[{id:'dashboard',label:'Vue d’ensemble',icon:LayoutDashboard},{id:'sellers',label:'Vendeurs',icon:Users},{id:'suppliers',label:'Fournisseurs',icon:Truck},{id:'receipts',label:'Réceptions de tickets',icon:Package},{id:'distributions',label:'Distributions',icon:Package},{id:'sales',label:'Ventes',icon:Ticket},{id:'commissions',label:'Commissions',icon:Wallet},{id:'remittances',label:'Reversements',icon:CircleDollarSign},{id:'reports',label:'Rapports',icon:ChartNoAxesCombined},{id:'settings',label:'Paramètres',icon:Settings}]
const today=()=>new Date().toISOString().slice(0,10)

async function dataApi(resource:string, method:'GET'|'POST'='GET', body?:Record<string,unknown>){
 const rawAuthUrl=String(import.meta.env.VITE_NEON_AUTH_URL||'')
 const authUrl=rawAuthUrl.endsWith('/')?rawAuthUrl.slice(0,-1):rawAuthUrl
 if(!authUrl) throw new Error('URL Neon Auth absente de la configuration.')
 let token:string|undefined
 let tokenError=''
 // Neon Managed Auth issues a short-lived JWT at /token using the secure session cookie.
 try{
  const tokenResponse=await fetch(authUrl+'/token',{method:'GET',credentials:'include',headers:{Accept:'application/json'},cache:'no-store'})
  const tokenPayload=await tokenResponse.json().catch(()=>null)
  if(tokenResponse.ok){
   token=tokenPayload?.token||tokenPayload?.access_token||tokenPayload?.data?.token||tokenPayload?.data?.access_token||tokenPayload?.session?.access_token
  }else{
   tokenError='Neon Auth /token a répondu HTTP '+tokenResponse.status
  }
 }catch(error){tokenError=error instanceof Error?error.message:'Impossible de joindre Neon Auth'}
 if(!token) throw new Error('Impossible de récupérer le JWT Neon. '+(tokenError||'Session expirée ou réponse JWT absente. Déconnectez-vous puis reconnectez-vous.'))
 const response=await fetch('/api/data?resource='+encodeURIComponent(resource),{
  method,
  credentials:'same-origin',
  headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  ...(body?{body:JSON.stringify(body)}:{})
 })
 const result=await response.json().catch(()=>({ok:false,error:'Réponse serveur illisible'}))
 if(!response.ok||!result.ok) throw new Error(result.error||'Erreur API ('+response.status+')')
 return result.data??result
}


type AdminUser={id:string;email:string;name?:string;fullName?:string;role:string;isActive:boolean;canResetPassword?:boolean}
const roleLabels:Record<string,string>={super_admin:'Super administrateur',admin:'Administrateur',sales_manager:'Responsable commercial',cashier:'Caissier',seller:'Vendeur',auditor:'Auditeur',sans_profil:'Sans profil'}
function AdminConsole({onBack}:{onBack:()=>void}){
 const [users,setUsers]=useState<AdminUser[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState(''),[search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[resetNotice,setResetNotice]=useState('')
 async function call(method:'GET'|'PATCH',body?:Record<string,unknown>){
  const raw=String(import.meta.env.VITE_NEON_AUTH_URL||''),url=raw.endsWith('/')?raw.slice(0,-1):raw
  const tokenRes=await fetch(url+'/token',{credentials:'include',cache:'no-store'})
  const tokenData=await tokenRes.json().catch(()=>null)
  const token=tokenData?.token||tokenData?.access_token||tokenData?.data?.token||tokenData?.data?.access_token||tokenData?.session?.access_token
  if(!token)throw new Error('Session Neon introuvable. Reconnectez-vous.')
  const res=await fetch('/api/admin-users',{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})})
  const data=await res.json().catch(()=>({}))
  if(!res.ok||!data.ok)throw new Error(data.error||'Erreur de gestion des utilisateurs.')
  return data.data
 }
 async function refresh(){setLoading(true);setError('');try{setUsers(await call('GET'))}catch(e){setError(e instanceof Error?e.message:'Chargement impossible')}finally{setLoading(false)}}
 useEffect(()=>{void refresh()},[])
 async function sendPasswordReset(user:AdminUser){
  setBusy(user.id);setError('');setResetNotice('')
  try{
   await call('PATCH',{action:'authorizePasswordReset',userId:user.id})
   const client=authClient as any
   const result=await client.requestPasswordReset({email:user.email,redirectTo:window.location.origin})
   if(result?.error)throw new Error(result.error.message||'Neon Auth n’a pas pu envoyer le lien.')
   setResetNotice('Un lien de réinitialisation a été envoyé à '+user.email+'.')
  }catch(e){setError(e instanceof Error?e.message:'Envoi du lien impossible. Vérifiez la configuration e-mail de Neon Auth.')}
  finally{setBusy('')}
 }
 async function update(user:AdminUser,change:Record<string,unknown>){setBusy(user.id);setError('');try{await call('PATCH',{userId:user.id,...change});await refresh()}catch(e){setError(e instanceof Error?e.message:'Modification impossible')}finally{setBusy('')}}
 const roles=['super_admin','admin','sales_manager','cashier','seller','auditor']
 const active=users.filter(u=>u.isActive).length,inactive=users.filter(u=>!u.isActive&&u.role!=='sans_profil').length,admins=users.filter(u=>['admin','super_admin'].includes(u.role)).length,missing=users.filter(u=>u.role==='sans_profil').length
 const visible=users.filter(u=>(u.email+' '+(u.fullName||u.name||'')).toLowerCase().includes(search.toLowerCase())&&(filter==='all'||(filter==='active'&&u.isActive)||(filter==='inactive'&&!u.isActive&&u.role!=='sans_profil')||(filter==='missing'&&u.role==='sans_profil')))
 return <main className="admin-console">
  <div className="admin-orb admin-orb-one"/><div className="admin-orb admin-orb-two"/>
  <div className="admin-wrap">
   <button className="admin-back" onClick={onBack}><span>←</span> Retour à l’espace de gestion</button>
   <header className="admin-hero">
    <div className="admin-hero-copy"><div className="admin-kicker"><span/> CENTRE DE CONTRÔLE · SÉCURITÉ</div><h1>Espace <em>administrateur</em></h1><p>Pilotez les accès, les comptes et les autorisations de votre organisation.</p><div className="admin-hero-meta"><span><i/> Console sécurisée</span><span>•</span><span>Synchronisation Neon</span></div></div>
    <div className="admin-hero-art" aria-hidden="true"><div className="admin-art-ring"/><div className="admin-art-shield">✓</div><span className="admin-art-dot dot-a"/><span className="admin-art-dot dot-b"/><span className="admin-art-dot dot-c"/></div>
   </header>
   <section className="admin-stats">
    <article className="admin-stat stat-total"><div className="admin-stat-top"><span>COMPTES ENREGISTRÉS</span><b>01</b></div><strong>{users.length}</strong><small>Comptes recensés dans Neon Auth</small><div className="admin-stat-icon">◎</div></article>
    <article className="admin-stat stat-active"><div className="admin-stat-top"><span>COMPTES ACTIFS</span><b>02</b></div><strong>{active}</strong><small>Accès métier actuellement autorisés</small><div className="admin-stat-icon">✓</div></article>
    <article className="admin-stat stat-admin"><div className="admin-stat-top"><span>ADMINISTRATEURS</span><b>03</b></div><strong>{admins}</strong><small>Gestion des paramètres et des accès</small><div className="admin-stat-icon">◇</div></article>
    <article className="admin-stat stat-pending"><div className="admin-stat-top"><span>PROFILS À CONFIGURER</span><b>04</b></div><strong>{missing+inactive}</strong><small>{missing} sans profil · {inactive} inactif(s)</small><div className="admin-stat-icon">!</div></article>
   </section>
   {error&&<div role="alert" className="admin-alert"><b>Attention</b><span>{error}</span><button onClick={()=>void refresh()}>Réessayer</button></div>}{resetNotice&&<div role="status" className="admin-reset-success">✓ {resetNotice}</div>}
   <section className="admin-users-panel">
    <div className="admin-panel-head"><div><div className="admin-kicker dark"><span/> GESTION DES IDENTITÉS</div><h2>Utilisateurs et permissions</h2><p>Attribuez les rôles et contrôlez l’état des comptes depuis une seule interface.</p></div><button className="admin-refresh" onClick={()=>void refresh()} disabled={loading}><span className={loading?'admin-spin':''}>↻</span> Actualiser</button></div>
    <div className="admin-toolbar"><div className="admin-search"><span>⌕</span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Rechercher un nom ou une adresse e-mail…"/></div><div className="admin-filters">{[['all','Tous'],['active','Actifs'],['inactive','Inactifs'],['missing','Sans profil']].map(([v,l])=><button key={v} className={filter===v?'selected':''} onClick={()=>setFilter(v)}>{l}{v==='all'&&<b>{users.length}</b>}</button>)}</div></div>
    {loading?<div className="admin-loading"><span className="admin-loader"/><b>Synchronisation des comptes…</b><small>Récupération des profils depuis Neon</small></div>:<div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>UTILISATEUR</th><th>ADRESSE E-MAIL</th><th>RÔLE ET AUTORISATIONS</th><th>STATUT</th><th>GESTION DU COMPTE</th></tr></thead><tbody>{visible.map((u,i)=><tr key={u.id} style={{animationDelay:(i*45)+'ms'}}><td><div className="admin-user-cell"><span className="admin-user-avatar">{(u.fullName||u.name||u.email||'U').slice(0,1).toUpperCase()}</span><span><b>{u.fullName||u.name||'Utilisateur'}</b><small>Compte Ticket Manager</small></span></div></td><td className="admin-email">{u.email}</td><td><select className="admin-role-select" aria-label={'Attribuer un rôle à '+u.email} disabled={busy===u.id} value={roles.includes(u.role)?u.role:''} onChange={e=>void update(u,{role:e.target.value})}>{u.role==='sans_profil'&&<option value="" disabled>Attribuer un rôle</option>}{roles.map(r=><option key={r} value={r}>{roleLabels[r]||r}</option>)}</select></td><td><span className={'admin-status '+(u.role==='sans_profil'?'status-missing':u.isActive?'status-active':'status-inactive')}><i/>{u.role==='sans_profil'?'Profil manquant':u.isActive?'Actif':'Inactif'}</span></td><td><button className={'admin-toggle '+(u.isActive?'is-on':'')} disabled={busy===u.id||u.role==='sans_profil'} onClick={()=>void update(u,{isActive:!u.isActive})}>{busy===u.id?'En cours…':u.isActive?'Désactiver':'Activer'}</button>{u.canResetPassword&&<button className="admin-reset-button" disabled={busy===u.id||u.role==='sans_profil'||!u.email} onClick={()=>void sendPasswordReset(u)}>{busy===u.id?'En cours…':'Réinitialiser le mot de passe'}</button>}</td></tr>)}</tbody></table>{visible.length===0&&<div className="admin-empty"><span>⌕</span><b>Aucun utilisateur trouvé</b><small>Modifiez votre recherche ou le filtre sélectionné.</small></div>}</div>}
    <div className="admin-panel-foot"><span>Affichage de <b>{visible.length}</b> sur <b>{users.length}</b> compte(s)</span><span><i/> Données sécurisées · Neon PostgreSQL</span></div>
   </section>
   <div className="admin-security-note"><span>◇</span><div><b>Contrôle des accès activé</b><p>Les autorisations sont vérifiées côté serveur. Les changements de rôle et de statut sont enregistrés dans Neon.</p></div></div>
   <footer className="admin-footer">TICKET MANAGER <span>ADMINISTRATION · CONSOLE DE CONTRÔLE</span></footer>
  </div>
 </main>
}


function ProfilePage({onBack}:{onBack:()=>void}){
 const [form,setForm]=useState({fullName:'',phone:'',email:'',role:'',dateOfBirth:'',address:'',city:'',country:'Guinée',jobTitle:'',department:'',employeeCode:'',avatarUrl:'',preferredLanguage:'fr',theme:'light',emailNotifications:true})
 const [loading,setLoading]=useState(true),[saving,setSaving]=useState(false),[message,setMessage]=useState(''),[error,setError]=useState('')
 const update=(key:string,value:string|boolean)=>setForm(old=>({...old,[key]:value}))
 async function request(method:'GET'|'PATCH',body?:Record<string,unknown>){
  const raw=String(import.meta.env.VITE_NEON_AUTH_URL||''),base=raw.endsWith('/')?raw.slice(0,-1):raw
  if(!base)throw new Error('URL Neon Auth absente de la configuration.')
  const tokenResponse=await fetch(base+'/token',{credentials:'include',cache:'no-store',headers:{Accept:'application/json'}})
  const tokenData=await tokenResponse.json().catch(()=>null)
  const token=tokenData?.token||tokenData?.access_token||tokenData?.data?.token||tokenData?.data?.access_token||tokenData?.session?.access_token
  if(!tokenResponse.ok||!token)throw new Error('Session Neon indisponible. Reconnectez-vous.')
  const response=await fetch('/api/profile',{method,credentials:'include',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined})
  const data=await response.json().catch(()=>null)
  if(!response.ok||!data?.ok)throw new Error(data?.error||'Opération impossible.')
  return data
 }
 useEffect(()=>{let alive=true;(async()=>{try{const d=await request('GET');if(!alive)return;setForm(old=>({...old,...d.data,avatarUrl:d.data.avatarUrl||'',dateOfBirth:d.data.dateOfBirth?String(d.data.dateOfBirth).slice(0,10):'',preferredLanguage:d.data.preferredLanguage||'fr',theme:d.data.theme||'light',emailNotifications:d.data.emailNotifications??true}))}catch(e){if(alive)setError(e instanceof Error?e.message:'Chargement du profil impossible')}finally{if(alive)setLoading(false)}})();return()=>{alive=false}},[])
 async function save(e:React.FormEvent<HTMLFormElement>){e.preventDefault();setSaving(true);setMessage('');setError('');try{const saved=await request('PATCH',form);if(saved.data)setForm(old=>({...old,...saved.data}));setMessage('Toutes vos modifications, y compris la langue et les préférences, ont été enregistrées.');}catch(e){setError(e instanceof Error?e.message:'Enregistrement impossible.')}finally{setSaving(false)}}
 async function photo(e:React.ChangeEvent<HTMLInputElement>){const file=e.target.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){setError('Format accepté : PNG, JPG ou WebP.');return}if(file.size>1500*1024){setError('La photo doit faire 1,5 Mo maximum.');return}const reader=new FileReader();reader.onload=()=>update('avatarUrl',String(reader.result||''));reader.readAsDataURL(file)}
 const roleLabel=({super_admin:'Super administrateur',admin:'Administrateur',sales_manager:'Responsable commercial',cashier:'Caissier',seller:'Vendeur',auditor:'Auditeur'} as Record<string,string>)[form.role]||form.role||'Non défini'
 return <main className="profile-page"><div className="profile-page-top"><button className="profile-back" onClick={onBack}>← Retour à l’application</button><span>ESPACE PERSONNEL</span></div><section className="profile-card-frame"><div className="profile-card"><div className="profile-page-heading"><label className="profile-photo-control">{form.avatarUrl?<img src={form.avatarUrl} alt="Photo de profil"/>:<span>{(form.fullName||form.email||'U').trim().slice(0,1).toUpperCase()}</span>}<input type="file" accept="image/png,image/jpeg,image/webp" onChange={photo}/><small>Modifier</small></label><div><span className="profile-kicker">MON COMPTE</span><h1>Mon profil</h1><p>Gérez vos informations personnelles, professionnelles et préférences.</p></div></div>{loading?<div className="profile-loading">Chargement de votre profil…</div>:<form className="profile-form" onSubmit={save}>
 <h2 className="profile-section-title">Informations personnelles</h2>
 <label>Nom complet<input required maxLength={120} value={form.fullName} onChange={e=>update('fullName',e.target.value)} placeholder="Votre nom et prénom"/></label>
 <label>Date de naissance<input type="date" value={form.dateOfBirth} onChange={e=>update('dateOfBirth',e.target.value)}/></label>
 <label>Téléphone<input maxLength={30} value={form.phone||''} onChange={e=>update('phone',e.target.value)} placeholder="+224 …"/></label>
 <label>Adresse e-mail<input value={form.email||''} readOnly disabled/></label>
 <label className="profile-wide">Adresse<input maxLength={240} value={form.address||''} onChange={e=>update('address',e.target.value)} placeholder="Quartier, rue, repère…"/></label>
 <label>Ville<input maxLength={100} value={form.city||''} onChange={e=>update('city',e.target.value)} placeholder="Conakry"/></label>
 <label>Pays<input maxLength={100} value={form.country||''} onChange={e=>update('country',e.target.value)}/></label>
 <h2 className="profile-section-title">Informations professionnelles</h2>
 <label>Fonction<input maxLength={120} value={form.jobTitle||''} onChange={e=>update('jobTitle',e.target.value)} placeholder="Ex. Responsable commercial"/></label>
 <label>Service / Département<input maxLength={120} value={form.department||''} onChange={e=>update('department',e.target.value)} placeholder="Ex. Administration"/></label>
 <label>Matricule automatique<input value={form.employeeCode||'Généré automatiquement'} readOnly disabled/><small>Attribué automatiquement par le système et non modifiable.</small></label>
 <div className="profile-readonly">Rôle et permissions<b>{roleLabel}</b><small>Ces paramètres sont gérés exclusivement par l’administration.</small></div>
 <h2 className="profile-section-title">Préférences</h2>
 <label>Langue<select value={form.preferredLanguage} onChange={e=>update('preferredLanguage',e.target.value)}><option value="fr">Français</option><option value="en">English</option></select></label>
 <label>Thème<select value={form.theme} onChange={e=>update('theme',e.target.value)}><option value="light">Clair</option><option value="dark">Sombre</option></select></label>
 <label className="profile-toggle"><input type="checkbox" checked={!!form.emailNotifications} onChange={e=>update('emailNotifications',e.target.checked)}/> Recevoir les notifications par e-mail</label>
 <h2 className="profile-section-title">Sécurité du compte</h2>
 <div className="profile-readonly profile-wide">Adresse e-mail et mot de passe<small>La gestion des identifiants est assurée par Neon Auth. Utilisez la procédure sécurisée de réinitialisation du mot de passe depuis l’écran de connexion.</small></div>
 {error&&<p className="profile-error" role="alert">{error}</p>}{message&&<p className="profile-success" role="status">{message}</p>}
 <div className="profile-form-actions"><button type="button" className="profile-cancel" onClick={onBack}>Annuler</button><button type="submit" disabled={saving}>{saving?'Enregistrement…':'Enregistrer les modifications'}</button></div>
 </form>}</div></section></main>
}

function Dashboard(){
 const [tab,setTab]=useState<Tab>('dashboard'),[mobile,setMobile]=useState(false),[query,setQuery]=useState(''),[notice,setNotice]=useState(''),[adminOpen,setAdminOpen]=useState(false),[notificationsOpen,setNotificationsOpen]=useState(false),[profileOpen,setProfileOpen]=useState(false),[profilePageOpen,setProfilePageOpen]=useState(false)
 useEffect(()=>{
  if(!notificationsOpen&&!profileOpen)return
  const handleOutside=(event:PointerEvent)=>{
   const target=event.target
   if(target instanceof Element&&!target.closest('.top-menu-wrap')){
    setNotificationsOpen(false)
    setProfileOpen(false)
   }
  }
  const handleEscape=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    setNotificationsOpen(false)
    setProfileOpen(false)
   }
  }
  document.addEventListener('pointerdown',handleOutside)
  document.addEventListener('keydown',handleEscape)
  return()=>{
   document.removeEventListener('pointerdown',handleOutside)
   document.removeEventListener('keydown',handleEscape)
  }
 },[notificationsOpen,profileOpen])

 const [sellers,setSellers]=useState<Seller[]>([]),[suppliers,setSuppliers]=useState<Supplier[]>([]),[receipts,setReceipts]=useState<Receipt[]>([]),[distributions,setDistributions]=useState<Distribution[]>([]),[sales,setSales]=useState<Sale[]>([]),[remittances,setRemittances]=useState<Remittance[]>([])
 const [loadingData,setLoadingData]=useState(true)
 const [ticketName,setTicketName]=useState('Ticket standard'),[ticketPrice,setTicketPrice]=useState('5000'),[defaultRate,setDefaultRate]=useState('10'),[period,setPeriod]=useState(today().slice(0,7)),[pairRates,setPairRates]=useState<Record<string,string>>({}),[settingsSaving,setSettingsSaving]=useState(false),[canManageSettings,setCanManageSettings]=useState(false),[appName,setAppName]=useState('Ticket Manager'),[organizationName,setOrganizationName]=useState(''),[supportEmail,setSupportEmail]=useState(''),[supportPhone,setSupportPhone]=useState(''),[appTimezone,setAppTimezone]=useState('Africa/Conakry'),[commissionEffectiveDate,setCommissionEffectiveDate]=useState(today()),[commissionSaving,setCommissionSaving]=useState('')
 useEffect(()=>{let alive=true;(async()=>{try{const [a,b,d,e,g,h,i,j]=await Promise.all([dataApi('sellers'),dataApi('suppliers'),dataApi('receipts'),dataApi('distributions'),dataApi('sales'),dataApi('remittances'),dataApi('commissions'),dataApi('settings')]);if(!alive)return;setSellers(a);setSuppliers(b);setReceipts(d);setDistributions(e);setSales(g);setRemittances(h);setPairRates(Object.fromEntries(i.map((x:any)=>[x.supplierId+'|'+x.sellerId,String(x.rate)])));if(j?.[0]){setCanManageSettings(Boolean(j[0].canManageSettings));setAppName(j[0].appName||'Ticket Manager');setOrganizationName(j[0].organizationName||'');setSupportEmail(j[0].supportEmail||'');setSupportPhone(j[0].supportPhone||'');setAppTimezone(j[0].timezone||'Africa/Conakry');setTicketName(j[0].ticketName||'Ticket standard');setTicketPrice(String(j[0].ticketPrice??5000));setDefaultRate(String(j[0].defaultCommissionRate??10));setOpForm(old=>({...old,price:String(j[0].ticketPrice??5000)}))}}catch(err){if(alive)setNotice(err instanceof Error?err.message:'Chargement des données impossible')}finally{if(alive)setLoadingData(false)}})();return()=>{alive=false}},[])
 const [modal,setModal]=useState<Tab|null>(null),[editing,setEditing]=useState<string|null>(null),[saving,setSaving]=useState(false)
 const [sellerForm,setSellerForm]=useState({name:'',phone:'',rate:'10'})
 const [supplierForm,setSupplierForm]=useState({name:'',contact:'',phone:'',email:'',address:'',taxId:''})
 const [opForm,setOpForm]=useState({sellerId:'',supplierId:'',date:today(),quantity:'',price:'5000',unitCost:'',method:'Espèces',reference:''})
 const title=nav.find(x=>x.id===tab)?.label||'Ticket Manager'
 const activeSellers=sellers.filter(s=>s.active)
 const totals=useMemo(()=>{const validSales=sales.filter(x=>x.status==='Validée'),validDist=distributions.filter(x=>x.status==='Validée');const revenue=validSales.reduce((a,x)=>a+x.quantity*x.price,0);const commission=validSales.reduce((a,x)=>a+x.quantity*x.price*(sellers.find(s=>s.id===x.sellerId)?.rate||0)/100,0);const remitted=remittances.reduce((a,x)=>a+x.amount,0);return {revenue,commission,remitted,distributed:validDist.reduce((a,x)=>a+x.quantity,0),sold:validSales.reduce((a,x)=>a+x.quantity,0),balance:revenue-commission-remitted}},[sales,distributions,remittances,sellers])
 const filteredSellers=useMemo(()=>sellers.filter(s=>(s.name+' '+s.phone).toLowerCase().includes(query.toLowerCase())),[sellers,query])
 const sellerBalance=(id:string)=>sales.filter(x=>x.sellerId===id&&x.status==='Validée').reduce((a,x)=>a+x.quantity*x.price*(1-(sellers.find(s=>s.id===id)?.rate||0)/100),0)-remittances.filter(x=>x.sellerId===id).reduce((a,x)=>a+x.amount,0)
 const receivedStock=receipts.reduce((a,x)=>a+x.quantity,0)
 const monthlyReceipts=useMemo(()=>{const grouped=new Map<string,number>();receipts.forEach(x=>{const month=x.date.slice(0,7);if(/^\\d{4}-\\d{2}$/.test(month))grouped.set(month,(grouped.get(month)||0)+x.quantity)});return [...grouped.entries()].sort((a,b)=>b[0].localeCompare(a[0])).map(([month,quantity])=>({month,quantity,percentage:receivedStock>0?quantity/receivedStock*100:0}))},[receipts,receivedStock])
 const distributedStock=distributions.filter(x=>x.status==='Validée').reduce((a,x)=>a+x.quantity,0)
 const availableStock=Math.max(0,receivedStock-distributedStock)
 const sellerDistributed=(id:string)=>distributions.filter(x=>x.sellerId===id&&x.status==='Validée').reduce((a,x)=>a+x.quantity,0)
 const supplierStock=(id:string)=>receipts.filter(x=>x.supplierId===id).reduce((a,x)=>a+x.quantity,0)-distributions.filter(x=>x.supplierId===id&&x.status==='Validée').reduce((a,x)=>a+x.quantity,0)
 const sellerSupplierStock=(sellerId:string,supplierId:string)=>distributions.filter(x=>x.sellerId===sellerId&&x.supplierId===supplierId&&x.status==='Validée').reduce((a,x)=>a+x.quantity,0)-sales.filter(x=>x.sellerId===sellerId&&x.supplierId===supplierId&&x.status==='Validée').reduce((a,x)=>a+x.quantity,0)
 const sellerSold=(id:string)=>sales.filter(x=>x.sellerId===id&&x.status==='Validée').reduce((a,x)=>a+x.quantity,0)
 const monthlySales=sales.filter(x=>x.status==='Validée'&&x.date.slice(0,7)===period)
 const monthlyCommission=monthlySales.reduce((a,x)=>a+x.quantity*x.price*(sellers.find(s=>s.id===x.sellerId)?.rate||0)/100,0)
 const monthlyRevenue=monthlySales.reduce((a,x)=>a+x.quantity*x.price,0)
 const monthlyTicketCount=monthlySales.reduce((a,x)=>a+x.quantity,0)
 const monthlySupplierPairs=useMemo(()=>{const keys=new Set(monthlySales.map(x=>x.supplierId+'|'+x.sellerId));return [...keys].map(key=>{const [supplierId,sellerId]=key.split('|'),rows=monthlySales.filter(x=>x.supplierId===supplierId&&x.sellerId===sellerId),quantity=rows.reduce((a,x)=>a+x.quantity,0),revenue=rows.reduce((a,x)=>a+x.quantity*x.price,0),hasMissingRate=rows.some(x=>x.supplierReceiverRate===null||x.supplierReceiverRate===undefined),commission=hasMissingRate?null:rows.reduce((sum,x)=>sum+x.quantity*x.price*(Number(x.supplierReceiverRate)||0)/100,0),net=commission===null?null:revenue-commission,rate=commission===null||revenue===0?null:commission/revenue*100;return {key,supplierId,sellerId,quantity,revenue,rate,commission,net,hasMissingRate}})},[monthlySales])
 if(profilePageOpen)return <ProfilePage onBack={()=>setProfilePageOpen(false)}/>
 if(adminOpen)return <AdminConsole onBack={()=>setAdminOpen(false)}/>
 const notify=(s:string)=>setNotice(s)
 async function saveSettings(){const price=Number(ticketPrice),rate=Number(defaultRate);if(!appName.trim()){notify('Le nom de l’application est obligatoire.');return}if(supportEmail&&!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(supportEmail)){notify('Adresse e-mail de support invalide.');return}if(!ticketName.trim()){notify('Le nom du type de ticket est obligatoire.');return}if(!Number.isSafeInteger(price)||price<0){notify('Le prix de référence doit être un montant entier positif ou nul.');return}if(!Number.isFinite(rate)||rate<0||rate>100){notify('Le taux par défaut doit être compris entre 0 et 100 %.');return}setSettingsSaving(true);try{const saved=await dataApi('settings','POST',{appName:appName.trim(),organizationName:organizationName.trim(),supportEmail:supportEmail.trim(),supportPhone:supportPhone.trim(),timezone:appTimezone,ticketName:ticketName.trim(),ticketPrice:price,defaultCommissionRate:rate});setAppName(saved.appName);setOrganizationName(saved.organizationName||'');setSupportEmail(saved.supportEmail||'');setSupportPhone(saved.supportPhone||'');setAppTimezone(saved.timezone||'Africa/Conakry');setTicketName(saved.ticketName);setTicketPrice(String(saved.ticketPrice));setDefaultRate(String(saved.defaultCommissionRate));setOpForm(old=>({...old,price:String(saved.ticketPrice)}));notify('Configuration de l’application enregistrée dans Neon.')}catch(err){notify(err instanceof Error?err.message:'Enregistrement des paramètres impossible.')}finally{setSettingsSaving(false)}}
 async function saveSupplierReceiverRate(supplierId:string,sellerId:string){const key=supplierId+'|'+sellerId,raw=pairRates[key],rate=Number(raw);if(raw===undefined||raw.trim()===''||!Number.isFinite(rate)||rate<0||rate>100){notify('Saisissez un taux compris entre 0 et 100 %.');return}setCommissionSaving(key);try{const result=await dataApi('commissions','POST',{supplierId,sellerId,rate,validFrom:commissionEffectiveDate});setPairRates(p=>({...p,[key]:String(result.rate??rate)}));notify('Taux fournisseur–receveur enregistré avec sa date d’effet.')}catch(err){notify(err instanceof Error?err.message:'Enregistrement du taux impossible.')}finally{setCommissionSaving('')}}
 function printReceipt(id:string){const item=receipts.find(x=>x.id===id);if(!item)return;const supplier=suppliers.find(x=>x.id===item.supplierId);const w=window.open('','_blank','width=800,height=650');if(!w){notify('Autorisez les fenêtres contextuelles pour imprimer le bon.');return}w.document.write('<!doctype html><html lang="fr"><head><meta charset="utf-8"><title>Bon de réception '+item.reference+'</title><style>body{font:14px Arial,sans-serif;color:#17243a;padding:36px}header{border-bottom:3px solid #0868b9;padding-bottom:18px;margin-bottom:28px}h1{font-size:24px;margin:0 0 6px}.muted{color:#64748b}table{width:100%;border-collapse:collapse;margin-top:24px}td,th{border:1px solid #dbe3ed;padding:13px;text-align:left}th{background:#f2f6fb}.sign{display:flex;justify-content:space-between;margin-top:90px}.sign div{width:40%;border-top:1px solid #64748b;padding-top:8px}</style></head><body><header><h1>BON DE RÉCEPTION DE TICKETS</h1><div class="muted">Ticket Manager · Approvisionnement</div></header><p><b>Référence :</b> '+item.reference+'</p><p><b>Date :</b> '+item.date+'</p><p><b>Fournisseur :</b> '+(supplier?.name||'Fournisseur')+'</p><table><tr><th>Désignation</th><th>Quantité reçue</th><th>Coût unitaire</th><th>Valeur totale</th></tr><tr><td>Tickets</td><td>'+item.quantity+'</td><td>'+money(item.unitCost)+'</td><td>'+money(item.quantity*item.unitCost)+'</td></tr></table><div class="sign"><div>Réceptionnaire</div><div>Signature du fournisseur</div></div><script>window.onload=()=>window.print()<\\/script></body></html>');w.document.close()}
 async function saveSeller(e:React.FormEvent){e.preventDefault();if(saving)return;if(!sellerForm.name.trim()){notify('Le nom du vendeur est obligatoire.');return}setSaving(true);try{await dataApi('sellers','POST',{name:sellerForm.name.trim(),phone:sellerForm.phone,rate:Number(sellerForm.rate)});setSellers(await dataApi('sellers'));notify('Vendeur enregistré dans Neon.');setModal(null);setEditing(null);setSellerForm({name:'',phone:'',rate:defaultRate})}catch(err){notify(err instanceof Error?err.message:'Enregistrement impossible')}finally{setSaving(false)}}
 async function saveSupplier(e:React.FormEvent){e.preventDefault();if(saving)return;if(!supplierForm.name.trim()){notify('Le nom du fournisseur est obligatoire.');return}setSaving(true);try{await dataApi('suppliers','POST',supplierForm);setSuppliers(await dataApi('suppliers'));notify('Fournisseur enregistré dans Neon.');setModal(null);setEditing(null);setSupplierForm({name:'',contact:'',phone:'',email:'',address:'',taxId:''})}catch(err){notify(err instanceof Error?err.message:'Enregistrement impossible')}finally{setSaving(false)}}
 async function saveOperation(e:React.FormEvent){e.preventDefault();if(saving)return;const q=Number(opForm.quantity),price=Number(opForm.price);if(!Number.isFinite(q)||q<=0){notify('Saisissez une quantité ou un montant supérieur à zéro.');return}if(modal!=='remittances'&&(!Number.isFinite(price)||price<0)){notify('Le prix unitaire est invalide.');return}setSaving(true)
 const resource=modal==='receipts'?'receipts':modal==='distributions'?'distributions':modal==='sales'?'sales':'remittances'
 const payload=modal==='receipts'?{supplierId:opForm.supplierId,date:opForm.date,quantity:q,unitCost:Number(opForm.unitCost),reference:opForm.reference.trim()}:
 modal==='remittances'?{sellerId:opForm.sellerId,date:opForm.date,amount:q,method:opForm.method,reference:opForm.reference}:
 {sellerId:opForm.sellerId,supplierId:opForm.supplierId,date:opForm.date,quantity:q,price}
 try{
  await dataApi(resource,'POST',payload)
  const [r,d,s,m]=await Promise.all([dataApi('receipts'),dataApi('distributions'),dataApi('sales'),dataApi('remittances')])
  setReceipts(r);setDistributions(d);setSales(s);setRemittances(m)
  notify('Opération enregistrée dans Neon.')
  setModal(null)
  setOpForm({sellerId:activeSellers[0]?.id||'',supplierId:suppliers.find(s=>s.active)?.id||'',date:today(),quantity:'',price:ticketPrice,unitCost:'',method:'Espèces',reference:''})
 }catch(err){notify(err instanceof Error?err.message:'Enregistrement impossible')}finally{setSaving(false)}
 }
 function openOperation(t:Tab){setModal(t);setOpForm({sellerId:activeSellers[0]?.id||'',supplierId:suppliers.find(s=>s.active)?.id||'',date:today(),quantity:'',price:ticketPrice,unitCost:'',method:'Espèces',reference:''})}
 function exportCsv(){const rows=[['Type','Date','Vendeur','Quantité','Montant GNF','Statut'],...distributions.map(x=>['Distribution',x.date,sellers.find(s=>s.id===x.sellerId)?.name||'',String(x.quantity),String(x.quantity*x.price),x.status]),...sales.map(x=>['Vente',x.date,sellers.find(s=>s.id===x.sellerId)?.name||'',String(x.quantity),String(x.quantity*x.price),x.status]),...remittances.map(x=>['Reversement',x.date,sellers.find(s=>s.id===x.sellerId)?.name||'','',String(x.amount),x.method])];const blob=new Blob(['\\ufeff'+rows.map(r=>r.map(v=>'"'+v.replace(/"/g,'""')+'"').join(';')).join('\\n')],{type:'text/csv;charset=utf-8'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='ticket-manager-rapport.csv';a.click();URL.revokeObjectURL(url)}
 const pageIntro=(eyebrow:string,heading:string,desc:string,action?:()=>void,label?:string)=><div className="welcome"><div><p className="eyebrow">{eyebrow}</p><h2>{heading}</h2><p>{desc}</p></div>{action&&<button className="btn-primary" onClick={action}><Plus size={17}/>{label}</button>}</div>
 const stat=(icon:any,label:string,value:string,sub:string,tone:string)=><div className="stat-card"><div className={'stat-icon '+tone}>{icon}</div><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>
 const sellerName=(id:string)=>sellers.find(s=>s.id===id)?.name||'Vendeur supprimé'
 const table=(headers:string[],rows:React.ReactNode[],empty:string)=><div className="table-wrap"><table><thead><tr>{headers.map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows}</tbody></table>{rows.length===0&&<div className="empty">{empty}</div>}</div>
 return <div className="app-shell">
 <aside className={mobile?'sidebar open':'sidebar'}><div className="brand"><div className="brand-mark">T</div><div><b>{appName}</b><small>{organizationName||'GESTION COMMERCIALE'}</small></div><button className="mobile-close" onClick={()=>setMobile(false)}><X size={18}/></button></div><button type="button" className="workspace" onClick={()=>{setAdminOpen(true);setMobile(false)}} aria-label="Ouvrir l’espace administrateur"><span className="workspace-dot"/><div><b>Espace administrateur</b><small>Comptes, rôles et permissions</small></div><ChevronDown size={15}/></button><p className="nav-label">MENU PRINCIPAL</p><nav>{nav.map(n=><button key={n.id} className={tab===n.id?'nav-item active':'nav-item'} onClick={()=>{setTab(n.id);setMobile(false)}}><n.icon size={18}/><span>{n.label}</span></button>)}</nav><div className="sidebar-bottom"><div className="help-card"><div className="help-icon">?</div><b>Centre d’aide</b><p>Consultez les consignes de gestion des tickets et reversements.</p><button onClick={()=>setTab('reports')}>Voir les rapports <ArrowUpRight size={14}/></button></div><div className="profile"><div className="avatar">SA</div><div><b>Compte connecté</b><small>Administrateur</small></div><MoreHorizontal size={18}/></div></div></aside>
 {mobile&&<div className="scrim" onClick={()=>setMobile(false)}/>}
 <main className="main"><header className="topbar"><div className="top-left"><button className="menu-btn" onClick={()=>setMobile(true)}><Menu/></button><div><span className="crumb">Espace de gestion</span><h1>{title}</h1></div></div><div className="top-actions"><div className="date-pill"><CalendarDays size={16}/> {new Intl.DateTimeFormat('fr-FR',{dateStyle:'long'}).format(new Date())}</div><div className="top-menu-wrap"><button type="button" className={notificationsOpen?"icon-btn top-icon-btn is-open":"icon-btn top-icon-btn"} aria-label="Notifications" aria-expanded={notificationsOpen} onClick={()=>{setNotificationsOpen(v=>!v);setProfileOpen(false)}}><Bell size={19}/></button>{notificationsOpen&&<section className="top-dropdown notification-dropdown" role="dialog" aria-label="Centre de notifications"><div className="top-dropdown-head"><div><b>Notifications</b><small>Centre de notifications</small></div><span className="notification-count">0</span></div><div className="notification-empty"><span className="notification-empty-icon"><Bell size={21}/></span><b>Tout est à jour</b><p>Vous n’avez aucune nouvelle notification pour le moment.</p></div><div className="top-dropdown-foot">Les alertes importantes apparaîtront ici.</div></section>}</div><div className="top-menu-wrap"><button type="button" className={profileOpen?"top-profile-trigger is-open":"top-profile-trigger"} aria-label="Ouvrir le menu du profil" aria-expanded={profileOpen} onClick={()=>{setProfileOpen(v=>!v);setNotificationsOpen(false)}}><span className="top-avatar">SA</span><span className="top-profile-chevron"><ChevronDown size={15}/></span></button>{profileOpen&&<section className="top-dropdown profile-dropdown" role="menu" aria-label="Menu du profil"><div className="profile-dropdown-head"><span className="profile-dropdown-avatar">SA</span><div><b>Compte connecté</b><small>Administrateur</small></div></div><button type="button" role="menuitem" onClick={()=>{setProfileOpen(false);setProfilePageOpen(true)}}><Settings size={16}/> Mon profil</button><button type="button" role="menuitem" className="profile-logout" onClick={()=>void authClient.signOut()}><LogOut size={16}/> Se déconnecter</button></section>}</div></div></header>
 <div className="content"><div className="notice"><AlertCircle size={15}/><span>Mode en ligne requis : la connexion à Neon doit être opérationnelle pour enregistrer et recharger les données. Aucune sauvegarde locale n’est utilisée.</span><button onClick={()=>setNotice('')}>×</button></div>{notice&&<div className="notice notice-success"><CheckCircle2 size={15}/>{notice}<button onClick={()=>setNotice('')}>×</button></div>}
 {tab==='dashboard'&&<>{pageIntro('TABLEAU DE BORD','Vue d’ensemble','Suivez les distributions, les ventes, les commissions et les reversements.',()=>openOperation('distributions'),'Nouvelle distribution')}<div className="stats-grid">{stat(<Users/>,'Vendeurs actifs',String(activeSellers.length),'Vendeurs enregistrés','blue')}{stat(<Package/>,'Tickets distribués',totals.distributed.toLocaleString('fr-FR'),'Distributions validées','orange')}{stat(<Ticket/>,'Chiffre d’affaires',money(totals.revenue),'Ventes validées','green')}{stat(<Wallet/>,'Commissions',money(totals.commission),'Montant acquis','purple')}</div><div className="dashboard-grid"><section className="panel"><div className="panel-head"><div><h3>Activité opérationnelle</h3><p>Indicateurs calculés à partir des opérations de la session</p></div></div><div className="metric-list"><div><span>Tickets vendus</span><b>{totals.sold.toLocaleString('fr-FR')}</b></div><div><span>Tickets invendus</span><b>{Math.max(0,totals.distributed-totals.sold).toLocaleString('fr-FR')}</b></div><div><span>Montant reversé</span><b>{money(totals.remitted)}</b></div><div><span>Solde à reverser</span><b>{money(totals.balance)}</b></div></div></section><section className="panel"><div className="panel-head"><div><h3>Actions rapides</h3><p>Accès direct aux opérations courantes</p></div></div><div className="quick-actions"><button onClick={()=>setTab('sellers')}><Users/>Gérer les vendeurs</button><button onClick={()=>openOperation('sales')}><Ticket/>Déclarer les ventes</button><button onClick={()=>openOperation('remittances')}><CircleDollarSign/>Enregistrer un reversement</button><button onClick={()=>setTab('reports')}><FileText/>Consulter les rapports</button></div></section></div><section className="panel table-panel"><div className="panel-head"><div><h3>Situation par vendeur</h3><p>État synthétique des comptes</p></div><button className="text-btn" onClick={()=>setTab('sellers')}>Tous les vendeurs <ArrowUpRight size={15}/></button></div>{table(['VENDEUR','DISTRIBUÉS','VENDUS','INVENDUS','À REVERSER'],sellers.map(s=><tr key={s.id}><td>{s.name}</td><td>{sellerDistributed(s.id)}</td><td>{sellerSold(s.id)}</td><td>{Math.max(0,sellerDistributed(s.id)-sellerSold(s.id))}</td><td className="amount-due">{money(sellerBalance(s.id))}</td></tr>),'Aucune donnée pour le moment. Ajoutez un vendeur puis enregistrez une distribution.')}</section></>}
 {tab==='sellers'&&<>{pageIntro('ÉQUIPE COMMERCIALE','Gestion des vendeurs','Créez les fiches, définissez les commissions et suivez les performances.',()=>{setEditing(null);setSellerForm({name:'',phone:'',rate:defaultRate});setModal('sellers')},'Ajouter un vendeur')}<section className="panel table-panel"><div className="panel-head"><div><h3>Liste des vendeurs</h3><p>{sellers.length} fiche(s)</p></div><div className="search"><Search size={16}/><input placeholder="Rechercher..." value={query} onChange={e=>setQuery(e.target.value)}/></div></div>{table(['VENDEUR','TÉLÉPHONE','TAUX','DISTRIBUÉS','VENDUS','SOLDE','ACTIONS'],filteredSellers.map(s=><tr key={s.id}><td><b>{s.name}</b></td><td>{s.phone||'—'}</td><td><span className="rate-pill">{s.rate}%</span></td><td>{sellerDistributed(s.id)}</td><td>{sellerSold(s.id)}</td><td className="amount-due">{money(sellerBalance(s.id))}</td><td><button className="row-action" onClick={()=>{setEditing(s.id);setSellerForm({name:s.name,phone:s.phone,rate:String(s.rate)});setModal('sellers')}}>Modifier</button><button className="row-action danger" onClick={()=>setSellers(p=>p.map(x=>x.id===s.id?{...x,active:false}:x))}>Désactiver</button></td></tr>),'Aucun vendeur trouvé.')}</section></>}
 {tab==='suppliers'&&<>{pageIntro('GESTION DES ACHATS','Répertoire des fournisseurs','Centralisez les coordonnées de vos fournisseurs et gérez leur statut.',()=>{setEditing(null);setSupplierForm({name:'',contact:'',phone:'',email:'',address:'',taxId:''});setModal('suppliers')},'Ajouter un fournisseur')}<section className="panel table-panel"><div className="panel-head"><div><h3>Liste des fournisseurs</h3><p>{suppliers.length} fiche(s) enregistrée(s)</p></div><div className="search"><Search size={16}/><input placeholder="Rechercher un fournisseur..." value={query} onChange={e=>setQuery(e.target.value)}/></div></div>{table(['FOURNISSEUR','CONTACT','TÉLÉPHONE','E-MAIL','ADRESSE','NIF / RCCM','STATUT','ACTIONS'],suppliers.filter(x=>(x.name+' '+x.contact+' '+x.phone+' '+x.email).toLowerCase().includes(query.toLowerCase())).map(x=><tr key={x.id}><td><b>{x.name}</b></td><td>{x.contact||'—'}</td><td>{x.phone||'—'}</td><td>{x.email||'—'}</td><td>{x.address||'—'}</td><td>{x.taxId||'—'}</td><td><span className={x.active?'status-ok':'rate-pill'}>{x.active?'Actif':'Inactif'}</span></td><td><button className="row-action" onClick={()=>{setEditing(x.id);setSupplierForm({name:x.name,contact:x.contact,phone:x.phone,email:x.email,address:x.address,taxId:x.taxId});setModal('suppliers')}}>Modifier</button><button className="row-action danger" onClick={()=>setSuppliers(p=>p.map(v=>v.id===x.id?{...v,active:!v.active}:v))}>{x.active?'Désactiver':'Réactiver'}</button></td></tr>),'Aucun fournisseur trouvé. Ajoutez votre premier fournisseur.')}</section></>}
 {tab==='receipts'&&<>{pageIntro('APPROVISIONNEMENT','Réceptions de tickets','Enregistrez les tickets reçus de chaque fournisseur avant toute distribution.',()=>openOperation('receipts'),'Enregistrer une réception')}<div className="stats-grid">{stat(<Package/>,'Tickets reçus',String(receivedStock),'Quantités réceptionnées','blue')}{stat(<Truck/>,'Fournisseurs actifs',String(suppliers.filter(x=>x.active).length),'Sources d’approvisionnement','orange')}{stat(<Package/>,'Tickets distribués',String(distributedStock),'Sorties du stock général','purple')}{stat(<CheckCircle2/>,'Stock disponible',String(availableStock),'Prêt à distribuer','green')}</div><section className="panel table-panel"><div className="panel-head"><div><h3>Répartition mensuelle des tickets reçus</h3><p>Part de chaque mois dans le volume total réceptionné ({receivedStock.toLocaleString('fr-FR')} tickets)</p></div></div>{table(['MOIS','QUANTITÉ REÇUE','PART DU TOTAL','RÉPARTITION'],monthlyReceipts.map(x=><tr key={x.month}><td>{new Intl.DateTimeFormat('fr-FR',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(x.month+'-01T00:00:00Z'))}</td><td><b>{x.quantity.toLocaleString('fr-FR')}</b></td><td><span className="rate-pill">{x.percentage.toFixed(2).replace('.',',')} %</span></td><td><div style={{height:8,minWidth:100,background:'#e8eef5',borderRadius:99,overflow:'hidden'}}><div style={{height:'100%',width:x.percentage+'%',background:'#0875cf',borderRadius:99}}/></div></td></tr>),'Aucune réception enregistrée.')}</section><section className="panel table-panel"><div className="panel-head"><div><h3>Historique des réceptions</h3><p>Entrées de tickets par fournisseur</p></div></div>{table(['DATE','RÉFÉRENCE','FOURNISSEUR','QUANTITÉ REÇUE','COÛT UNITAIRE','VALEUR','DOCUMENT'],receipts.map(x=><tr key={x.id}><td>{x.date}</td><td>{x.reference}</td><td>{suppliers.find(s=>s.id===x.supplierId)?.name||'Fournisseur supprimé'}</td><td>{x.quantity.toLocaleString('fr-FR')}</td><td>{money(x.unitCost)}</td><td>{money(x.quantity*x.unitCost)}</td><td><button className="row-action" onClick={()=>printReceipt(x.id)}>Imprimer le bon</button></td></tr>),'Aucune réception enregistrée. Enregistrez d’abord une réception fournisseur.')}</section></>}
 {tab==='distributions'&&<>{pageIntro('MOUVEMENTS DE STOCK','Distributions de tickets','Enregistrez chaque remise de tickets à un vendeur et consultez l’historique.',()=>openOperation('distributions'),'Nouvelle distribution')}<div className="stats-grid">{stat(<Package/>,'Stock disponible',String(availableStock),'Tickets reçus moins distribués','green')}{stat(<Package/>,'Quantité distribuée',String(totals.distributed),'Distributions validées','blue')}{stat(<Users/>,'Vendeurs servis',String(new Set(distributions.map(x=>x.sellerId)).size),'Sur la période','orange')}{stat(<CircleDollarSign/>,'Valeur distribuée',money(distributions.filter(x=>x.status==='Validée').reduce((a,x)=>a+x.quantity*x.price,0)),'Prix de référence','green')}{stat(<FileText/>,'Bons enregistrés',String(distributions.length),'Historique enregistré localement','purple')}</div><section className="panel table-panel"><div className="panel-head"><div><h3>Historique des distributions</h3><p>Chaque ligne représente un bon de distribution</p></div></div>{table(['DATE','RÉFÉRENCE','FOURNISSEUR','RECEVEUR','QUANTITÉ','PRIX UNITAIRE','VALEUR','STATUT'],distributions.map(x=><tr key={x.id}><td>{x.date}</td><td>{x.id.slice(0,8).toUpperCase()}</td><td>{suppliers.find(s=>s.id===x.supplierId)?.name||'Fournisseur supprimé'}</td><td>{sellerName(x.sellerId)}</td><td>{x.quantity}</td><td>{money(x.price)}</td><td>{money(x.quantity*x.price)}</td><td><span className="status-ok">{x.status}</span></td></tr>),'Aucune distribution enregistrée.')}</section></>}
 {tab==='sales'&&<>{pageIntro('ENCAISSEMENTS COMMERCIAUX','Déclarations des ventes','Déclarez les tickets vendus. Le système contrôle le stock disponible et calcule le chiffre d’affaires.',()=>openOperation('sales'),'Déclarer des ventes')}<div className="stats-grid">{stat(<Ticket/>,'Tickets vendus',String(totals.sold),'Ventes validées','blue')}{stat(<Package/>,'Tickets invendus',String(Math.max(0,totals.distributed-totals.sold)),'Stock des vendeurs','orange')}{stat(<ChartNoAxesCombined/>,'Chiffre d’affaires',money(totals.revenue),'Ventes validées','green')}{stat(<Wallet/>,'Commissions',money(totals.commission),'Selon taux vendeur','purple')}</div><section className="panel table-panel"><div className="panel-head"><div><h3>Historique des ventes</h3><p>Déclarations validées</p></div></div>{table(['DATE','RÉFÉRENCE','FOURNISSEUR','RECEVEUR','QUANTITÉ','PRIX UNITAIRE','CHIFFRE D’AFFAIRES','COMMISSION VENDEUR'],sales.map(x=><tr key={x.id}><td>{x.date}</td><td>{x.id.slice(0,8).toUpperCase()}</td><td>{suppliers.find(s=>s.id===x.supplierId)?.name||'Fournisseur supprimé'}</td><td>{sellerName(x.sellerId)}</td><td>{x.quantity}</td><td>{money(x.price)}</td><td>{money(x.quantity*x.price)}</td><td>{money(x.quantity*x.price*(sellers.find(s=>s.id===x.sellerId)?.rate||0)/100)}</td></tr>),'Aucune vente déclarée.')}</section></>}
 {tab==='commissions'&&<>{pageIntro('RÉMUNÉRATION','Commissions mensuelles','La commission est calculée chaque mois sur la valeur totale des tickets effectivement vendus : quantité vendue × prix unitaire × taux du vendeur.')}<section className="panel" style={{padding:18,marginBottom:18}}><label style={{display:'block',fontWeight:600,marginBottom:8}}>Mois de calcul</label><input type="month" value={period} onChange={e=>setPeriod(e.target.value)} style={{maxWidth:240}}/><p className="muted" style={{marginTop:8}}>Seules les ventes validées du mois sélectionné sont prises en compte. Les taux fournisseur–receveur peuvent être définis ou modifiés à tout moment.</p></section><div className="stats-grid">{stat(<Wallet/>,'Commissions du mois',money(monthlyCommission),'Taux individuel appliqué','purple')}{stat(<Ticket/>,'Tickets vendus',String(monthlyTicketCount),'Total des ventes validées','blue')}{stat(<ChartNoAxesCombined/>,'Chiffre d’affaires',money(monthlyRevenue),'Base de calcul du mois','green')}{stat(<CircleDollarSign/>,'Net à reverser',money(monthlyRevenue-monthlyCommission),'Après commissions','orange')}</div><section className="panel table-panel"><div className="panel-head"><div><h3>Détail mensuel par vendeur</h3><p>Commission = chiffre d’affaires mensuel × taux individuel</p></div></div>{table(['VENDEUR','TAUX','TICKETS VENDUS','CHIFFRE D’AFFAIRES','COMMISSION','NET À REVERSER'],sellers.map(s=>{const rows=monthlySales.filter(x=>x.sellerId===s.id),qty=rows.reduce((a,x)=>a+x.quantity,0),rev=rows.reduce((a,x)=>a+x.quantity*x.price,0),com=rev*s.rate/100;return <tr key={s.id}><td>{s.name}</td><td>{s.rate}%</td><td>{qty.toLocaleString('fr-FR')}</td><td>{money(rev)}</td><td>{money(com)}</td><td>{money(rev-com)}</td></tr>}), 'Aucune vente validée pour ce mois.')}</section><section className="panel table-panel"><div className="panel-head"><div><h3>Partage mensuel fournisseur – receveur</h3><p>Base : tickets vendus × prix unitaire. Le taux reste à définir tant qu’il n’est pas renseigné.</p></div></div>{table(['FOURNISSEUR','RECEVEUR','TICKETS VENDUS','CHIFFRE D’AFFAIRES','TAUX (%)','COMMISSION','PART RESTANTE'],monthlySupplierPairs.map(x=><tr key={x.key}><td>{suppliers.find(s=>s.id===x.supplierId)?.name||'Fournisseur supprimé'}</td><td>{sellerName(x.sellerId)}</td><td>{x.quantity.toLocaleString('fr-FR')}</td><td>{money(x.revenue)}</td><td><input aria-label="Taux de commission fournisseur receveur" type="number" min="0" max="100" step="0.01" placeholder="À définir" value={pairRates[x.key]??''} onChange={e=>setPairRates(p=>({...p,[x.key]:e.target.value}))} onBlur={async e=>{const rate=Number(e.currentTarget.value);if(e.currentTarget.value.trim()===""||!Number.isFinite(rate)||rate<0||rate>100){notify("Saisissez un taux compris entre 0 et 100 %.");return}try{await dataApi("commissions","POST",{supplierId:x.supplierId,sellerId:x.sellerId,rate,validFrom:today()});notify("Taux fournisseur–receveur enregistré dans Neon.")}catch(err){notify(err instanceof Error?err.message:"Enregistrement du taux impossible")}}} style={{width:100}}/></td><td>{x.commission===null?'À calculer':money(x.commission)}</td><td>{x.net===null?'À calculer':money(x.net)}</td></tr>),'Aucune vente fournisseur–receveur pour ce mois.')}</section></>}
 {tab==='remittances'&&<>{pageIntro('SUIVI DE TRÉSORERIE','Reversements','Enregistrez les sommes reçues et suivez le solde restant dû par vendeur.',()=>openOperation('remittances'),'Nouveau reversement')}<div className="stats-grid">{stat(<CircleDollarSign/>,'Montant reversé',money(totals.remitted),'Paiements enregistrés','green')}{stat(<Wallet/>,'Solde à recouvrer',money(totals.balance),'Après commissions','orange')}{stat(<Users/>,'Vendeurs débiteurs',String(sellers.filter(s=>sellerBalance(s.id)>0).length),'Solde positif','blue')}{stat(<FileText/>,'Opérations',String(remittances.length),'Reversements enregistrés','purple')}</div><section className="panel table-panel"><div className="panel-head"><div><h3>Historique des reversements</h3><p>Traçabilité des remises de fonds</p></div></div>{table(['DATE','RÉFÉRENCE','VENDEUR','MODE DE PAIEMENT','MONTANT','SOLDE RESTANT'],remittances.map(x=><tr key={x.id}><td>{x.date}</td><td>{x.reference||x.id.slice(0,8).toUpperCase()}</td><td>{sellerName(x.sellerId)}</td><td>{x.method}</td><td>{money(x.amount)}</td><td>{money(sellerBalance(x.sellerId))}</td></tr>),'Aucun reversement enregistré.')}</section></>}
 {tab==='reports'&&<>{pageIntro('PILOTAGE & ANALYSE','Rapports et états','Consultez les indicateurs de gestion et exportez les opérations de la session.',exportCsv,'Exporter en CSV')}<div className="stats-grid">{stat(<Package/>,'Distributions',String(distributions.length),'Bons enregistrés','blue')}{stat(<Ticket/>,'Ventes',String(sales.length),'Déclarations enregistrées','green')}{stat(<Wallet/>,'Commissions',money(totals.commission),'Calcul automatique','purple')}{stat(<CircleDollarSign/>,'Reversements',money(totals.remitted),'Montants reçus','orange')}</div><section className="panel"><div className="panel-head"><div><h3>Synthèse de l’activité</h3><p>Les montants reflètent uniquement les données saisies dans cette session.</p></div><button className="btn-outline" onClick={exportCsv}><Download size={15}/> Exporter CSV</button></div><div className="metric-list"><div><span>Valeur des ventes</span><b>{money(totals.revenue)}</b></div><div><span>Commissions acquises</span><b>{money(totals.commission)}</b></div><div><span>Net à reverser</span><b>{money(totals.revenue-totals.commission)}</b></div><div><span>Reste à reverser</span><b>{money(totals.balance)}</b></div></div></section></>}
 {tab==='settings'&&<>{pageIntro('CONFIGURATION','Paramètres de gestion','Configurez l’identité de l’application, les références commerciales et les commissions par couple fournisseur–receveur.')}<section className="panel settings-card app-configuration-card"><h3><Settings size={17}/> Configuration de l’application</h3><div className="settings-fields-grid"><label>Nom de l’application<input value={appName} disabled={!canManageSettings} onChange={e=>setAppName(e.target.value)} placeholder="Ticket Manager"/></label><label>Organisation / entreprise<input value={organizationName} disabled={!canManageSettings} onChange={e=>setOrganizationName(e.target.value)} placeholder="Nom de votre structure"/></label><label>E-mail de support<input type="email" value={supportEmail} disabled={!canManageSettings} onChange={e=>setSupportEmail(e.target.value)} placeholder="support@exemple.com"/></label><label>Téléphone de support<input value={supportPhone} disabled={!canManageSettings} onChange={e=>setSupportPhone(e.target.value)} placeholder="Téléphone de contact"/></label><label>Fuseau horaire<select value={appTimezone} disabled={!canManageSettings} onChange={e=>setAppTimezone(e.target.value)}><option value="Africa/Conakry">Afrique / Conakry</option><option value="Africa/Dakar">Afrique / Dakar</option><option value="UTC">UTC</option></select></label><label>Devise principale<input value="GNF — Franc guinéen" disabled/></label><label>Langue de l’interface<input value="Français" disabled/></label><label>Stockage des données<input value="Neon PostgreSQL — en ligne" disabled/></label></div><p>La devise et la langue restent fixées sur GNF et français dans cette version afin de garantir la cohérence des montants et des libellés.</p></section><div className="settings-grid"><section className="panel settings-card"><h3><Ticket size={17}/> Tarification des tickets</h3><label>Nom du type de ticket<input value={ticketName} disabled={!canManageSettings} onChange={e=>setTicketName(e.target.value)} placeholder="Ex. Ticket standard" /></label><label>Prix unitaire de référence (GNF)<input type="number" min="0" step="1" value={ticketPrice} disabled={!canManageSettings} onChange={e=>setTicketPrice(e.target.value)} /></label><p>Ce tarif est prérempli dans les nouveaux formulaires de distribution et de vente. Les opérations déjà enregistrées conservent leur prix historique.</p></section><section className="panel settings-card"><h3><Wallet size={17}/> Règles de commission</h3><label>Taux de commission par défaut (%)<input type="number" min="0" max="100" step="0.01" value={defaultRate} disabled={!canManageSettings} onChange={e=>setDefaultRate(e.target.value)}/></label><p>Ce taux est proposé automatiquement lors de la création d’un nouveau vendeur. Les taux individuels existants ne sont pas écrasés.</p></section><section className="panel settings-card"><h3><Settings size={17}/> Paramètres généraux</h3><div className="metric-list"><div><span>Devise de gestion</span><b>GNF — Franc guinéen</b></div><div><span>Règle de validation</span><b>Contrôle serveur à l’enregistrement</b></div><div><span>Gestion du stock</span><b>Contrôle obligatoire avant vente</b></div><div><span>Mode de fonctionnement</span><b>En ligne uniquement — Neon</b></div><div><span>Historique</span><b>Les opérations existantes sont préservées</b></div></div><p>Ces règles sont appliquées par le serveur et ne peuvent pas être désactivées depuis l’interface.</p></section></div><section className="panel settings-card supplier-receiver-settings"><div className="panel-head"><div><h3><Wallet size={17}/> Commission fournisseur–receveur</h3><p>Définissez un taux distinct pour chaque fournisseur et chaque vendeur. Le taux est figé sur chaque vente à sa date d’enregistrement.</p></div></div><label className="commission-effective-date">Date d’effet des nouveaux taux<input type="date" value={commissionEffectiveDate} disabled={!canManageSettings} onChange={e=>setCommissionEffectiveDate(e.target.value)}/></label>{table(['FOURNISSEUR','RECEVEUR / VENDEUR','TAUX (%)','ACTION'],suppliers.filter(s=>s.active).flatMap(s=>activeSellers.map(v=>{const key=s.id+'|'+v.id;return <tr key={key}><td>{s.name}</td><td>{v.name}</td><td><input aria-label={'Taux '+s.name+' - '+v.name} type="number" min="0" max="100" step="0.01" placeholder="À définir" value={pairRates[key]??''} disabled={!canManageSettings} onChange={e=>setPairRates(p=>({...p,[key]:e.target.value}))} style={{width:110}}/></td><td>{canManageSettings?<button className="btn-outline" disabled={commissionSaving===key} onClick={()=>void saveSupplierReceiverRate(s.id,v.id)}>{commissionSaving===key?'Enregistrement…':'Enregistrer'}</button>:<span className="muted">Lecture seule</span>}</td></tr>})),'Ajoutez un fournisseur et un vendeur actifs pour configurer leur taux.')}<p>Un taux s’applique aux ventes dont la date est comprise dans sa période de validité. Les ventes antérieures ne sont pas recalculées.</p></section><section className="panel settings-save-panel"><div><b>Enregistrer la configuration de l’application</b><p>Identité, coordonnées de support et fuseau horaire conservés dans Neon.</p></div>{canManageSettings?<button className="btn-primary" onClick={()=>void saveSettings()} disabled={settingsSaving}>{settingsSaving?'Enregistrement…':'Enregistrer la configuration'}</button>:<span className="muted">Modification réservée aux administrateurs autorisés.</span>}</section></>}
 <footer>© 2026 {appName} <span>{organizationName||'Gestion des tickets physiques & commissions'}</span></footer></div></main>
 {modal&&<div className="modal-backdrop"><form className="modal" onInvalid={(e)=>{const field=e.target as HTMLInputElement;notify(field.validationMessage||"Veuillez vérifier les champs obligatoires.");}} onSubmit={(e)=>{notify("Formulaire validé — préparation de l’enregistrement…");(modal==='sellers'?saveSeller:modal==='suppliers'?saveSupplier:saveOperation)(e);}}><div className="modal-head"><div><h3>{modal==='sellers'?(editing?'Modifier le vendeur':'Ajouter un vendeur'):modal==='suppliers'?(editing?'Modifier le fournisseur':'Ajouter un fournisseur'):modal==='receipts'?'Réception de tickets fournisseur':modal==='distributions'?'Nouvelle distribution':modal==='sales'?'Déclarer les ventes':'Enregistrer un reversement'}</h3><p>Les données doivent être enregistrées exclusivement dans Neon.</p></div><button type="button" className="icon-btn" onClick={()=>setModal(null)}><X/></button></div>{modal==='receipts'?<><label>Fournisseur<select required value={opForm.supplierId} onChange={e=>setOpForm({...opForm,supplierId:e.target.value})}><option value="">Sélectionner un fournisseur</option>{suppliers.filter(s=>s.active).map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label><label>Date de réception<input type="date" required value={opForm.date} onChange={e=>setOpForm({...opForm,date:e.target.value})}/></label><label>Quantité reçue (tickets)<input type="number" min="1" required value={opForm.quantity} onChange={e=>setOpForm({...opForm,quantity:e.target.value})}/></label><label>Coût d’achat unitaire (GNF)<input type="number" min="0" required value={opForm.unitCost} onChange={e=>setOpForm({...opForm,unitCost:e.target.value})}/></label><label>Référence du bon / facture fournisseur<input value={opForm.reference} onChange={e=>setOpForm({...opForm,reference:e.target.value})} placeholder="Référence du document fournisseur"/></label></>:modal==='suppliers'?<><label>Raison sociale / Nom du fournisseur<input required value={supplierForm.name} onChange={e=>setSupplierForm({...supplierForm,name:e.target.value})} placeholder="Nom du fournisseur"/></label><label>Nom du contact<input value={supplierForm.contact} onChange={e=>setSupplierForm({...supplierForm,contact:e.target.value})} placeholder="Personne à contacter"/></label><label>Téléphone<input value={supplierForm.phone} onChange={e=>setSupplierForm({...supplierForm,phone:e.target.value})} placeholder="Téléphone"/></label><label>E-mail<input type="email" value={supplierForm.email} onChange={e=>setSupplierForm({...supplierForm,email:e.target.value})} placeholder="Adresse e-mail"/></label><label>Adresse<input value={supplierForm.address} onChange={e=>setSupplierForm({...supplierForm,address:e.target.value})} placeholder="Adresse du fournisseur"/></label><label>NIF / RCCM<input value={supplierForm.taxId} onChange={e=>setSupplierForm({...supplierForm,taxId:e.target.value})} placeholder="Identifiant fiscal ou RCCM"/></label></>:modal==='sellers'?<><label>Nom complet<input required value={sellerForm.name} onChange={e=>setSellerForm({...sellerForm,name:e.target.value})} placeholder="Nom et prénom"/></label><label>Téléphone<input value={sellerForm.phone} onChange={e=>setSellerForm({...sellerForm,phone:e.target.value})} placeholder="6XX XX XX XX"/></label><label>Taux de commission (%)<input required type="number" min="0" max="100" step=".01" value={sellerForm.rate} onChange={e=>setSellerForm({...sellerForm,rate:e.target.value})}/></label></>:<><label>Vendeur<select required value={opForm.sellerId} onChange={e=>setOpForm({...opForm,sellerId:e.target.value})}><option value="">Sélectionner un vendeur</option>{activeSellers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></label>{(modal==='distributions'||modal==='sales')&&<label>Fournisseur d’origine<select required value={opForm.supplierId} onChange={e=>setOpForm({...opForm,supplierId:e.target.value})}><option value="">Sélectionner un fournisseur</option>{suppliers.filter(s=>s.active&&(modal==='distributions'?supplierStock(s.id)>0:sellerSupplierStock(opForm.sellerId,s.id)>0)).map(s=><option key={s.id} value={s.id}>{s.name} — {modal==='distributions'?supplierStock(s.id):sellerSupplierStock(opForm.sellerId,s.id)} ticket(s) disponible(s)</option>)}</select></label>}<label>Date<input type="date" required value={opForm.date} onChange={e=>setOpForm({...opForm,date:e.target.value})}/></label><label>{modal==='remittances'?'Montant reçu (GNF)':'Quantité de tickets'}<input type="number" min="1" required value={opForm.quantity} onChange={e=>setOpForm({...opForm,quantity:e.target.value})}/></label>{modal!=='remittances'&&<label>Prix unitaire (GNF)<input type="number" min="0" required value={opForm.price} onChange={e=>setOpForm({...opForm,price:e.target.value})}/></label>}{modal==='remittances'&&<><label>Mode de paiement<select value={opForm.method} onChange={e=>setOpForm({...opForm,method:e.target.value})}><option>Espèces</option><option>Virement bancaire</option><option>Mobile Money</option><option>Autre</option></select></label><label>Référence de transaction<input value={opForm.reference} onChange={e=>setOpForm({...opForm,reference:e.target.value})}/></label></>}</>}<div className="modal-actions"><button type="button" className="btn-outline" onClick={()=>setModal(null)}>Annuler</button><button type="submit" className="btn-primary" disabled={saving||(modal==='receipts'&&suppliers.filter(s=>s.active).length===0)||(modal==='distributions'&&(activeSellers.length===0||availableStock===0||suppliers.every(s=>!s.active||supplierStock(s.id)<=0)))||((modal==='sales'||modal==='remittances')&&activeSellers.length===0)}>{saving?'Enregistrement…':'Enregistrer'}</button></div></form></div>}
 </div>
}
export default function App() {
  const session = authClient.useSession()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState<'signin'|'signup'>('signin')
  const [fullName, setFullName] = useState('')
  const [success, setSuccess] = useState('')
  const [verificationPending, setVerificationPending] = useState(false)
  const [otp, setOtp] = useState('')
  const [otpBusy, setOtpBusy] = useState(false)
 const [resetPassword,setResetPassword]=useState('')
 const [resetPasswordConfirm,setResetPasswordConfirm]=useState('')
 const [resetBusy,setResetBusy]=useState(false)
 const resetToken=new URLSearchParams(window.location.search).get('token')

  if (resetToken) {
    async function submitReset(e:React.FormEvent<HTMLFormElement>){
      e.preventDefault();setError('');setSuccess('')
      if(resetPassword.length<8){setError('Le mot de passe doit contenir au moins 8 caractères.');return}
      if(resetPassword!==resetPasswordConfirm){setError('Les deux mots de passe ne correspondent pas.');return}
      setResetBusy(true)
      try{
        const result=await (authClient as any).resetPassword({newPassword:resetPassword,token:resetToken})
        if(result?.error)throw new Error(result.error.message||'Le lien est invalide ou expiré.')
        window.history.replaceState({},'',window.location.pathname)
        setPassword('');setResetPassword('');setResetPasswordConfirm('')
        setSuccess('Mot de passe réinitialisé. Vous pouvez maintenant vous connecter.')
      }catch(e){setError(e instanceof Error?e.message:'Réinitialisation impossible. Demandez un nouveau lien.')}
      finally{setResetBusy(false)}
    }
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'linear-gradient(135deg,#071a36,#0b3970)',fontFamily:'Inter,Arial,sans-serif'}}>
      <form onSubmit={submitReset} style={{width:'100%',maxWidth:440,boxSizing:'border-box',padding:32,background:'#fff',borderRadius:20,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
        <div style={{width:48,height:48,borderRadius:14,display:'grid',placeItems:'center',background:'#0057b9',color:'#fff',fontSize:24,fontWeight:800}}>T</div>
        <h1 style={{color:'#071a36'}}>Nouveau mot de passe</h1>
        <p style={{color:'#64748b'}}>Choisissez un nouveau mot de passe pour votre compte Ticket Manager.</p>
        <label style={{display:'block',fontWeight:600,color:'#243247',marginTop:18}}>Nouveau mot de passe<input type="password" required minLength={8} autoComplete="new-password" value={resetPassword} onChange={e=>setResetPassword(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box',padding:12,marginTop:7,border:'1px solid #d7dfeb',borderRadius:9}}/></label>
        <label style={{display:'block',fontWeight:600,color:'#243247',marginTop:14}}>Confirmer le mot de passe<input type="password" required minLength={8} autoComplete="new-password" value={resetPasswordConfirm} onChange={e=>setResetPasswordConfirm(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box',padding:12,marginTop:7,border:'1px solid #d7dfeb',borderRadius:9}}/></label>
        {error&&<p role="alert" style={{color:'#b42318',fontSize:13}}>{error}</p>}
        {success&&<p role="status" style={{color:'#067647',fontSize:13}}>{success}</p>}
        <button disabled={resetBusy} style={{width:'100%',marginTop:18,padding:13,border:0,borderRadius:9,background:'#0057b9',color:'#fff',fontWeight:700}}>{resetBusy?'Mise à jour…':'Enregistrer le nouveau mot de passe'}</button>
      </form>
    </main>
  }

  if (!isNeonAuthConfigured) {
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'#f4f7fb',fontFamily:'Inter,Arial,sans-serif'}}>
      <section style={{maxWidth:520,padding:32,background:'#fff',borderRadius:18,boxShadow:'0 12px 40px rgba(10,30,60,.08)'}}>
        <h1 style={{marginTop:0}}>Configuration de Ticket Manager</h1>
        <p>Neon Auth n’est pas encore configuré dans les variables Vercel.</p>
        <p>Ajoutez <code>VITE_NEON_AUTH_URL</code> dans les environnements Production et Preview, puis relancez le déploiement.</p>
      </section>
    </main>
  }

  if (session.isPending) {
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',fontFamily:'Inter,Arial,sans-serif'}}>Vérification de votre session sécurisée…</main>
  }

  if (verificationPending) {
    async function verifyCode(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault()
      setError('')
      setOtpBusy(true)
      try {
        const client = authClient as any
        const result = await client.emailOtp.verifyEmail({ email, otp: otp.trim() })
        if (result?.error) throw new Error(result.error.message || 'Code incorrect ou expiré.')
        setVerificationPending(false)
        setPassword('')
        setSuccess('Adresse e-mail vérifiée. Vous pouvez maintenant accéder à votre espace.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Vérification impossible. Vérifiez le code reçu.')
      } finally {
        setOtpBusy(false)
      }
    }
    async function resendCode() {
      setError('')
      setSuccess('')
      setOtpBusy(true)
      try {
        const client = authClient as any
        const result = await client.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })
        if (result?.error) throw new Error(result.error.message || 'Impossible de renvoyer le code.')
        setSuccess('Un nouveau code de vérification vient d’être demandé.')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Impossible de renvoyer le code.')
      } finally {
        setOtpBusy(false)
      }
    }
    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'linear-gradient(135deg,#071a36,#0b3970)',fontFamily:'Inter,Arial,sans-serif'}}>
      <form onSubmit={verifyCode} style={{width:'100%',maxWidth:460,boxSizing:'border-box',padding:36,background:'#fff',borderRadius:20,boxShadow:'0 20px 60px rgba(0,0,0,.2)',textAlign:'center'}}>
        <div style={{width:64,height:64,borderRadius:20,display:'grid',placeItems:'center',margin:'0 auto 18px',background:'#e8f1ff',color:'#0057b9',fontSize:30}}>✉</div>
        <h1 style={{marginBottom:10,color:'#071a36'}}>Saisissez votre code</h1>
        <p style={{color:'#475569',lineHeight:1.65}}>Un code de vérification a été envoyé à <strong>{email}</strong>. Consultez également vos courriers indésirables.</p>
        <label style={{display:'block',textAlign:'left',fontWeight:600,color:'#243247',marginTop:22}}>Code de vérification
          <input required inputMode="numeric" autoComplete="one-time-code" maxLength={8} value={otp} onChange={e=>setOtp(e.target.value.replace(/\D/g,''))} placeholder="Entrez le code reçu" style={{display:'block',width:'100%',boxSizing:'border-box',padding:15,marginTop:8,border:'1px solid #cbd5e1',borderRadius:9,fontSize:22,letterSpacing:6,textAlign:'center'}}/>
        </label>
        {error && <p role="alert" style={{color:'#b42318',fontSize:13}}>{error}</p>}
        {success && <p role="status" style={{color:'#067647',fontSize:13}}>{success}</p>}
        <button disabled={otpBusy || !otp.trim()} style={{width:'100%',marginTop:18,padding:13,border:0,borderRadius:9,background:'#0057b9',color:'#fff',fontWeight:700,cursor:otpBusy?'wait':'pointer'}}>{otpBusy?'Vérification…':'Vérifier le code'}</button>
        <button type="button" disabled={otpBusy} onClick={()=>void resendCode()} style={{width:'100%',marginTop:12,padding:10,border:0,background:'transparent',color:'#0057b9',fontWeight:600,cursor:'pointer'}}>Renvoyer le code</button>
        <button type="button" onClick={()=>{setVerificationPending(false);setMode('signin');setOtp('');setPassword('');setError('');setSuccess('')}} style={{width:'100%',padding:10,border:0,background:'transparent',color:'#64748b',cursor:'pointer'}}>Retour à la connexion</button>
      </form>
    </main>
  }

  if (!session.data) {
    async function submit(e: React.FormEvent<HTMLFormElement>) {
      e.preventDefault()
      setError('')
      setSuccess('')
      setBusy(true)
      try {
        if (mode === 'signup') {
          const result = await authClient.signUp.email({ email, password, name: fullName })
          if (result.error) throw new Error(result.error.message || 'Création du compte impossible.')
          setOtp('')
          setVerificationPending(true)
        } else {
          const result = await authClient.signIn.email({ email, password })
          if (result.error) {
            const message = result.error.message || 'Connexion impossible. Vérifiez vos identifiants.'
            if (/email.*(not|isn.t)\s*verified|email.*verification/i.test(message)) {
              const client = authClient as any
              const sent = await client.emailOtp.sendVerificationOtp({ email, type: 'email-verification' })
              if (sent?.error) throw new Error(sent.error.message || message)
              setOtp('')
              setVerificationPending(true)
              return
            }
            throw new Error(message)
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Opération impossible. Vérifiez les informations saisies.')
      } finally {
        setBusy(false)
      }
    }

    return <main style={{minHeight:'100vh',display:'grid',placeItems:'center',padding:24,background:'linear-gradient(135deg,#071a36,#0b3970)',fontFamily:'Inter,Arial,sans-serif'}}>
      <form onSubmit={submit} style={{width:'100%',maxWidth:420,boxSizing:'border-box',padding:32,background:'#fff',borderRadius:20,boxShadow:'0 20px 60px rgba(0,0,0,.2)'}}>
        <div style={{width:48,height:48,borderRadius:14,display:'grid',placeItems:'center',background:'#0057b9',color:'#fff',fontSize:24,fontWeight:800}}>T</div>
        <h1 style={{marginBottom:6,color:'#071a36'}}>Ticket Manager</h1>
        <p style={{marginTop:0,marginBottom:24,color:'#64748b'}}>{mode === 'signup' ? 'Créez votre compte d’accès.' : 'Connectez-vous à votre espace de gestion.'}</p>
        {mode === 'signup' && <label style={{display:'block',fontWeight:600,marginBottom:14,color:'#243247'}}>Nom complet<input required value={fullName} onChange={e=>setFullName(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box',padding:12,marginTop:7,border:'1px solid #d7dfeb',borderRadius:9}}/></label>}
        <label style={{display:'block',fontWeight:600,marginBottom:14,color:'#243247'}}>Adresse e-mail
          <input type="email" required autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box',padding:12,marginTop:7,border:'1px solid #d7dfeb',borderRadius:9}}/>
        </label>
        <label style={{display:'block',fontWeight:600,marginBottom:16,color:'#243247'}}>Mot de passe
          <input type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e=>setPassword(e.target.value)} style={{display:'block',width:'100%',boxSizing:'border-box',padding:12,marginTop:7,border:'1px solid #d7dfeb',borderRadius:9}}/>
        </label>
        {error && <p role="alert" style={{color:'#b42318',fontSize:13}}>{error}</p>}
        {success && <p role="status" style={{color:'#067647',fontSize:13}}>{success}</p>}
        <button disabled={busy} style={{width:'100%',padding:13,border:0,borderRadius:9,background:'#0057b9',color:'#fff',fontWeight:700,cursor:busy?'wait':'pointer'}}>{busy?(mode === 'signup'?'Création…':'Connexion…'):(mode === 'signup'?'Créer mon compte':'Se connecter')}</button>
        <button type="button" onClick={()=>{setMode(mode === 'signin'?'signup':'signin');setError('');setSuccess('')}} style={{width:'100%',marginTop:12,padding:10,border:0,background:'transparent',color:'#0057b9',fontWeight:600,cursor:'pointer'}}>{mode === 'signin'?'Créer un nouveau compte':'J’ai déjà un compte'}</button>
        <p style={{marginBottom:0,marginTop:8,fontSize:12,color:'#64748b'}}>Authentification sécurisée par Neon Auth.</p>
      </form>
    </main>
  }

  return <Dashboard />
}
