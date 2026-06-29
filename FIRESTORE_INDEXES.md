# Índices Compuestos de Firestore Requeridos

Este documento lista todos los índices compuestos que necesitas crear en Firebase Console para que la API funcione correctamente.

## Cómo Crear los Índices

1. Ve a [Firebase Console](https://console.firebase.google.com/)
2. Selecciona tu proyecto: `api-gestion-starlink`
3. Abre **Firestore Database**
4. Ve a la pestaña **Índices**
5. Haz clic en **Crear índice** para cada uno de los siguientes

---

## Colección: `subscriptions`

### Índice 1: Clientes con sus suscripciones
- **Campos:**
  - `clientId` (Ascendente)
  - `createdAt` (Ascendente)
- **Estado:** Creando (ya se inició)

---

## Colección: `billingPeriods`

### Índice 2: Períodos por suscripción ordenados por fecha
- **Campos:**
  - `subscriptionId` (Ascendente)
  - `dueDate` (Ascendente)
- **Uso:** Endpoint `GET /subscriptions/:id` - lista períodos de una suscripción

### Índice 3: Períodos activos por suscripción
- **Campos:**
  - `subscriptionId` (Ascendente)
  - `type` (Ascendente)
  - `status` (Ascendente)
- **Uso:** Buscar períodos regulares activos (pending, partial, overdue) para reactivación

---

## Colección: `payments`

### Índice 4: Pagos por suscripción
- **Campos:**
  - `subscriptionId` (Ascendente)
  - `createdAt` (Ascendente)
- **Uso:** Endpoint `GET /subscriptions/:id/payments`

### Índice 5: Pagos por período
- **Campos:**
  - `billingPeriodId` (Ascendente)
  - `createdAt` (Ascendente)
- **Uso:** Listar pagos de un período específico (para anulación)

---

## Colección: `lateFees`

### Índice 6: Mora aplicada por período
- **Campos:**
  - `billingPeriodId` (Ascendente)
  - `status` (Ascendente)
- **Uso:** Buscar si ya existe mora aplicada a un período

---

## Colección: `communications`

### Índice 7: Comunicaciones por suscripción y tipo
- **Campos:**
  - `subscriptionId` (Ascendente)
  - `type` (Ascendente)
- **Uso:** Verificar duplicados de notificaciones (payment_reminder, overdue, suspended)

---

## Colección: `clients` (automáticos)

Los siguientes índices ya existen por defecto en Firestore:
- `organizationId` + `phone` (único)
- `organizationId` + `dni` (único)

No necesitas crearlos manualmente.

---

## Notas Importantes

1. **Tiempo de construcción:** Cada índice puede tomar 1-5 minutos en construirse
2. **Mensajes de error:** Si ves "The query requires an index", el mensaje incluirá un link directo para crearlo
3. **Subcolecciones:** Todas las colecciones están dentro de subcolecciones de organizacion:
   - `/organizations/{orgId}/clients`
   - `/organizations/{orgId}/subscriptions`
   - `/organizations/{orgId}/billingPeriods`
   - `/organizations/{orgId}/payments`
   - `/organizations/{orgId}/lateFees`
   - `/organizations/{orgId}/communications`
   - `/organizations/{orgId}/activityLogs`

---

## Verificación Rápida

Después de crear todos los índices, prueba estos endpoints en orden:

1. `POST /api/clients` - Crear cliente ✓
2. `GET /api/clients/:id` - Obtener cliente con suscripciones
3. `POST /api/subscriptions` - Crear suscripción
4. `GET /api/subscriptions/:id` - Obtener suscripción con períodos
5. `POST /api/subscriptions/:id/payments` - Registrar pago
6. `POST /api/payments/:id/confirm` - Confirmar pago
7. `GET /api/subscriptions/:id/debt` - Consultar deuda

Si todos funcionan sin errores de índice, estás listo para producción.
