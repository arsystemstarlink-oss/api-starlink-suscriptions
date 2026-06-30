# Plan API - Sistema de Gestión de Suscripciones Starlink

## 1. Objetivo

Construir un backend único para gestionar suscripciones tipo Starlink, centrado en el ciclo de vida:

`Cliente → Suscripción → BillingPeriod → Pagos → Estado del servicio`

El frontend nunca debe calcular reglas de facturación, suspensión, mora, prorrata o reactivación. Toda la lógica de negocio debe vivir en servicios del backend.

## 2. Alcance inicial

### Incluye

- Gestión de clientes.
- Gestión de suscripciones.
- Ciclos mensuales de facturación.
- Pagos parciales y completos.
- Mora por suspensión.
- Prorrata y recargo 5% tras reactivación suspendida.
- Suspensión automática por job diario.
- Notificaciones WhatsApp mediante Twilio.
- Auditoría completa con `ActivityLog`.
- API por comandos de negocio.
- Roles `admin` y `operator`.
- Modelo preparado para multi-organización.

### Fuera de alcance inicial

- Portal de clientes.
- App móvil.
- Integración real con control de servicio Starlink.
- Pasarela de pagos externa.
- Multi-organización completa con UI/administración avanzada.

## 3. Decisiones de diseño

- Base de datos: **Firestore**.
- Arquitectura backend: **monolítico modular**.
- Módulos principales:
  - clientes
  - suscripciones
  - facturación
  - pagos
  - suspensiones
  - notificaciones
  - cron
  - auditoría
  - autenticación/permisos
- Multi-organización preparada mediante `organizationId`.
- API expuesta como **REST + comandos de negocio**.
- Firestore se usa solo como persistencia; no debe contener lógica de negocio.
- Todas las operaciones financieras deben usar transacciones Firestore.
- Los jobs diarios deben ser idempotentes.
- Los pagos no se editan ni eliminan físicamente.

## 4. Modelo de datos Firestore

Estructura base:

```text
organizations/{organizationId}
  clients/{clientId}
  subscriptions/{subscriptionId}
  billingPeriods/{billingPeriodId}
  payments/{paymentId}
  lateFees/{lateFeeId}
  communications/{communicationId}
  activityLogs/{activityLogId}
  settings/{settingsId}
```

### Client

Campos principales:

- `id`
- `organizationId`
- `name`
- `dni`
- `phone`
- `address`
- `email`
- `createdAt`
- `updatedAt`

Reglas:

- `name` obligatorio.
- `dni` obligatorio y único por organización.
- `phone` obligatorio y único por organización.
- `address` obligatorio.
- `email` obligatorio y único por organización.

### Plan

Campos principales:

- `id`
- `organizationId`
- `name` — único por organización
- `priceUsd`
- `lateFeeUsd`
- `graceDays`
- `description?`
- `isActive`
- `createdAt`
- `updatedAt`

Reglas:

- `name` obligatorio y único por organización.
- `priceUsd > 0`.
- `lateFeeUsd >= 0` (default `10`).
- `graceDays >= 0` (default `30`).
- `isActive` default `true`.

### Subscription

Campos principales:

- `id`
- `organizationId`
- `starlinkAccountId` — identificador único de la cuenta Starlink (único por organización)
- `kitId`
- `plan`
- `priceUsd`
- `status`
- `dueDay`
- `graceDays`
- `lateFeeUsd`
- `currentOwnerName`
- `currentOwnerDni`
- `starlinkEmail` — email de la cuenta Starlink (obligatorio, tomado automáticamente del email del cliente)
- `starlinkPassword` — password de la cuenta Starlink (obligatorio al crear la suscripción)
- `createdAt`
- `updatedAt`

Estados:

- `paused`
- `active`
- `suspended`
- `cancelled`

Reglas:

- `starlinkAccountId` único por organización (identificador de la cuenta Starlink).
- `kitId` identifica el equipo/antena física.
- `starlinkEmail` se toma automáticamente del email del cliente. El cliente debe tener email asignado antes de crear una suscripción.
- `starlinkPassword` es el password de la cuenta Starlink (diferente al password del portal del cliente). Se proporciona al crear la suscripción.
- Juntos, `starlinkEmail` y `starlinkPassword` almacenan las credenciales de acceso a la cuenta Starlink para centralizar la gestión de las antenas.
- Una suscripción puede tener múltiples períodos, pero solo uno activo de servicio.
- Puede transferirse sin cambiar `starlinkAccountId`.
- Al crearla queda `paused` hasta confirmar el primer pago.
- La transferencia actualiza `clientId`, `currentOwnerName` y `currentOwnerDni` sin perder historial.

### BillingPeriod

Campos principales:

- `id`
- `organizationId`
- `subscriptionId`
- `clientId`
- `type`: `regular` | `advance`
- `startDate`
- `endDate`
- `dueDate`
- `status`
- `amountUsd`
- `paidAmountUsd`
- `surchargeUsd`
- `suspensionDate`
- `createdAt`
- `updatedAt`

Estados:

- `pending`
- `partial`
- `paid`
- `overdue`
- `suspended`

Reglas:

- Representa la unidad principal de deuda.
- Un período regular cubre un ciclo mensual.
- Un período de adelanto cubre uso desde fecha de pago hasta próximo corte.
- Solo debe existir un período activo de servicio por suscripción.
- Al pagar completamente un período regular, se crea el siguiente período regular.
- El período original queda `paid` cuando se liquida su deuda.

### Payment

Campos principales:

- `id`
- `organizationId`
- `billingPeriodId`
- `subscriptionId`
- `clientId`
- `amount`
- `currency`: `USD` | `USDT` | `Bs` | `Zinli`
- `exchangeRate`
- `amountUsd`
- `reference`
- `paidAt`
- `createdBy`
- `confirmedBy`
- `voidedBy`
- `voidReason`
- `status`
- `createdAt`
- `updatedAt`

Estados:

- `registered`
- `confirmed`
- `voided`

Reglas:

- Solo pagos `confirmed` afectan deuda, estados, mora, prorrata y reactivación.
- `reference` obligatorio (cadena libre, usada para identificar el pago de forma única).
- `exchangeRate` obligatorio (se usa para calcular `amountUsd`).
- `amount > 0`.
- `amountUsd = amount * exchangeRate`.
- `amountUsd` debe redondearse a 2 decimales.
- El operador puede registrar pagos, pero quedan `registered`.
- El admin confirma pagos.
- Los pagos no se editan ni eliminan.
- Para anular, se cambia a `voided` con motivo y auditoría.

### LateFee

Campos principales:

- `id`
- `organizationId`
- `billingPeriodId`
- `subscriptionId`
- `amountUsd`
- `status`
- `createdAt`
- `appliedAt`

Reglas:

- Se aplica una sola vez por ciclo suspendido.
- Es un concepto separado del precio base.
- No modifica `BillingPeriod.amountUsd`.

### Communication

Campos principales:

- `id`
- `organizationId`
- `clientId`
- `subscriptionId`
- `type`
- `channel`
- `provider`
- `status`
- `sentAt`
- `errorMessage`
- `payload`
- `createdAt`

Tipos:

- `payment_reminder`
- `overdue`
- `suspended`
- `payment_confirmed`

Proveedor principal:

- `twilio`

### ActivityLog

Campos principales:

- `id`
- `organizationId`
- `actorId`
- `actorRole`
- `action`
- `entityType`
- `entityId`
- `before`
- `after`
- `reason`
- `createdAt`
- `metadata`

Debe registrar:

- creación de clientes
- creación de suscripciones
- transferencias
- pagos registrados
- pagos confirmados
- pagos anulados
- suspensiones manuales
- suspensiones automáticas
- mora aplicada
- reactivaciones
- comunicaciones enviadas
- ejecución del job diario

## 5. Reglas de negocio críticas

### 5.1 Creación de suscripción

Al crear una suscripción:

1. Se crea `Subscription` con `status = paused`.
2. Se crea el primer `BillingPeriod` regular.
3. `startDate` es la fecha de activación administrativa.
4. `dueDate` es el próximo día fijo mensual configurado.
5. La suscripción no entra en recordatorios ni suspensión hasta que se confirme el primer pago.
6. Al confirmar el primer pago, pasa a `active`.

Ejemplo:

- Activación: 5 de mayo.
- Corte mensual: día 5.
- Primer vencimiento: 5 de junio.

### 5.2 Pago completo de período regular

Cuando un período regular se paga completamente:

1. `BillingPeriod.status = paid`.
2. Se crea el siguiente período regular.
3. El siguiente vencimiento respeta el día fijo mensual.

Ejemplo:

- Vence 5 de junio.
- Se paga completo.
- Siguiente vencimiento: 5 de julio.

### 5.3 Pago parcial

Se permiten pagos parciales.

Reglas:

- Un período puede tener múltiples pagos confirmados.
- `BillingPeriod.status = partial` mientras `paidAmountUsd < amountUsd`.
- `BillingPeriod.status = paid` solo cuando el saldo sea 0.
- Un pago parcial no reactiva una suscripción suspendida.

### 5.4 Vencimiento

Reglas:

- Si llega el `dueDate` y no está pagado, el período sigue pendiente el mismo día.
- Al día siguiente del vencimiento, pasa a `overdue`.
- El job diario debe corregir estados automáticamente.

Ejemplo:

- `dueDate = 2026-05-05`
- `overdueDate = 2026-05-06`

### 5.5 Suspensión automática

Reglas:

- Una suscripción vencida se suspende después de `graceDays`.
- `suspensionDate = dueDate + graceDays`.
- Si `graceDays = 30`, vencimiento 5 de mayo implica suspensión 5 de junio.
- Al suspenderse:
  - `BillingPeriod.status = suspended`
  - `Subscription.status = suspended`
  - se crea `LateFee`
  - se registra `ActivityLog`
  - se envía WhatsApp de suspensión

### 5.6 Mora

Reglas:

- La mora es fija por suscripción/ciclo.
- Se guarda en `LateFee`.
- Se aplica una sola vez por ciclo suspendido.
- No modifica el monto original del período.
- Es obligatoria para reactivar si la suscripción fue suspendida.

### 5.7 Prorrata

La prorrata se usa cuando una suscripción suspendida paga para reactivar y quiere usar el servicio hasta el próximo corte.

Reglas:

- Se calcula con 30 días fijos.
- `dailyRate = priceUsd / 30`
- `advanceAmountUsd = dailyRate * díasRestantesHastaProximoCorte`
- Se guarda como `BillingPeriod.type = advance`.
- El recargo 5% se guarda separado dentro del adelanto.

Ejemplo:

- Mensualidad: `120 USD`
- Pago: 30 de junio
- Próximo corte: 5 de julio
- Días restantes: 10
- `dailyRate = 120 / 30 = 4`
- Prorrata: `10 * 4 = 40`
- Recargo 5%: `40 * 0.05 = 2`
- Total de adelanto: `42 USD`

### 5.8 Reactivación

Una suscripción suspendida solo se reactiva si paga todo lo obligatorio:

```text
totalReactivation =
  deudaVencidaUsd +
  lateFeeUsd +
  advanceAmountUsd +
  surchargeUsd
```

Reglas:

- No se reactiva con pago parcial.
- No se reactiva si falta mora.
- No se reactiva si falta prorrata.
- No se reactiva si falta recargo 5%.
- El backend debe recalcular el total antes de confirmar la reactivación.
- El frontend solo muestra el total calculado por el backend.

Ejemplo completo:

- Mensualidad: `120 USD`
- Mora: `10 USD`
- Pago reactivación: 30 de junio
- Prórroga hasta 5 de julio: `40 USD`
- Recargo 5%: `2 USD`
- Total reactivación: `172 USD`

Resultado:

- Período vencido original queda `paid`.
- `LateFee` queda aplicado.
- Se crea `BillingPeriod` de adelanto `paid`.
- Recargo 5% queda registrado separado.
- `Subscription.status = active`.
- Siguiente período regular queda pendiente con fecha de corte correspondiente.

### 5.9 Transferencia

Reglas:

- El `starlinkAccountId` no cambia.
- Se actualiza:
  - `clientId`
  - `currentOwnerName`
  - `currentOwnerDni`
- El historial del código y pagos se conserva.
- Se registra `ActivityLog`.

## 6. API principal

> **Convenciones generales (aplican a todos los endpoints):**
>
> - Base URL: `/api`
> - Autenticación: header `Authorization: Bearer <JWT>` en todos los endpoints excepto `POST /api/auth/login` y `POST /api/communications/webhook/twilio`.
> - Roles: `admin` requiere middleware `requireAdmin`. Sin middleware = cualquier rol autenticado.
> - Paginación: query params `page` (default `1`) y `limit` (default `20`, max `100`).
> - Respuestas de error: `{ "message": "descripción del error" }` con HTTP status correspondiente.
> - Timestamps en formato ISO 8601 (`YYYY-MM-DDTHH:mm:ss.sssZ`).

#### Resumen de endpoints

| Método | Path | Auth | Sección |
|--------|------|------|---------|
| GET | `/api/health` | — | 6.1 |
| POST | `/api/auth/login` | — | 6.2 |
| POST | `/api/auth/register` | admin | 6.2 |
| POST | `/api/auth/register-client` | admin | 6.2 |
| GET | `/api/auth/me` | auth | 6.2 |
| GET | `/api/auth/users` | admin | 6.2 |
| PUT | `/api/auth/users/:id/activate` | admin | 6.2 |
| PUT | `/api/auth/users/:id/deactivate` | admin | 6.2 |
| GET | `/api/clients` | admin | 6.3 |
| POST | `/api/clients` | admin | 6.3 |
| GET | `/api/clients/:id` | auth | 6.3 |
| PUT | `/api/clients/:id` | admin | 6.3 |
| DELETE | `/api/clients/:id` | admin | 6.3 |
| GET | `/api/plans` | auth | 6.4 |
| GET | `/api/plans/:id` | auth | 6.4 |
| POST | `/api/plans` | admin | 6.4 |
| PUT | `/api/plans/:id` | admin | 6.4 |
| POST | `/api/plans/:id/propagate` | admin | 6.4 |
| GET | `/api/subscriptions/:id` | auth | 6.5 |
| POST | `/api/subscriptions` | admin | 6.5 |
| POST | `/api/subscriptions/:id/transfer` | admin | 6.5 |
| POST | `/api/subscriptions/:id/suspend` | admin | 6.5 |
| POST | `/api/subscriptions/:id/payments` | admin | 6.5 |
| GET | `/api/subscriptions/:id/debt` | admin | 6.5 |
| GET | `/api/subscriptions/:id/reactivation-quote` | admin | 6.5 |
| POST | `/api/subscriptions/:id/reactivate` | admin | 6.5 |
| POST | `/api/payments/:id/confirm` | admin | 6.6 |
| POST | `/api/payments/:id/void` | admin | 6.6 |
| POST | `/api/communications/webhook/twilio` | Twilio sig | 6.7 |
| GET | `/api/communications/:id` | admin | 6.7 |
| GET | `/api/communications/client/:clientId` | admin | 6.7 |
| POST | `/api/communications/send` | admin | 6.7 |
| GET | `/api/cron/config` | — | 6.8 |
| PUT | `/api/cron/config` | admin | 6.8 |
| POST | `/api/cron/daily` | admin | 6.8 |
| GET | `/api/client/profile` | client | 6.9 |
| GET | `/api/client/subscription` | client | 6.9 |
| GET | `/api/client/payments` | client | 6.9 |
| GET | `/api/client/debt` | client | 6.9 |
| WS | `/ws?token=<JWT>` | auth JWT | 6.10 |

### 6.1 Health

#### `GET /api/health`

Verificar estado del servidor.

**Auth:** ninguna

Respuesta (`200`):

```json
{
  "status": "ok",
  "timestamp": "2026-06-29T12:00:00.000Z"
}
```

### 6.2 Autenticación `/api/auth`

#### `POST /api/auth/login`

Iniciar sesión y obtener JWT.

**Auth:** ninguna

Request:

```json
{
  "email": "admin@ejemplo.com",
  "password": "password123"
}
```

Validaciones:

- `email` formato email válido
- `password` mínimo 6 caracteres

Respuesta (`200`):

```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user_123",
    "email": "admin@ejemplo.com",
    "name": "Administrador",
    "role": "admin"
  },
  "expiresIn": 3600
}
```

Errores:

- `400` — datos inválidos
- `403` — usuario desactivado
- `403` — credenciales incorrectas

#### `POST /api/auth/register`

Registrar nuevo usuario.

**Auth:** `admin`

Request:

```json
{
  "email": "cliente@ejemplo.com",
  "password": "password123",
  "name": "Juan Pérez",
  "role": "client",
  "clientId": "client_123"
}
```

Validaciones:

- `email` formato email válido
- `password` mínimo 6 caracteres
- `name` obligatorio
- `role` — `"admin"` | `"client"` (default `"client"`)
- `clientId` obligatorio si `role` es `"client"`
- `email` único por organización

Respuesta (`201`):

```json
{
  "id": "user_456",
  "organizationId": "default",
  "email": "cliente@ejemplo.com",
  "name": "Juan Pérez",
  "role": "client",
  "clientId": "client_123",
  "isActive": true,
  "createdAt": "2026-06-29T12:00:00.000Z",
  "updatedAt": "2026-06-29T12:00:00.000Z"
}
```

Errores:

- `409` — email ya registrado

#### `POST /api/auth/register-client`

Registrar un nuevo cliente completo con credenciales de acceso. Unifica la creación del Client (entidad de negocio) y el User (entidad de autenticación) en una sola operación. El cliente queda automáticamente vinculado.

**Auth:** `admin`

Request:

```json
{
  "name": "Juan Pérez",
  "dni": "V-12345678",
  "phone": "+584141234567",
  "address": "Av. Principal 123",
  "email": "juan@starlink.com",
  "password": "password123"
}
```

Validaciones:

- `name` obligatorio
- `dni` obligatorio y único por organización
- `phone` obligatorio (mínimo 7 caracteres) y único por organización
- `address` obligatorio
- `email` formato email válido, único por organización
- `password` mínimo 6 caracteres
- Devuelve `400` si faltan campos obligatorios
- Devuelve `409` si el email ya existe
- Devuelve `403` si no tiene permisos de admin

Respuesta (`201`):

```json
{
  "client": {
    "id": "client_123",
    "organizationId": "default",
    "name": "Juan Pérez",
    "dni": "V-12345678",
    "phone": "+584141234567",
    "address": "Av. Principal 123",
    "email": "juan@starlink.com",
    "createdAt": "2026-06-29T12:00:00.000Z",
    "updatedAt": "2026-06-29T12:00:00.000Z"
  },
  "user": {
    "id": "user_456",
    "email": "juan@starlink.com",
    "name": "Juan Pérez",
    "role": "client",
    "clientId": "client_123",
    "isActive": true,
    "createdAt": "2026-06-29T12:00:00.000Z",
    "updatedAt": "2026-06-29T12:00:00.000Z"
  }
}
```

Respuesta detallada:

- `client`: datos del cliente creado (entidad de negocio)
- `user`: datos del usuario creado (entidad de autenticación), con `role: "client"` y `clientId` vinculado

Errores:

- `400` — campos faltantes o formato inválido
- `403` — sin permisos de admin
- `409` — email ya registrado

**Flujo completo desde el frontend:**

```
1. Admin envía POST /api/auth/register-client con datos del cliente + email + password
2. Backend crea automáticamente:
   - Client (entidad de negocio)
   - User con role=client vinculado al Client
3. Backend devuelve datos del client + datos del user
4. Admin proporciona las credenciales (email/password) al cliente
5. Cliente inicia sesión con POST /api/auth/login
```

**Ejemplo de uso:**

```bash
# Admin registra un nuevo cliente
POST /api/auth/register-client
Authorization: Bearer admin-jwt-token
{
  "name": "Juan Pérez",
  "dni": "V-12345678",
  "phone": "+584141234567",
  "address": "Av. Principal 123",
  "email": "juan@starlink.com",
  "password": "password123"
}

# Respuesta: { "client": {...}, "user": {...} }

# El admin proporciona las credenciales al cliente
# El cliente inicia sesión
POST /api/auth/login
{
  "email": "juan@starlink.com",
  "password": "password123"
}
# Respuesta: { "token": "eyJhbG...", "user": {...}, "expiresIn": 3600 }

# Ahora el cliente puede acceder al portal
GET /api/client/profile
Authorization: Bearer eyJhbG...
# Respuesta: { "id": "client_123", "name": "Juan Pérez", ... }
```

#### `GET /api/auth/me`

Obtener datos del usuario autenticado.

**Auth:** cualquier rol

Respuesta (`200`):

```json
{
  "id": "user_123",
  "organizationId": "default",
  "email": "admin@ejemplo.com",
  "name": "Administrador",
  "role": "admin",
  "isActive": true,
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

#### `GET /api/auth/users`

Listar todos los usuarios de la organización (excluye `passwordHash`).

**Auth:** `admin`

Respuesta (`200`):

```json
[
  {
    "id": "user_123",
    "email": "admin@ejemplo.com",
    "name": "Administrador",
    "role": "admin",
    "isActive": true,
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-01-01T00:00:00.000Z"
  },
  {
    "id": "user_456",
    "email": "cliente@ejemplo.com",
    "name": "Juan Pérez",
    "role": "client",
    "clientId": "client_123",
    "isActive": true,
    "createdAt": "2026-01-02T00:00:00.000Z",
    "updatedAt": "2026-01-02T00:00:00.000Z"
  }
]
```

#### `PUT /api/auth/users/:userId/activate`

Activar usuario desactivado.

**Auth:** `admin`

Respuesta (`200`):

```json
{
  "message": "Usuario activado"
}
```

#### `PUT /api/auth/users/:userId/deactivate`

Desactivar usuario (no podrá iniciar sesión).

**Auth:** `admin`

Respuesta (`200`):

```json
{
  "message": "Usuario desactivado"
}
```

### 6.3 Clientes `/api/clients`

#### `GET /api/clients`

Listar clientes paginado.

**Auth:** `admin`

Query params:

- `page` (default `1`)
- `limit` (default `20`, max `100`)

Respuesta (`200`):

```json
{
  "data": [
    {
      "id": "client_123",
      "name": "Juan Pérez",
      "dni": "12345678",
      "phone": "+580000000000",
      "address": "Dirección completa",
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 45,
  "totalPages": 3
}
```

#### `POST /api/clients`

Crear cliente.

**Auth:** `admin`

Request:

```json
{
  "name": "Juan Pérez",
  "dni": "12345678",
  "phone": "+580000000000",
  "address": "Dirección completa",
  "email": "juan.perez@example.com"
}
```

Validaciones:

- `name` obligatorio
- `dni` obligatorio y único por organización
- `phone` obligatorio (mínimo 7 caracteres) y único por organización
- `address` obligatorio
- `email` obligatorio, formato email válido

Respuesta (`201`):

```json
{
  "id": "client_123",
  "organizationId": "default",
  "name": "Juan Pérez",
  "dni": "12345678",
  "phone": "+580000000000",
  "address": "Dirección completa",
  "email": "juan.perez@example.com",
  "createdAt": "2026-06-29T12:00:00.000Z",
  "updatedAt": "2026-06-29T12:00:00.000Z"
}
```

Errores:

- `409` — DNI o teléfono ya registrado

#### `GET /api/clients/:clientId`

Obtener cliente con resumen de suscripciones.

**Auth:** cualquier rol autenticado

Respuesta (`200`):

```json
{
  "id": "client_123",
  "name": "Juan Pérez",
  "dni": "12345678",
  "phone": "+580000000000",
  "address": "Dirección completa",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z",
  "subscriptions": [
    {
      "id": "sub_123",
      "starlinkAccountId": "ACC-01-0001",
      "plan": "Starlink Residential",
      "planId": "plan_001",
      "status": "active",
      "priceUsd": 120,
      "dueDay": 5
    }
  ]
}
```

#### `PUT /api/clients/:clientId`

Actualizar cliente (campos parciales).

**Auth:** `admin`

Request:

```json
{
  "name": "Juan P. Actualizado",
  "phone": "+580000000001",
  "address": "Nueva dirección"
}
```

Validaciones:

- Al menos un campo obligatorio
- `dni` y `phone` únicos si se modifican

Respuesta (`200`): objeto `Client` actualizado.

#### `DELETE /api/clients/:clientId`

Eliminar cliente.

**Auth:** `admin`

Respuesta: `204 No Content`

### 6.4 Planes `/api/plans`

#### `GET /api/plans`

Listar planes activos paginado.

**Auth:** cualquier rol autenticado

Query params:

- `page` (default `1`)
- `limit` (default `20`)
- `includeInactive=true` (opcional, incluye planes inactivos)

Respuesta (`200`):

```json
{
  "data": [
    {
      "id": "plan_001",
      "name": "Starlink Residential",
      "priceUsd": 120,
      "lateFeeUsd": 10,
      "graceDays": 30,
      "description": "Plan estándar residencial",
      "isActive": true,
      "createdAt": "2026-01-01T00:00:00.000Z",
      "updatedAt": "2026-01-01T00:00:00.000Z"
    }
  ],
  "page": 1,
  "limit": 20,
  "total": 3,
  "totalPages": 1
}
```

#### `GET /api/plans/:planId`

Obtener plan por ID.

**Auth:** cualquier rol autenticado

Respuesta (`200`): objeto `Plan` completo.

#### `POST /api/plans`

Crear plan.

**Auth:** `admin`

Request:

```json
{
  "name": "Starlink Residential",
  "priceUsd": 120,
  "lateFeeUsd": 10,
  "graceDays": 30,
  "description": "Plan estándar residencial"
}
```

Validaciones:

- `name` obligatorio y único por organización. Se normaliza automáticamente a **Title Case** (cada palabra con mayúscula inicial)
- `priceUsd > 0`.
- `lateFeeUsd >= 0` (default `10`).
- `graceDays >= 0` (default `30`).
- `description` opcional.

Respuesta (`201`):

```json
{
  "id": "plan_001",
  "organizationId": "default",
  "name": "Starlink Residential",
  "priceUsd": 120,
  "lateFeeUsd": 10,
  "graceDays": 30,
  "description": "Plan estándar residencial",
  "isActive": true,
  "createdAt": "2026-06-29T12:00:00.000Z",
  "updatedAt": "2026-06-29T12:00:00.000Z"
}
```

Errores:

- `409` — nombre ya registrado

**Nota sobre normalización**: El campo `name` se normaliza automáticamente a **Title Case**. Por ejemplo:
- `"starlink residential"` → `"Starlink Residential"`
- `"PREMIUM PLAN"` → `"Premium Plan"`
- `"basic"` → `"Basic"`

La normalización también se aplica al actualizar planes vía `PUT /api/plans/:planId`.

#### `PUT /api/plans/:planId`

Actualizar plan (campos parciales).

**Auth:** `admin`

Request:

```json
{
  "priceUsd": 150,
  "lateFeeUsd": 15,
  "isActive": true
}
```

Validaciones:

- Al menos un campo obligatorio

Respuesta (`200`): objeto `Plan` actualizado.

#### `POST /api/plans/:planId/propagate`

Propagar cambios del plan a suscripciones activas.

**Auth:** `admin`

**Precaución:** actualiza `priceUsd`, `lateFeeUsd` y `graceDays` en todas las suscripciones asociadas al plan.

Request:

```json
{
  "preview": true
}
```

Validaciones:

- `preview` booleano (default `false`)

Respuesta (`200`) con `preview: true`:

```json
{
  "plan": {
    "id": "plan_001",
    "name": "Starlink Residential",
    "priceUsd": 150,
    "lateFeeUsd": 15,
    "graceDays": 30
  },
  "preview": true,
  "affectedSubscriptions": 15,
  "changes": [
    {
      "subscriptionId": "sub_123",
      "starlinkAccountId": "ACC-01-0001",
      "status": "active",
      "currentPriceUsd": 120,
      "currentLateFeeUsd": 10,
      "currentGraceDays": 30,
      "newPriceUsd": 150,
      "newLateFeeUsd": 15,
      "newGraceDays": 30
    }
  ]
}
```

Respuesta (`200`) con `preview: false`:

```json
{
  "plan": {
    "id": "plan_001",
    "name": "Starlink Residential",
    "priceUsd": 150,
    "lateFeeUsd": 15,
    "graceDays": 30
  },
  "preview": false,
  "applied": true,
  "affectedSubscriptions": 15,
  "changes": [
    {
      "subscriptionId": "sub_123",
      "starlinkAccountId": "ACC-01-0001",
      "status": "active",
      "currentPriceUsd": 120,
      "currentLateFeeUsd": 10,
      "currentGraceDays": 30,
      "newPriceUsd": 150,
      "newLateFeeUsd": 15,
      "newGraceDays": 30
    }
  ]
}
```

### 6.5 Suscripciones `/api/subscriptions`

#### `GET /api/subscriptions/:subscriptionId`

Obtener suscripción con datos enriquecidos en una sola respuesta.

**Auth:** cualquier rol autenticado

Respuesta:

```json
{
  "subscription": {
    "id": "sub_123",
    "starlinkAccountId": "ACC-01-0001",
    "planName": "Starlink Residential",
    "planId": "plan_001",
    "clientId": "client_123",
    "priceUsd": 120,
    "status": "active",
    "dueDay": 5,
    "graceDays": 30,
    "lateFeeUsd": 10,
    "currentOwnerName": "Juan Pérez",
    "currentOwnerDni": "12345678"
  },
  "client": {
    "id": "client_123",
    "name": "Juan Pérez",
    "dni": "12345678",
    "phone": "+580000000000",
    "address": "Dirección completa"
  },
  "activePeriod": {
    "id": "bp_123",
    "startDate": "2026-05-05",
    "dueDate": "2026-06-05",
    "amountUsd": 120,
    "paidAmountUsd": 50,
    "balanceUsd": 70,
    "status": "partial"
  },
  "debt": {
    "totalDueUsd": 80,
    "overduePeriods": 1,
    "hasLateFees": false
  },
  "periods": [
    {
      "id": "bp_123",
      "type": "regular",
      "startDate": "2026-05-05",
      "dueDate": "2026-06-05",
      "amountUsd": 120,
      "paidAmountUsd": 50,
      "status": "partial"
    }
  ],
  "calculated": {
    "status": "overdue",
    "daysUntilDue": -2,
    "isOverdue": true,
    "isSuspended": false
  }
}
```

Campos:

- **subscription** — datos básicos de la suscripción
- **client** — datos del titular actual
- **activePeriod** — período pendiente o parcial (si existe), incluye `balanceUsd` calculado
- **debt** — resumen de deuda: total adeudado, períodos vencidos, si tiene mora
- **periods** — historial completo de períodos
- **calculated.status** — estado interpretado: `active`, `overdue`, `suspended`, `paused`, `cancelled`
- **calculated.daysUntilDue** — días hasta vencimiento (negativo = ya venció)
- **calculated.isOverdue** — true si el período activo pasó su `dueDate`
- **calculated.isSuspended** — true si la suscripción está suspendida

#### `POST /api/subscriptions`

Crear suscripción.

**Auth:** `admin`

Request:

```json
{
  "clientId": "client_123",
  "starlinkAccountId": "ACC-01-0001",
  "kitId": "KIT-2026-001",
  "planId": "plan_001",
  "dueDay": 5,
  "starlinkPassword": "password123"
}
```

Validaciones:

- `clientId` debe existir y tener email asignado
- `starlinkAccountId` obligatorio y único por organización
- `kitId` obligatorio
- `planId` obligatorio y debe existir
- `dueDay` entre 1 y 31
- `starlinkPassword` obligatorio

> **Nota:** El `starlinkEmail` se toma automáticamente del email del cliente. No se necesita especificar en el request.

Respuesta (`201`):

```json
{
  "subscriptionId": "sub_123",
  "status": "paused",
  "initialBillingPeriodId": "bp_123",
  "dueDate": "2026-07-05"
}
```

Errores:

- `409` — código de suscripción ya registrado

#### `POST /api/subscriptions/:subscriptionId/transfer`

Transferir suscripción a otro cliente.

**Auth:** `admin`

Request:

```json
{
  "newClientId": "client_456",
  "currentOwnerName": "María López",
  "currentOwnerDni": "87654321",
  "reason": "Cambio de titular"
}
```

Validaciones:

- `newClientId` debe existir
- `currentOwnerName` obligatorio
- `currentOwnerDni` obligatorio
- `reason` obligatorio
- El `starlinkAccountId` de la suscripción no cambia

Respuesta (`200`): suscripción actualizada con nuevo `clientId`, `currentOwnerName` y `currentOwnerDni`.

#### `POST /api/subscriptions/:subscriptionId/suspend`

Suspensión manual.

**Auth:** `admin`

Request:

```json
{
  "reason": "Mora impaga confirmada por administrador"
}
```

Validaciones:

- `reason` obligatorio

Respuesta (`200`): suscripción en estado `suspended`.

Efectos:

- Cambia status a `suspended`
- Aplica mora (`LateFee`) si no existe
- Envía WhatsApp de suspensión
- Registra `ActivityLog`

#### `POST /api/subscriptions/:subscriptionId/payments`

Registrar pago.

**Auth:** `admin`

Request:

```json
{
  "billingPeriodId": "bp_123",
  "amount": 120,
  "currency": "USD",
  "exchangeRate": 1,
  "reference": "REF-001",
  "paidAt": "2026-05-30T12:00:00Z"
}
```

Validaciones:

- `billingPeriodId` obligatorio
- `amount > 0`
- `currency` — `"USD"` | `"USDT"` | `"Bs"` | `"Zinli"`
- `exchangeRate > 0`
- `reference` obligatorio
- `paidAt` opcional (ISO 8601), default ahora

Respuesta (`201`):

```json
{
  "paymentId": "pay_123",
  "status": "registered"
}
```

El pago queda `registered` hasta que un admin lo confirme.

Errores:

- `400` — período ya pagado o datos inválidos

#### `GET /api/subscriptions/:subscriptionId/debt`

Consultar deuda completa de la suscripción.

**Auth:** `admin`

Respuesta (`200`):

```json
{
  "subscriptionId": "sub_123",
  "status": "suspended",
  "overduePeriods": [
    {
      "billingPeriodId": "bp_123",
      "startDate": "2026-05-05",
      "dueDate": "2026-06-05",
      "amountUsd": 120,
      "paidAmountUsd": 0,
      "balanceUsd": 120,
      "lateFeeUsd": 10
    }
  ],
  "advance": {
    "days": 10,
    "amountUsd": 40,
    "surchargeUsd": 2,
    "totalUsd": 42
  },
  "totalDueUsd": 172
}
```

#### `GET /api/subscriptions/:subscriptionId/reactivation-quote`

Consultar total necesario para reactivar una suscripción suspendida.

**Auth:** `admin`

Respuesta (`200`):

```json
{
  "canReactivate": false,
  "requiredUsd": 172,
  "breakdown": {
    "overdueAmountUsd": 120,
    "lateFeeUsd": 10,
    "advanceAmountUsd": 40,
    "surchargeUsd": 2
  },
  "nextCutoffDate": "2026-07-05"
}
```

Campos:

- **canReactivate** — true si la suscripción está suspendida y puede reactivarse
- **requiredUsd** — monto total necesario (deuda + mora + prorrata + recargo 5%)
- **breakdown** — desglose detallado del cálculo
- **nextCutoffDate** — próxima fecha de corte si se reactiva

#### `POST /api/subscriptions/:subscriptionId/reactivate`

Reactivar suscripción suspendida.

**Auth:** `admin`

Request:

```json
{
  "paymentIds": ["pay_123"],
  "expectedTotalUsd": 172
}
```

Validaciones:

- `paymentIds` — al menos 1 ID de pago `confirmed`
- `expectedTotalUsd` se recalcula internamente; si los pagos no cubren el total, se rechaza

Respuesta (`200`): suscripción actualizada con `status: "active"`.

Efectos:

- Marca período vencido como `paid`
- Aplica mora (`LateFee`)
- Crea/valida período de adelanto (`BillingPeriod type=advance`)
- Registra recargo 5% (`surchargeUsd`)
- Cambia status a `active`
- Crea siguiente período regular
- Envía WhatsApp de confirmación
- Registra `ActivityLog`

### 6.6 Pagos `/api/payments`

#### `POST /api/payments/:paymentId/confirm`

Confirmar pago registrado.

**Auth:** `admin`

Request:

```json
{
  "confirmedAt": "2026-05-30T12:05:00Z"
}
```

Request body opcional. Si `confirmedAt` no se envía, se usa la fecha actual.

Respuesta (`200`): pago actualizado con `status: "confirmed"`.

Efectos:

- `Payment.status = confirmed`
- Recalcula `BillingPeriod.paidAmountUsd`
- Si el período queda pagado: crea siguiente período regular
- Si reactiva una suscripción suspendida: aplica prorrata y recargo
- Envía WhatsApp de confirmación
- Registra `ActivityLog`

#### `POST /api/payments/:paymentId/void`

Anular pago.

**Auth:** `admin`

Request:

```json
{
  "reason": "Pago registrado por error"
}
```

Validaciones:

- `reason` obligatorio

Respuesta (`200`): pago actualizado con `status: "voided"`.

Efectos:

- `Payment.status = voided`
- Recalcula deuda
- No elimina el documento original
- Registra motivo y `ActivityLog`

### 6.7 Comunicaciones `/api/communications`

#### `POST /api/communications/webhook/twilio`

Webhook de Twilio para mensajes entrantes.

**Auth:** validación de firma Twilio (middleware `validateTwilioWebhook`)

Twilio envía `application/x-www-form-urlencoded`:

- `From` — número del remitente (p.ej. `whatsapp:+580000000000`)
- `Body` — texto del mensaje
- `MessageSid` — ID único del mensaje en Twilio

Respuesta (`200`):

```json
{
  "communicationId": "comm_123",
  "status": "received"
}
```

Si el número no corresponde a un cliente registrado, retorna `200` con mensaje informativo pero no crea comunicación.

#### `GET /api/communications/:communicationId`

Obtener comunicación por ID.

**Auth:** `admin`

Respuesta (`200`):

```json
{
  "id": "comm_123",
  "organizationId": "default",
  "clientId": "client_123",
  "subscriptionId": "sub_123",
  "type": "payment_reminder",
  "channel": "whatsapp",
  "provider": "twilio",
  "status": "sent",
  "sentAt": "2026-06-02T08:00:00.000Z",
  "payload": {
    "to": "whatsapp:+580000000000",
    "from": "whatsapp:+1234567890",
    "messageSid": "SM..."
  },
  "createdAt": "2026-06-02T07:59:00.000Z"
}
```

Tipos de comunicación:

- `payment_reminder` — recordatorio 3 días antes del vencimiento
- `overdue` — notificación de vencimiento
- `suspended` — notificación de suspensión
- `payment_confirmed` — confirmación de pago
- `manual` — mensaje manual enviado por admin
- `received` — mensaje entrante del cliente

Estados:

- `queued` — en cola
- `sent` — enviado exitosamente
- `received` — mensaje recibido del cliente
- `failed` — error al enviar

#### `GET /api/communications/client/:clientId`

Listar comunicaciones de un cliente.

**Auth:** `admin`

Query params:

- `limit` (opcional, default sin límite)

Respuesta (`200`): array de objetos `Communication` ordenados por `createdAt` descendente.

#### `POST /api/communications/send`

Enviar mensaje manual por WhatsApp.

**Auth:** `admin`

Request:

```json
{
  "clientId": "client_123",
  "subscriptionId": "sub_123",
  "body": "Su pago ha sido recibido, gracias por su pago."
}
```

Validaciones:

- `clientId` obligatorio
- `subscriptionId` opcional
- `body` obligatorio, máximo 4096 caracteres

Respuesta (`201`):

```json
{
  "id": "comm_456",
  "type": "manual",
  "status": "sent",
  "sentAt": "2026-06-29T12:00:00.000Z"
}
```

### 6.8 Cron — Ejecutor de tareas `/api/cron`

#### `GET /api/cron/config`

Obtener estado actual del scheduler y su configuración.

**Auth:** ninguna (endpoint público para monitoreo)

Respuesta (`200`):

```json
{
  "isRunning": true,
  "config": {
    "id": "daily",
    "organizationId": "default",
    "scheduledHour": 8,
    "scheduledMinute": 0,
    "isActive": true,
    "lastRunAt": "2026-06-29T08:00:00.000Z",
    "lastRunResult": "completed",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "updatedAt": "2026-06-29T08:00:00.000Z"
  },
  "scheduledTime": "08:00",
  "timezone": "America/Caracas"
}
```

Campos:

- **isRunning** — true si el cron tiene una tarea programada activa
- **config** — configuración completa del scheduler (siempre presente con valores por defecto si no hay configuración guardada)
- **scheduledTime** — hora programada en formato `"HH:MM"` (24h)
- **timezone** — zona horaria del servidor

#### `PUT /api/cron/config`

Actualizar configuración del scheduler.

**Auth:** `admin`

Request:

```json
{
  "scheduledHour": 10,
  "scheduledMinute": 30,
  "isActive": true
}
```

Validaciones:

- Al menos un campo obligatorio
- `scheduledHour` — entero entre 0 y 23
- `scheduledMinute` — entero entre 0 y 59
- `isActive` — booleano

Si no existe configuración previa, se crea con valores por defecto (`08:00`, `isActive: false`).

Respuesta (`200`): configuración completa actualizada (`CronScheduleConfig`).

Efectos:

- Si `isActive: true`: programa o re-programa el cron inmediatamente
- Si `isActive: false`: detiene la tarea programada sin borrar la configuración
- Si se cambia hora/minuto: detiene la tarea anterior y crea una nueva con el horario actualizado

#### `POST /api/cron/daily`

Ejecutar job diario manualmente.

**Auth:** `admin`

Debe ser idempotente por `organizationId`, fecha de ejecución y tipo de job.
Si ya se ejecutó hoy y marcó `completed`, retorna el resultado previo sin re-ejecutar.

Respuesta (`200`):

```json
{
  "organizationId": "default",
  "date": "2026-06-29",
  "status": "completed",
  "reminded": 3,
  "notifiedOnDueDate": 1,
  "markedOverdue": 2,
  "suspended": 0,
  "errors": [],
  "timestamp": "2026-06-29T12:00:00.000Z"
}
```

Campos:

- **status** — `"completed"`, `"already_executed"` o `"failed"`
- **reminded** — cantidad de recordatorios enviados (3 días antes del vencimiento)
- **notifiedOnDueDate** — notificaciones enviadas el día de vencimiento
- **markedOverdue** — períodos marcados como `overdue`
- **suspended** — suscripciones suspendidas automáticamente
- **errors** — array de errores parciales (si los hubo)

### 6.9 Portal del Cliente `/api/client`

> Endpoints exclusivos para usuarios con rol `client`.
> El cliente solo accede a sus propios datos mediante `clientId` extraído del JWT.

#### `GET /api/client/profile`

Retorna el perfil del cliente autenticado.

**Auth:** `client`

Respuesta (`200`):

```json
{
  "id": "client_123",
  "name": "Juan Pérez",
  "dni": "12345678",
  "phone": "+580000000000",
  "address": "Dirección completa",
  "createdAt": "2026-01-01T00:00:00.000Z",
  "updatedAt": "2026-01-01T00:00:00.000Z"
}
```

#### `GET /api/client/subscription`

Retorna la suscripción del cliente con datos enriquecidos (mismo formato que `GET /api/subscriptions/:id`).
Si el cliente no tiene suscripción, retorna `{ "subscription": null }`.

**Auth:** `client`

#### `GET /api/client/payments`

Retorna el historial de pagos del cliente, ordenado por fecha descendente.

**Auth:** `client`

Respuesta (`200`):

```json
{
  "payments": [
    {
      "id": "pay_123",
      "billingPeriodId": "bp_123",
      "subscriptionId": "sub_123",
      "amount": 120,
      "currency": "USD",
      "exchangeRate": 1,
      "amountUsd": 120,
      "reference": "REF-001",
      "paidAt": "2026-05-30T12:00:00.000Z",
      "status": "confirmed",
      "confirmedAt": "2026-05-30T12:05:00.000Z"
    }
  ]
}
```

#### `GET /api/client/debt`

Retorna el resumen de deuda del cliente.

**Auth:** `client`

Respuesta (`200`):

```json
{
  "subscriptionId": "sub_123",
  "status": "active",
  "overduePeriods": [],
  "advance": null,
  "totalDueUsd": 0
}
```

### 6.10 WebSocket

#### `WS /ws?token=<JWT>`

Conexión WebSocket para actualizaciones en tiempo real.

**Auth:** token JWT como query param

Eventos emitidos por el servidor:

- `payment:confirmed` — cuando un pago es confirmado
- `subscription:status` — cuando cambia el estado de una suscripción
- `debt:updated` — cuando se actualiza la deuda de una suscripción
- `communication:sent` — cuando se envía una comunicación

## 7. Job diario

Responsabilidades:

1. Bloquear ejecución idempotente del día.
2. Detectar períodos próximos a vencer.
3. Enviar recordatorio 3 días antes del vencimiento.
4. Detectar períodos vencidos.
5. Marcar `overdue` al día siguiente del vencimiento.
6. Enviar WhatsApp de vencimiento.
7. Detectar períodos que deben suspenderse.
8. Suspender automáticamente.
9. Aplicar `LateFee`.
10. Enviar WhatsApp de suspensión.
11. Registrar `ActivityLog`.
12. Liberar bloqueo del job.

Reglas:

- El job no debe crear deuda duplicada.
- El job no debe aplicar mora más de una vez por ciclo.
- El job no debe enviar el mismo WhatsApp repetidamente.
- Fallo de Twilio no debe impedir actualizar estados internos.
- Todo debe quedar auditado.

## 8. Notificaciones WhatsApp con Twilio

Eventos obligatorios:

- Recordatorio 3 días antes del vencimiento.
- Vencimiento el mismo día de `dueDate`.
- Suspensión automática o manual.
- Confirmación de pago.

Reglas:

- `Communication` debe registrarse antes o después del intento de envío.
- `status`: `queued`, `sent`, `failed`.
- Reintentos permitidos para `failed`.
- No duplicar mensajes idénticos para el mismo evento.
- El mensaje debe incluir:
  - nombre del cliente
  - código de suscripción
  - monto pendiente
  - fecha de corte
  - consecuencia de no pagar

# 9. Permisos

> **Cambio arquitectónico (2026-06-27):** Se eliminó el rol `operator` y se agregó el rol `client`.
> Ahora existen dos entidades diferenciadas:
> - **User** → entidad de autenticación (email, password, role)
> - **Client** → entidad de negocio (datos del titular del servicio Starlink)
>
> Un User con rol `client` tiene un campo `clientId` que lo vincula a un Client específico,
> permitiéndole acceder solo a sus propios datos (suscripción, pagos, deuda).

### Endpoints públicos (no requieren autenticación)

Los siguientes endpoints están disponibles sin necesidad de token:

- **`POST /api/auth/login`** — inicio de sesión para admin y client.

### `admin`

Puede:

- **Health:** `GET /api/health`
- **Auth:** registrar usuarios (`POST /api/auth/register`), registrar clientes (`POST /api/auth/register-client`), listar usuarios (`GET /api/auth/users`), activar/desactivar usuarios
- **Clientes:** crear, listar, obtener, actualizar, eliminar
- **Planes:** crear, listar, obtener, actualizar, propagar cambios
- **Suscripciones:** crear, obtener detalle enriquecido, transferir, suspender manualmente
- **Pagos:** registrar pagos, confirmar pagos, anular pagos
- **Deuda y reactivación:** consultar deuda, cotización de reactivación, reactivar
- **Comunicaciones:** enviar mensajes manuales, listar comunicaciones, ver detalle
- **Cron:** ver estado, configurar scheduler, ejecutar job diario
- **WebSocket:** conexión en tiempo real

### `client`

Puede (solo sus propios datos, vinculados mediante `clientId`):

- consultar su perfil → `GET /api/client/profile`
- consultar su suscripción → `GET /api/client/subscription`
- consultar sus pagos → `GET /api/client/payments`
- consultar su deuda → `GET /api/client/debt`

No puede:

- crear/editar clientes
- crear/modificar suscripciones
- confirmar/anular pagos
- acceder a datos de otros clientes
- ejecutar jobs

## 10. Casos de prueba de negocio

### Caso 1: creación y primer pago

Datos:

- Corte: día 5.
- Creación: 5 de mayo.
- Precio: `120 USD`.
- Primer pago: 4 de junio.

Resultado:

- Suscripción pasa de `paused` a `active`.
- BillingPeriod mayo-junio queda `paid`.
- Se crea siguiente período con vencimiento 5 de julio.

### Caso 2: pago parcial antes de vencer

Datos:

- Deuda: `120 USD`.
- Pago parcial: `50 USD`.
- Fecha: antes del vencimiento.

Resultado:

- BillingPeriod queda `partial`.
- Suscripción sigue `active`.
- Saldo pendiente: `70 USD`.

### Caso 3: vencimiento

Datos:

- `dueDate = 2026-05-05`.
- Sin pago completo al 2026-05-05.

Resultado:

- 2026-05-05: sigue pendiente/vencido según regla del mismo día.
- 2026-05-06: pasa a `overdue`.
- Se envía WhatsApp de vencimiento.

### Caso 4: suspensión automática

Datos:

- `dueDate = 2026-05-05`.
- `graceDays = 30`.
- `lateFeeUsd = 10`.
- Sin pago al 2026-06-05.

Resultado:

- BillingPeriod pasa a `suspended`.
- Subscription pasa a `suspended`.
- Se crea `LateFee` de `10 USD`.
- Se envía WhatsApp de suspensión.

### Caso 5: reactivación suspendida

Datos:

- Mensualidad: `120 USD`.
- Mora: `10 USD`.
- Pago: 30 de junio.
- Próximo corte: 5 de julio.
- Días restantes: 10.
- Precio diario: `4 USD`.

Cálculo:

- Prorrata: `40 USD`.
- Recargo 5%: `2 USD`.
- Total reactivación: `120 + 10 + 40 + 2 = 172 USD`.

Resultado si paga `172 USD`:

- Período vencido queda `paid`.
- Mora queda aplicada.
- BillingPeriod de adelanto queda `paid`.
- Recargo 5% queda separado.
- Subscription pasa a `active`.
- Siguiente período regular vence 5 de julio.

Resultado si paga menos de `172 USD`:

- No reactiva.
- Suspensión se mantiene.
- Deuda pendiente se recalcula.

### Caso 6: pago en Bs

Datos:

- Monto: `4320 Bs`.
- Tasa: `36 Bs/USD`.

Resultado:

- `amountUsd = 120`.
- Se guarda monto original, tasa y USD calculado.
- La tasa queda auditada.

### Caso 7: admin registra y confirma pago

Escenario normal donde el admin registra un pago y luego lo confirma.

Resultado:

- Pago queda `registered` tras registro del admin.
- No afecta deuda hasta confirmación.
- Tras confirmación del mismo admin, afecta deuda y estados.

### Caso 8: anulación de pago

Resultado:

- Pago cambia a `voided`.
- No se elimina.
- Deuda se recalcula.
- Se registra motivo y auditoría.

### Caso 9: transferencia

Resultado:

- `code` no cambia.
- `clientId` cambia.
- `currentOwnerName` y `currentOwnerDni` cambian.
- Historial de pagos y períodos se conserva.

### Caso 10: intento de pagar período ya pagado

Resultado:

- Backend rechaza el pago.
- No se crea deuda negativa.
- Se registra intento en auditoría.

## 11. Riesgos y controles

### Riesgo: inconsistencia financiera en Firestore

Control:

- Usar transacciones Firestore para pagos, confirmaciones, reactivaciones y cierre de períodos.
- Recalcular saldos en backend.
- No confiar en cálculos del frontend.

### Riesgo: job diario duplicado

Control:

- Lock por `organizationId + fecha + tipoJob`.
- Validar idempotencia antes de aplicar cambios.
- Registrar ejecución en `ActivityLog`.

### Riesgo: mora duplicada

Control:

- Crear `LateFee` con clave lógica por `billingPeriodId`.
- Validar antes de aplicar.

### Riesgo: notificación duplicada

Control:

- Crear `Communication` con clave lógica por evento.
- No reenviar si ya existe `sent`.

### Riesgo: Twilio falla

Control:

- Guardar estado `failed`.
- Permitir reintento.
- No bloquear estados financieros por fallo de notificación.

### Riesgo: recargo o prorrata mal calculados

Control:

- Centralizar fórmula en servicio de dominio.
- Usar casos de prueba de negocio.
- Redondear a 2 decimales.

### Riesgo: zona horaria incorrecta

Control:

- Definir `timezone` por organización.
- Usar fechas locales para cortes y jobs.
- Guardar timestamps UTC y fechas locales cuando aplique.

## 12. Validación de implementación

Antes de considerar terminada la implementación, validar:

- Crear cliente y suscripción deja suscripción `paused`.
- Primer pago confirmado activa suscripción.
- Pago parcial no activa una suscripción suspendida.
- Período pasa a `overdue` al día siguiente del vencimiento.
- Suspensión automática ocurre en `dueDate + graceDays`.
- Mora se aplica una sola vez.
- Prorrata usa 30 días fijos.
- Recargo 5% se aplica solo tras suspensión.
- Reactivación exige pago completo.
- Código de suscripción no cambia en transferencia.
- Pagos no se editan ni eliminan.
- Pagos en moneda local calculan `amountUsd`.
- Twilio registra comunicación enviada o fallida.
- Job diario es idempotente.
- ActivityLog registra operaciones críticas.
- Frontend solo consume datos y comandos, sin lógica financiera.

## 13. Tareas de implementación recomendadas

1. Crear estructura modular del backend.
2. Definir configuración de Firestore y colecciones.
3. Implementar modelo de organización, cliente y suscripción.
4. Implementar servicios de dominio para facturación.
5. Implementar servicios de pago con transacciones.
6. Implementar servicio de deuda y reactivación.
7. Implementar servicio de suspensión y mora.
8. Implementar servicio de prorrata y recargo 5%.
9. Implementar API por comandos.
10. Implementar permisos `admin` y `client`.
11. Implementar job diario idempotente.
12. Implementar Twilio y plantilla de mensajes.
13. Implementar ActivityLog.
14. Implementar casos de prueba de negocio.
15. Ejecutar validaciones manuales con los escenarios del plan.
