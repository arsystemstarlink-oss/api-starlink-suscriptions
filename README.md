# Starlink Subscription API

API REST para gestión de suscripciones de Starlink con sistema de billing completo, notificaciones por WhatsApp y portal de clientes.

## 📋 Tabla de Contenidos

- [Características](#características)
- [Arquitectura](#arquitectura)
- [Requisitos Previos](#requisitos-previos)
- [Instalación](#instalación)
- [Configuración](#configuración)
- [Uso](#uso)
- [Testing](#testing)
- [Despliegue](#despliegue)
- [Documentación](#documentación)

---

## ✨ Características

### Gestión de Suscripciones
- Ciclo completo: alta → billing → cobro → suspensión → reactivación
- Soporte para múltiples clientes y suscripciones
- Planes personalizados con precios y períodos configurables

### Sistema de Billing
- Generación automática de recibos mensuales
- Cobro con múltiples métodos (transferencia, efectivo, USDT)
- Cálculo de mora y suspensión automática por impago
- Reactivación con cálculo de prorrata

### Portal de Clientes
- Autenticación JWT con roles (admin/client)
- Clientes pueden consultar sus suscripciones y pagos
- Acceso restringido a información propia

### Notificaciones
- WhatsApp integration via Twilio
- Recordatorios automáticos de vencimiento
- Notificaciones de suspensión y reactivación
- Confirmación de pagos

### Seguridad
- Autenticación JWT con tokens refresh
- Validación de roles y permisos
- Rate limiting configurable
- Auditoría completa de operaciones

---

## 🏗️ Arquitectura

```
src/
├── api/                    # Controladores y rutas
│   ├── routes/            # Definición de endpoints
│   ├── controllers/       # Lógica de presentación
│   └── middlewares/       # Autenticación, validación, rate limiting
├── domain/                # Lógica de negocio
│   ├── entities/          # Modelos de dominio
│   ├── events/            # Eventos del sistema
│   └── services/          # Servicios de dominio
├── infrastructure/        # Capa de infraestructura
│   ├── database/          # Conexión y repositorios Firestore
│   ├── messaging/         # Integración con Twilio
│   └── security/          # JWT, encriptación
└── config/                # Configuración del sistema
```

### Patrones de Diseño
- **Domain-Driven Design**: Lógica de negocio aislada en `/domain`
- **Repository Pattern**: Abstracción de base de datos
- **Event-Driven Architecture**: Acoplamiento débil entre módulos
- **Clean Architecture**: Separación de responsabilidades
- **Single Responsibility**: Servicios especializados por dominio

### Servicios Especializados

| Servicio | Responsabilidad |
|----------|-----------------|
| `paymentService` | Ciclo de vida de pagos (register/confirm/void), cálculo de deuda |
| `reactivationService` | Orquestación de reactivación de suscripciones |
| `billingService` | Generación y suspensión de períodos, cálculo de mora |
| `subscriptionService` | Creación, transferencia, consulta de suscripciones |
| `clientService` | Gestión de clientes |
| `planService` | Gestión de planes y propagación atómica de cambios |
| `cronService` | Ejecución de jobs programados con TTL |

### Conexión WebSocket

El WebSocket requiere autenticación JWT. Para conectarte:

```javascript
// Cliente WebSocket con autenticación
const ws = new WebSocket('ws://localhost:3000/ws?token=TU_JWT_TOKEN');

// Opcional: filtrar por subscriptionId (solo admin)
const wsAdmin = new WebSocket('ws://localhost:3000/ws?token=TU_JWT_TOKEN&subscriptionId=SUB_ID');
```

**Reglas de seguridad:**
- Token JWT obligatorio en el handshake
- `organizationId` y `clientId` se derivan del JWT, no de query params
- Conexiones rechazadas si token es inválido o expirado

---

## 📦 Requisitos Previos

- **Node.js** >= 18.0.0
- **Firebase Project** con Firestore habilitado
- **Twilio Account** (para notificaciones WhatsApp)
- **npm** o **yarn**

---

## 🚀 Instalación

1. **Clonar repositorio**
```bash
git clone <repository-url>
cd starlink-subscription-api
```

2. **Instalar dependencias**
```bash
npm install
```

3. **Configurar variables de entorno**
```bash
# Copiar archivo de ejemplo
cp .env.example .env

# Editar .env con tus credenciales
# Ver sección "Configuración" para detalles
```

4. **Configurar Firebase**
   - Ver [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) para guía completa

5. **Compilar TypeScript**
```bash
npm run build
```

---

## ⚙️ Configuración

### Variables de Entorno

Copia `.env.example` y configura las siguientes variables:

#### Firebase (Requerido)

**Método 1: Variables de Entorno (Recomendado para Producción)**
```env
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@api-gestion-starlink.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
FIREBASE_PROJECT_ID=api-gestion-starlink
```

**Método 2: Archivo JSON (Solo Desarrollo Local)**
```env
FIREBASE_SERVICE_ACCOUNT_KEY_PATH=./credentials/firebase-admin.json
```

#### Twilio (Opcional - para notificaciones)
```env
TWILIO_ACCOUNT_SID=your_account_sid
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886
TWILIO_WHATSAPP_REMINDER_SID=your_template_sid
TWILIO_WHATSAPP_CUTOFF_SID=your_template_sid
TWILIO_WHATSAPP_SUSPENDED_SID=your_template_sid
```

#### JWT (Requerido)
```env
JWT_SECRET=your-super-secret-key-min-32-chars
JWT_EXPIRES_IN=24h
```

#### Opcional
```env
PORT=3000
NODE_ENV=development
TIMEZONE=America/Caracas
```

**Ver [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) para guía completa de configuración.**

---

## 💻 Uso

### Desarrollo
```bash
# Servidor con hot reload
npm run dev
```

### Producción
```bash
# Compilar
npm run build

# Ejecutar
npm start
```

### Endpoints Principales

#### Autenticación
```
POST /api/auth/login          # Login de usuarios
POST /api/auth/register       # Registro de usuarios (solo admin)
GET  /api/auth/me             # Obtener usuario actual
```

#### Clientes
```
GET    /api/client/profile       # Perfil del cliente autenticado
GET    /api/client/subscription  # Suscripciones del cliente
GET    /api/client/payments      # Historial de pagos
GET    /api/client/debt          # Deuda del cliente
```

#### Administración (requiere rol admin)
```
POST   /api/admin/dashboard      # Dashboard con métricas
POST   /api/admin/scheduler/run  # Ejecutar trabajo programado
GET    /api/admin/clients        # Listar clientes
POST   /api/admin/clients        # Crear cliente
```

#### Webhooks
```
POST /api/webhooks/twilio      # Recibir mensajes de WhatsApp
```

---

## 🧪 Testing

```bash
# Ejecutar todos los tests
npm test

# Modo watch
npm run test:watch

# Con cobertura
npm run test:coverage
```

**Cobertura de tests:**
- ✅ Integración de endpoints API
- ✅ Reglas de negocio (cobro, mora, reactivación)
- ✅ Cálculos de fechas y prorrata
- ✅ Validación de schemas
- ✅ Autenticación y permisos
- ✅ Manejo de errores

---

## 🚢 Despliegue

### Railway (Recomendado)

1. **Preparar proyecto**
   - Verificar que `.env` no esté en `.gitignore`
   - Asegurar que `package.json` tenga el script `start`

2. **Desplegar en Railway**
   - Crear proyecto en [railway.app](https://railway.app)
   - Conectar repositorio GitHub
   - Configurar variables de entorno desde dashboard
   - Railway detectará automáticamente Node.js

3. **Variables en Railway**
   - `FIREBASE_CLIENT_EMAIL`
   - `FIREBASE_PRIVATE_KEY`
   - `FIREBASE_PROJECT_ID`
   - `JWT_SECRET`
   - Variables de Twilio (si se usan)

### Docker

```bash
# Construir imagen
docker build -t starlink-subscription-api .

# Ejecutar
docker run -p 3000:3000 --env-file .env starlink-subscription-api
```

### Otras Plataformas
- **Vercel**: Configurar como Node.js app
- **Render**: Auto-detect Node.js
- **AWS/Azure/GCP**: Usar Docker o Node.js directamente

---

## 📚 Documentación

### Guías
- [Plan de Implementación](./starlink-subscription-api-plan.md) - Plan original y especificaciones
- [Configuración Firebase](./FIREBASE_SETUP.md) - Guía completa de autenticación
- [CHANGELOG](./CHANGELOG.md) - Historial de cambios

### Estructura del Proyecto
- `src/api/` - Controladores y rutas HTTP
- `src/domain/` - Lógica de negocio pura
- `src/infrastructure/` - Integraciones externas
- `src/config/` - Configuración del sistema
- `src/tests/` - Suite de tests

### Reglas de Negocio
- Billing mensual automático
- Cobro de mora por impago
- Suspensión automática tras período de gracia
- Reactivación con cálculo de prorrata
- Notificaciones por WhatsApp
- Portal de clientes con acceso restringido

---

## 🔒 Seguridad

### Buenas Prácticas Implementadas
- ✅ Variables de entorno para secrets
- ✅ JWT con expiración configurable
- ✅ Validación de entrada con schemas
- ✅ Rate limiting en endpoints críticos
- ✅ CORS configurado apropiadamente
- ✅ Helmet para headers de seguridad
- ✅ Auditoría de operaciones sensibles

### Para Producción
- Usar HTTPS
- Rotar `JWT_SECRET` regularmente
- Configurar `JWT_EXPIRES_IN` apropiado
- Monitorear logs de auditoría
- Implementar alertas de seguridad

---

## 🤝 Contribución

1. Fork el proyecto
2. Crear rama de feature (`git checkout -b feature/AmazingFeature`)
3. Commit cambios (`git commit -m 'Add: AmazingFeature'`)
4. Push a la rama (`git push origin feature/AmazingFeature`)
5. Abrir Pull Request

---

## 📄 Licencia

ISC

---

## 📞 Soporte

Para preguntas o problemas:
1. Revisar documentación en `/docs`
2. Verificar [FIREBASE_SETUP.md](./FIREBASE_SETUP.md) para problemas de configuración
3. Revisar issues en GitHub
4. Contactar al equipo de desarrollo

---

## 🗺️ Roadmap

- [ ] Portal de administración web completo
- [ ] API para integración con pasarelas de pago
- [ ] Reportes y dashboards avanzados
- [ ] Multi-organización
- [ ] Importación masiva de clientes
- [ ] API pública documentada (Swagger/OpenAPI)

---

**Desarrollado con ❤️ para gestión de suscripciones Starlink**
