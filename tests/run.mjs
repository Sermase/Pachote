// Pruebas de Pachote: cálculo de saldos, redondeo, mínimo de pagos y un recorrido básico de la app.
// Uso:  node tests/run.mjs            (comprueba)
//       node tests/run.mjs --update   (regenera tests/golden.json tras un cambio de cálculo QUERIDO)
// Abre la app con ?mock (almacén simulado, sin Firebase) en Chromium headless.
import {chromium} from 'playwright';
import http from 'node:http';import fs from 'node:fs';import path from 'node:path';import {fileURLToPath} from 'node:url';
const here=path.dirname(fileURLToPath(import.meta.url));const root=process.env.PACHOTE_ROOT||path.join(here,'..','public');
const TYPES={'.html':'text/html','.js':'text/javascript','.json':'application/json','.webmanifest':'application/manifest+json','.png':'image/png','.svg':'image/svg+xml'};
const srv=http.createServer((q,r)=>{let f=decodeURIComponent(new URL(q.url,'http://x').pathname);if(f.endsWith('/'))f+='index.html';const fp=path.join(root,f);
  if(!fp.startsWith(root)||!fs.existsSync(fp)){r.writeHead(404);return r.end()}r.writeHead(200,{'Content-Type':TYPES[path.extname(fp)]||'application/octet-stream'});fs.createReadStream(fp).pipe(r)});
await new Promise(res=>srv.listen(0,res));const URL0=`http://localhost:${srv.address().port}/?mock`;
let fails=0;const ok=(c,msg)=>{if(c)console.log('  ✓',msg);else{fails++;console.log('  ✗',msg)}};

/* Grupos de prueba deterministas (sin datos personales): familias, niños con peso, cuentas conjuntas,
   pagos «como familia», transferencias y todos los modos de reparto. */
function fixtures(){let seed=12345;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};const pick=a=>a[Math.floor(rnd()*a.length)];
  const out=[];
  for(let t=0;t<60;t++){
    const nF=1+Math.floor(rnd()*5),nP=4+Math.floor(rnd()*16);
    const hs=[...Array(nF)].map((_,i)=>({id:'h'+i,name:'Familia '+i,color:'#888'}));
    const ms=[...Array(nP)].map((_,i)=>{const kid=rnd()<.25;return {id:'m'+i,name:'P'+i,hh:rnd()<.75?'h'+Math.floor(rnd()*nF):null,kid,weight:kid?pick([0.5,0.75,1]):pick([1,1,1,1.5])}});
    if(rnd()<.3){const h=hs[0];const ad=ms.filter(m=>m.hh===h.id&&!m.kid);if(ad.length>=2)h.joints=[{id:'j0',ids:ad.slice(0,2).map(m=>m.id)}]}
    if(rnd()<.3)hs[0].kidsBy={mode:pick(['head','adults','group'])};
    const ex=[];
    for(let k=0;k<1+Math.floor(rnd()*25);k++){
      const ps=ms.filter(()=>rnd()<.65).map(m=>m.id);if(!ps.length)continue;
      const mode=pick(['peso','iguales','familias','importe','porcentaje','acciones','ajuste']);
      const payer=rnd()<.1?'h:h0':rnd()<.08&&hs[0].joints?'j:j0':'m:'+pick(ms).id;
      const e={id:'e'+k,amount:1+Math.floor(rnd()*120000),payer,parts:ps,mode,date:'2026-0'+(1+k%9)+'-1'+(k%9),cat:'otros',created:k};
      if(mode==='importe'){let left=e.amount;e.custom={};ps.forEach((id,i)=>{const v=i===ps.length-1?left:Math.floor(left*rnd()*.6);e.custom[id]=v;left-=v})}
      if(mode==='porcentaje'){e.vals={};let left=100;ps.forEach((id,i)=>{const v=i===ps.length-1?left:Math.floor(left*rnd()*.6);e.vals[id]=v;left-=v})}
      if(mode==='acciones'){e.vals={};ps.forEach(id=>e.vals[id]=1+Math.floor(rnd()*3))}
      if(mode==='ajuste'){e.vals={[ps[0]]:Math.floor(e.amount*.1)}}
      if(rnd()<.12){e.kind='transfer';e.to='m:'+pick(ms).id;e.parts=[];if(e.to===payer)continue}
      else if(rnd()<.08)e.kind='ingreso';
      ex.push(e)}
    out.push({id:'t'+t,name:'Prueba '+t,members:ms,households:hs,expenses:ex,features:{families:rnd()<.85,kids:rnd()<.85},created:1})}
  return out}

const b=await chromium.launch();const page=await (await b.newContext()).newPage();const errs=[];page.on('pageerror',e=>errs.push(e.message));
await page.goto(URL0);await page.waitForFunction(()=>typeof compute==='function'&&window.PachoteStore!==undefined);

console.log('Cálculo');
const plans=fixtures();
const res=await page.evaluate(plans=>plans.map(q=>{S.plans={[q.id]:q};S.current=q.id;const P=plan();
  const a=compute(P),i=compute(P,true),r=compute(P,true,false);
  const fam=P.households.map(h=>famAccounts(P,h.id).rows.map(x=>[x.m.id,x.net]));
  const used=new Set();P.expenses.forEach(e=>{(e.parts||[]).forEach(x=>used.add(x));[e.payer,e.to].forEach(k=>{if(!k)return;if(k.startsWith('m:'))used.add(k.slice(2));if(k.startsWith('h:')){const hd=famHead(P,k.slice(2));if(hd)used.add(hd.id)}if(k.startsWith('j:'))(jointOf(P,k)?.ids||[]).forEach(x=>used.add(x))})});
  const kd=kidDist(P);for(const k in kd)if(used.has(k))for(const x in kd[k])used.add(x);
  const sum=o=>Object.values(o).reduce((s,v)=>s+v,0);
  const settles=c=>{const n={...c.net};c.tx.forEach(t=>{n[t.from]+=t.amt;n[t.to]-=t.amt});return Object.values(n).every(v=>v===0)};
  const intOk=c=>Object.values(c.net).every(Number.isInteger);
  const stray=Object.keys(i.net).filter(u=>u.startsWith('m:')&&!used.has(u.slice(2))&&i.net[u]!==0);
  return {id:q.id,snap:JSON.stringify({a:[a.net,a.tx],i:[i.net,i.tx],r:r.net,fam}),zero:[sum(a.net),sum(i.net),sum(r.net)],settle:settles(a)&&settles(i),ints:intOk(a)&&intOk(i),stray}}),plans);
ok(res.every(r=>r.zero.every(z=>z===0)),'los saldos de cada grupo suman 0 (por familias, por persona y sin agrupar niños)');
ok(res.every(r=>r.ints),'todos los saldos son céntimos enteros');
ok(res.every(r=>r.settle),'los pagos propuestos dejan a todos a cero');
ok(res.every(r=>!r.stray.length),'quien no participa no tiene ni un céntimo de saldo');
const gf=path.join(here,'golden.json');const now=Object.fromEntries(res.map(r=>[r.id,r.snap]));
if(process.argv.includes('--update')||!fs.existsSync(gf)){fs.writeFileSync(gf,JSON.stringify(now,null,0));console.log('  · golden.json regenerado')}
else{const g=JSON.parse(fs.readFileSync(gf,'utf8'));const diff=Object.keys(now).filter(k=>g[k]!==now[k]);ok(!diff.length,`resultados idénticos a los guardados (${Object.keys(now).length} grupos)${diff.length?' · cambian: '+diff.slice(0,5).join(', '):''}`)}

const rk=await page.evaluate(()=>{let bad=0;let seed=99;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
  for(let t=0;t<20000;t++){const o={};let tot=0;const n=2+Math.floor(rnd()*15);for(let i=0;i<n;i++){const v=rnd()<.3?0:(rnd()-.5)*90000/(1+Math.floor(rnd()*7));o['k'+i]=v;tot+=v}
    const nz=Object.keys(o).filter(k=>o[k]);if(nz.length<2)continue;o[nz[0]]-=tot;const r=roundKeepSum(o);
    if(Object.values(r).reduce((a,b)=>a+b,0)!==Math.round(Object.values(o).reduce((a,b)=>a+b,0)))bad++;for(const k in o)if((o[k]===0&&r[k]!==0)||Math.abs(r[k]-o[k])>=1.0000001)bad++}
  return bad});
ok(rk===0,'redondeo: suma exacta, nadie a más de 1 céntimo, los ceros siguen en cero (20.000 casos)');
const mt=await page.evaluate(()=>{let worse=0,bad=0;let seed=7;const rnd=()=>{seed=(seed*16807)%2147483647;return seed/2147483647};
  for(let t=0;t<400;t++){const n=2+Math.floor(rnd()*12);const o={};let s=0;for(let i=0;i<n-1;i++){const v=Math.round((rnd()-.5)*20000);o['u'+i]=v;s+=v}o['u'+(n-1)]=-s;
    const tx=minTransfers(o),g=greedyTx(Object.entries(o).filter(([,v])=>v));const r={...o};tx.forEach(x=>{r[x.from]+=x.amt;r[x.to]-=x.amt});
    if(Object.values(r).some(v=>v))bad++;if(tx.length>g.length)worse++}return {bad,worse}});
ok(!mt.bad&&!mt.worse,'mínimo de pagos: siempre cuadra y nunca hace más pagos que el método sencillo');

console.log('Recorrido');
await page.evaluate(()=>{S.plans={};S.current=null;render()});
await page.click('[data-act="newplan"]');await page.fill('#pname','Cena de prueba');await page.fill('#ppeople','Ana, Luis, Marta');await page.click('#psave');
await page.waitForFunction(()=>plan()&&plan().members.length===3);
await page.evaluate(()=>{closeSheet();const p=plan();S.plans[p.id]._me={...(p._me||{}),memberId:p.members[0].id,role:'admin'}});
await page.evaluate(()=>openEntry());await page.fill('#eamt','30');await page.fill('#edesc','Pizzas');await page.click('#esave');
await page.waitForFunction(()=>plan().expenses.length===1,null,{timeout:5000}).catch(()=>{});
const st=await page.evaluate(()=>{const c=compute(plan(),true);return Object.values(c.net).sort((a,b)=>a-b)});
ok(JSON.stringify(st)===JSON.stringify([-1000,-1000,2000]),'gasto de 30 € entre 3 pagado por Ana → Ana +20 €, los demás −10 €');
await page.evaluate(()=>setTab('saldos'));ok(await page.$$eval('.tr',x=>x.length)===2,'Saldos propone 2 pagos');
ok(!errs.length,'sin errores de JavaScript'+(errs.length?': '+errs.slice(0,3).join(' | '):''));
await b.close();srv.close();
console.log(fails?`\n${fails} prueba(s) fallida(s)`:'\nTodo bien');process.exit(fails?1:0);
