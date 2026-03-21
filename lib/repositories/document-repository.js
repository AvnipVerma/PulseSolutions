import { prisma } from "../prisma.js";

export async function createDocument(document) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`
      INSERT INTO documents (title, content, url)
      VALUES (${document.title}, ${document.content}, ${document.url})
    `;

    const rows = await tx.$queryRaw`
      SELECT id, title, content, url, createdAt
      FROM documents
      WHERE id = LAST_INSERT_ID()
      LIMIT 1
    `;

    return rows[0];
  });
}

export async function createDocuments(documents) {
  if (documents.length === 0) {
    return [];
  }

  return prisma.$transaction(async (tx) => {
    const insertedDocuments = [];

    for (const document of documents) {
      await tx.$executeRaw`
        INSERT INTO documents (title, content, url)
        VALUES (${document.title}, ${document.content}, ${document.url})
      `;

      const rows = await tx.$queryRaw`
        SELECT id, title, content, url, createdAt
        FROM documents
        WHERE id = LAST_INSERT_ID()
        LIMIT 1
      `;

      insertedDocuments.push(rows[0]);
    }

    return insertedDocuments;
  });
}

export async function deleteDocumentById(id) {
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw`
      SELECT id, title, content, url, createdAt
      FROM documents
      WHERE id = ${id}
      LIMIT 1
    `;
    const document = rows[0];

    if (!document) {
      return null;
    }

    await tx.$executeRaw`
      DELETE FROM documents
      WHERE id = ${id}
    `;

    return document;
  });
}

export async function countDocuments() {
  const rows = await prisma.$queryRaw`
    SELECT COUNT(*) AS total
    FROM documents
  `;

  return Number(rows[0]?.total ?? 0);
}

export async function listDocuments({ page, limit } = {}) {
  if (!limit) {
    return prisma.$queryRaw`
      SELECT id, title, content, url, createdAt
      FROM documents
      ORDER BY createdAt DESC, id DESC
    `;
  }

  const offset = (page - 1) * limit;

  return prisma.$queryRawUnsafe(
    `
      SELECT id, title, content, url, createdAt
      FROM documents
      ORDER BY createdAt DESC, id DESC
      LIMIT ${limit} OFFSET ${offset}
    `,
  );
}

export async function getAllDocuments() {
  return prisma.$queryRaw`
    SELECT id, title, content, url, createdAt
    FROM documents
    ORDER BY createdAt ASC, id ASC
  `;
}

export async function getSearchCorpus(limit) {
  return prisma.$queryRawUnsafe(
    `
      SELECT id, title, content, url, createdAt
      FROM documents
      ORDER BY createdAt DESC, id DESC
      LIMIT ${limit}
    `,
  );
}
