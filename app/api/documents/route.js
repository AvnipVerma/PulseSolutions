import { getDocumentsController } from "@/lib/controllers/document-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  return getDocumentsController(request);
}

