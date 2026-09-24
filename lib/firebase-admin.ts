import "server-only";

import { cert, getApps, initializeApp, type ServiceAccount } from "firebase-admin/app";
import { getDatabase } from "firebase-admin/database";

const ADMIN_APP_NAME = "dual-temperature-monitor-admin";

interface ServiceAccountJson {
  project_id?: unknown;
  client_email?: unknown;
  private_key?: unknown;
}

function readServiceAccount(): ServiceAccount {
  const encoded = process.env.FIREBASE_SERVICE_ACCOUNT_BASE64;
  if (!encoded) {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is not configured.");
  }

  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(
      Buffer.from(encoded, "base64").toString("utf8"),
    ) as ServiceAccountJson;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_BASE64 is malformed.");
  }

  if (
    typeof parsed.project_id !== "string" ||
    typeof parsed.client_email !== "string" ||
    typeof parsed.private_key !== "string"
  ) {
    throw new Error("Firebase service-account fields are missing.");
  }

  return {
    projectId: parsed.project_id,
    clientEmail: parsed.client_email,
    privateKey: parsed.private_key,
  };
}

export function getAdminDatabase() {
  const databaseURL = process.env.FIREBASE_DATABASE_URL;
  if (!databaseURL) {
    throw new Error("FIREBASE_DATABASE_URL is not configured.");
  }

  const existing = getApps().find((app) => app.name === ADMIN_APP_NAME);
  const app =
    existing ??
    initializeApp(
      {
        credential: cert(readServiceAccount()),
        databaseURL,
      },
      ADMIN_APP_NAME,
    );

  return getDatabase(app);
}
