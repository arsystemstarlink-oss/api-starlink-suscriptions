import { cert, getApps, initializeApp } from "firebase-admin/app";
import { getFirestore } from "firebase-admin/firestore";
import { env } from "./env.js";

let isInitialized = false;

/**
 * Inicializa Firebase Admin SDK.
 * 
 * Estrategias de autenticación (en orden de prioridad):
 * 1. Variables de entorno (FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY) - Recomendado para producción
 * 2. Archivo JSON local (FIREBASE_SERVICE_ACCOUNT_KEY_PATH) - Solo para desarrollo
 * 
 * @throws Error si no se pueden encontrar credenciales válidas
 */
export function ensureFirebaseInitialized(): void {
  if (isInitialized && getApps().length > 0) {
    return;
  }

  const config: Record<string, any> = {
    projectId: env.FIREBASE_PROJECT_ID,
  };

  // Estrategia 1: Variables de entorno (producción)
  if (env.FIREBASE_CLIENT_EMAIL && env.FIREBASE_PRIVATE_KEY) {
    console.log("🔐 Firebase: Usando credenciales desde variables de entorno");
    
    const privateKey = env.FIREBASE_PRIVATE_KEY
      .replace(/\\n/g, "\n")
      .replace(/"/g, "");

    config.credential = cert({
      projectId: env.FIREBASE_PROJECT_ID,
      clientEmail: env.FIREBASE_CLIENT_EMAIL,
      privateKey,
    });
  } 
  // Estrategia 2: Archivo JSON local (desarrollo)
  else if (env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH) {
    console.log(`🔐 Firebase: Usando credenciales desde archivo JSON: ${env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH}`);
    
    try {
      const serviceAccount = require(env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH);
      
      config.credential = cert({
        projectId: serviceAccount.project_id,
        clientEmail: serviceAccount.client_email,
        privateKey: serviceAccount.private_key,
      });
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      throw new Error(
        `No se pudo cargar el archivo de credenciales en: ${env.FIREBASE_SERVICE_ACCOUNT_KEY_PATH}\n` +
        `Error: ${errorMsg}\n` +
        `Verifica que el archivo exista y sea un JSON válido.`
      );
    }
  } 
  // Sin credenciales
  else {
    throw new Error(
      "❌ No se encontraron credenciales de Firebase.\n" +
      "Configura una de estas opciones:\n" +
      "  1. Variables de entorno: FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY (producción)\n" +
      "  2. Archivo JSON: FIREBASE_SERVICE_ACCOUNT_KEY_PATH (desarrollo)"
    );
  }

  initializeApp(config);
  isInitialized = true;
  console.log(`✅ Firebase inicializado (proyecto: ${env.FIREBASE_PROJECT_ID})`);
}

/**
 * Valida que la conexión a Firestore funcione correctamente.
 * Realiza una operación simple de lectura para verificar las credenciales.
 * 
 * @throws Error si la conexión falla
 */
export async function validateFirebaseConnection(): Promise<void> {
  console.log("🔍 Validando conexión a Firestore...");
  
  try {
    const db = getFirestore();
    
    // Operación simple: intentar obtener una colección que no existe devuelve vacío pero prueba la conexión
    const collectionName = `_firebase_health_check_${Date.now()}`;
    await db.collection(collectionName).limit(1).get();
    
    console.log("✅ Conexión a Firestore validada correctamente");
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    console.error("❌ Error al validar conexión a Firestore:");
    console.error(`   ${errorMsg}`);
    
    if (errorMsg.includes("PERMISSION_DENIED")) {
      throw new Error(
        "❌ Permisos insuficientes en Firestore.\n" +
        "Verifica que el service account tenga el rol 'Cloud Datastore User' o equivalente."
      );
    } else if (errorMsg.includes("UNAUTHENTICATED")) {
      throw new Error(
        "❌ Credenciales inválidas.\n" +
        "Verifica que FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY sean correctos."
      );
    } else if (errorMsg.includes("NOT_FOUND")) {
      throw new Error(
        "❌ Proyecto de Firebase no encontrado.\n" +
        `Verifica que FIREBASE_PROJECT_ID='${env.FIREBASE_PROJECT_ID}' sea correcto.`
      );
    }
    
    throw new Error(`Error de conexión a Firestore: ${errorMsg}`);
  }
}

/**
 * Obtiene una instancia de Firestore configurada.
 * Lance un error si Firebase no ha sido inicializado.
 */
export function getDb(): ReturnType<typeof getFirestore> {
  if (getApps().length === 0) {
    throw new Error("Firebase no ha sido inicializado. Llama a ensureFirebaseInitialized() primero.");
  }
  return getFirestore();
}
