# Pachote · puesta en marcha con Firebase

## 1. Una sola vez, en la consola de Firebase (proyecto «pachote»)
1. **Authentication → Método de acceso**: activa **Anónimo** y **Google**.
2. **Firestore Database → Crear base de datos** → modo producción → región `europe-southwest1` (Madrid) o `eur3`.
3. **Configuración del proyecto → General → Tus apps → Añadir app web** (</>). Copia el bloque `firebaseConfig`.
4. **Authentication → Configuración → Dominios autorizados**: comprueba que están `pachote.web.app` y `pachote.firebaseapp.com` (o el ID real de tu proyecto).

## 2. En tu ordenador
1. Pega tu `firebaseConfig` en `public/firebase-config.js`.
2. Pon el ID de tu proyecto en `.firebaserc` (donde dice `PEGA_AQUI_TU_PROJECT_ID`).
3. En esta carpeta:
   ```
   npm install -g firebase-tools     # si no lo tienes
   firebase login
   firebase deploy --only firestore:rules,hosting
   ```
4. Abre la dirección que te dé (`https://TU-PROYECTO.web.app`).

## 3. Traer tus planes actuales
En Pachote: **+ Nuevo plan → 📥 Importar** y elige cada archivo de `mis-planes/`.

## Probar sin Firebase
Sirve la carpeta `public` (por ejemplo `npx serve public`) y abre `http://localhost:3000/?mock`. Usa un almacén simulado en el navegador; cada pestaña es un «dispositivo».

## Cómo funciona el acceso
- Al abrir la app se crea un usuario anónimo en ese navegador, sin registro.
- **⚙️ → Compartir y dispositivos**: link de invitación para mandar al WhatsApp del grupo. Quien lo abre entra y puede apuntar gastos.
- Si el link se filtra: **Cambiar link**. El viejo deja de valer; quien ya estaba dentro sigue dentro.
- El administrador puede poner a alguien en **Solo ver** o quitarle el acceso.
- **Tu cuenta → Guardar mis grupos con Google**: para tenerlos en varios dispositivos.
- Las reglas de `firestore.rules` impiden ver o tocar un grupo sin haber entrado con su link.
