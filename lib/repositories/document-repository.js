import { prisma } from "../prisma.js";

export async function createDocument(document) {
  return prisma.document.create({
    data: {
      title: document.title,
      content: document.content,
      url: document.url,
    },
  });
}

export async function createDocuments(documents) {
  if (documents.length === 0) {
    return [];
  }

  const insertedDocuments = [];

  for (const document of documents) {
    // Keep each insert independent to avoid long-lived interactive transactions.
    const created = await prisma.document.create({
      data: {
        title: document.title,
        content: document.content,
        url: document.url,
      },
    });

    insertedDocuments.push(created);
  }

  return insertedDocuments;
}

export async function deleteDocumentById(id) {
  try {
    return await prisma.document.delete({
      where: { id },
    });
  } catch (error) {
    if (error?.code === "P2025") {
      return null;
    }

    throw error;
  }
}

export async function countDocuments() {
  return prisma.document.count();
}

export async function listDocuments({ page, limit } = {}) {
  if (!limit) {
    return prisma.document.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
  }

  const offset = (page - 1) * limit;

  return prisma.document.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
    skip: offset,
  });
}

export async function getAllDocuments() {
  return prisma.document.findMany({
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}

export async function getSearchCorpus(limit) {
  return prisma.document.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit,
  });
}
