import { parse } from "csv-parse/sync";

import { CSV_REQUIRED_HEADERS } from "../config/constants.js";
import { AppError } from "./errors.js";

function normalizeHeader(value) {
  return String(value ?? "").trim().toLowerCase();
}

function validateHeaders(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  const missingHeaders = CSV_REQUIRED_HEADERS.filter(
    (header) => !normalizedHeaders.includes(header),
  );

  if (missingHeaders.length > 0) {
    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "CSV headers are invalid.",
      details: {
        requiredHeaders: CSV_REQUIRED_HEADERS,
        missingHeaders,
      },
    });
  }

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

