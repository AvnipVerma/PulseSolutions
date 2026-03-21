import { searchDocumentsController } from "@/lib/controllers/search-controller";

export const runtime = "nodejs";

export async function POST(request) {
  return searchDocumentsController(request);
}
