import { Document as LangChainDocument } from "@langchain/core/documents";
import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";

import { getVectorEnv } from "../config/env.js";
import { buildEmbeddingText } from "../utils/document.js";
import { AppError } from "../utils/errors.js";

function createEmbeddings(taskType) {
  const env = getVectorEnv();

  return new GoogleGenerativeAIEmbeddings({
    apiKey: env.GEMINI_API_KEY,
    model: "gemini-embedding-001",
    taskType,
  });
}

function toPointId(value) {
  const numericId = Number(value);

  if (Number.isInteger(numericId) && numericId > 0) {
    return numericId;
  }

  return String(value);
}

function wrapVectorError(error) {
  if (error instanceof AppError) {
    throw error;
  }

  const errorMessage = error instanceof Error ? error.message : String(error);
  const accessDenied =
    errorMessage === "Forbidden" ||
    (typeof error?.status === "number" && error.status === 403);

  throw new AppError({
    status: 500,
    errorCode: "VECTOR_DB_ERROR",
    message: accessDenied
      ? "Qdrant access was denied. Check QDRANT_URL and QDRANT_API_KEY."
      : "Vector database operation failed.",
    details:
      process.env.NODE_ENV === "development"
        ? {
            cause: errorMessage,
          }
        : {},
  });
}

export async function getVectorStore(taskType = "RETRIEVAL_QUERY") {
  const env = getVectorEnv();

  try {
    return await QdrantVectorStore.fromExistingCollection(createEmbeddings(taskType), {
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
      collectionName: env.QDRANT_COLLECTION_NAME,
    });
  } catch (error) {
    wrapVectorError(error);
  }
}

export async function syncDocumentsToVectorStore(documents) {
  if (documents.length === 0) {
    return 0;
  }

  try {
    const vectorStore = await getVectorStore("RETRIEVAL_DOCUMENT");
    const vectorDocuments = documents.map(
      (document) =>
        new LangChainDocument({
          id: toPointId(document.id),
          pageContent: buildEmbeddingText(document),
          metadata: {
            id: document.id,
            title: document.title,
            content: document.content,
            url: document.url,
          },
        }),
    );

    await vectorStore.addDocuments(vectorDocuments, {
      ids: documents.map((document) => toPointId(document.id)),
    });

    return documents.length;
  } catch (error) {
    wrapVectorError(error);
  }
}

export async function deleteDocumentFromVectorStore(documentId) {
  try {
    const vectorStore = await getVectorStore("RETRIEVAL_DOCUMENT");
    await vectorStore.delete({
      ids: [toPointId(documentId)],
    });
  } catch (error) {
    wrapVectorError(error);
  }
}
