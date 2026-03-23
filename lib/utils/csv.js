import { parse } from "csv-parse/sync";

import {
  CSV_HEADER_ALIASES,
  CSV_REQUIRED_HEADERS,
} from "../config/constants.js";
import { logDebug } from "./debug.js";
import { AppError } from "./errors.js";

function normalizeHeader(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function resolveCanonicalHeader(value) {
  const normalizedHeader = normalizeHeader(value);

  const canonicalHeader = Object.entries(CSV_HEADER_ALIASES).find(
    ([, aliases]) =>
      aliases.some((alias) => normalizeHeader(alias) === normalizedHeader),
  )?.[0];

  return canonicalHeader ?? normalizedHeader;
}

function validateHeaders(headers) {
  const normalizedHeaders = headers.map(resolveCanonicalHeader);
  const duplicateHeaders = normalizedHeaders.filter(
    (header, index) => normalizedHeaders.indexOf(header) !== index,
  );

  if (duplicateHeaders.length > 0) {
    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "CSV contains duplicate column mappings.",
      details: {
        duplicateHeaders: Array.from(new Set(duplicateHeaders)),
      },
    });
  }

  const missingHeaders = CSV_REQUIRED_HEADERS.filter(
    (header) => !normalizedHeaders.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "CSV headers are invalid.",
      details: {
        receivedHeaders: headers,
        requiredHeaders: CSV_REQUIRED_HEADERS,
        missingHeaders,
      },
    });
  }

  logDebug("csv", "Resolved CSV headers.", {
    receivedHeaders: headers,
    normalizedHeaders,
  });

  return normalizedHeaders;
}

export function parseDocumentsCsv(csvText) {
  let parsedHeaders = [];

  try {
    const rows = parse(csvText, {
      bom: true,
      columns: (headers) => {
        parsedHeaders = validateHeaders(headers);
        return parsedHeaders;
      },
      skip_empty_lines: true,
      trim: true,
    });

    if (rows.length === 0) {
      throw new AppError({
        status: 400,
        errorCode: "FILE_FORMAT_ERROR",
        message: "CSV file does not contain any data rows.",
        details: {
          requiredHeaders: CSV_REQUIRED_HEADERS,
        },
      });
    }

    return {
      headers: parsedHeaders,
      rows,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "CSV parsing failed.",
      details: {
        cause: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
