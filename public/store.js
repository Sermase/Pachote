/* Pachote · capa de datos. Vive en el Firebase de Listopic (misma cuenta, mismo chat).
   Firestore:
     pachoteUsers/{uid}                    { groups: { gid: { joined } }, profile: { name, photo } } → mis grupos y mi perfil
     pachoteGroups/{gid}                   núcleo del plan (gente, familias, opciones) + owner + inviteToken
                                           + chatId (chat de Listopic enlazado) + summary (saldos para ese chat)
     pachoteGroups/{gid}/movs/{mid}        un documento por movimiento (así dos personas pueden apuntar a la vez)
     pachoteGroups/{gid}/access/{uid}      dispositivos con acceso { role, memberId, token, joined, label }
     pachoteGroups/{gid}/log/{id}          historial de cambios { at, uid, who, act, txt, snap? } (no se edita ni se borra)
     chats/{chatId}/messages               el chat del grupo de Listopic enlazado (solo con cuenta de Listopic)
   Con ?mock en la URL usa un almacén simulado en este navegador (para probar sin Firebase). */
const FB='https://www.gstatic.com/firebasejs/10.12.2/';
const clean=o=>JSON.parse(JSON.stringify(o));
const rid=(n=20)=>{const a='abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';const r=crypto.getRandomValues(new Uint8Array(n));return [...r].map(x=>a[x%a.length]).join('')};
const CORE_SKIP=new Set(['expenses','_me','_role','_v','_log','id']);
const coreOf=p=>{const o={};for(const k in p)if(!CORE_SKIP.has(k))o[k]=p[k];return clean(o)};
/* Solo las claves de la ficha del grupo que han cambiado (sin contar «updated»), para no pisar cambios de otros. */
const changedKeys=(c1,c0)=>{const ks=new Set([...Object.keys(c1||{}),...Object.keys(c0||{})]);return [...ks].filter(k=>!['updated','owner','inviteToken','_v','summary','chatId','migratedAt'].includes(k)&&JSON.stringify(c1[k])!==JSON.stringify((c0||{})[k]))};

/* ---------- Firebase ---------- */
async function firebaseStore(){
  const {firebaseConfig,legacyConfig}=await import('./firebase-config.js');
  if(!firebaseConfig||String(firebaseConfig.apiKey).includes('PEGA_AQUI'))throw new Error('config');
  const {initializeApp}=await import(FB+'firebase-app.js');
  const A=await import(FB+'firebase-auth.js');
  const F=await import(FB+'firebase-firestore.js');
  /* Pruebas de extremo a extremo: emuladores de Listopic (solo si la página lo pide antes de cargar). */
  const emu=window.PACHOTE_EMU===true;
  /* Con nombre propio: el nombre por defecto se lo queda el Firebase antiguo, para recuperar la sesión de este dispositivo y mudar sus grupos. */
  const app=initializeApp(emu?{...firebaseConfig,projectId:'demo-listopic'}:firebaseConfig,'listopic');
  let FNS=null;const callable=async name=>{if(!FNS){const FN=await import(FB+'firebase-functions.js');const f=FN.getFunctions(app,'europe-west1');if(emu)FN.connectFunctionsEmulator(f,'127.0.0.1',5001);FNS={FN,f}}return FNS.FN.httpsCallable(FNS.f,name)};
  const auth=A.getAuth(app);
  let db;try{db=F.initializeFirestore(app,{localCache:F.persistentLocalCache({tabManager:F.persistentMultipleTabManager()})})}catch(e){db=F.getFirestore(app)}
  if(emu){A.connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});F.connectFirestoreEmulator(db,'127.0.0.1',8080)}
  await A.setPersistence(auth,A.browserLocalPersistence).catch(()=>{});
  let pendingAdopt=null;
  const user=await new Promise(res=>{const un=A.onAuthStateChanged(auth,async u=>{if(u){un();res(u)}else{try{await A.signInAnonymously(auth)}catch(e){un();res(null)}}})});
  if(!user)throw new Error('auth');
  /* Abierto desde Listopic: entra con esa misma cuenta y, si este dispositivo iba sin cuenta, se lleva sus grupos. */
  const hand=window.__handoff;window.__handoff=null;
  if(hand){let to='';try{to=JSON.parse(atob(hand.split('.')[1].replace(/-/g,'+').replace(/_/g,'/'))).uid||''}catch(e){}
    if(to&&to!==auth.currentUser.uid){const prev=auth.currentUser.isAnonymous?await auth.currentUser.getIdToken().catch(()=>null):null;
      try{await A.signInWithCustomToken(auth,hand);if(prev)pendingAdopt=prev}catch(e){console.warn('Listopic',e&&e.code)}}}
  const uid=()=>auth.currentUser.uid;
  const G='pachoteGroups';
  const gref=g=>F.doc(db,G,g),mref=(g,m)=>F.doc(db,G,g,'movs',m),aref=(g,u)=>F.doc(db,G,g,'access',u),uref=u=>F.doc(db,'pachoteUsers',u);
  const subs={};let myGroups={};let rejoinTried=false;let onPlans=()=>{};const plans={};let myProfile=null,onProf=()=>{};
  const emit=()=>onPlans(Object.fromEntries(Object.entries(plans).filter(([,p])=>p&&p._core).map(([g,p])=>[g,{...p._core,id:g,expenses:p._movs?Object.values(p._movs).sort((a,b)=>(a.created||0)-(b.created||0)):[],_me:p._acc||null}])));
  /* Copia local de mis grupos (id + link vigente) para poder recuperarlos si la lista se pierde. */
  const KN='pachote_known';const known=()=>{try{return JSON.parse(localStorage.getItem(KN))||{}}catch(e){return {}}};
  const setKnown=(g,v)=>{try{const k=known();if(v)k[g]={...(k[g]||{}),...v};else delete k[g];localStorage.setItem(KN,JSON.stringify(k))}catch(e){}};
  function watchGroup(g){
    if(subs[g])return;plans[g]={};
    /* Solo se quita un grupo de mi lista si el servidor confirma que ya no existe o que ya no tengo acceso.
       Un error pasajero o una lectura de la caché local nunca borra nada: se reintenta. */
    const drop=()=>{unwatch(g);setKnown(g,null);F.updateDoc(uref(uid()),{['groups.'+g]:F.deleteField()}).catch(()=>{});emit()};
    const retry=e=>{console.warn('grupo',g,e&&e.code);unwatch(g);emit();setTimeout(()=>{if(myGroups[g])watchGroup(g)},15000)};
    subs[g]=[
      F.onSnapshot(gref(g),{includeMetadataChanges:false},s=>{if(!s.exists()){if(!s.metadata.fromCache)drop();return}const d=s.data();plans[g]._core=d;if(d.inviteToken)setKnown(g,{t:d.inviteToken,n:d.name});emit()},retry),
      F.onSnapshot(F.collection(db,G,g,'movs'),s=>{plans[g]._movs=Object.fromEntries(s.docs.map(d=>[d.id,{...d.data(),id:d.id}]));emit()},()=>{}),
      F.onSnapshot(aref(g,uid()),s=>{if(!s.exists()){if(!s.metadata.fromCache)drop();return}plans[g]._acc=s.data();emit()},retry)];
  }
  function unwatch(g){(subs[g]||[]).forEach(u=>u());delete subs[g];delete plans[g]}
  /* Mudanza (una vez por dispositivo): si este navegador tenía sesión en el Firebase antiguo, sus grupos pasan aquí con el mismo papel. */
  const MIG='pachote_mudanza';
  async function migrateLegacy(){
    try{if(emu||!legacyConfig||localStorage.getItem(MIG))return null}catch(e){return null}
    const old=initializeApp(legacyConfig);const oa=A.getAuth(old);
    const ou=await new Promise(res=>{const un=A.onAuthStateChanged(oa,u=>{un();res(u)})});
    if(!ou){try{localStorage.setItem(MIG,'nada')}catch(e){}return null}
    const r=await (await callable('pachoteMigrate'))({oldIdToken:await ou.getIdToken()});
    try{localStorage.setItem(MIG,JSON.stringify({at:Date.now(),...r.data}))}catch(e){}
    return r.data;
  }
  /* Al cambiar a una cuenta: los grupos del usuario de antes pasan a la cuenta (con su papel). Si falla, se vuelve a entrar con los links. */
  async function adoptFrom(prevTok,tokens){
    try{if(prevTok){await (await callable('pachoteAdopt'))({prevIdToken:prevTok});return}}catch(e){console.warn('adopt',e)}
    for(const [g,t] of tokens){try{await api.join(g,t)}catch(x){}}
  }
  const knownTokens=()=>{const kn=known();return [...new Map([...Object.keys(myGroups).map(g=>[g,plans[g]?._core?.inviteToken]),...Object.keys(kn).map(g=>[g,kn[g].t])].filter(x=>x[1])).entries()]};
  const LAST='pachote_last';
  /* Guarda con qué cuenta se entró (email y si fue con Google); al cerrar sesión, marca que se salió. */
  const remember=out=>{const u=auth.currentUser;if(!u||u.isAnonymous||!u.email)return;try{localStorage.setItem(LAST,JSON.stringify({email:u.email,google:u.providerData.some(p=>p.providerId==='google.com'),out:!!out}))}catch(e){}};
  const names={};
  const api={
    kind:'cloud',
    migrate:migrateLegacy,
    user:()=>{const u=auth.currentUser;return u?{uid:u.uid,anon:u.isAnonymous,email:u.email||'',name:u.displayName||''}:null},
    /* Resumen de saldos para el chat de Listopic enlazado (lo calcula index.html con el mismo motor de siempre). */
    putSummary:(g,summary)=>F.updateDoc(gref(g),{summary:clean(summary)}),
    /* Nombre y foto de la gente de Listopic (perfil público). */
    async person(u){if(names[u])return names[u];const s=await F.getDoc(F.doc(db,'publicProfiles',u)).catch(()=>null);const d=s&&s.exists()?s.data():{};
      return names[u]={name:d.displayName||d.username||d.name||'Alguien',photo:d.photoUrl||''}},
    /* Mis chats de Listopic (de grupo o con una persona), para enlazar uno. */
    async myChats(){const s=await F.getDocs(F.query(F.collection(db,'chats'),F.where('participants','array-contains',uid())));
      return s.docs.map(d=>({id:d.id,...d.data()})).filter(c=>c.type==='group'||c.type==='private').sort((a,b)=>((b.updatedAt&&b.updatedAt.toMillis&&b.updatedAt.toMillis())||0)-((a.updatedAt&&a.updatedAt.toMillis&&a.updatedAt.toMillis())||0))},
    async linkChat(g,chat,members){const p=plans[g]?._core;if(!p)throw new Error('grupo');
      await F.updateDoc(gref(g),{chatId:chat.id,members:clean(members),updated:Date.now()});
      await F.updateDoc(F.doc(db,'chats',chat.id),{['pachote.'+g]:clean({name:p.name,emoji:p.emoji||null})});
      const me=(await api.person(uid())).name;
      await F.addDoc(F.collection(db,'chats',chat.id,'messages'),{text:`💸 ${me} ha enlazado las cuentas «${p.name}» de Pachote`,senderId:uid(),createdAt:F.serverTimestamp(),type:'event',event:{kind:'pachote-link',title:p.name},readBy:[uid()]}).catch(()=>{})},
    async unlinkChat(g,chatId){await F.updateDoc(gref(g),{chatId:F.deleteField(),updated:Date.now()});await F.updateDoc(F.doc(db,'chats',chatId),{['pachote.'+g]:F.deleteField()}).catch(()=>{})},
    /* Mis grupos. Si cambia la cuenta (al entrar con Listopic), se vuelve a escuchar con la nueva. */
    watch(cb){onPlans=cb;let un=null,cur=null;
      const start=()=>{if(un)un();Object.keys(subs).forEach(unwatch);myGroups={};rejoinTried=false;cur=uid();un=F.onSnapshot(uref(cur),s=>{myGroups=(s.exists()&&s.data().groups)||{};
      const pr=(s.exists()&&s.data().profile)||null;if(JSON.stringify(pr)!==JSON.stringify(myProfile)){myProfile=pr;onProf(pr)}Object.keys(myGroups).forEach(watchGroup);Object.keys(subs).forEach(g=>{if(!myGroups[g])unwatch(g)});emit();
      /* Recuperación: grupos que este dispositivo conocía y ya no están en la lista → volver a entrar con su link. */
      if(!s.metadata.fromCache&&!rejoinTried){rejoinTried=true;const k=known();Object.keys(k).filter(g=>!myGroups[g]&&k[g].t).forEach(g=>{api.join(g,k[g].t).catch(e=>console.warn('no se pudo recuperar',g,e&&e.code))})}},e=>console.warn('mis grupos',e&&e.code))};
      start();A.onAuthStateChanged(auth,u=>{if(u&&cur&&u.uid!==cur)start()});return ()=>un&&un()},
    async create(p){
      const g=p.id,core=coreOf(p);core.owner=uid();core.inviteToken=rid(24);core.created=core.created||Date.now();
      await F.setDoc(gref(g),core);
      await F.setDoc(aref(g,uid()),{role:'admin',memberId:p._me?.memberId||null,joined:Date.now(),label:navigator.userAgent.slice(0,80)});
      await F.setDoc(uref(uid()),{groups:{[g]:{joined:Date.now()}}},{merge:true});
      if(p._log)for(const l of p._log)await F.addDoc(F.collection(db,G,g,'log'),{...clean(l),uid:uid(),at:F.serverTimestamp()}).catch(()=>{});
      const ex=clean(p.expenses||[]);for(let i=0;i<ex.length;i+=400){const b=F.writeBatch(db);ex.slice(i,i+400).forEach(e=>b.set(mref(g,e.id),e));await b.commit()}
    },
    async save(p,prev,logs){
      const g=p.id;const b=F.writeBatch(db);let n=0;
      /* El historial va en el mismo lote: o se guarda el cambio con su apunte, o nada. */
      (logs||[]).slice(0,40).forEach(l=>{b.set(F.doc(F.collection(db,G,g,'log')),{...clean(l),uid:uid(),at:F.serverTimestamp()})});
      const c1=coreOf(p),c0=prev?coreOf(prev):{};const ck=changedKeys(c1,c0);
      if(ck.length){const up={updated:Date.now()};ck.forEach(k=>up[k]=k in c1?c1[k]:F.deleteField());b.update(gref(g),up);n++}
      const old=Object.fromEntries((prev?.expenses||[]).map(e=>[e.id,JSON.stringify(e)]));const now=new Set();
      for(const e of clean(p.expenses||[])){now.add(e.id);if(old[e.id]!==JSON.stringify(e)){b.set(mref(g,e.id),e);n++}}
      for(const id in old)if(!now.has(id)){b.delete(mref(g,id));n++}
      if(n)await b.commit();
    },
    async remove(g){
      const ms=await F.getDocs(F.collection(db,G,g,'movs'));const as=await F.getDocs(F.collection(db,G,g,'access'));const ls=await F.getDocs(F.collection(db,G,g,'log')).catch(()=>({docs:[]}));
      const refs=[...ms.docs.map(d=>d.ref),...ls.docs.map(d=>d.ref),...as.docs.filter(d=>d.id!==uid()).map(d=>d.ref)];
      for(let i=0;i<refs.length;i+=400){const b=F.writeBatch(db);refs.slice(i,i+400).forEach(r=>b.delete(r));await b.commit()}
      setKnown(g,null);await F.deleteDoc(gref(g));await F.deleteDoc(aref(g,uid())).catch(()=>{});
      await F.updateDoc(uref(uid()),{['groups.'+g]:F.deleteField()}).catch(()=>{});
    },
    async leave(g){setKnown(g,null);await F.deleteDoc(aref(g,uid()));await F.updateDoc(uref(uid()),{['groups.'+g]:F.deleteField()}).catch(()=>{})},
    async join(g,token){
      const ex=await F.getDoc(aref(g,uid())).catch(()=>null);
      if(!ex||!ex.exists())await F.setDoc(aref(g,uid()),{role:'editor',token,memberId:null,joined:Date.now(),label:navigator.userAgent.slice(0,80)});
      await F.setDoc(uref(uid()),{groups:{[g]:{joined:Date.now()}}},{merge:true});
    },
    setMe:(g,memberId)=>F.updateDoc(aref(g,uid()),{memberId}),
    watchLog:(g,cb)=>F.onSnapshot(F.query(F.collection(db,G,g,'log'),F.orderBy('at','desc'),F.limit(300)),s=>cb(s.docs.map(d=>{const x=d.data();return {...x,id:d.id,at:x.at&&x.at.toMillis?x.at.toMillis():Date.now()}})),()=>cb(null)),
    watchAccess:(g,cb)=>F.onSnapshot(F.collection(db,G,g,'access'),s=>cb(s.docs.map(d=>({uid:d.id,...d.data()}))),()=>cb([])),
    setRole:(g,u,role)=>F.updateDoc(aref(g,u),{role}),
    kick:(g,u)=>F.deleteDoc(aref(g,u)),
    regenToken:g=>F.updateDoc(gref(g),{inviteToken:rid(24)}),
    token:g=>plans[g]?._core?.inviteToken||'',
    myUid:()=>uid(),
    profile:()=>myProfile,
    onProfile(cb){onProf=cb},
    setProfile:pr=>F.setDoc(uref(uid()),{profile:clean(pr)},{merge:true}),
    /* Entrar con Google: la cuenta es la misma en Pachote y en Listopic. Si este dispositivo iba sin cuenta, sus grupos pasan a ella.
       Siempre con ventanita: la redirección no vuelve bien desde otro dominio (Safari, Chrome y Firefox ya no lo dejan). */
    async signInGoogle(){
      const prov=new A.GoogleAuthProvider();prov.setCustomParameters({prompt:'select_account'});
      const was=auth.currentUser;const tokens=knownTokens();const prevTok=was&&was.isAnonymous?await was.getIdToken().catch(()=>null):null;
      await A.signInWithPopup(auth,prov);
      if(prevTok&&auth.currentUser.uid!==was.uid)await adoptFrom(prevTok,tokens);
      remember();return 'switched';
    },
    /* Entrar con email y contraseña. */
    async signInEmail(email,pass){
      const tokens=knownTokens();const was=auth.currentUser;const prevTok=was&&was.isAnonymous?await was.getIdToken().catch(()=>null):null;
      await A.signInWithEmailAndPassword(auth,String(email).trim(),pass);
      if(prevTok&&auth.currentUser.uid!==was.uid)await adoptFrom(prevTok,tokens);
      remember();return 'switched';
    },
    /* Crear cuenta con email: si este dispositivo iba sin cuenta, la cuenta nueva es este mismo usuario (con sus grupos). */
    async signUpEmail(email,pass){
      email=String(email).trim();const was=auth.currentUser;
      if(was&&was.isAnonymous){await A.linkWithCredential(was,A.EmailAuthProvider.credential(email,pass));await was.getIdToken(true).catch(()=>{})}
      else await A.createUserWithEmailAndPassword(auth,email,pass);
      remember();return 'linked';
    },
    resetPassword:email=>A.sendPasswordResetEmail(auth,String(email).trim()),
    /* La última cuenta usada en este dispositivo, para ofrecer volver a entrar con ella. */
    lastAccount:()=>{try{return JSON.parse(localStorage.getItem(LAST))||null}catch(e){return null}},
    forgetLast:()=>{try{localStorage.removeItem(LAST)}catch(e){}},
    /* Cerrar sesión: los grupos se quedan en la cuenta; este dispositivo vuelve a empezar sin cuenta. */
    async signOut(){remember(true);try{localStorage.removeItem(KN)}catch(e){}await A.signOut(auth)}
  };
  if(pendingAdopt)adoptFrom(pendingAdopt,[]);
  remember();
  return api;
}

/* ---------- Simulado (pruebas sin Firebase): «servidor» en localStorage, un usuario por pestaña ---------- */
function mockStore(){
  const K='pachote_mockdb';const load=()=>{try{return JSON.parse(localStorage.getItem(K))||{users:{},groups:{}}}catch(e){return {users:{},groups:{}}}};
  const saveDb=d=>{localStorage.setItem(K,JSON.stringify(d));setTimeout(fire,0)};
  let me=sessionStorage.getItem('pachote_mock_uid');if(!me){me='u_'+rid(8);sessionStorage.setItem('pachote_mock_uid',me)}
  let cb=()=>{},pcb=()=>{},lastProf='null';const fire=()=>{const d=load();const pr=JSON.stringify(d.users[me]?.profile||null);if(pr!==lastProf){lastProf=pr;pcb(JSON.parse(pr))}const gs=(d.users[me]&&d.users[me].groups)||{};const out={};
    for(const g in gs){const G=d.groups[g];if(!G||!G.access[me])continue;out[g]={...clean(G.core),id:g,expenses:Object.values(G.movs).sort((a,b)=>(a.created||0)-(b.created||0)),_me:G.access[me]}}cb(out);logCbs.forEach(([g,f])=>f());accCbs.forEach(([g,f])=>{const G=load().groups[g];f(G?Object.entries(G.access).map(([u,a])=>({uid:u,...a})):[])})};
  const accCbs=[],logCbs=[];window.addEventListener('storage',e=>{if(e.key===K)fire()});
  const can=(G,role)=>G&&G.access[me]&&(role==='admin'?(G.access[me].role==='admin'||(!!G.core.allAdmin&&G.access[me].role==='editor')):['admin','editor'].includes(G.access[me].role));
  return {
    kind:'mock',user:()=>({uid:me,anon:true,email:'',name:''}),
    watch(f){cb=f;setTimeout(fire,0);return()=>{}},
    async create(p){const d=load();d.groups[p.id]={log:(p._log||[]).map(l=>({...clean(l),uid:me,at:Date.now(),id:rid(10)})),core:{...coreOf(p),owner:me,inviteToken:rid(24)},movs:Object.fromEntries((p.expenses||[]).map(e=>[e.id,clean(e)])),access:{[me]:{role:'admin',memberId:p._me?.memberId||null,joined:Date.now(),label:'Este navegador'}}};
      (d.users[me]??={groups:{}}).groups[p.id]={joined:Date.now()};saveDb(d)},
    async save(p,prev,logs){const d=load();const G=d.groups[p.id];if(!can(G,'edit'))throw new Error('perm');(G.log??=[]).push(...(logs||[]).map(l=>({...clean(l),uid:me,at:Date.now(),id:rid(10)})));const c1=coreOf(p),c0=prev?coreOf(prev):{};changedKeys(c1,c0).forEach(k=>{if(k in c1)G.core[k]=c1[k];else delete G.core[k]});
      const old=Object.fromEntries((prev?.expenses||[]).map(e=>[e.id,JSON.stringify(e)]));const now=new Set();for(const e of p.expenses||[]){now.add(e.id);if(old[e.id]!==JSON.stringify(e))G.movs[e.id]=clean(e)}for(const id of (prev?.expenses||[]).map(e=>e.id))if(!now.has(id))delete G.movs[id];saveDb(d)},
    async remove(g){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');delete d.groups[g];delete d.users[me].groups[g];saveDb(d)},
    async leave(g){const d=load();delete d.groups[g]?.access[me];delete d.users[me]?.groups[g];saveDb(d)},
    async join(g,token){const d=load();const G=d.groups[g];if(!G||G.core.inviteToken!==token)throw new Error('token');G.access[me]??={role:'editor',token,memberId:null,joined:Date.now(),label:'Otro navegador'};(d.users[me]??={groups:{}}).groups[g]={joined:Date.now()};saveDb(d)},
    async setMe(g,memberId){const d=load();d.groups[g].access[me].memberId=memberId;saveDb(d)},
    watchLog(g,f){const run=()=>f([...(load().groups[g]?.log||[])].reverse());const w=[g,run];logCbs.push(w);setTimeout(run,0);return()=>{const i=logCbs.indexOf(w);if(i>=0)logCbs.splice(i,1)}},
    watchAccess(g,f){accCbs.push([g,f]);setTimeout(fire,0);return()=>{const i=accCbs.findIndex(x=>x[1]===f);if(i>=0)accCbs.splice(i,1)}},
    async setRole(g,u,role){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');d.groups[g].access[u].role=role;saveDb(d)},
    async kick(g,u){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');delete d.groups[g].access[u];saveDb(d)},
    async regenToken(g){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');d.groups[g].core.inviteToken=rid(24);saveDb(d)},
    token:g=>load().groups[g]?.core.inviteToken||'',myUid:()=>me,
    profile:()=>load().users[me]?.profile||null,onProfile(f){pcb=f},
    async setProfile(pr){const d=load();(d.users[me]??={groups:{}}).profile={...(d.users[me].profile||{}),...clean(pr)};saveDb(d)},
    async signInGoogle(){throw new Error('mock')},signOut:async()=>{},
    migrate:async()=>null,async putSummary(g,sum){const d=load();if(d.groups[g]){d.groups[g].core.summary=clean(sum);saveDb(d)}},
    async person(){return {name:'Alguien',photo:''}},async myChats(){return []},
    async linkChat(){throw new Error('mock')},async unlinkChat(){throw new Error('mock')},
    async signInEmail(){throw new Error('mock')},async signUpEmail(){throw new Error('mock')},async resetPassword(){throw new Error('mock')},lastAccount:()=>null,forgetLast:()=>{}
  };
}

(async()=>{
  let store;
  if(location.search.includes('mock'))store=mockStore();
  else{try{store=await firebaseStore()}catch(e){window.PachoteStoreError=e.message==='config'?'config':'auth';console.error(e)}}
  window.PachoteStore=store||null;window.dispatchEvent(new Event('pachote-store'));
})();
