import fs from "node:fs";
import path from "node:path";

import nextEnv from "@next/env";

const { loadEnvConfig } = nextEnv;

const projectDir = process.cwd();

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

export function ensureEnvLoaded() {
  if (envLoaded) {
    return;
  }

  loadEnvConfig(projectDir);

  if (!process.env.DATABASE_URL) {
    applyEnvFile(path.join(projectDir, ".env"));
    applyEnvFile(path.join(projectDir, ".env.local"));
  }

  envLoaded = true;
}
