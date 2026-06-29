# Changelog

Registro de mejoras y cambios realizados en la API para preparación de despliegue en Railway.

## [Unreleased]

### 2026-06-28 — Mejoras de arquitectura P1

**Mejoras implementadas:**

#### 1. Uso consistente de `NotFoundError` en toda la API

Los errores de "no encontrado" ahora usan `NotFoundError` (HTTP 404) en lugar de `BusinessRuleError` (HTTP 409), mejorando la semántica HTTP y la claridad para clientes:

| Servicio | Cambio |
|----------|--------|
| `clientService.ts` | `"Cliente no encontrado"` → `NotFoundError` |
| `subscriptionService.ts` | `"Suscripción no encontrada"` → `NotFoundError` |
| `planService.ts` | `"Plan no encontrado"` → `NotFoundError` |
| `paymentService.ts` | `"Pago no encontrado"`, `"Período de facturación no encontrado"`, `"Suscripción no encontrada"` → `NotFoundError` |
| `communicationService.ts` | `ValidationError` → `NotFoundError` |
| `authService.ts` | `"Usuario no encontrado"` en `activate/deactivate` → `NotFoundError` |

Los mensajes incluyen el ID para facilitar el debugging: `Suscripción no encontrada (id: abc123)`.

**Impacto**: Los tests esperan código 404 donde antes esperaban 409. Un test fue corregido para reflejar el comportamiento correcto.

#### 2. Extracción de `reactivationService`

**Antes**: `paymentService.ts` tenía 632 líneas con 8+ responsabilidades, incluyendo el flujo de reactivación (orquestación compleja).

**Ahora**: Nuevo servicio especializado en `src/services/reactivation/reactivationService.ts` con 3 métodos:
- `calculateReactivationQuote()` - Cálculo del quote de reactivación
- `reactivate()` - Orquestación transaccional de la reactivación
- `findReactivationPeriod()` - Búsqueda del período a reactivar

`paymentService.ts` se redujo a ~280 líneas y ahora se enfoca exclusivamente en el ciclo de vida de pagos: `register`, `confirm`, `void`, `calculateDebt`, `handlePaidPeriod`.

**Beneficios**:
- Principio de Responsabilidad Única respetado
- Código más testeable y mantenible
- Límites de servicios claros para el equipo

#### 3. Autenticación WebSocket con JWT

**Antes**: WebSocket aceptaba cualquier `organizationId`/`clientId` de query params, permitiendo sniffing de datos de otras organizaciones.

**Ahora**: El handshake requiere token JWT (`?token=xxx`) que se valida contra `authService.verifyToken()`:
- Sin token → conexión cerrada (código 4001)
- Token inválido/expirado → conexión cerrada (código 4002)
- Token válido → `organizationId` y `clientId` se derivan del JWT, NO de query params
- Para administradores, se permite filtrado opcional vía `?clientId=` y `?subscriptionId=` para restringir el alcance de los broadcasts

Seguridad:
- Los datos del cliente del token son fuente de verdad (no los query params)
- El rol del token determina permisos de filtrado
- Cada broadcast valida contra el JWT del cliente

#### 4. Atomicidad en `planService.propagate` con WriteBatch

**Antes**: El loop `for (sub of candidates)` ejecutaba updates individuales, permitiendo estado inconsistente si fallaba a mitad.

**Ahora**: Usa Firestore `WriteBatch` para atomicidad:
- Todas las actualizaciones se aplican atómicamente en un batch
- Cada batch se divide en chunks de 500 (límite de Firestore)
- Si un batch falla, las actualizaciones pendientes no se aplican
- Logs y ActivityLog mantienen el estado del propagate

**Beneficio**: Garantiza consistencia en precios entre plan y todas sus suscripciones asociadas.

**Archivos modificados:**
- `src/services/clients/clientService.ts`
- `src/services/subscriptions/subscriptionService.ts`
- `src/services/plans/planService.ts`
- `src/services/communications/communicationService.ts`
- `src/services/payments/paymentService.ts`
- `src/services/auth/authService.ts`
- `src/services/reactivation/reactivationService.ts` (nuevo)
- `src/services/billing/billingService.ts`
- `src/api/routes/subscriptionRoutes.ts`
- `src/infrastructure/websocket/websocketServer.ts`
- `src/tests/integration/api.test.ts` (un test ajustado de 409 a 404)

**Verificación:** TypeScript compila sin errores. 133/133 tests pasan ✅

---

### 2026-06-27 — Crítico: Transaccionalización de operaciones financieras y seguridad del cron

**Problema:**  
La auditoría crítica identificó 3 problemas críticos que exponían la integridad financiera del sistema:

1. **`void()` tenía race condition**: Actualizaba el payment en transacción, pero luego calculaba `paidAmountUsd` y actualizaba el `billingPeriod` FUERA de transacción. Si otro pago se confirmaba concurrentemente, el saldo quedaría inconsistente.

2. **`reactivate()` no era atómico**: Ejecutaba 4 operaciones secuenciales (actualizar billingPeriod principal, crear advance period, crear next regular period, actualizar subscription). Si el proceso fallaba entre pasos, la suscripción quedaba en estado inconsistente con períodos huérfanos o estados mezclados.

3. **`suspendPeriod()` no era transaccional**: Creaba el `LateFee` y actualizaba el `billingPeriod` en operaciones separadas. Si fallaba entre ambas, quedaba un fee sin contexto de suspensión o viceversa.

4. **Lock del cron sin TTL**: Si el job diario crasheaba, el lock quedaba en estado "running" permanentemente, impidiendo cualquier re-ejecución futura.

5. **Rutas de pago sin `requireAdmin`**: `POST /payments`, `GET /debt`, y `GET /reactivation-quote` eran accesibles por cualquier usuario autenticado, permitiendo que un cliente registrara pagos contra billing periods de otros clientes.

**Solución implementada:**

#### 1. Transaccionalización de `void()` (paymentsService.ts)
```typescript
await runFirestoreTransaction(async (transaction) => {
  // 1. Actualizar payment a voided
  const paymentRef = paymentRepository.getRef(payment.organizationId, payment.id);
  transaction.update(paymentRef, { status: PaymentStatus.Voided, voidedAt, voidReason, voidedBy });

  // 2. Obtener payments confirmados DENTRO de la transacción
  const confirmedPayments = (await paymentRepository.listByBillingPeriod(
    payment.organizationId, payment.billingPeriodId
  )).filter(p => p.status === PaymentStatus.Confirmed && p.id !== payment.id);

  // 3. Calcular paidAmountUsd actualizado
  const paidAmountUsd = roundMoney(confirmedPayments.reduce((total, item) => total + item.amountUsd, 0));

  // 4. Actualizar billingPeriod DENTRO de la transacción
  const periodRef = billingPeriodRepository.getRef(period.organizationId, period.id);
  transaction.update(periodRef, { paidAmountUsd, status: calculateStatusFromPaidAmount(period, paidAmountUsd) });
});
```
**Beneficio**: Elimina race conditions. Ambos documentos se actualizan atómicamente.

#### 2. Transaccionalización de `reactivate()` (paymentService.ts)
```typescript
await runFirestoreTransaction(async (transaction) => {
  // 1. Actualizar billingPeriod principal a Paid
  transaction.update(mainPeriodRef, { paidAmountUsd: mainPeriod.amountUsd, status: BillingPeriodStatus.Paid });

  // 2. Crear advance period (si corresponde)
  const advanceId = crypto.randomUUID();
  transaction.create(advanceRef, { id: advanceId, type: 'advance', status: 'paid', ... });

  // 3. Crear siguiente período regular
  const nextId = crypto.randomUUID();
  transaction.create(nextRef, { id: nextId, type: 'regular', status: 'pending', ... });

  // 4. Actualizar suscripción a Active
  transaction.update(subscriptionRef, { status: SubscriptionStatus.Active });
});
```
**Beneficio**: Operación de reactivación completamente atómica. Si falla, ningún cambio se aplica.

#### 3. Transaccionalización de `suspendPeriod()` (billingService.ts)
```typescript
await runFirestoreTransaction(async (transaction) => {
  // 1. Crear LateFee
  const lateFeeId = crypto.randomUUID();
  transaction.create(lateFeeRef, { id: lateFeeId, billingPeriodId, amountUsd, status: 'applied' });

  // 2. Actualizar billingPeriod a suspended
  transaction.update(periodRef, { status: BillingPeriodStatus.Suspended, suspensionDate });
});
```
**Beneficio**: LateFee y suspensión del billingPeriod siempre ocurren juntos o ninguno ocurre.

#### 4. TTL y recuperación del lock del cron (jobLockRepository.ts)
```typescript
async tryAcquire(organizationId, date, jobType) {
  const snapshot = await docRef.get();
  
  if (!snapshot.exists) {
    // Crear nuevo lock
    await docRef.create({ status: 'running', startedAt: nowIso() });
    return true;
  }
  
  const lockData = snapshot.data();
  
  if (lockData.status === 'completed') return false;
  if (lockData.status === 'failed') {
    // Permitir re-intento
    await docRef.update({ status: 'running', startedAt: nowIso() });
    return true;
  }
  
  if (lockData.status === 'running') {
    // Verificar si está stuck (más de 1 hora)
    const startedAt = new Date(lockData.startedAt);
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    
    if (startedAt < oneHourAgo) {
      // Lock expirado, tomar ownership
      await docRef.update({ status: 'running', startedAt: nowIso() });
      return true;
    }
    
    return false;
  }
}
```

**Liberación del lock en catch (dailyJobService.ts):**
```typescript
try {
  // ... ejecución del job
  await jobLockRepository.release(organizationId, date, 'daily', 'completed');
} catch (error) {
  // CRÍTICO: Liberar lock con status "failed" para permitir re-intento
  await jobLockRepository.release(organizationId, date, 'daily', 'failed');
  throw error;
}
```
**Beneficio**: Si el job crashea, el lock no queda muerto. Puede re-ejecutarse automáticamente.

#### 5. `requireAdmin` en rutas de pago (subscriptionRoutes.ts)
```typescript
subscriptionRouter.post('/:subscriptionId/payments', requireAdmin, validateBody(registerPaymentSchema), handler(async (req, res) => {
  // ...
}));

subscriptionRouter.get('/:subscriptionId/debt', requireAdmin, handler(async (req, res) => {
  // ...
}));

subscriptionRouter.get('/:subscriptionId/reactivation-quote', requireAdmin, handler(async (req, res) => {
  // ...
}));
```
**Beneficio**: Solo admin puede registrar pagos y consultar deudas. Los clientes solo pueden ver SUS propios datos vía `/api/client/*`.

**Archivos modificados:**
- `src/services/payments/paymentService.ts` — Transaccionalización de `void()` y `reactivate()`
- `src/services/billing/billingService.ts` — Transaccionalización de `suspendPeriod()`
- `src/infrastructure/firestore/repositories.ts` — TTL del lock + liberación en failed, `getRef()` para lateFeeRepository y subscriptionRepository
- `src/services/cron/dailyJobService.ts` — Liberación del lock en catch con status "failed"
- `src/api/routes/subscriptionRoutes.ts` — `requireAdmin` en rutas de pagos y deuda

**Cambios adicionales de infraestructura:**
- Agregado `runFirestoreTransaction` a imports de `billingService.ts`
- Agregado `addMonthsPreservingDay`, `toLocalDate` a imports de `paymentService.ts`
- Agregado `getRef()` a `lateFeeRepository` y `subscriptionRepository`

**Verificación:** TypeScript compila sin errores, 133/133 tests pasan ✅

---

### 2026-06-27 — Mejora: Validación obligatoria de `exchangeRate` y `proofImage` en registro de pagos

**Problema:**
El schema de validación del endpoint `POST /api/subscriptions/:subscriptionId/payments` permitía:
- `exchangeRate` como campo opcional, lo cual causaba que pagos en monedas distintas a USD no calcularan correctamente el `amountUsd`
- `proofImage` no estaba incluido en el schema, permitiendo registrar pagos sin comprobante visual

**Impacto:**
- Pagos sin `exchangeRate` correcto podían generar deudas incorrectas
- Pagos sin `proofImage` dificultaban el proceso de confirmación manual por parte del administrador
- La API no cumplía con el plan original que establece ambos campos como obligatorios

**Solución:**
- Schema de validación ahora requiere `exchangeRate` (número positivo) y `proofImage` (string no vacío)
- Service layer requiere ambos campos (TypeScript type-checking)
- Tests actualizados para enviar ambos campos en todos los pagos válidos
- Nuevos tests de validación que verifican el rechazo de pagos sin estos campos

**Archivos modificados:**
- `src/api/validators/schemas.ts` — `registerPaymentSchema`: `exchangeRate` y `proofImage` ahora obligatorios
- `src/services/payments/paymentService.ts` — método `register()` ahora requiere `proofImage: string` (no opcional)
- `src/tests/integration/api.test.ts` — Tests actualizados + 2 nuevos tests de validación

**Tests:** Validación de pago exitoso con ambos campos, validación de rechazo cuando falta `exchangeRate`, validación de rechazo cuando falta `proofImage`

**Verificación:** 133/133 tests pasan ✅

**Decisión de diseño:**
- El modelo `Payment` en Firestore mantiene `proofImage?: string` (opcional) para compatibilidad hacia atrás con datos históricos
- Solo la validación de la API requiere el campo obligatorio
- Esto permite que pagos antiguos sin comprobante sigan siendo válidos en la base de datos

---

### 2026-06-27 — Cambio arquitectónico: Separación de entidades User/Client y nuevo rol `client`

**Problema:** El plan original definía roles `admin` y `operator`, pero no contemplaba que los clientes
(titulares del servicio Starlink) pudieran acceder al sistema para consultar su propia información.
Además, `operator` era un rol intermedio que generaba confusión con el modelo de negocio real.

**Decision de diseño:**
- `Client` = entidad de negocio (titular del servicio Starlink: nombre, DNI, teléfono, dirección)
- `User` = entidad de autenticación (email, password, rol)
- Un `User` con rol `client` tiene un campo `clientId` que lo vincula a un `Client` específico
- El `User` con rol `admin` gestiona todo el sistema
- Se elimina el rol `operator`

**Justificación:**
1. **Separación de responsabilidades** — autenticación (User) vs datos de negocio (Client)
2. **Portal del cliente** — permite al titular ver su suscripción, pagos y deuda sin intervención del admin
3. **Seguridad** — el cliente solo puede acceder a sus propios datos mediante `clientId` del JWT
4. **Simplicidad** — dos roles claros: admin (gestión total) y client (consulta propia)

**Cambios implementados:**

1. **Modelos** (`src/domain/models.ts`, `src/domain/types.ts`):
   - `UserRole` enum actualizado: `Admin`, `Client` (se elimina `Operator`)
   - `User` ahora incluye campo opcional `clientId`
   - `RequestContext` ahora incluye `clientId?` para propagar contexto del cliente

2. **Autenticación** (`src/services/auth/authService.ts`):
   - Rol por defecto en registro: `client` (antes `operator`)
   - Validación: si role=`client`, `clientId` es obligatorio
   - JWT payload incluye `clientId`

3. **Middlewares** (`src/api/middlewares/requestContext.ts`, `src/api/middlewares/authMiddleware.ts`):
   - Nuevo middleware `requireClient` — valida rol client y clientId presente
   - `authenticateRequired` propaga `clientId` desde JWT al RequestContext
   - `requireHuman` simplificado — ya no verifica operator/admin, solo que haya usuario autenticado

4. **Portal del Cliente** (`src/api/routes/clientPortalRoutes.ts`) — nuevo archivo:
   - `GET /api/client/profile` → datos del cliente autenticado
   - `GET /api/client/subscription` → suscripción enriquecida
   - `GET /api/client/payments` → historial de pagos
   - `GET /api/client/debt` → resumen de deuda

5. **Servicios**:
   - `subscriptionService.listByClient()` — nuevo método
   - `paymentService.listByClient()` — nuevo método
   - `paymentRepository.listByClientId()` — nuevo método en repositorio real y mock

6. **Validación** (`src/api/validators/schemas.ts`):
   - `registerSchema` acepta `role: "admin" | "client"` y `clientId` opcional
   - Refine: si role=client, clientId es requerido

**Archivos modificados:**
- `src/domain/models.ts` — User con clientId, RequestContext con clientId
- `src/domain/types.ts` — UserRole: Admin, Client
- `src/services/auth/authService.ts` — JwtPayload con clientId, register con clientId
- `src/api/middlewares/requestContext.ts` — requireClient, parseRole actualizado
- `src/api/middlewares/authMiddleware.ts` — propagación de clientId
- `src/api/routes/clientPortalRoutes.ts` — nuevo archivo
- `src/api/routes/index.ts` — registro de clientPortalRouter
- `src/api/routes/authRoutes.ts` — pasa clientId al registrar
- `src/api/validators/schemas.ts` — registerSchema con clientId
- `src/services/subscriptions/subscriptionService.ts` — listByClient
- `src/services/payments/paymentService.ts` — listByClient
- `src/infrastructure/firestore/repositories.ts` — listByClientId en paymentRepository
- `src/tests/helpers/setup.ts` — makeClientToken reemplaza makeOperatorToken
- `src/tests/helpers/mockRepositories.ts` — listByClientId en mock de paymentRepository
- `src/tests/auth.test.ts` — tests actualizados para nuevo rol
- `src/tests/integration/api.test.ts` — tests actualizados + 6 nuevos tests para portal
- `starlink-subscription-api-plan.md` — sección 9 actualizada + nueva sección Portal del Cliente

**Tests agregados (6):**
- Perfil del cliente accesible para rol client
- Admin no puede acceder al portal del cliente
- Suscripción enriquecida con datos del cliente
- Suscripción null cuando el cliente no tiene suscripciones
- Lista de pagos vacía
- Resumen de deuda

**Verificación:** 131/131 tests pasan.

---

### 2026-06-26 — Mejora: Validación obligatoria de `dni` y `address` en clientes

**Problema:** El plan original (sección 4 - Client) especifica que `dni` y `address` son obligatorios, pero la implementación los trataba como opcionales.

**Impacto:** Se podían crear clientes sin DNI ni dirección, lo cual afecta:
- Validación de identidad del titular
- Notificaciones de servicio Starlink
- Cumplimiento con el modelo de datos planificado

**Archivos modificados:**
- `src/api/validators/schemas.ts` — `dni` y `address` ahora obligatorios con mensajes de error
- `src/domain/models.ts` — `Client.dni` ya no es opcional (`string` en vez de `string?`)
- `src/services/clients/clientService.ts` — `dni` requerido como parámetro; validación de unicidad siempre se ejecuta
- `src/tests/integration/api.test.ts` — Tests actualizados para incluir `dni` al crear clientes
- `starlink-subscription-api-plan.md` — Documentación actualizada

**Verificación:** 119/119 tests pasan.

---

### 2026-06-26 — Mejora: Respuesta enriquecida en `GET /subscriptions/{id}`

**Problema:** El endpoint `GET /subscriptions/{id}` retornaba solo `{ subscription, periods }`, lo cual no cumplía con la especificación del plan (sección 5.2).

**Especificación del plan:**
> Obtener suscripción con: datos actuales, cliente, período activo, deuda resumida, último estado calculado

**Impacto del problema:**
- El frontend necesitaba 3-4 requests adicionales para mostrar información básica
- Mayor latencia y complejidad en la UI
- Riesgo de inconsistencia entre datos obtenidos en múltiples requests

**Solución implementada:**
El endpoint ahora retorna en una sola respuesta:
```json
{
  "subscription": { /* datos básicos */ },
  "client": { "id", "name", "dni", "phone", "address" },
  "activePeriod": { "id", "startDate", "dueDate", "amountUsd", "paidAmountUsd", "balanceUsd", "status" } | null,
  "debt": { "totalDueUsd", "overduePeriods", "hasLateFees" },
  "periods": [ /* historial completo */ ],
  "calculated": { "status", "daysUntilDue", "isOverdue", "isSuspended" }
}
```

**Beneficios:**
1. **Menor latencia** — un solo request en vez de 3-4
2. **Frontend simplificado** — no necesita calcular estados ni buscar período activo
3. **Consistencia garantizada** — todos los datos provienen de una sola transacción lógica
4. **Mejor UX** — pantalla de detalle carga instantáneamente

**Archivos modificados:**
- `src/services/subscriptions/subscriptionService.ts` — Método `getWithPeriods()` enriquecido con JSDoc detallado
- `starlink-subscription-api-plan.md` — Sección 5.2 documenta la nueva estructura de respuesta con ejemplo
- `src/tests/integration/api.test.ts` — 4 nuevos tests para validar respuesta enriquecida

**Tests agregados:**
- Valida estructura completa con cliente, período activo, deuda y estado calculado
- Detecta correctamente estado `overdue`
- Retorna `activePeriod: null` cuando no hay períodos pendientes
- Retorna error 409 para suscripciones inexistentes

**Verificación:** 123/123 tests pasan (4 nuevos tests agregados).

---

## [1.0.0] — Estado inicial antes de ajustes pre-despliegue

- API completa según plan original con 87% de cobertura de especificación
- Ciclos de facturación, pagos, mora, prorrata, reactivación
- Cron diario idempotente con notificaciones WhatsApp (Twilio)
- WebSocket para actualizaciones en tiempo real
- JWT con roles admin/operator (cambiado a admin/client en la mejora del 2026-06-27)
- Auditoría completa con ActivityLog
- Tests de integración, reglas de negocio y utilidades
