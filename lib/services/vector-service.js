import { GoogleGenerativeAIEmbeddings } from "@langchain/google-genai";
import { QdrantVectorStore } from "@langchain/qdrant";
import { QdrantClient } from "@qdrant/js-client-rest";

import { getVectorEnv } from "../config/env.js";
import { buildEmbeddingText } from "../utils/document.js";
import { AppError } from "../utils/errors.js";

const globalForVectorStatus = globalThis;
const MAX_EMBEDDING_INPUT_CHARS = 3000;

function getQdrantClient() {
  const env = getVectorEnv();

  if (!globalForVectorStatus.qdrantClient) {
    globalForVectorStatus.qdrantClient = new QdrantClient({
      url: env.QDRANT_URL,
      apiKey: env.QDRANT_API_KEY,
    });
  }

  return globalForVectorStatus.qdrantClient;
}

function normalizeEmbeddingInput(document) {
  return buildEmbeddingText(document).slice(0, MAX_EMBEDDING_INPUT_CHARS);
}

function getCollectionVectorDimension(collectionInfo) {
  const vectorsConfig = collectionInfo?.config?.params?.vectors;

  if (typeof vectorsConfig?.size === "number") {
    return vectorsConfig.size;
  }

  if (vectorsConfig && typeof vectorsConfig === "object") {
    const firstNamedVector = Object.values(vectorsConfig).find(
      (value) => typeof value?.size === "number",
    );
    return firstNamedVector?.size ?? null;
  }

  return null;
}

async function embedDocumentsResilient(embeddings, vectorInputs) {
  let vectors = [];
  let firstErrorMessage = null;

  try {
    vectors = await embeddings.embedDocuments(vectorInputs);
  } catch {
    vectors = [];
  }

  const normalizedVectors = Array.from({ length: vectorInputs.length }, (_, index) => {
    const vector = vectors[index];
    return Array.isArray(vector) ? vector : [];
  });

  for (let index = 0; index < normalizedVectors.length; index += 1) {
    if (normalizedVectors[index].length > 0) {
      continue;
    }

    try {
      const fallbackVector = await embeddings.embedQuery(vectorInputs[index]);
      normalizedVectors[index] = Array.isArray(fallbackVector) ? fallbackVector : [];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!firstErrorMessage) {
        firstErrorMessage = message;
      }
      normalizedVectors[index] = [];

      if (/quota|rate limit|429/i.test(message)) {
        break;
      }
    }
  }

  return {
    vectors: normalizedVectors,
    firstErrorMessage,
  };
}

function createEmbeddings(taskType) {
  const env = getVectorEnv();

  if (!globalForVectorStatus.geminiReadyLogged) {
    console.log("Gemini API key configured successfully.");
    globalForVectorStatus.geminiReadyLogged = true;
  }

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
    const env = getVectorEnv();
    const embeddings = createEmbeddings("RETRIEVAL_DOCUMENT");
    const vectorInputs = documents.map((document) =>
      normalizeEmbeddingInput(document),
    );
    const { vectors: rawVectors, firstErrorMessage } = await embedDocumentsResilient(
      embeddings,
      vectorInputs,
    );
    const collectionInfo = await getQdrantClient().getCollection(
      env.QDRANT_COLLECTION_NAME,
    );
    const collectionDimension = getCollectionVectorDimension(collectionInfo);
    const discoveredDimension =
      rawVectors.find((vector) => Array.isArray(vector) && vector.length > 0)
        ?.length ?? 0;
    const expectedDimension = collectionDimension ?? discoveredDimension;

    const points = documents
      .map((document, index) => {
        const vector = rawVectors[index];

        if (!Array.isArray(vector) || vector.length === 0) {
          return null;
        }

        if (expectedDimension > 0 && vector.length !== expectedDimension) {
          return null;
        }

        return {
          id: toPointId(document.id),
          vector,
          payload: {
            id: document.id,
            title: document.title,
            content: document.content,
            url: document.url,
          },
        };
      })
      .filter(Boolean);

    if (points.length === 0) {
      const dimensionMismatchMessage =
        expectedDimension > 0 && discoveredDimension > 0 && expectedDimension !== discoveredDimension
          ? `Embedding dimension mismatch (collection: ${expectedDimension}, generated: ${discoveredDimension}).`
          : null;

      throw new AppError({
        status: 500,
        errorCode: "VECTOR_DB_ERROR",
        message: "Vector generation failed for all uploaded documents.",
        details: {
          cause:
            firstErrorMessage ??
            dimensionMismatchMessage ??
            "Embedding provider returned empty vectors.",
        },
      });
    }

    await getQdrantClient().upsert(env.QDRANT_COLLECTION_NAME, {
      wait: true,
      points,
    });

    if (process.env.NODE_ENV === "development" && points.length < documents.length) {
      console.warn(
        `[vector] Skipped ${documents.length - points.length} documents due to empty or invalid vectors.`,
      );
    }

    return points.length;
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
