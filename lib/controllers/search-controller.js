import { searchDocuments } from "../services/search-service.js";
import { successResponse } from "../utils/api-response.js";
import { handleApiError } from "../utils/errors.js";

export async function searchDocumentsController(request) {
  try {
    const payload = await request.json();
    const results = await searchDocuments(payload);

    return successResponse(results);
  } catch (error) {
    return handleApiError(error);
  }
}

