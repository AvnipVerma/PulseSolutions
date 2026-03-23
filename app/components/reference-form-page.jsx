"use client";

import { FileUp, Search, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { logDebug } from "@/lib/utils/debug";
import { manualDocumentSchema } from "@/lib/validators/document";
import { searchSchema } from "@/lib/validators/search";

const initialState = {
  title: "",
  content: "",
  url: "",
};

function getManualErrors(error) {
  const fieldErrors = error.flatten().fieldErrors;

  return {
    title: fieldErrors.title?.[0],
    content: fieldErrors.content?.[0],
    url: fieldErrors.url?.[0],
  };
}

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${bytes} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function ReferenceFormPage() {
  const [formData, setFormData] = useState(initialState);
  const [manualErrors, setManualErrors] = useState({});
  const [manualFormError, setManualFormError] = useState("");
  const [isSavingManual, setIsSavingManual] = useState(false);

  const [file, setFile] = useState(null);
  const [csvError, setCsvError] = useState("");
  const [isUploadingCsv, setIsUploadingCsv] = useState(false);

  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchQuery, setActiveSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [searchFieldError, setSearchFieldError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  const [deleteCandidate, setDeleteCandidate] = useState(null);
  const [isDeletingId, setIsDeletingId] = useState(null);

  useEffect(() => {
    if (!isSearchOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key !== "Escape") {
        return;
      }

      if (deleteCandidate) {
        setDeleteCandidate(null);
        return;
      }

      setIsSearchOpen(false);
    }

    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [deleteCandidate, isSearchOpen]);

  function updateField(name, value) {
    setFormData((current) => ({
      ...current,
      [name]: value,
    }));
    setManualErrors((current) => ({
      ...current,
      [name]: undefined,
    }));
    setManualFormError("");
  }

  function resetManualForm() {
    setFormData(initialState);
    setManualErrors({});
    setManualFormError("");
  }

  function resetCsvForm() {
    setFile(null);
    setCsvError("");
  }

  function resetAllInputs() {
    resetManualForm();
    resetCsvForm();
  }

  async function handleManualSubmit() {
    setIsSavingManual(true);
    setManualErrors({});
    setManualFormError("");

    try {
      const validation = manualDocumentSchema.safeParse(formData);

      if (!validation.success) {
        setManualErrors(getManualErrors(validation.error));
        return;
      }

      const response = await fetch("/api/documents/manual", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validation.data),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Save failed.");
      }

      if (payload.data?.vectorSynced === false) {
        toast.warning(
          payload.data.vectorSyncError
            ? `Saved in DB, but Qdrant sync failed: ${payload.data.vectorSyncError}`
            : "Saved in DB, but Qdrant sync failed.",
        );
      } else {
        toast.success("Document saved.");
      }

      resetManualForm();
    } catch (error) {
      setManualFormError(
        error instanceof Error ? error.message : "Save failed.",
      );
    } finally {
      setIsSavingManual(false);
    }
  }

  async function handleCsvUpload() {
    setIsUploadingCsv(true);
    setCsvError("");

    try {
      if (!file) {
        setCsvError("Choose a CSV file for batch upload.");
        return;
      }

      logDebug("reference-form", "Submitting CSV upload.", {
        fileName: file.name,
        fileSize: file.size,
      });

      const formPayload = new FormData();
      formPayload.append("file", file);

      const response = await fetch("/api/documents/csv", {
        method: "POST",
        body: formPayload,
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Upload failed.");
      }

      logDebug("reference-form", "CSV upload completed.", {
        insertedCount: payload.data?.insertedCount ?? 0,
        duplicateCount: payload.data?.duplicateCount ?? 0,
        vectorSyncQueued: Boolean(payload.data?.vectorSyncQueued),
      });

      const message = `Batch upload complete: ${payload.data.insertedCount} records saved.`;

      if (payload.data?.vectorSyncQueued) {
        toast.success(`${message} Vector sync queued in background.`);
      } else if (payload.data?.vectorSynced === false) {
        toast.warning(
          payload.data.vectorSyncError
            ? `${message} ${payload.data.vectorSyncError}`
            : `${message} Qdrant sync failed.`,
        );
      } else {
        toast.success(message);
      }

      resetCsvForm();
    } catch (error) {
      logDebug("reference-form", "CSV upload failed.", {
        cause: error instanceof Error ? error.message : String(error),
      });
      setCsvError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploadingCsv(false);
    }
  }

  async function handlePrimaryAction() {
    if (file) {
      await handleCsvUpload();
      return;
    }

    await handleManualSubmit();
  }

  async function handleSearch(event) {
    event.preventDefault();

    const validation = searchSchema.safeParse({
      query: searchQuery,
      limit: 5,
    });

    if (!validation.success) {
      setSearchFieldError(
        validation.error.flatten().fieldErrors.query?.[0] ??
          "Enter a search term.",
      );
      return;
    }

    const submittedQuery = validation.data.query;

    setActiveSearchQuery(submittedQuery);
    setIsSearchOpen(true);
    setIsSearching(true);
    setSearchResults([]);
    setSearchError("");
    setSearchFieldError("");
    setHasSearched(true);

    logDebug("reference-form", "Submitting search.", {
      query: submittedQuery,
      limit: validation.data.limit,
    });

    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(validation.data),
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Search failed.");
      }

      const results = payload.data ?? [];
      logDebug("reference-form", "Search completed.", {
        query: submittedQuery,
        resultCount: results.length,
      });
      setSearchResults(results);
    } catch (error) {
      logDebug("reference-form", "Search failed.", {
        query: submittedQuery,
        cause: error instanceof Error ? error.message : String(error),
      });
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleDeleteDocument() {
    if (!deleteCandidate?.id) {
      return;
    }

    setIsDeletingId(deleteCandidate.id);

    try {
      const response = await fetch(`/api/documents/${deleteCandidate.id}`, {
        method: "DELETE",
      });
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Delete failed.");
      }

      setSearchResults((current) =>
        current.filter((entry) => entry.id !== deleteCandidate.id),
      );
      toast.success(`Deleted ${deleteCandidate.title}.`);
      setDeleteCandidate(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Delete failed.");
    } finally {
      setIsDeletingId(null);
    }
  }

  function closeSearchModal() {
    setDeleteCandidate(null);
    setIsSearchOpen(false);
  }

  const isPrimaryLoading = isSavingManual || isUploadingCsv;
  const primaryLabel = file
    ? isUploadingCsv
      ? "Uploading..."
      : "Upload CSV batch"
    : isSavingManual
      ? "Saving..."
      : "Save document";

  return (
    <main className="reference-form-layout">
      <div className="pointer-events-none absolute inset-x-0 top-[-220px] -z-10 h-[420px] bg-[radial-gradient(circle_at_20%_20%,rgba(14,165,233,0.18),transparent_45%),radial-gradient(circle_at_80%_10%,rgba(16,185,129,0.22),transparent_45%)]" />

      <div className="space-y-6">
        <section className="reference-form-shell border-sky-200/80 bg-white/95">
          <div className="border-b border-sky-100 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-sky-700/75">
              Search
            </p>
          </div>

          <form className="mt-5 space-y-3" onSubmit={handleSearch}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="relative flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input
                  className="h-12 w-full rounded-xl border border-slate-200 bg-white pl-10 pr-4 text-sm outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
                  onChange={(event) => {
                    setSearchQuery(event.target.value);
                    setSearchFieldError("");
                    setSearchError("");
                  }}
                  placeholder="Search by title or content"
                  value={searchQuery}
                />
              </div>
              <button
                className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-slate-900 bg-slate-900 px-4 text-sm font-semibold text-white transition hover:bg-slate-800 disabled:opacity-60 sm:min-w-[120px]"
                disabled={isSearching}
                type="submit"
              >
                <Search className="h-4 w-4" />
                {isSearching ? "Searching..." : "Search"}
              </button>
            </div>
            {searchFieldError ? (
              <p className="text-sm text-red-600">{searchFieldError}</p>
            ) : null}
          </form>
        </section>

        <section className="reference-form-shell border-emerald-200/80 bg-white/95">
          <div className="border-b border-emerald-100 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-emerald-700/75">
              Manual Entry
            </p>
          </div>

          <div className="mt-6 space-y-5">
            <div>
              <label className="text-sm font-semibold text-slate-800" htmlFor="title">
                Title
              </label>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                id="title"
                onChange={(event) => updateField("title", event.target.value)}
                value={formData.title}
              />
              {manualErrors.title ? (
                <p className="mt-1 text-sm text-red-600">{manualErrors.title}</p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800" htmlFor="url">
                URL
              </label>
              <input
                className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-4 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                id="url"
                onChange={(event) => updateField("url", event.target.value)}
                value={formData.url}
              />
              {manualErrors.url ? (
                <p className="mt-1 text-sm text-red-600">{manualErrors.url}</p>
              ) : null}
            </div>

            <div>
              <label className="text-sm font-semibold text-slate-800" htmlFor="content">
                Content
              </label>
              <textarea
                className="mt-2 min-h-[200px] w-full resize-y rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm outline-none transition focus:border-emerald-300 focus:ring-2 focus:ring-emerald-100"
                id="content"
                onChange={(event) => updateField("content", event.target.value)}
                value={formData.content}
              />
              {manualErrors.content ? (
                <p className="mt-1 text-sm text-red-600">{manualErrors.content}</p>
              ) : null}
            </div>

            {manualFormError ? (
              <p className="text-sm text-red-600">{manualFormError}</p>
            ) : null}
          </div>

          <div className="mt-6 border-t border-slate-100 pt-6">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-600">
              CSV Upload
            </p>

            <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50/80 p-4">
              <label
                className={`flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed px-4 py-5 transition ${
                  file
                    ? "border-emerald-300 bg-emerald-50/70"
                    : "border-slate-300 bg-white hover:border-emerald-300 hover:bg-emerald-50/40"
                }`}
                htmlFor="file"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-emerald-600 shadow-sm">
                  <FileUp className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-900">
                    {file ? file.name : "Click to choose CSV file"}
                  </span>
                  <span className="mt-1 block text-xs text-slate-500">
                    {file
                      ? `${formatBytes(file.size)} selected for batch insert.`
                      : "Entire CSV will be inserted in DB batches."}
                  </span>
                </span>
              </label>
              <input
                accept=".csv,text/csv"
                className="sr-only"
                id="file"
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setCsvError("");
                }}
                type="file"
              />
            
            </div>

            {csvError ? (
              <p className="mt-3 text-sm text-red-600">{csvError}</p>
            ) : null}
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-5">
            <button
              className="h-11 rounded-xl border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
              onClick={resetAllInputs}
              type="button"
            >
              Clear all
            </button>
            <button
              className="h-11 rounded-xl border border-emerald-700 bg-emerald-600 px-5 text-sm font-semibold text-white transition hover:bg-emerald-700 disabled:opacity-60"
              disabled={isPrimaryLoading}
              onClick={handlePrimaryAction}
              type="button"
            >
              {primaryLabel}
            </button>
          </div>
        </section>
      </div>

      {isSearchOpen ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 py-8 backdrop-blur-[3px]"
          onClick={closeSearchModal}
        >
          <div
            aria-modal="true"
            className="flex max-h-[82vh] min-h-[430px] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_35px_90px_rgba(15,23,42,0.2)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Search Results
                </p>
                <p className="mt-2 text-sm text-slate-500">
                  Query: {activeSearchQuery || "-"}
                </p>
              </div>
              <button
                aria-label="Close search"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                onClick={closeSearchModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5">
              {isSearching ? (
                <p className="text-sm text-slate-500">Searching...</p>
              ) : null}
              {searchError ? (
                <p className="text-sm text-red-600">{searchError}</p>
              ) : null}
              {hasSearched &&
              !isSearching &&
              searchResults.length === 0 &&
              !searchError ? (
                <p className="text-sm text-slate-500">
                  No matching records found.
                </p>
              ) : null}

              <div className="space-y-4">
                {searchResults.map((result) => (
                  <article
                    className="rounded-2xl border border-slate-200 bg-slate-50/75 px-5 py-4"
                    key={result.id ?? result.title}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold text-slate-900">
                          {result.title}
                        </h3>
                      </div>
                      <button
                        aria-label={`Delete ${result.title}`}
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-rose-200 bg-white text-rose-500 transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={isDeletingId === result.id || !result.id}
                        onClick={() => setDeleteCandidate(result)}
                        type="button"
                      >
                        {isDeletingId === result.id ? (
                          <span className="text-[11px] font-semibold">...</span>
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {result.content}
                    </p>
                    {result.url ? (
                      <a
                        className="mt-3 inline-block text-sm font-medium text-sky-700"
                        href={result.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {result.url}
                      </a>
                    ) : null}
                  </article>
                ))}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]"
          onClick={() => setDeleteCandidate(null)}
        >
          <div
            aria-modal="true"
            className="w-full max-w-md rounded-[22px] border border-slate-200 bg-white p-6 shadow-[0_24px_70px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Confirm Delete
                </p>
                <h3 className="mt-2 text-lg font-semibold text-slate-900">
                  Delete entry
                </h3>
              </div>
              <button
                aria-label="Close delete confirmation"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                onClick={() => setDeleteCandidate(null)}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-600">
              Delete{" "}
              <span className="font-semibold text-slate-900">
                {deleteCandidate.title}
              </span>
              ?
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={() => setDeleteCandidate(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="h-10 rounded-md border border-rose-200 bg-rose-500 px-4 text-sm font-semibold text-white transition hover:bg-rose-600 disabled:opacity-60"
                disabled={isDeletingId === deleteCandidate.id}
                onClick={handleDeleteDocument}
                type="button"
              >
                {isDeletingId === deleteCandidate.id ? "Deleting..." : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
