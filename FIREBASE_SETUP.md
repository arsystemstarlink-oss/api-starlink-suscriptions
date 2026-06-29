# Configuración de Firebase

Esta guía explica cómo obtener y configurar las credenciales de Firebase para la API.

## Tabla de Contenidos

1. [Obtener Credenciales de Firebase](#obtener-credenciales-de-firebase)
2. [Método 1: Variables de Entorno (Recomendado)](#método-1-variables-de-entorno-recomendado)
3. [Método 2: Archivo JSON (Desarrollo Local)](#método-2-archivo-json-desarrollo-local)
4. [Validación de Configuración](#validación-de-configuración)
5. [Errores Comunes](#errores-comunes)
6. [Seguridad de Credenciales](#seguridad-de-credenciales)

---

## Obtener Credenciales de Firebase

### Paso 1: Acceder a Firebase Console

Ve a [Firebase Console](https://console.firebase.google.com/) y selecciona tu proyecto.

### Paso 2: Configurar Firestore Database

Si aún no lo has hecho:
1. Ve a **Firestore Database** en el menú lateral
2. Haz clic en **Crear base de datos**
3. Selecciona **Empezar en modo de prueba** (luego cambias a producción)
4. Selecciona la ubicación más cercana (ej: `nam5` para América)

### Paso 3: Generar Service Account Key

1. Ve a **Project settings** (⚙️)
2. Selecciona pestaña **Service accounts**
3. Haz clic en **Generate new private key**
4. Se descargará un archivo JSON con las credenciales

**⚠️ IMPORTANTE:** Este archivo contiene información sensible. Nunca lo subas al repositorio.

### Paso 4: Contenido del archivo JSON

El archivo descargado tendrá esta estructura:

```json
{
  "type": "service_account",
  "project_id": "api-gestion-starlink",
  "private_key_id": "abc123...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "firebase-adminsdk-xxxxx@api-gestion-starlink.iam.gserviceaccount.com",
  "client_id": "123456789",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/..."
}
```

Necesitarás los campos:
- `project_id`
- `client_email`
- `private_key`

---

## Método 1: Variables de Entorno (Recomendado)

**Recomendado para:** Railway, Render, Vercel, AWS, GCP, Docker, cualquier PaaS

### Ventajas
- ✅ Más seguro: las credenciales no están en archivos
- ✅ Compatible con todos los servicios de despliegue
- ✅ Más fácil de rotar credenciales

### Configuración Local (.env)

```env
FIREBASE_PROJECT_ID=api-gestion-starlink
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@api-gestion-starlink.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAAS...\n-----END PRIVATE KEY-----\n"
```

**⚠️ Notas importantes:**
- El `private_key` debe estar entre comillas dobles
- Los saltos de línea deben ser `\n` (no saltos de línea reales)
- Asegúrate de no tener espacios extras al inicio/final

### Configuración en Railway

1. Ve a tu proyecto en Railway
2. Selecciona tu servicio
3. Ve a la pestaña **Variables**
4. Agrega estas variables:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

**💡 Tip:** En Railway, puedes usar el botón **"Raw Edit"** para pegar el private key sin escapes problemáticos.

### Configuración en Render

1. Ve a tu servicio en Render
2. Selecciona pestaña **Environment**
3. Agrega las tres variables:
   - `FIREBASE_PROJECT_ID`
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`

---

## Método 2: Archivo JSON (Desarrollo Local)

**Recomendado para:** Desarrollo local, testing manual

### Ventajas
- ✅ Más simple para desarrollo
- ✅ No necesitas copiar/pegar claves largas
- ❌ Requiere proteger el archivo manualmente

### Configuración

1. Crea una carpeta `credentials/` en la raíz del proyecto:

```bash
mkdir credentials
```

2. Copia aquí el archivo JSON descargado de Firebase:

```bash
credentials/
└── firebase-admin.json
```

3. Configura en tu `.env`:

```env
FIREBASE_PROJECT_ID=api-gestion-starlink
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./credentials/firebase-admin.json
```

4. **IMPORTANTE:** Asegúrate de que `.gitignore` incluya:

```gitignore
# Firebase credentials
credentials/
*-firebase-adminsdk-*.json
*.json.firebase
```

### Estructura de Proyecto Recomendada

```
starlink-subscription-api/
├── credentials/
│   └── firebase-admin.json    # ⚠️ NO subir al repo
├── src/
├── .env                       # ⚠️ NO subir al repo
├── .env.example               # ✅ Subir al repo (plantilla)
└── .gitignore                 # ✅ Subir al repo
```

---

## Validación de Configuración

### Test Automático

Al iniciar la API, se ejecuta automáticamente una validación de conexión:

```bash
npm run dev
```

Deberías ver:

```
✅ Firebase inicializado (proyecto: api-gestion-starlink)
🔐 Firebase: Usando credenciales desde variables de entorno
🔍 Validando conexión a Firestore...
✅ Conexión a Firestore validada correctamente
```

### Test Manual

Puedes verificar la conexión haciendo una petición de health check:

```bash
curl http://localhost:3000/health
```

Respuesta esperada:

```json
{
  "status": "ok",
  "timestamp": "2026-06-27T23:22:13.000Z",
  "firebase": "connected",
  "database": "firestore"
}
```

---

## Errores Comunes

### Error: "PERMISSION_DENIED"

**Causa:** El service account no tiene permisos suficientes en Firestore.

**Solución:**
1. Ve a [IAM & Admin](https://console.cloud.google.com/iam-admin/)
2. Encuentra el service account (`firebase-adminsdk-xxxxx@...`)
3. Asegúrate de que tenga el rol **Cloud Datastore User** o **Firebase Admin**

### Error: "UNAUTHENTICATED" o "Invalid grant"

**Causa:** Las credenciales son inválidas o están mal formateadas.

**Solución:**
- Verifica que `client_email` sea correcto
- Verifica que `private_key` incluya los encabezados `-----BEGIN PRIVATE KEY-----`
- En variables de entorno, asegúrate de que los saltos de línea sean `\n` (no saltos reales)

### Error: "Project not found"

**Causa:** El `FIREBASE_PROJECT_ID` es incorrecto.

**Solución:**
1. Verifica en [Firebase Console](https://console.firebase.google.com/) → Project settings → Project ID
2. Actualiza `FIREBASE_PROJECT_ID` en tu configuración

### Error: "Cannot find module" (archivo JSON)

**Causa:** La ruta al archivo JSON es incorrecta.

**Solución:**
- Verifica que el archivo exista en la ruta especificada
- Usa rutas relativas desde la raíz del proyecto: `./credentials/firebase-admin.json`
- En Windows, usa `/` en lugar de `\` en la ruta

---

## Seguridad de Credenciales

### ⚠️ Reglas de Oro

1. **NUNCA** subas el archivo JSON al repositorio
2. **NUNCA** pegues `private_key` en commits, PRs o mensajes públicos
3. **NUNCA** compartas credenciales por chat, email sin cifrar, etc.
4. **SIEMPRE** usa variables de entorno en producción
5. **SIEMPRE** rota las credenciales si sospechas que fueron comprometidas

### Rotación de Credenciales

Si necesitas cambiar las credenciales:

1. Ve a Firebase Console → Project settings → Service accounts
2. Haz clic en **Generate new private key**
3. Descarga el nuevo archivo JSON
4. Actualiza tus variables de entorno o archivo JSON
5. Verifica que la API funcione correctamente
6. Elimina las credenciales antiguas de Firebase Console

### Mejores Prácticas

- Usa un gestor de secretos (Railway Secrets, Doppler, 1Password, etc.)
- Configura diferentes credenciales para desarrollo, staging y producción
- Monitorea el uso de tu service account en Google Cloud Console
- Establece alertas de seguridad para accesos no autorizados

---

## Recursos Adicionales

- [Firebase Admin SDK Setup](https://firebase.google.com/docs/admin/setup)
- [Service Account Authentication](https://cloud.google.com/iam/docs/service-accounts)
- [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/get-started)

---

## Soporte

Si tienes problemas con la configuración:

1. Revisa la sección de [Errores Comunes](#errores-comunes)
2. Verifica que tu `.env` coincida con `.env.example`
3. Consulta la [documentación oficial de Firebase](https://firebase.google.com/docs)
