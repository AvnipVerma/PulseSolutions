import fs from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const projectDir = process.cwd();
const allowedDatabaseSslAcceptValues = new Set([
  "strict",
  "accept_invalid_certs",
]);

let envLoaded = false;

function stripWrappingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}

function applyEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return;
  }

  const fileContents = fs.readFileSync(filePath, "utf8");
  const lines = fileContents.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();

    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = stripWrappingQuotes(rawValue);
  }
}

function applyDatabaseTlsOverride() {
  const databaseUrl = process.env.DATABASE_URL;
  const databaseSslAccept = process.env.DATABASE_SSL_ACCEPT?.trim();

  if (!databaseUrl || !databaseSslAccept) {
    return;
  }

  if (!allowedDatabaseSslAcceptValues.has(databaseSslAccept)) {
    console.warn(
      `Ignoring unsupported DATABASE_SSL_ACCEPT value: "${databaseSslAccept}".`,
    );
    return;
  }

  try {
    const parsedUrl = new URL(databaseUrl);
    parsedUrl.searchParams.set("sslaccept", databaseSslAccept);
    process.env.DATABASE_URL = parsedUrl.toString();
  } catch (error) {
    console.warn(
      "DATABASE_SSL_ACCEPT is set, but DATABASE_URL is not a valid URL.",
      error,
    );
  }
}

export function ensureEnvLoaded() {
  if (envLoaded) {
    return;
  }

  loadEnvConfig(projectDir);

  if (!process.env.DATABASE_URL) {
    applyEnvFile(path.join(projectDir, ".env"));
    applyEnvFile(path.join(projectDir, ".env.local"));
  }

  applyDatabaseTlsOverride();

  envLoaded = true;
}
