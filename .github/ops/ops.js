// Operaciones puntuales de mantenimiento (se ejecutan en GitHub Actions con la cuenta de servicio).
// No imprime datos personales: solo ids recortados, roles y fechas.
const admin=require('firebase-admin');const {GoogleAuth}=require('google-auth-library');
const P='pachote-78042';
admin.initializeApp({credential:admin.credential.applicationDefault(),projectId:P});
const db=admin.firestore();const cut=s=>String(s||'').slice(0,6);
(async()=>{
  const cfg=JSON.parse(require('fs').readFileSync(__dirname+'/task.json','utf8'));
  if(cfg.authCheck){
    try{const c=await new GoogleAuth({scopes:['https://www.googleapis.com/auth/cloud-platform']}).getClient();
      const a=await c.request({url:`https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/config`});
      console.log('anonimo:',!!a.data.signIn?.anonymous?.enabled,'| dominios:',(a.data.authorizedDomains||[]).join(', '));
      const g=await c.request({url:`https://identitytoolkit.googleapis.com/admin/v2/projects/${P}/defaultSupportedIdpConfigs/google.com`}).catch(e=>({data:{error:e.response?.status}}));
      console.log('google:',g.data.enabled===true?'activado':'NO activado',g.data.error||'');
    }catch(e){console.log('auth config: sin permiso o error',e.response?.status||e.message)}
  }
  for(const g of cfg.groups||[]){
    const acc=await db.collection('groups').doc(g).collection('access').get();
    console.log(`grupo ${cut(g)}: ${acc.size} dispositivos`);
    acc.docs.sort((a,b)=>(a.data().joined||0)-(b.data().joined||0)).forEach((d,i)=>{const x=d.data();console.log(` #${i} uid:${cut(d.id)} rol:${x.role} persona:${cut(x.memberId)} entró:${new Date(x.joined||0).toISOString()} ${String(x.label||'').slice(0,40)}`)});
  }
  for(const op of cfg.setRole||[]){
    const ref=db.collection('groups').doc(op.g).collection('access');const all=await ref.get();
    const d=all.docs.find(x=>x.id.startsWith(op.uidPrefix));if(!d){console.log('no encontrado',op.uidPrefix);continue}
    await d.ref.update({role:op.role});console.log('rol cambiado',cut(d.id),'→',op.role);
    await db.collection('users').doc(d.id).set({groups:{[op.g]:{joined:Date.now()}}},{merge:true});
  }
})().catch(e=>{console.error('ERROR',e.code||'',e.message);process.exit(1)});
