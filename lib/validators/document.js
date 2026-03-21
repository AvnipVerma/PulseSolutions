import { z } from "zod";

export const manualDocumentSchema = z.object({
  title: z.string().trim().min(1, "Title is required."),
  content: z.string().trim().min(1, "Content is required."),
  url: z.string().trim().url("Enter a valid URL."),
});

export const csvDocumentRowSchema = manualDocumentSchema;

export const listDocumentsQuerySchema = z
  .object({
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .transform(({ page, limit }) => ({
    page: limit ? page ?? 1 : undefined,
    limit,
  }));

export const documentIdSchema = z.object({
  id: z.coerce.number().int().positive(),
});
