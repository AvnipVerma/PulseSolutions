import { z } from "zod";

import { ensureEnvLoaded } from "./load-env.js";
import { DEFAULT_QDRANT_COLLECTION } from "./constants.js";
import { AppError } from "../utils/errors.js";

ensureEnvLoaded();

const baseEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required."),
});

const vectorEnvSchema = baseEnvSchema.extend({
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required."),
  QDRANT_URL: z.string().url("QDRANT_URL must be a valid URL."),
  QDRANT_API_KEY: z.string().min(1, "QDRANT_API_KEY is required."),
  QDRANT_COLLECTION_NAME: z
    .string()
    .min(1, "QDRANT_COLLECTION_NAME is required.")
    .default(DEFAULT_QDRANT_COLLECTION),
});

function formatIssues(issues) {
  return issues.map((issue) => ({
    field: issue.path.join("."),
    message: issue.message,
  }));
}

function parseEnvironment(schema, errorCode) {
  const parsed = schema.safeParse({
    ...process.env,
    QDRANT_COLLECTION_NAME:
      process.env.QDRANT_COLLECTION_NAME ?? DEFAULT_QDRANT_COLLECTION,
  });

  if (!parsed.success) {
    throw new AppError({
      status: 500,
      errorCode,
      message: "Environment configuration is incomplete.",
      details: {
        issues: formatIssues(parsed.error.issues),
      },
    });
  }

  return parsed.data;
}

export function getDatabaseEnv() {
  return parseEnvironment(baseEnvSchema, "DATABASE_ERROR");
}

export function getVectorEnv() {
  return parseEnvironment(vectorEnvSchema, "VECTOR_DB_ERROR");
}
