import {
  DEFAULT_SEARCH_LIMIT,
  SEMANTIC_SEARCH_LIMIT,
} from "../config/constants.js";
import {
  getDocumentsByIds,
  searchDocumentsLexically,
} from "../repositories/document-repository.js";
import { logDebug } from "../utils/debug.js";
import { searchSchema } from "../validators/search.js";
import { getVectorStore } from "./vector-service.js";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "for",
  "from",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);

function normalizeSemanticScore(score) {
  if (typeof score !== "number") {
    return 0;
  }

  return Math.max(0, Math.min(score, 1));
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function buildSearchTokens(query) {
  return normalizeSearchText(query)
    .split(" ")
    .filter(Boolean)
    .filter(
      (token) =>
        /^\d+$/.test(token) ||
        (token.length >= 3 && !STOP_WORDS.has(token)),
    );
}

function countTokenMatches(text, tokens) {
  return tokens.filter((token) => text.includes(token)).length;
}

function getDocumentId(document) {
  const rawId = document?.id ?? document?.metadata?.id;
  const numericId = Number(rawId);

  return Number.isInteger(numericId) && numericId > 0 ? numericId : null;
}

function getDocumentFields(document) {
  return {
    title: String(document?.title ?? document?.metadata?.title ?? "").trim(),
    content: String(
      document?.content ??
        document?.metadata?.content ??
        document?.pageContent ??
        "",
    ).trim(),
    url: String(document?.url ?? document?.metadata?.url ?? "").trim(),
  };
}

function getLexicalSignal(document, query) {
  const normalizedQuery = normalizeSearchText(query);
  const { title, content } = getDocumentFields(document);
  const normalizedTitle = normalizeSearchText(title);
  const normalizedContent = normalizeSearchText(content);
  const normalizedBody = [normalizedTitle, normalizedContent].filter(Boolean).join(" ");
  const tokens = buildSearchTokens(query);

  if (!normalizedBody) {
    return { lexicalScore: 0, matchTier: 0 };
  }

  if (normalizedTitle === normalizedQuery) {
    return { lexicalScore: 1, matchTier: 5 };
  }

  if (normalizedTitle.includes(normalizedQuery)) {
    return { lexicalScore: 0.94, matchTier: 4 };
  }

  if (normalizedContent.includes(normalizedQuery)) {
    return { lexicalScore: 0.84, matchTier: 3 };
  }

  if (tokens.length === 0) {
    return { lexicalScore: 0, matchTier: 0 };
  }

  const titleMatches = countTokenMatches(normalizedTitle, tokens);
  const bodyMatches = countTokenMatches(normalizedBody, tokens);
  const coverage = bodyMatches / tokens.length;

  if (titleMatches === tokens.length) {
    return {
      lexicalScore: Number((0.78 + coverage * 0.18).toFixed(3)),
      matchTier: 3,
    };
  }

  if (bodyMatches === tokens.length) {
    return {
      lexicalScore: Number((0.68 + coverage * 0.16).toFixed(3)),
      matchTier: 2,
    };
  }

  if (bodyMatches > 0) {
    return {
      lexicalScore: Number((0.42 + coverage * 0.22).toFixed(3)),
      matchTier: 1,
    };
  }

  return { lexicalScore: 0, matchTier: 0 };
}

function buildFinalScore(result) {
  if (result.matchTier >= 3) {
    return Number(
      Math.min(
        0.999,
        result.lexicalScore * 0.74 + result.semanticScore * 0.26,
      ).toFixed(3),
    );
  }

  return Number(
    Math.min(0.999, result.lexicalScore * 0.64 + result.semanticScore * 0.36).toFixed(3),
  );
}

async function getSemanticCandidates(query, limit) {
  try {
    const vectorStore = await getVectorStore("RETRIEVAL_QUERY");
    const semanticResults = await vectorStore.similaritySearchWithScore(
      query,
      Math.max(limit * 8, SEMANTIC_SEARCH_LIMIT * 3),
    );
    const vectorIds = Array.from(
      new Set(
        semanticResults
          .map(([document]) => getDocumentId(document))
          .filter(Boolean),
      ),
    );
    const persistedDocuments = await getDocumentsByIds(vectorIds);
    const persistedDocumentsById = new Map(
      persistedDocuments.map((document) => [document.id, document]),
    );

    logDebug("search", "Vector search completed.", {
      query,
      semanticHits: semanticResults.length,
      hydratedDocumentCount: persistedDocuments.length,
    });

    return semanticResults
      .map(([document, score]) => {
        const id = getDocumentId(document);
        const persistedDocument = id ? persistedDocumentsById.get(id) : null;
        const fields = getDocumentFields(persistedDocument ?? document);
        const lexical = getLexicalSignal(
          {
            ...fields,
          },
          query,
        );

        return {
          id,
          ...fields,
          semanticScore: normalizeSemanticScore(score),
          lexicalScore: lexical.lexicalScore,
          matchTier: lexical.matchTier,
        };
      })
      .filter(
        (result) => result.id && (result.title || result.content || result.url),
      );
  } catch (error) {
    logDebug("search", "Vector search failed, falling back to DB lexical search.", {
      query,
      cause: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

async function getLexicalCandidates(query, limit) {
  const tokens = buildSearchTokens(query);
  const candidateTake = Math.max(limit * 12, 50);
  const lexicalDocuments = await searchDocumentsLexically({
    query,
    tokens,
    take: candidateTake,
  });

  logDebug("search", "Database lexical search completed.", {
    query,
    tokens,
    candidateCount: lexicalDocuments.length,
  });

  return lexicalDocuments
    .map((document) => {
      const fields = getDocumentFields(document);
      const lexical = getLexicalSignal(fields, query);

      return {
        id: getDocumentId(document),
        ...fields,
        semanticScore: 0,
        lexicalScore: lexical.lexicalScore,
        matchTier: lexical.matchTier,
      };
    })
    .filter((result) => result.id && result.matchTier > 0);
}

function mergeSearchCandidates(...candidateGroups) {
  const mergedResults = new Map();

  candidateGroups.flat().forEach((candidate) => {
    if (!candidate?.id) {
      return;
    }

    const current = mergedResults.get(candidate.id);

    if (!current) {
      mergedResults.set(candidate.id, candidate);
      return;
    }

    mergedResults.set(candidate.id, {
      ...current,
      title: current.title || candidate.title,
      content: current.content || candidate.content,
      url: current.url || candidate.url,
      semanticScore: Math.max(current.semanticScore, candidate.semanticScore),
      lexicalScore: Math.max(current.lexicalScore, candidate.lexicalScore),
      matchTier: Math.max(current.matchTier, candidate.matchTier),
    });
  });

  return Array.from(mergedResults.values());
}

export async function searchDocuments(payload) {
  const { query, limit = DEFAULT_SEARCH_LIMIT } = searchSchema.parse(payload);
  logDebug("search", "Starting search.", { query, limit });

  const semanticCandidates = await getSemanticCandidates(query, limit);
  const lexicalCandidates = await getLexicalCandidates(query, limit);
  const rankedResults = mergeSearchCandidates(
    semanticCandidates,
    lexicalCandidates,
  ).filter((result) => result.matchTier > 0 || result.semanticScore >= 0.72);

  const results = rankedResults
    .map((result) => ({
      id: result.id,
      title: result.title,
      content: result.content,
      url: result.url,
      score: buildFinalScore(result),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);

  logDebug("search", "Returning ranked search results.", {
    query,
    resultCount: results.length,
    resultIds: results.map((result) => result.id),
  });

  return results;
}
