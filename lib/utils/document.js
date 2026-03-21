import { sanitizeDocumentInput } from "./sanitize.js";

export function buildEmbeddingText(document) {
  return [document.title, document.content, document.url].join("\n\n");
}

export function prepareDocumentRecord(input) {
  return sanitizeDocumentInput(input);
}

export function serializeDocument(document) {
  return {
    id: document.id,
    title: document.title,
    content: document.content,
    url: document.url,
    createdAt:
      document.createdAt instanceof Date
        ? document.createdAt.toISOString()
        : document.createdAt,
  };
}
