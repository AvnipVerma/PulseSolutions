import { z } from "zod";

import { DEFAULT_SEARCH_LIMIT, MAX_SEARCH_LIMIT } from "../config/constants.js";

export const searchSchema = z.object({
  query: z.string().trim().min(2, "Enter at least 2 characters."),
  limit: z
    .coerce
    .number()
    .int()
    .min(DEFAULT_SEARCH_LIMIT)
    .max(MAX_SEARCH_LIMIT)
    .default(DEFAULT_SEARCH_LIMIT),
});
