# Pachote · cuentas claras, a pachas

App en **https://pachote-78042.web.app**. Los datos viven en el **Firebase de Listopic**: la misma cuenta sirve en las dos apps y un grupo de Pachote puede enlazarse al chat de un grupo de Listopic.

## Despliegue
Cada `git push` a `main` publica la app (`.github/workflows/firebase-deploy.yml`, solo Hosting).
Las reglas de Firestore de Pachote están en el repo de Listopic (`firestore.rules`, sección PACHOTE) y se despliegan desde allí, igual que las funciones `pachoteMigrate` y `pachoteAdopt`.

## Una sola vez, en la consola (proyecto «listopic»)
1. **Authentication → Método de acceso**: **Anónimo** activado (Google y email ya lo están).
2. **Authentication → Configuración → Dominios autorizados**: `pachote-78042.web.app`.
3. **Google Cloud → Credenciales → Browser key**: añadir `https://pachote-78042.web.app/*` a los sitios web permitidos.

## Mudanza desde el Firebase antiguo («pachote-78042»)
Al abrir esta versión, cada dispositivo manda a `pachoteMigrate` el token de su usuario antiguo. La función lo comprueba, lee sus grupos del proyecto antiguo con ese mismo token y los copia al nuevo, con el mismo papel (administrador, puede apuntar o solo ver). Los links de invitación siguen valiendo. Las reglas antiguas quedan en `legacy/firestore.rules`.

## Probar sin Firebase
Sirve la carpeta `public` (por ejemplo `npx serve public`) y abre `http://localhost:3000/?mock`. Usa un almacén simulado en el navegador; cada pestaña es un «dispositivo».

## Cómo funciona el acceso
- Al abrir la app se crea un usuario anónimo en ese navegador, sin registro. En Listopic ese usuario no cuenta como sesión.
- **⚙️ → Compartir y dispositivos**: link de invitación para mandar al WhatsApp del grupo. Quien lo abre entra y puede apuntar gastos.
- Si el link se filtra: **Cambiar link**. El viejo deja de valer; quien ya estaba dentro sigue dentro.
- El administrador puede poner a alguien en **Solo ver** o quitarle el acceso.
- **☰ → Entrar con tu cuenta de Listopic** (Google o email): tus grupos te siguen a cualquier dispositivo.
- **⚙️ → Chat de Listopic**: enlaza el grupo con un chat de grupo de Listopic. Los del chat ven el resumen (total, saldos, pagos y últimos gastos) y entran sin link; aquí se ve el chat con 💬.
- Desde Listopic (info del grupo o 🍽️ → 💸 Cuentas) también se crean cuentas nuevas con la gente del chat.
