import WebSocket, { WebSocketServer } from "ws";
import type { Server as HttpServer } from "http";
import type { Communication } from "../../domain/models.js";
import { CommunicationStatus } from "../../domain/types.js";
import { env } from "../../config/env.js";
import { authService } from "../../services/auth/authService.js";
import { UserRole } from "../../domain/types.js";

/**
 * Cliente WebSocket conectado.
 *
 * Los datos provienen del JWT validado en el handshake, NO de query params
 * (salvo filtros opcionales para admin). Esto evita que un cliente manipule
 * la organización o el clientId viendo datos de otros.
 */
interface WebSocketClient {
  ws: WebSocket;
  userId: string;
  role: UserRole;
  organizationId: string;
  /**
   * clientId asociado al token JWT (solo para rol client).
   * Si es un admin, puede ser undefined para ver todo o un filtro específico.
   */
  clientId?: string;
  /**
   * Filtro opcional de subscriptionId. Solo admins pueden usarlo para
   * filtrar comunicaciones a una suscripción específica.
   */
  subscriptionId?: string;
}

class WebSocketServerManager {
  private wss: WebSocketServer | null = null;
  private clients: Set<WebSocketClient> = new Set();

  initialize(server: HttpServer) {
    this.wss = new WebSocketServer({ server, path: "/ws" });

    this.wss.on("connection", (ws: WebSocket, req) => {
      const url = new URL(req.url || "", `http://${req.headers.host}`);

      // 1. Validar JWT del handshake (query param ?token=...)
      const token = url.searchParams.get("token");

      if (!token) {
        console.log("WebSocket connection rejected: missing token");
        ws.send(
          JSON.stringify({
            type: "error",
            code: "UNAUTHORIZED",
            message: "Token requerido. Usa ?token=<JWT>"
          })
        );
        ws.close(4001, "Token requerido");
        return;
      }

      let payload: { sub: string; role: UserRole; organizationId: string; clientId?: string };
      try {
        const verified = authService.verifyToken(token);
        payload = {
          sub: verified.sub,
          role: verified.role,
          organizationId: verified.organizationId,
          clientId: verified.clientId
        };
      } catch (error) {
        console.log("WebSocket connection rejected: invalid token");
        ws.send(
          JSON.stringify({
            type: "error",
            code: "UNAUTHORIZED",
            message: "Token inválido o expirado"
          })
        );
        ws.close(4002, "Token inválido");
        return;
      }

      // 2. Construir el cliente a partir del JWT (no de query params para seguridad)
      const organizationId = payload.organizationId;
      const clientId = payload.role === UserRole.Client ? payload.clientId : url.searchParams.get("clientId") || undefined;
      const subscriptionId = payload.role === UserRole.Admin ? url.searchParams.get("subscriptionId") || undefined : undefined;

      const client: WebSocketClient = {
        ws,
        userId: payload.sub,
        role: payload.role,
        organizationId,
        clientId,
        subscriptionId
      };
      this.clients.add(client);

      console.log(`WebSocket connection established: userId=${payload.sub}, role=${payload.role}`);

      ws.on("message", (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(client, data);
        } catch (error) {
          console.error("Error parsing WebSocket message:", error);
        }
      });

      ws.on("close", () => {
        console.log(`WebSocket connection closed: userId=${client.userId}`);
        this.clients.delete(client);
      });

      ws.on("error", (error) => {
        console.error("WebSocket error:", error);
        this.clients.delete(client);
      });

      ws.send(
        JSON.stringify({
          type: "connected",
          message: "Conexión WebSocket establecida",
          role: client.role,
          timestamp: new Date().toISOString()
        })
      );
    });

    console.log("WebSocket server initialized on path /ws (JWT auth required)");
  }

  private handleClientMessage(client: WebSocketClient, data: any) {
    console.log("Received message from client:", data);
  }

  /**
   * Broadcast de una communication a todos los clientes cualificados.
   *
   * Reglas de filtrado:
   * - Solo clientes de la misma organización reciben el broadcast.
   * - Clientes con rol client solo reciben si la communication es para su clientId.
   * - Clientes con rol admin reciben si el clientId coincide (o no tienen filtro).
   * - El filtro opcional subscriptionId (solo admin) restringe aún más.
   */
  broadcastCommunication(communication: Communication, organizationId: string) {
    if (!this.wss) return;

    const payload = {
      type: "communication",
      data: communication,
      timestamp: new Date().toISOString()
    };

    const message = JSON.stringify(payload);

    this.clients.forEach((client) => {
      if (client.ws.readyState !== WebSocket.OPEN) return;
      if (client.organizationId !== organizationId) return;

      // Filtro por clientId: si el cliente tiene clientId, debe coincidir
      if (client.clientId && client.clientId !== communication.clientId) {
        return;
      }

      // Filtro por subscriptionId: si el cliente lo especificó, debe coincidir
      if (client.subscriptionId && client.subscriptionId !== communication.subscriptionId) {
        return;
      }

      client.ws.send(message);
    });
  }

  broadcastCommunicationSent(communication: Communication, organizationId: string) {
    this.broadcastCommunication(communication, organizationId);
  }

  broadcastCommunicationReceived(communication: Communication, organizationId: string) {
    this.broadcastCommunication(communication, organizationId);
  }

  broadcastCommunicationFailed(communication: Communication, organizationId: string) {
    this.broadcastCommunication(communication, organizationId);
  }

  shutdown() {
    if (this.wss) {
      this.wss.close();
      this.clients.clear();
    }
  }
}

export const webSocketServer = new WebSocketServerManager();
