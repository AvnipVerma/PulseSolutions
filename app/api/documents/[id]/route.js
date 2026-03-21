import { deleteDocumentController } from "@/lib/controllers/document-controller";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(_request, context) {
  const { id } = await context.params;

  return deleteDocumentController(id);
}
