/* Pachote · service worker.
   - App (mismo origen): red primero, pero si la red tarda más de 3 s se sirve la copia guardada (arranque rápido con mala cobertura).
   - Librerías de Firebase y fuentes (URL con versión, no cambian): copia guardada primero, así la app abre aunque no haya conexión.
   Los datos los sincroniza Firestore por su cuenta. */
const CACHE='pachote-v23';
const LIBS='pachote-libs-v1';
const SHELL=['./','index.html','store.js','firebase-config.js','manifest.webmanifest','icon.svg','icon-192.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==CACHE&&k!==LIBS).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
const isLib=u=>(u.hostname==='www.gstatic.com'&&u.pathname.startsWith('/firebasejs/'))||u.hostname==='fonts.googleapis.com'||u.hostname==='fonts.gstatic.com';
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const u=new URL(e.request.url);
  if(isLib(u)){e.respondWith(caches.open(LIBS).then(c=>c.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{if(r.ok||r.type==='opaque')c.put(e.request,r.clone());return r}))));return}
  if(u.origin!==location.origin)return; // el resto (Firestore, Auth…) va directo
  const net=fetch(e.request).then(r=>{if(r.ok){const cp=r.clone();caches.open(CACHE).then(c=>c.put(e.request,cp))}return r});
  const late=new Promise(res=>setTimeout(()=>caches.match(e.request).then(r=>r&&res(r)),3000));
  e.respondWith(Promise.race([net.catch(()=>null),late]).then(r=>r||caches.match(e.request).then(c=>c||net).catch(()=>caches.match('index.html'))).then(r=>r||caches.match('index.html')));
});
