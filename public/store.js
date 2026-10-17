/* Pachote · capa de datos.
   Firestore:
     users/{uid}                      { groups: { gid: { joined } }, profile: { name, photo } } → mis grupos y mi perfil
     groups/{gid}                     núcleo del plan (gente, familias, opciones) + owner + inviteToken
     groups/{gid}/movs/{mid}          un documento por movimiento (así dos personas pueden apuntar a la vez)
     groups/{gid}/access/{uid}        dispositivos con acceso { role, memberId, token, joined, label }
   Con ?mock en la URL usa un almacén simulado en este navegador (para probar sin Firebase). */
const FB='https://www.gstatic.com/firebasejs/10.12.2/';
const clean=o=>JSON.parse(JSON.stringify(o));
const rid=(n=20)=>{const a='abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';const r=crypto.getRandomValues(new Uint8Array(n));return [...r].map(x=>a[x%a.length]).join('')};
const CORE_SKIP=new Set(['expenses','_me','_role','_v','id']);
const coreOf=p=>{const o={};for(const k in p)if(!CORE_SKIP.has(k))o[k]=p[k];return clean(o)};
/* Solo las claves de la ficha del grupo que han cambiado (sin contar «updated»), para no pisar cambios de otros. */
const changedKeys=(c1,c0)=>{const ks=new Set([...Object.keys(c1||{}),...Object.keys(c0||{})]);return [...ks].filter(k=>!['updated','owner','inviteToken','_v'].includes(k)&&JSON.stringify(c1[k])!==JSON.stringify((c0||{})[k]))};

/* ---------- Firebase ---------- */
async function firebaseStore(){
  const {firebaseConfig}=await import('./firebase-config.js');
  if(!firebaseConfig||String(firebaseConfig.apiKey).includes('PEGA_AQUI'))throw new Error('config');
  const {initializeApp}=await import(FB+'firebase-app.js');
  const A=await import(FB+'firebase-auth.js');
  const F=await import(FB+'firebase-firestore.js');
  const app=initializeApp(firebaseConfig);
  const auth=A.getAuth(app);
  let db;try{db=F.initializeFirestore(app,{localCache:F.persistentLocalCache({tabManager:F.persistentMultipleTabManager()})})}catch(e){db=F.getFirestore(app)}
  await A.setPersistence(auth,A.browserLocalPersistence).catch(()=>{});
  const user=await new Promise(res=>{const un=A.onAuthStateChanged(auth,async u=>{if(u){un();res(u)}else{try{await A.signInAnonymously(auth)}catch(e){un();res(null)}}})});
  if(!user)throw new Error('auth');
  const uid=()=>auth.currentUser.uid;
  const gref=g=>F.doc(db,'groups',g),mref=(g,m)=>F.doc(db,'groups',g,'movs',m),aref=(g,u)=>F.doc(db,'groups',g,'access',u),uref=u=>F.doc(db,'users',u);
  const subs={};let myGroups={};let onPlans=()=>{};const plans={};let myProfile=null,onProf=()=>{};
  const emit=()=>onPlans(Object.fromEntries(Object.entries(plans).filter(([,p])=>p&&p._core).map(([g,p])=>[g,{...p._core,id:g,expenses:p._movs?Object.values(p._movs).sort((a,b)=>(a.created||0)-(b.created||0)):[],_me:p._acc||null}])));
  function watchGroup(g){
    if(subs[g])return;plans[g]={};const drop=()=>{unwatch(g);F.updateDoc(uref(uid()),{['groups.'+g]:F.deleteField()}).catch(()=>{});emit()};
    subs[g]=[
      F.onSnapshot(gref(g),s=>{if(!s.exists()){drop();return}plans[g]._core=s.data();emit()},()=>drop()),
      F.onSnapshot(F.collection(db,'groups',g,'movs'),s=>{plans[g]._movs=Object.fromEntries(s.docs.map(d=>[d.id,{...d.data(),id:d.id}]));emit()},()=>{}),
      F.onSnapshot(aref(g,uid()),s=>{if(!s.exists()){drop();return}plans[g]._acc=s.data();emit()},()=>drop())];
  }
  function unwatch(g){(subs[g]||[]).forEach(u=>u());delete subs[g];delete plans[g]}
  return {
    kind:'cloud',
    user:()=>{const u=auth.currentUser;return u?{uid:u.uid,anon:u.isAnonymous,email:u.email||'',name:u.displayName||''}:null},
    watch(cb){onPlans=cb;return F.onSnapshot(uref(uid()),s=>{myGroups=(s.exists()&&s.data().groups)||{};
      const pr=(s.exists()&&s.data().profile)||null;if(JSON.stringify(pr)!==JSON.stringify(myProfile)){myProfile=pr;onProf(pr)}Object.keys(myGroups).forEach(watchGroup);Object.keys(subs).forEach(g=>{if(!myGroups[g])unwatch(g)});emit()})},
    async create(p){
      const g=p.id,core=coreOf(p);core.owner=uid();core.inviteToken=rid(24);core.created=core.created||Date.now();
      await F.setDoc(gref(g),core);
      await F.setDoc(aref(g,uid()),{role:'admin',memberId:p._me?.memberId||null,joined:Date.now(),label:navigator.userAgent.slice(0,80)});
      await F.setDoc(uref(uid()),{groups:{[g]:{joined:Date.now()}}},{merge:true});
      const ex=clean(p.expenses||[]);for(let i=0;i<ex.length;i+=400){const b=F.writeBatch(db);ex.slice(i,i+400).forEach(e=>b.set(mref(g,e.id),e));await b.commit()}
    },
    async save(p,prev){
      const g=p.id;const b=F.writeBatch(db);let n=0;
      const c1=coreOf(p),c0=prev?coreOf(prev):{};const ck=changedKeys(c1,c0);
      if(ck.length){const up={updated:Date.now()};ck.forEach(k=>up[k]=k in c1?c1[k]:F.deleteField());b.update(gref(g),up);n++}
      const old=Object.fromEntries((prev?.expenses||[]).map(e=>[e.id,JSON.stringify(e)]));const now=new Set();
      for(const e of clean(p.expenses||[])){now.add(e.id);if(old[e.id]!==JSON.stringify(e)){b.set(mref(g,e.id),e);n++}}
      for(const id in old)if(!now.has(id)){b.delete(mref(g,id));n++}
      if(n)await b.commit();
    },
    async remove(g){
      const ms=await F.getDocs(F.collection(db,'groups',g,'movs'));const as=await F.getDocs(F.collection(db,'groups',g,'access'));
      const refs=[...ms.docs.map(d=>d.ref),...as.docs.filter(d=>d.id!==uid()).map(d=>d.ref)];
      for(let i=0;i<refs.length;i+=400){const b=F.writeBatch(db);refs.slice(i,i+400).forEach(r=>b.delete(r));await b.commit()}
      await F.deleteDoc(gref(g));await F.deleteDoc(aref(g,uid())).catch(()=>{});
      await F.updateDoc(uref(uid()),{['groups.'+g]:F.deleteField()}).catch(()=>{});
    },
    async leave(g){await F.deleteDoc(aref(g,uid()));await F.updateDoc(uref(uid()),{['groups.'+g]:F.deleteField()}).catch(()=>{})},
    async join(g,token){
      const ex=await F.getDoc(aref(g,uid())).catch(()=>null);
      if(!ex||!ex.exists())await F.setDoc(aref(g,uid()),{role:'editor',token,memberId:null,joined:Date.now(),label:navigator.userAgent.slice(0,80)});
      await F.setDoc(uref(uid()),{groups:{[g]:{joined:Date.now()}}},{merge:true});
    },
    setMe:(g,memberId)=>F.updateDoc(aref(g,uid()),{memberId}),
    watchAccess:(g,cb)=>F.onSnapshot(F.collection(db,'groups',g,'access'),s=>cb(s.docs.map(d=>({uid:d.id,...d.data()}))),()=>cb([])),
    setRole:(g,u,role)=>F.updateDoc(aref(g,u),{role}),
    kick:(g,u)=>F.deleteDoc(aref(g,u)),
    regenToken:g=>F.updateDoc(gref(g),{inviteToken:rid(24)}),
    token:g=>plans[g]?._core?.inviteToken||'',
    myUid:()=>uid(),
    profile:()=>myProfile,
    onProfile(cb){onProf=cb},
    setProfile:pr=>F.setDoc(uref(uid()),{profile:clean(pr)},{merge:true}),
    async linkGoogle(){
      const prov=new A.GoogleAuthProvider();
      try{await A.linkWithPopup(auth.currentUser,prov);return 'linked'}
      catch(e){
        if(e.code!=='auth/credential-already-in-use')throw e;
        /* Ya tenías cuenta: entramos con ella y volvemos a unirnos a los grupos de este dispositivo con su link actual. */
        const tokens=Object.keys(myGroups).map(g=>[g,plans[g]?._core?.inviteToken]).filter(x=>x[1]);
        const cred=A.GoogleAuthProvider.credentialFromError(e);await A.signInWithCredential(auth,cred);
        for(const [g,t] of tokens){try{await this.join(g,t)}catch(x){}}
        return 'switched';
      }
    },
    signOut:()=>A.signOut(auth)
  };
}

/* ---------- Simulado (pruebas sin Firebase): «servidor» en localStorage, un usuario por pestaña ---------- */
function mockStore(){
  const K='pachote_mockdb';const load=()=>{try{return JSON.parse(localStorage.getItem(K))||{users:{},groups:{}}}catch(e){return {users:{},groups:{}}}};
  const saveDb=d=>{localStorage.setItem(K,JSON.stringify(d));setTimeout(fire,0)};
  let me=sessionStorage.getItem('pachote_mock_uid');if(!me){me='u_'+rid(8);sessionStorage.setItem('pachote_mock_uid',me)}
  let cb=()=>{},pcb=()=>{},lastProf='null';const fire=()=>{const d=load();const pr=JSON.stringify(d.users[me]?.profile||null);if(pr!==lastProf){lastProf=pr;pcb(JSON.parse(pr))}const gs=(d.users[me]&&d.users[me].groups)||{};const out={};
    for(const g in gs){const G=d.groups[g];if(!G||!G.access[me])continue;out[g]={...clean(G.core),id:g,expenses:Object.values(G.movs).sort((a,b)=>(a.created||0)-(b.created||0)),_me:G.access[me]}}cb(out);accCbs.forEach(([g,f])=>{const G=load().groups[g];f(G?Object.entries(G.access).map(([u,a])=>({uid:u,...a})):[])})};
  const accCbs=[];window.addEventListener('storage',e=>{if(e.key===K)fire()});
  const can=(G,role)=>G&&G.access[me]&&(role==='admin'?G.access[me].role==='admin':['admin','editor'].includes(G.access[me].role));
  return {
    kind:'mock',user:()=>({uid:me,anon:true,email:'',name:''}),
    watch(f){cb=f;setTimeout(fire,0);return()=>{}},
    async create(p){const d=load();d.groups[p.id]={core:{...coreOf(p),owner:me,inviteToken:rid(24)},movs:Object.fromEntries((p.expenses||[]).map(e=>[e.id,clean(e)])),access:{[me]:{role:'admin',memberId:p._me?.memberId||null,joined:Date.now(),label:'Este navegador'}}};
      (d.users[me]??={groups:{}}).groups[p.id]={joined:Date.now()};saveDb(d)},
    async save(p,prev){const d=load();const G=d.groups[p.id];if(!can(G,'edit'))throw new Error('perm');const c1=coreOf(p),c0=prev?coreOf(prev):{};changedKeys(c1,c0).forEach(k=>{if(k in c1)G.core[k]=c1[k];else delete G.core[k]});
      const old=Object.fromEntries((prev?.expenses||[]).map(e=>[e.id,JSON.stringify(e)]));const now=new Set();for(const e of p.expenses||[]){now.add(e.id);if(old[e.id]!==JSON.stringify(e))G.movs[e.id]=clean(e)}for(const id of (prev?.expenses||[]).map(e=>e.id))if(!now.has(id))delete G.movs[id];saveDb(d)},
    async remove(g){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');delete d.groups[g];delete d.users[me].groups[g];saveDb(d)},
    async leave(g){const d=load();delete d.groups[g]?.access[me];delete d.users[me]?.groups[g];saveDb(d)},
    async join(g,token){const d=load();const G=d.groups[g];if(!G||G.core.inviteToken!==token)throw new Error('token');G.access[me]??={role:'editor',token,memberId:null,joined:Date.now(),label:'Otro navegador'};(d.users[me]??={groups:{}}).groups[g]={joined:Date.now()};saveDb(d)},
    async setMe(g,memberId){const d=load();d.groups[g].access[me].memberId=memberId;saveDb(d)},
    watchAccess(g,f){accCbs.push([g,f]);setTimeout(fire,0);return()=>{const i=accCbs.findIndex(x=>x[1]===f);if(i>=0)accCbs.splice(i,1)}},
    async setRole(g,u,role){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');d.groups[g].access[u].role=role;saveDb(d)},
    async kick(g,u){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');delete d.groups[g].access[u];saveDb(d)},
    async regenToken(g){const d=load();if(!can(d.groups[g],'admin'))throw new Error('perm');d.groups[g].core.inviteToken=rid(24);saveDb(d)},
    token:g=>load().groups[g]?.core.inviteToken||'',myUid:()=>me,
    profile:()=>load().users[me]?.profile||null,onProfile(f){pcb=f},
    async setProfile(pr){const d=load();(d.users[me]??={groups:{}}).profile={...(d.users[me].profile||{}),...clean(pr)};saveDb(d)},
    async linkGoogle(){throw new Error('mock')},signOut:async()=>{}
  };
}

(async()=>{
  let store;
  if(location.search.includes('mock'))store=mockStore();
  else{try{store=await firebaseStore()}catch(e){window.PachoteStoreError=e.message==='config'?'config':'auth';console.error(e)}}
  window.PachoteStore=store||null;window.dispatchEvent(new Event('pachote-store'));
})();
