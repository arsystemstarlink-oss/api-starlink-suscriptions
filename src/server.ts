import { ensureFirebaseInitialized, validateFirebaseConnection } from "./config/firebase.js";
import { app } from "./app.js";
import { env } from "./config/env.js";
import { webSocketServer } from "./infrastructure/websocket/websocketServer.js";
import { eventBus, EventName } from "./infrastructure/events/eventBus.js";
import { schedulerService } from "./services/cron/schedulerService.js";

// Inicializar Firebase
ensureFirebaseInitialized();

const server = app.listen(env.PORT, async () => {
  console.log(`\n🚀 API escuchando en puerto ${env.PORT}`);
  console.log(`📡 WebSocket disponible en ws://localhost:${env.PORT}/ws`);
  console.log(`\n📊 Estado del sistema:`);
  console.log(`   Entorno: ${env.NODE_ENV}`);
  console.log(`   Organización: ${env.ORGANIZATION_ID}`);
  console.log(`   Twilio: ${env.TWILIO_ACCOUNT_SID ? "✅ Configurado" : "❌ No configurado"}`);
  console.log();

  // Validar conexión a Firestore
  try {
    await validateFirebaseConnection();
  } catch (error) {
    console.error("\n⚠️  La API está corriendo pero la conexión a Firestore falló.");
    console.error("   Las operaciones de base de datos no funcionarán hasta que se resuelva este problema.\n");
    // No cerramos el servidor completamente, pero registramos el error críticamente
    // Esto permite que Railway u otros orquestadores detecten el fallo via health checks
  }

  webSocketServer.initialize(server);
  
  eventBus.on(EventName.COMMUNICATION_SENT, (data) => {
    webSocketServer.broadcastCommunicationSent(data, data.organizationId);
  });
  
  eventBus.on(EventName.COMMUNICATION_RECEIVED, (data) => {
    webSocketServer.broadcastCommunicationReceived(data, data.organizationId);
  });
  
  eventBus.on(EventName.COMMUNICATION_FAILED, (data) => {
    webSocketServer.broadcastCommunicationFailed(data, data.organizationId);
  });

  schedulerService.initialize().catch((err) => {
    console.error("⏰ Error inicializando scheduler:", err);
  });
});

function shutdown(signal: string) {
  console.log(`\n${signal} recibido. Cerrando servidor...`);
  schedulerService.shutdown();
  webSocketServer.shutdown();
  server.close(() => {
    console.log("Servidor cerrado");
    process.exit(0);
  });
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
