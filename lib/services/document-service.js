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
import {
  deleteDocumentFromVectorStore,
  syncDocumentsToVectorStore,
} from "./vector-service.js";

const VECTOR_SYNC_BATCH_SIZE = 40;
const VECTOR_SYNC_MAX_RETRIES = 3;
const VECTOR_SYNC_RETRY_BASE_MS = 1500;
const globalForVectorQueue = globalThis;

function getVectorQueueState() {
  if (!globalForVectorQueue.vectorSyncQueueState) {
    globalForVectorQueue.vectorSyncQueueState = {
      queue: [],
      running: false,
    };
  }

  return globalForVectorQueue.vectorSyncQueueState;
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getErrorMessage(error) {
  if (error instanceof AppError) {
    return error.details?.cause
      ? `${error.message} ${error.details.cause}`
      : error.message;
  }

  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function isRetriableVectorError(error) {
  const message = getErrorMessage(error).toLowerCase();

  if (message.includes("quota exceeded") || message.includes("perday")) {
    return false;
  }

  return (
    message.includes("429") ||
    message.includes("rate limit") ||
    message.includes("timeout") ||
    message.includes("temporar") ||
    message.includes("econnreset") ||
    message.includes("service unavailable")
  );
}

function getRetryDelayMs(error, attempt) {
  const message = getErrorMessage(error);
  const retryDelayMatch = message.match(/retry in ([\d.]+)s/i);

  if (retryDelayMatch) {
    return Math.ceil(Number(retryDelayMatch[1]) * 1000);
  }

  return VECTOR_SYNC_RETRY_BASE_MS * attempt;
}

async function syncBatchWithRetry(batch) {
  let lastError;

  for (let attempt = 1; attempt <= VECTOR_SYNC_MAX_RETRIES; attempt += 1) {
    try {
      return await syncDocumentsToVectorStore(batch);
    } catch (error) {
      lastError = error;

      if (!isRetriableVectorError(error) || attempt === VECTOR_SYNC_MAX_RETRIES) {
        throw error;
      }

      await wait(getRetryDelayMs(error, attempt));
    }
  }

  throw lastError;
}

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

async function attemptVectorSync(documents) {
  if (documents.length === 0) {
    return {
      vectorSynced: true,
      vectorSyncError: null,
    };
  }

  try {
    let syncedCount = 0;

    for (
      let index = 0;
      index < documents.length;
      index += VECTOR_SYNC_BATCH_SIZE
    ) {
      const batch = documents.slice(index, index + VECTOR_SYNC_BATCH_SIZE);
      syncedCount += await syncBatchWithRetry(batch);
    }

    if (syncedCount < documents.length) {
      return {
        vectorSynced: false,
        vectorSyncError: `Vector sync completed partially (${syncedCount}/${documents.length}). Some rows were skipped due to invalid embeddings.`,
      };
    }

    return {
      vectorSynced: true,
      vectorSyncError: null,
    };
  } catch (error) {
    const detailedMessage = getErrorMessage(error);

    return {
      vectorSynced: false,
      vectorSyncError: detailedMessage,
    };
  }
}

async function processVectorSyncQueue() {
  const queueState = getVectorQueueState();

  if (queueState.running) {
    return;
  }

  queueState.running = true;

  try {
    while (queueState.queue.length > 0) {
      const nextBatch = queueState.queue.shift();
      const result = await attemptVectorSync(nextBatch);

      if (!result.vectorSynced) {
        console.warn(
          `[vector-sync] Background sync failed: ${result.vectorSyncError}`,
        );
      }
    }
  } finally {
    queueState.running = false;
  }
}

function enqueueVectorSync(documents) {
  if (documents.length === 0) {
    return;
  }

  const queueState = getVectorQueueState();
  queueState.queue.push(documents);

  void processVectorSyncQueue();
}

export async function saveManualDocument(payload) {
  const validatedInput = manualDocumentSchema.parse(payload);
  const preparedDocument = prepareDocumentRecord(validatedInput);
  const document = await createDocument(preparedDocument);
  const vectorSyncStatus = await attemptVectorSync([document]);

  return {
    created: true,
    document: serializeDocument(document),
    ...vectorSyncStatus,
  };
}

export async function saveCsvDocuments(file) {
  assertCsvFile(file);

  const csvText = await file.text();
  const { rows } = parseDocumentsCsv(csvText);
  const preparedDocuments = normalizeCsvRows(rows);
  const createdDocuments = await createDocuments(preparedDocuments);
  enqueueVectorSync(createdDocuments);

  return {
    insertedCount: createdDocuments.length,
    duplicateCount: preparedDocuments.length - createdDocuments.length,
    totalRows: preparedDocuments.length,
    vectorSynced: false,
    vectorSyncQueued: true,
    vectorSyncError: null,
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
