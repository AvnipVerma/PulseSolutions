import { createCsvDocumentsController } from "@/lib/controllers/document-controller";

export const runtime = "nodejs";

export async function POST(request) {
  return createCsvDocumentsController(request);
}

