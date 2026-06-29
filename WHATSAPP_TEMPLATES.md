# Plantillas de WhatsApp Aprobadas

Este documento contiene las plantillas de WhatsApp aprobadas por Meta para el envío de notificaciones desde el sistema.

## 1. Recordatorio 3 días antes del vencimiento

- **Nombre**: `subscription_reminder_3days_2v`
- **SID**: `HXfcc8ae438db9df662a0e1f7d801e946b`
- **Variables**:
  - `{{1}}`: Nombre del cliente
  - `{{2}}`: Fecha de vencimiento (YYYY-MM-DD)
- **Mensaje**:
  ```
  Hola *{{1}}*, te recordamos que tu suscripción de Starlink vence el *{{2}}*. 📅

  Para evitar la suspensión del servicio, te recomendamos realizar el pago antes de la fecha indicada.

  Si ya realizaste el pago, por favor ignora este mensaje.

  *A|R System*
  > Este es un mensaje automático de notificación, no es necesario responder.
  ```
- **Cuándo se usa**: 3 días antes del vencimiento de la suscripción (día de vencimiento - 3)

## 2. Aviso día de vencimiento (cutoff day)

- **Nombre**: `subscription_cutoff_day_2v`
- **SID**: `HX416f989f4eb0c55836464269165eece0`
- **Variables**:
  - `{{1}}`: Nombre del cliente
  - `{{2}}`: Código de la suscripción
  - `{{3}}`: Fecha de hoy (YYYY-MM-DD)
- **Mensaje**:
  ```
  Hola *{{1}}*, te informamos que tu suscripción de *Starlink* *{{2}}* vence *hoy {{3}}*. ⏰

  Para evitar la suspensión del servicio, te recomendamos realizar el pago antes de la hora de corte establecida.

  Si ya realizaste el pago, por favor ignora este mensaje.

  *A|R System*
  > Este es un mensaje automático de notificación, no es necesario responder.
  ```
- **Cuándo se usa**: El mismo día de vencimiento de la suscripción

## 3. Notificación de suspensión

- **Nombre**: `subscription_suspended_notice_2v`
- **SID**: `HX9954143348c57d5cfb1daf4b5ab8ee6b`
- **Variables**:
  - `{{1}}`: Nombre del cliente
  - `{{2}}`: Código de la suscripción
- **Mensaje**:
  ```
  Hola *{{1}}*, te informamos que tu suscripción de Starlink *{{2}}* fue suspendida por falta de pago. ⚠️

  Para reactivar el servicio, te recomendamos realizar el pago pendiente o contactar a soporte para mayor información.

  *A|R System*
  > Este es un mensaje automático de notificación, no es necesario responder.
  ```
- **Cuándo se usa**: Cuando la suscripción pasa a estado "suspended" después del período de gracia

## Configuración en .env

```env
TWILIO_WHATSAPP_REMINDER_SID=HXfcc8ae438db9df662a0e1f7d801e946b
TWILIO_WHATSAPP_CUTOFF_SID=HX416f989f4eb0c55836464269165eece0
TWILIO_WHATSAPP_SUSPENDED_SID=HX9954143348c57d5cfb1daf4b5ab8ee6b
```

## Variables de Entorno Adicionales Requeridas

```env
TWILIO_ACCOUNT_SID=
TWILIO_AUTH_TOKEN=
TWILIO_WHATSAPP_FROM=whatsapp:+584223552626
TWILIO_WHATSAPP_TO=whatsapp:+584161005606
```

## Flujo de Notificaciones

1. **3 días antes del vencimiento** → Se envía `subscription_reminder_3days_2v` con nombre y fecha
2. **Día de vencimiento** → Se envía `subscription_cutoff_day_2v` con nombre, código y fecha actual
3. **Después del período de gracia** → Se suspende la suscripción y se envía `subscription_suspended_notice_2v` con nombre y código
