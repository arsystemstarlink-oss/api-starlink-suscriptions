export enum EventName {
  COMMUNICATION_SENT = "communication.sent",
  COMMUNICATION_RECEIVED = "communication.received",
  COMMUNICATION_FAILED = "communication.failed"
}

type EventHandler = (data: any) => void;

class EventBus {
  private handlers: Map<EventName, EventHandler[]> = new Map();

  on(event: EventName, handler: EventHandler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  off(event: EventName, handler: EventHandler) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event: EventName, data: any) {
    const handlers = this.handlers.get(event);
    if (handlers) {
      handlers.forEach(handler => {
        try {
          handler(data);
        } catch (error) {
          console.error(`Error en handler de evento ${event}:`, error);
        }
      });
    }
  }

  clear() {
    this.handlers.clear();
  }
}

export const eventBus = new EventBus();
