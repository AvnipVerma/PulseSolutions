import {
  DEFAULT_SEARCH_LIMIT,
  SEMANTIC_SEARCH_LIMIT,
} from "../config/constants.js";
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

function getLexicalSignal(document, query) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedTitle = normalizeSearchText(document.metadata?.title);
  const normalizedContent = normalizeSearchText(document.metadata?.content);
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
      Math.min(0.999, result.lexicalScore * 0.74 + result.semanticScore * 0.26).toFixed(3),
    );
  }

  return Number(
    Math.min(0.999, result.lexicalScore * 0.64 + result.semanticScore * 0.36).toFixed(3),
  );
}

export async function searchDocuments(payload) {
  const { query, limit = DEFAULT_SEARCH_LIMIT } = searchSchema.parse(payload);
  const vectorStore = await getVectorStore("RETRIEVAL_QUERY");
  const semanticResults = await vectorStore.similaritySearchWithScore(
    query,
    Math.max(limit * 8, SEMANTIC_SEARCH_LIMIT * 3),
  );

  const rankedResults = semanticResults
    .map(([document, score]) => {
      const lexical = getLexicalSignal(document, query);

      return {
        id: Number(document.metadata?.id ?? document.id),
        title: document.metadata?.title ?? "",
        content: document.metadata?.content ?? "",
        semanticScore: normalizeSemanticScore(score),
        lexicalScore: lexical.lexicalScore,
        matchTier: lexical.matchTier,
      };
    })
    .filter((result) => result.id && (result.title || result.content));
  const lexicalMatches = rankedResults.filter((result) => result.matchTier > 0);

  return lexicalMatches
    .map((result) => ({
      id: result.id,
      title: result.title,
      content: result.content,
      score: buildFinalScore(result),
    }))
    .sort((left, right) => right.score - left.score)
    .slice(0, limit);
}
