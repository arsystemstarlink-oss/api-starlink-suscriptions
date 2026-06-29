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
- `createdAt`
- `updatedAt`

Reglas:

- `name` obligatorio.
- `dni` obligatorio y único por organización.
- `phone` obligatorio y único por organización.
- `address` obligatorio.

### Subscription

Campos principales:

- `id`
- `organizationId`
- `code`
- `clientId`
- `plan`
- `priceUsd`
- `status`
- `dueDay`
- `graceDays`
- `lateFeeUsd`
- `currentOwnerName`
- `currentOwnerDni`
- `createdAt`
- `updatedAt`

Estados:

- `paused`
- `active`
- `suspended`
- `cancelled`

Reglas:

- `code` único por organización.
- Una suscripción puede tener múltiples períodos, pero solo uno activo de servicio.
- Puede transferirse sin cambiar `code`.
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
- `proofImage`
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
- `reference` obligatorio.
- `proofImage` obligatorio (URL de la imagen del comprobante).
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

- El `code` no cambia.
- Se actualiza:
  - `clientId`
  - `currentOwnerName`
  - `currentOwnerDni`
- El historial del código y pagos se conserva.
- Se registra `ActivityLog`.

## 6. API principal

### Clientes

#### `POST /clients`

Crear cliente.

Request:

```json
{
  "name": "Juan Pérez",
  "dni": "12345678",
  "phone": "+580000000000",
  "address": "Dirección completa"
}
```

Validaciones:

- `name` obligatorio.
- `dni` obligatorio y único.
- `phone` obligatorio y único.
- `address` obligatorio.

#### `GET /clients/{clientId}`

Obtener cliente con sus suscripciones resumidas.

### Suscripciones

#### `POST /subscriptions`

Crear suscripción.

Request:

```json
{
  "clientId": "client_123",
  "code": "ACC-01-0001",
  "plan": "Starlink Residential",
  "priceUsd": 120,
  "dueDay": 5,
  "graceDays": 30,
  "lateFeeUsd": 10
}
```

Respuesta esperada:

```json
{
  "subscriptionId": "sub_123",
  "status": "paused",
  "initialBillingPeriodId": "bp_123",
  "dueDate": "2026-06-05"
}
```

Validaciones:

- `clientId` existe.
- `code` único.
- `priceUsd > 0`.
- `dueDay` entre 1 y 31.
- `graceDays >= 0`.
- `lateFeeUsd >= 0`.

#### `GET /subscriptions/{subscriptionId}`

Obtener suscripción con datos enriquecidos en una sola respuesta.

> **Mejora implementada (2026-06-26):** El endpoint originalmente retornaba solo `{ subscription, periods }`,
> requiriendo que el frontend hiciera 3-4 requests adicionales (cliente, deuda, período activo).
> Ahora retorna toda la información necesaria en una sola respuesta para:
>
> 1. **Reducir latencia** — evitar múltiples requests HTTP
> 2. **Simplificar frontend** — no necesita calcular estados ni buscar período activo
> 3. **Garantizar consistencia** — todos los datos provienen de una sola transacción lógica
> 4. **Mejorar UX** — la pantalla de detalle carga instantáneamente

Respuesta:

```json
{
  "subscription": { /* datos básicos */ },
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
  "periods": [ /* historial completo */ ],
  "calculated": {
    "status": "overdue",
    "daysUntilDue": -2,
    "isOverdue": true,
    "isSuspended": false
  }
}
```

Campos explicados:

- **client**: datos del titular actual de la suscripción
- **activePeriod**: período pendiente o parcial (si existe), incluye balance calculado
- **debt**: resumen de deuda — total adeudado, cantidad de períodos vencidos, si tiene mora aplicada
- **calculated.status**: estado interpretado (active, overdue, suspended, paused, cancelled)
- **calculated.daysUntilDue**: días faltantes hasta el próximo vencimiento (negativo si ya venció)
- **calculated.isOverdue**: true si el período activo pasó su fecha de vencimiento
- **calculated.isSuspended**: true si la suscripción está suspendida

#### `POST /subscriptions/{subscriptionId}/transfer`

Solo admin.

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

- `newClientId` existe.
- `currentOwnerName` obligatorio.
- `currentOwnerDni` obligatorio.
- No cambia `code`.

### Pagos

#### `POST /subscriptions/{subscriptionId}/payments`

Registrar pago.

Puede ser ejecutado por `operator` o `admin`.

Request:

```json
{
  "billingPeriodId": "bp_123",
  "amount": 120,
  "currency": "USD",
  "exchangeRate": 1,
  "reference": "REF-001",
  "proofImage": "https://storage/proof.jpg",
  "paidAt": "2026-05-30T12:00:00Z"
}
```

Respuesta:

```json
{
  "paymentId": "pay_123",
  "status": "registered"
}
```

Validaciones:

- `amount > 0`.
- `currency` válida.
- `exchangeRate > 0`.
- `reference` obligatorio.
- No permitir pagos duplicados con misma referencia confirmada.
- No permitir pagos a períodos pagados, salvo flujo de anulación.

#### `POST /payments/{paymentId}/confirm`

Solo admin.

Request:

```json
{
  "confirmedAt": "2026-05-30T12:05:00Z"
}
```

Efectos:

- `Payment.status = confirmed`.
- Recalcular `BillingPeriod.paidAmountUsd`.
- Recalcular estado del período.
- Si corresponde, crear siguiente período.
- Si corresponde, reactivar suscripción.
- Enviar WhatsApp de confirmación de pago.
- Registrar `ActivityLog`.

#### `POST /payments/{paymentId}/void`

Solo admin.

Request:

```json
{
  "reason": "Pago registrado por error"
}
```

Efectos:

- `Payment.status = voided`.
- Recalcular deuda.
- Registrar `ActivityLog`.
- No elimina el documento original.

### Deuda y reactivación

#### `GET /subscriptions/{subscriptionId}/debt`

Consultar deuda completa.

Respuesta:

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

#### `GET /subscriptions/{subscriptionId}/reactivation-quote`

Consultar total necesario para reactivar.

Respuesta:

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

#### `POST /subscriptions/{subscriptionId}/reactivate`

Solo admin.

Request:

```json
{
  "paymentIds": ["pay_123"],
  "expectedTotalUsd": 172
}
```

Reglas:

- Recalcular deuda internamente.
- Validar que pagos confirmados cubran `expectedTotalUsd`.
- Si no cubre, rechazar.
- Si cubre:
  - marcar período vencido como `paid`
  - aplicar mora
  - crear/validar período de adelanto
  - registrar recargo 5%
  - marcar suscripción como `active`
  - crear siguiente período regular si corresponde
  - enviar WhatsApp de confirmación
  - registrar auditoría

### Suspensión manual

#### `POST /subscriptions/{subscriptionId}/suspend`

Solo admin.

Request:

```json
{
  "reason": "Mora impaga confirmada por administrador"
}
```

Efectos:

- Cambia a `suspended`.
- Aplica mora si no existe.
- Envía WhatsApp.
- Registra auditoría.

### Cron

#### `POST /cron/daily`

Ejecuta job diario.

Debe ser idempotente por:

- `organizationId`
- fecha de ejecución
- tipo de job

Puede ejecutarse desde scheduler externo, pero la lógica pertenece al backend.

### Portal del Cliente

> **Sección agregada (2026-06-27):** Endpoints exclusivos para usuarios con rol `client`.
> El cliente solo accede a sus propios datos mediante `clientId` extraído del JWT.

#### `GET /api/client/profile`

Retorna el perfil del cliente autenticado.

Respuesta:

```json
{
  "id": "client_123",
  "name": "Juan Pérez",
  "dni": "12345678",
  "phone": "+580000000000",
  "address": "Dirección completa"
}
```

#### `GET /api/client/subscription`

Retorna la suscripción del cliente con datos enriquecidos (mismo formato que `GET /subscriptions/{id}`).
Si el cliente no tiene suscripción, retorna `{ "subscription": null }`.

#### `GET /api/client/payments`

Retorna el historial de pagos del cliente, ordenado por fecha descendente.

Respuesta:

```json
{
  "payments": [
    {
      "id": "pay_123",
      "amount": 120,
      "currency": "USD",
      "amountUsd": 120,
      "status": "confirmed",
      "paidAt": "2026-05-30T12:00:00Z"
    }
  ]
}
```

#### `GET /api/client/debt`

Retorna el resumen de deuda del cliente.

Respuesta:

```json
{
  "subscriptionId": "sub_123",
  "status": "active",
  "overduePeriods": [],
  "advance": null,
  "totalDueUsd": 0
}
```

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

## 9. Permisos

> **Cambio arquitectónico (2026-06-27):** Se eliminó el rol `operator` y se agregó el rol `client`.
> Ahora existen dos entidades diferenciadas:
> - **User** → entidad de autenticación (email, password, role)
> - **Client** → entidad de negocio (datos del titular del servicio Starlink)
>
> Un User con rol `client` tiene un campo `clientId` que lo vincula a un Client específico,
> permitiéndole acceder solo a sus propios datos (suscripción, pagos, deuda).

### `admin`

Puede:

- crear/editar clientes
- crear suscripciones
- transferir suscripciones
- registrar pagos
- confirmar pagos
- anular pagos
- suspender manualmente
- reactivar
- consultar deuda
- ejecutar/reportar jobs
- registrar usuarios (admin o client) con `POST /api/auth/register`

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

### Caso 7: operador registra, admin confirma

Resultado:

- Pago queda `registered` tras registro del operador.
- No afecta deuda.
- Tras confirmación del admin, afecta deuda y estados.

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
10. Implementar permisos `admin` y `operator`.
11. Implementar job diario idempotente.
12. Implementar Twilio y plantilla de mensajes.
13. Implementar ActivityLog.
14. Implementar casos de prueba de negocio.
15. Ejecutar validaciones manuales con los escenarios del plan.
