import { successResponse } from "../utils/api-response.js";
import { handleApiError } from "../utils/errors.js";
import {
  deleteDocument,
  getDocuments,
  saveCsvDocuments,
  saveManualDocument,
} from "../services/document-service.js";

export async function createManualDocumentController(request) {
  try {
    const payload = await request.json();
    const result = await saveManualDocument(payload);

    return successResponse(result, result.created ? 201 : 200);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function createCsvDocumentsController(request) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const result = await saveCsvDocuments(file);

    return successResponse(result, 201);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function getDocumentsController(request) {
  try {
    const { searchParams } = new URL(request.url);
    const result = await getDocuments({
      page: searchParams.get("page") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
    });

    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function deleteDocumentController(documentId) {
  try {
    const result = await deleteDocument(documentId);

    return successResponse(result);
  } catch (error) {
    return handleApiError(error);
  }
}
