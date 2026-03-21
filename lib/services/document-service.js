import { ZodError } from "zod";

import {
  createDocument,
  createDocuments,
  countDocuments,
  deleteDocumentById,
  getAllDocuments,
  listDocuments,
} from "../repositories/document-repository.js";
import { MAX_CSV_FILE_SIZE_BYTES } from "../config/constants.js";
import {
  csvDocumentRowSchema,
  documentIdSchema,
  listDocumentsQuerySchema,
  manualDocumentSchema,
} from "../validators/document.js";
import { parseDocumentsCsv } from "../utils/csv.js";
import { prepareDocumentRecord, serializeDocument } from "../utils/document.js";
import { AppError } from "../utils/errors.js";
import { deleteDocumentFromVectorStore } from "./vector-service.js";

function assertCsvFile(file) {
  if (!file || typeof file.arrayBuffer !== "function") {
    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "Please upload a valid CSV file.",
    });
  }

  if (file.size === 0) {
    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "Uploaded CSV file is empty.",
    });
  }

  if (file.size > MAX_CSV_FILE_SIZE_BYTES) {
    throw new AppError({
      status: 413,
      errorCode: "FILE_FORMAT_ERROR",
      message: "CSV file is too large.",
      details: {
        maxBytes: MAX_CSV_FILE_SIZE_BYTES,
      },
    });
  }

  const fileName = file.name?.toLowerCase() ?? "";
  const fileType = file.type?.toLowerCase() ?? "";
  const isCsv = fileName.endsWith(".csv") || fileType.includes("csv");

  if (!isCsv) {
    throw new AppError({
      status: 400,
      errorCode: "FILE_FORMAT_ERROR",
      message: "Only CSV uploads are supported.",
    });
  }
}

function normalizeCsvRows(rows) {
  return rows.map((row, index) => {
    try {
      const validatedRow = csvDocumentRowSchema.parse(row);
      return prepareDocumentRecord(validatedRow);
    } catch (error) {
      if (error instanceof ZodError) {
        throw new AppError({
          status: 400,
          errorCode: "VALIDATION_ERROR",
          message: `CSV row ${index + 2} is invalid.`,
          details: {
            row: index + 2,
            errors: error.flatten(),
          },
        });
      }

      throw error;
    }
  });
}

export async function saveManualDocument(payload) {
  const validatedInput = manualDocumentSchema.parse(payload);
  const preparedDocument = prepareDocumentRecord(validatedInput);
  const document = await createDocument(preparedDocument);

  return {
    created: true,
    document: serializeDocument(document),
  };
}

export async function saveCsvDocuments(file) {
  assertCsvFile(file);

  const csvText = await file.text();
  const { rows } = parseDocumentsCsv(csvText);
  const preparedDocuments = normalizeCsvRows(rows);
  const createdCount = await createDocuments(preparedDocuments);

  return {
    insertedCount: createdCount,
    duplicateCount: preparedDocuments.length - createdCount,
    totalRows: preparedDocuments.length,
  };
}

export async function getDocuments(query) {
  const { page, limit } = listDocumentsQuerySchema.parse(query ?? {});
  const documents = await listDocuments({ page, limit });

  if (!limit) {
    return {
      documents: documents.map(serializeDocument),
      pagination: null,
    };
  }

  const total = await countDocuments();

  return {
    documents: documents.map(serializeDocument),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    },
  };
}

export async function getDocumentsForEmbedding() {
  return getAllDocuments();
}

export async function deleteDocument(documentId) {
  const { id } = documentIdSchema.parse({ id: documentId });
  const deletedDocument = await deleteDocumentById(id);

  if (!deletedDocument) {
    throw new AppError({
      status: 404,
      errorCode: "DATABASE_ERROR",
      message: "Document not found.",
    });
  }

  try {
    await deleteDocumentFromVectorStore(id);
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("Vector cleanup skipped for deleted document.", error);
    }
  }

  return {
    deleted: true,
    document: serializeDocument(deletedDocument),
  };
}
