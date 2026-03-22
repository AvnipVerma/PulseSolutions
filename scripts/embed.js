import { getDocumentsForEmbedding } from "../lib/services/document-service.js";
import { syncDocumentsToVectorStore } from "../lib/services/vector-service.js";

const BATCH_SIZE = 25;

async function main() {
  console.info("[embed] Fetching documents from MySQL...");
  const documents = await getDocumentsForEmbedding();

  if (documents.length === 0) {
    console.info("[embed] No documents found. Nothing to embed.");
    return;
  }

  console.info(`[embed] Found ${documents.length} documents.`);

  let processed = 0;
  let synced = 0;

  for (let index = 0; index < documents.length; index += BATCH_SIZE) {
    const batch = documents.slice(index, index + BATCH_SIZE);
    const batchNumber = Math.floor(index / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(documents.length / BATCH_SIZE);

    console.info(
      `[embed] Processing batch ${batchNumber}/${totalBatches} (${batch.length} documents)...`,
    );

    const syncedInBatch = await syncDocumentsToVectorStore(batch);
    processed += batch.length;
    synced += syncedInBatch;

    console.info(
      `[embed] Progress: ${processed}/${documents.length} (synced ${synced})`,
    );
  }

  if (synced < documents.length) {
    console.warn(
      `[embed] Completed with skips: ${documents.length - synced} documents returned invalid embeddings.`,
    );
  }

  console.info("[embed] Embedding sync complete.");
}

main().catch((error) => {
  console.error("[embed] Failed to sync embeddings.");
  console.error(error);
  process.exitCode = 1;
});
