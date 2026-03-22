import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { errorResponse } from "./api-response.js";

export class AppError extends Error {
  constructor({ status = 500, errorCode = "UNKNOWN_ERROR", message, details }) {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.errorCode = errorCode;
    this.details = details ?? {};
  }
}

function normalizeZodError(error) {
  return new AppError({
    status: 400,
    errorCode: "VALIDATION_ERROR",
    message: "Invalid input",
    details: error.flatten(),
  });
}

function isUntrustedTlsCertificateError(error) {
  const message = error?.message?.toLowerCase?.() ?? "";

  return (
    message.includes("error opening a tls connection") &&
    message.includes("root certificate which is not trusted")
  );
}

function normalizePrismaError(error) {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === "P2002"
  ) {
    return new AppError({
      status: 409,
      errorCode: "DATABASE_ERROR",
      message: "A matching document already exists.",
      details: {
        target: error.meta?.target ?? [],
      },
    });
  }

  if (isUntrustedTlsCertificateError(error)) {
    return new AppError({
      status: 500,
      errorCode: "DATABASE_ERROR",
      message:
        "Database TLS certificate is not trusted. Set DATABASE_SSL_ACCEPT=accept_invalid_certs for local development or install the provider CA certificate.",
      details:
        process.env.NODE_ENV === "development"
          ? {
              cause: error.message,
            }
          : {},
    });
  }

  return new AppError({
    status: 500,
    errorCode: "DATABASE_ERROR",
    message: "A database operation failed.",
    details:
      process.env.NODE_ENV === "development"
        ? {
            cause: error.message,
          }
        : {},
  });
}

export function normalizeError(error) {
  if (error instanceof AppError) {
    return error;
  }

  if (error instanceof ZodError) {
    return normalizeZodError(error);
  }

  if (
    error instanceof Prisma.PrismaClientKnownRequestError ||
    error instanceof Prisma.PrismaClientValidationError ||
    error instanceof Prisma.PrismaClientInitializationError ||
    error instanceof Prisma.PrismaClientRustPanicError
  ) {
    return normalizePrismaError(error);
  }

  return new AppError({
    status: 500,
    errorCode: "UNKNOWN_ERROR",
    message: error instanceof Error ? error.message : "Unexpected error",
    details:
      process.env.NODE_ENV === "development"
        ? {
            cause: error instanceof Error ? error.stack : String(error),
          }
        : {},
  });
}

export function handleApiError(error) {
  const normalized = normalizeError(error);

  return errorResponse({
    status: normalized.status,
    errorCode: normalized.errorCode,
    message: normalized.message,
    details: normalized.details,
  });
}
