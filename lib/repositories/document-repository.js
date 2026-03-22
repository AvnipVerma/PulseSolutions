import { prisma } from "../prisma.js";

const DB_INSERT_BATCH_SIZE = 200;

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

  const latestDocument = await prisma.document.findFirst({
    orderBy: {
      id: "desc",
    },
    select: {
      id: true,
    },
  });
  const previousMaxId = latestDocument?.id ?? 0;
  let insertedCount = 0;

  for (let index = 0; index < documents.length; index += DB_INSERT_BATCH_SIZE) {
    const batch = documents.slice(index, index + DB_INSERT_BATCH_SIZE);
    const result = await prisma.document.createMany({
      data: batch.map((document) => ({
        title: document.title,
        content: document.content,
        url: document.url,
      })),
    });

    insertedCount += result.count;
  }

  if (insertedCount === 0) {
    return [];
  }

  return prisma.document.findMany({
    where: {
      id: {
        gt: previousMaxId,
      },
    },
    orderBy: {
      id: "asc",
    },
    take: insertedCount,
  });
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
