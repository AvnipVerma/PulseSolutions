import { createManualDocumentController } from "@/lib/controllers/document-controller";

export const runtime = "nodejs";

export async function POST(request) {
  return createManualDocumentController(request);
}

