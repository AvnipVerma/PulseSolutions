import Fuse from "fuse.js";

import {
  DEFAULT_SEARCH_LIMIT,
  FUZZY_CORPUS_LIMIT,
  SEMANTIC_SEARCH_LIMIT,
} from "../config/constants.js";
import { getAllDocuments } from "../repositories/document-repository.js";
import { searchSchema } from "../validators/search.js";
import { getVectorStore } from "./vector-service.js";

function normalizeSemanticScore(score) {
  return Math.max(0, Math.min(score ?? 0, 1));
}

function normalizeFuzzyScore(score) {
  if (typeof score !== "number") {
    return 0;
  }

  return Math.max(0, 1 - Math.min(score, 1));
}

function createFuzzyEngine(corpus) {
  return new Fuse(corpus, {
    includeScore: true,
    threshold: 0.22,
    ignoreLocation: true,
    minMatchCharLength: 2,
    keys: [
      { name: "title", weight: 0.58 },
      { name: "content", weight: 0.27 },
      { name: "url", weight: 0.15 },
    ],
  });
}

function normalizeSearchText(value) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isAlphaNumeric(value) {
  return /[a-z0-9]/i.test(value);
}

function getFieldSignal(value, normalizedQuery, boundaryRegex, queryTokens) {
  const normalizedValue = normalizeSearchText(value);

  if (!normalizedValue) {
    return { score: 0, tier: 0 };
  }

  if (normalizedValue === normalizedQuery) {
    return { score: 1, tier: 6 };
  }

  const queryIndex = normalizedValue.indexOf(normalizedQuery);

  if (queryIndex >= 0 && boundaryRegex.test(normalizedValue)) {
    return {
      score: queryIndex === 0 ? 0.92 : 0.84,
      tier: queryIndex === 0 ? 5 : 4,
    };
  }

  if (queryIndex === 0) {
    const nextCharacter = normalizedValue.charAt(normalizedQuery.length);
    const continuesSameWord = nextCharacter && isAlphaNumeric(nextCharacter);

    return {
      score: continuesSameWord ? 0.38 : 0.72,
      tier: continuesSameWord ? 1 : 3,
    };
  }

  if (queryIndex > 0) {
    return { score: 0.32, tier: 1 };
  }

  if (queryTokens.length > 1) {
    const matchedTokens = queryTokens.filter((token) =>
      normalizedValue.includes(token),
    ).length;
    const coverage = matchedTokens / queryTokens.length;

    if (coverage >= 0.75) {
      return { score: 0.3 + coverage * 0.2, tier: 1 };
    }
  }

  return { score: 0, tier: 0 };
}

function getLexicalSignal(document, query) {
  const normalizedQuery = normalizeSearchText(query);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const boundaryRegex = new RegExp(
    `(^|[^a-z0-9])${escapeRegExp(normalizedQuery)}([^a-z0-9]|$)`,
    "i",
  );
  const candidates = [
    {
      field: "title",
      fieldPriority: 3,
      weight: 1,
      ...getFieldSignal(document.title, normalizedQuery, boundaryRegex, queryTokens),
    },
    {
      field: "url",
      fieldPriority: 2,
      weight: 0.96,
      ...getFieldSignal(document.url, normalizedQuery, boundaryRegex, queryTokens),
    },
    {
      field: "content",
      fieldPriority: 1,
      weight: 0.86,
      ...getFieldSignal(
        document.content,
        normalizedQuery,
        boundaryRegex,
        queryTokens,
      ),
    },
  ]
    .map((candidate) => ({
      ...candidate,
      weightedScore: Number((candidate.score * candidate.weight).toFixed(3)),
      matchTier: candidate.tier * 10 + candidate.fieldPriority,
    }))
    .sort(
      (left, right) =>
        right.matchTier - left.matchTier ||
        right.weightedScore - left.weightedScore,
    );

  const bestCandidate = candidates[0];

  if (!bestCandidate || bestCandidate.weightedScore === 0) {
    return null;
  }

  return {
    id: document.id,
    title: document.title,
    content: document.content,
    url: document.url,
    lexicalScore: bestCandidate.weightedScore,
    matchTier: bestCandidate.matchTier,
  };
}

function scoreMergedResult(result) {
  if (result.matchTier >= 40) {
    return Number(
      Math.min(
        0.999,
        result.lexicalScore * 0.74 +
          result.semanticScore * 0.14 +
          result.fuzzyScore * 0.08 +
          result.rankBoost,
      ).toFixed(3),
    );
  }

  if (result.lexicalScore > 0) {
    return Number(
      Math.min(
        0.999,
        result.lexicalScore * 0.56 +
          result.semanticScore * 0.2 +
          result.fuzzyScore * 0.18 +
          result.rankBoost,
      ).toFixed(3),
    );
  }

  return Number(
    Math.min(
      0.999,
      result.semanticScore * 0.68 +
        result.fuzzyScore * 0.26 +
        result.rankBoost,
    ).toFixed(3),
  );
}

export async function searchDocuments(payload) {
  const { query, limit = DEFAULT_SEARCH_LIMIT } = searchSchema.parse(payload);
  const corpus = await getAllDocuments();

  if (corpus.length === 0) {
    return [];
  }

  const validDocumentIds = new Set(corpus.map((document) => Number(document.id)));
  const merged = new Map();
  const lexicalMatches = corpus
    .map((document) => getLexicalSignal(document, query))
    .filter(Boolean);

  for (const result of lexicalMatches) {
    merged.set(result.id, {
      id: result.id,
      title: result.title,
      content: result.content,
      url: result.url,
      lexicalScore: result.lexicalScore,
      semanticScore: 0,
      fuzzyScore: 0,
      rankBoost: 0,
      matchTier: result.matchTier,
    });
  }

  const fuzzyCorpus =
    corpus.length > FUZZY_CORPUS_LIMIT
      ? corpus.slice(-FUZZY_CORPUS_LIMIT)
      : corpus;
  const fuzzyResults = createFuzzyEngine(fuzzyCorpus).search(query, {
    limit: limit * 3,
  });

  for (const [index, result] of fuzzyResults.entries()) {
    const existing = merged.get(result.item.id) ?? {
      id: result.item.id,
      title: result.item.title,
      content: result.item.content,
      url: result.item.url,
      lexicalScore: 0,
      semanticScore: 0,
      fuzzyScore: 0,
      rankBoost: 0,
      matchTier: 0,
    };

    merged.set(result.item.id, {
      ...existing,
      fuzzyScore: Math.max(
        existing.fuzzyScore,
        normalizeFuzzyScore(result.score),
      ),
      rankBoost: Math.max(existing.rankBoost, Math.max(0, 0.04 - index * 0.006)),
    });
  }

  try {
    const vectorStore = await getVectorStore("RETRIEVAL_QUERY");
    const semanticResults = await vectorStore.similaritySearchWithScore(
      query,
      Math.max(limit, SEMANTIC_SEARCH_LIMIT),
    );

    for (const [index, [document, score]] of semanticResults.entries()) {
      const documentId = Number(document.metadata?.id ?? document.id);

      if (!documentId || !validDocumentIds.has(documentId)) {
        continue;
      }

      const existing = merged.get(documentId) ?? {
        id: documentId,
        title: document.metadata?.title ?? "",
        content: document.metadata?.content ?? "",
        url: document.metadata?.url ?? "",
        lexicalScore: 0,
        semanticScore: 0,
        fuzzyScore: 0,
        rankBoost: 0,
        matchTier: 0,
      };

      merged.set(documentId, {
        ...existing,
        semanticScore: Math.max(
          existing.semanticScore,
          normalizeSemanticScore(score),
        ),
        rankBoost: Math.max(existing.rankBoost, 0.1 - index * 0.012),
      });
    }
  } catch (error) {
    if (process.env.NODE_ENV === "development") {
      console.warn("Semantic search fallback engaged.", error);
    }
  }

  const rankedResults = [...merged.values()]
    .map((result) => ({
      id: result.id,
      title: result.title,
      content: result.content,
      url: result.url,
      score: scoreMergedResult(result),
      matchTier: result.matchTier,
    }))
    .sort(
      (left, right) =>
        right.matchTier - left.matchTier || right.score - left.score,
    );
  const exactMatches = rankedResults.filter((result) => result.matchTier >= 60);

  if (exactMatches.length > 0) {
    return exactMatches.slice(0, limit);
  }

  const strongMatches = rankedResults.filter((result) => result.matchTier >= 40);

  if (strongMatches.length > 0) {
    return rankedResults
      .filter((result) => result.matchTier >= 40 || result.score >= 0.5)
      .slice(0, limit);
  }

  return rankedResults.slice(0, limit);
}
