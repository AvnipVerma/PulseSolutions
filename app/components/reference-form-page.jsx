"use client";

import { Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { manualDocumentSchema } from "@/lib/validators/document";
import { searchSchema } from "@/lib/validators/search";

const initialState = {
  title: "",
  content: "",
  url: "",
};

function areManualFieldsEmpty(values) {
  return !values.title.trim() && !values.content.trim() && !values.url.trim();
}

function getManualErrors(error) {
  const fieldErrors = error.flatten().fieldErrors;

  return {
    title: fieldErrors.title?.[0],
    content: fieldErrors.content?.[0],
    url: fieldErrors.url?.[0],
  };
}

function normalizeEntryFilter(value) {
  return String(value ?? "").toLowerCase().trim();
}

function matchesEntryFilter(entry, query) {
  const normalizedQuery = normalizeEntryFilter(query);

  if (!normalizedQuery) {
    return true;
  }

  return [entry.title, entry.content, entry.url].some((field) =>
    normalizeEntryFilter(field).includes(normalizedQuery),
  );
}

export function ReferenceFormPage() {
  const router = useRouter();
  const [formData, setFormData] = useState(initialState);
  const [file, setFile] = useState(null);
  const [errors, setErrors] = useState({});
  const [isSaving, setIsSaving] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [modalMode, setModalMode] = useState("search");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [searchError, setSearchError] = useState("");
  const [searchFieldError, setSearchFieldError] = useState("");
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [allEntries, setAllEntries] = useState([]);
  const [allEntriesQuery, setAllEntriesQuery] = useState("");
  const [allEntriesError, setAllEntriesError] = useState("");
  const [isLoadingEntries, setIsLoadingEntries] = useState(false);
  const [hasLoadedEntries, setHasLoadedEntries] = useState(false);
  const [isDeletingId, setIsDeletingId] = useState(null);
  const [deleteCandidate, setDeleteCandidate] = useState(null);

  useEffect(() => {
    if (!isSearchOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;

    function handleKeyDown(event) {
      if (event.key === "Escape") {
        if (deleteCandidate) {
          setDeleteCandidate(null);
          return;
        }

        setIsSearchOpen(false);
      }
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
    setErrors((current) => ({
      ...current,
      [name]: undefined,
      form: undefined,
    }));
  }

  function resetForm() {
    setFormData(initialState);
    setFile(null);
    setErrors({});
  }

  async function saveManualDocument() {
    const validation = manualDocumentSchema.safeParse(formData);

    if (!validation.success) {
      setErrors(getManualErrors(validation.error));
      return false;
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
          ? `Saved in MySQL, but Qdrant sync failed: ${payload.data.vectorSyncError}`
          : "Saved in MySQL, but Qdrant sync failed.",
      );
    } else {
      toast.success("Document saved.");
    }

    resetForm();
    return true;
  }

  async function uploadCsv() {
    if (!file) {
      setErrors({
        form: "Enter document details or choose a CSV file.",
      });
      return false;
    }

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

    const saveMessage = `${payload.data.insertedCount} records saved${
      payload.data.duplicateCount
        ? `, ${payload.data.duplicateCount} duplicates skipped`
        : ""
    }.`;

    if (payload.data?.vectorSynced === false) {
      toast.warning(
        payload.data.vectorSyncError
          ? `${saveMessage} Qdrant sync failed: ${payload.data.vectorSyncError}`
          : `${saveMessage} Qdrant sync failed.`,
      );
    } else {
      toast.success(saveMessage);
    }

    resetForm();
    return true;
  }

  async function handleSubmit(event) {
    event.preventDefault();
    setIsSaving(true);
    setErrors({});

    try {
      if (!areManualFieldsEmpty(formData)) {
        await saveManualDocument();
      } else {
        await uploadCsv();
      }
    } catch (error) {
      setErrors({
        form: error instanceof Error ? error.message : "Save failed.",
      });
    } finally {
      setIsSaving(false);
    }
  }

  function handleBack() {
    if (window.history.length > 1) {
      router.back();
      return;
    }

    resetForm();
  }

  function closeSearchModal() {
    setDeleteCandidate(null);
    setIsSearchOpen(false);
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

    setIsSearching(true);
    setModalMode("search");
    setIsSearchOpen(true);
    setSearchResults([]);
    setSearchError("");
    setSearchFieldError("");
    setHasSearched(true);

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

      setSearchResults(payload.data ?? []);
    } catch (error) {
      setSearchResults([]);
      setSearchError(error instanceof Error ? error.message : "Search failed.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleShowAllEntries() {
    setModalMode("all");
    setIsSearchOpen(true);
    setIsLoadingEntries(true);
    setHasLoadedEntries(false);
    setAllEntries([]);
    setAllEntriesQuery("");
    setAllEntriesError("");

    try {
      const response = await fetch("/api/documents");
      const payload = await response.json();

      if (!response.ok || !payload.success) {
        throw new Error(payload.message ?? "Unable to load entries.");
      }

      setAllEntries(payload.data?.documents ?? []);
    } catch (error) {
      setAllEntries([]);
      setAllEntriesError(
        error instanceof Error ? error.message : "Unable to load entries.",
      );
    } finally {
      setIsLoadingEntries(false);
      setHasLoadedEntries(true);
    }
  }

  function openDeleteConfirmation(document) {
    setDeleteCandidate(document);
  }

  function closeDeleteConfirmation() {
    setDeleteCandidate(null);
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
      setAllEntries((current) =>
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

  const isViewingAllEntries = modalMode === "all";
  const filteredAllEntries = allEntries.filter((entry) =>
    matchesEntryFilter(entry, allEntriesQuery),
  );
  const modalHeading = isViewingAllEntries ? "All entries" : "Search results";
  const modalSubheading = isViewingAllEntries
    ? hasLoadedEntries && !isLoadingEntries
      ? allEntriesQuery
        ? `Showing ${filteredAllEntries.length} of ${allEntries.length} documents`
        : `${allEntries.length} documents available in the database`
      : "Loading stored documents"
    : `Semantic matches from Qdrant for: ${searchQuery || "Untitled search"}`;

  return (
    <main className="reference-form-layout">
      <div className="space-y-6">
        <section className="reference-form-shell">
          <div className="border-b border-slate-100 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              Search
            </p>

          </div>

          <form className=" space-y-3" onSubmit={handleSearch}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <input
                className="h-[44px] w-full rounded-md border border-slate-200 bg-white px-4 text-sm outline-none ring-0 transition focus:border-slate-400"
                id="search-home"
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setSearchFieldError("");
                  setSearchError("");
                }}
                placeholder="Search by title or content keyword"
                value={searchQuery}
              />
              <button
                className="h-[44px] shrink-0 rounded-md border border-slate-200 bg-slate-900 px-4 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-60 sm:min-w-[96px]"
                disabled={isSearching}
                type="submit"
              >
                {isSearching ? "Searching..." : "Search"}
              </button>
              {/*<button*/}
              {/*  className="h-[44px] shrink-0 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-60 sm:min-w-[138px]"*/}
              {/*  disabled={isLoadingEntries}*/}
              {/*  onClick={handleShowAllEntries}*/}
              {/*  type="button"*/}
              {/*>*/}
              {/*  {isLoadingEntries ? "Loading..." : "Show all entries"}*/}
              {/*</button>*/}
            </div>

            {searchFieldError ? (
              <p className="text-sm text-red-600">{searchFieldError}</p>
            ) : null}
          </form>
        </section>

        <section className="reference-form-shell">
          <div className=" border-b border-slate-100 pb-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
              Document Entry
            </p>
          </div>

          <form className="space-y-6" onSubmit={handleSubmit}>
            <div className="reference-form-grid items-start">
              <label
                className="pt-3 text-[15px] font-medium text-slate-900"
                htmlFor="title"
              >
                Title
              </label>
              <div>
                <input
                  className="h-[42px] w-full rounded-md border border-slate-200 bg-white px-4 text-sm outline-none ring-0 transition focus:border-slate-400"
                  id="title"
                  onChange={(event) => updateField("title", event.target.value)}
                  value={formData.title}
                />
                {errors.title ? (
                  <p className="mt-1 text-sm text-red-600">{errors.title}</p>
                ) : null}
              </div>
            </div>

            <div className="reference-form-grid items-start">
              <label
                className="pt-3 text-[15px] font-medium text-slate-900"
                htmlFor="url"
              >
                URL
              </label>
              <div>
                <input
                  className="h-[42px] w-full rounded-md border border-slate-200 bg-white px-4 text-sm outline-none ring-0 transition focus:border-slate-400"
                  id="url"
                  onChange={(event) => updateField("url", event.target.value)}
                  value={formData.url}
                />
                {errors.url ? (
                  <p className="mt-1 text-sm text-red-600">{errors.url}</p>
                ) : null}
              </div>
            </div>

            <div className="reference-form-grid items-start">
              <label
                className="pt-3 text-[15px] font-medium text-slate-900"
                htmlFor="content"
              >
                Content
              </label>
              <div>
                <textarea
                  className="min-h-[226px] w-full resize-y rounded-md border border-slate-200 bg-white px-4 py-3 text-sm outline-none ring-0 transition focus:border-slate-400"
                  id="content"
                  onChange={(event) => updateField("content", event.target.value)}
                  value={formData.content}
                />
                {errors.content ? (
                  <p className="mt-1 text-sm text-red-600">{errors.content}</p>
                ) : null}
              </div>
            </div>

            <div className="reference-form-grid items-start">
              <label
                className="pt-3 text-[15px] font-medium text-slate-900"
                htmlFor="file"
              >
                CSV File
              </label>
              <div>
                <input
                  className="block w-full rounded-md border border-slate-200 bg-white text-sm file:mr-4 file:border-0 file:border-r file:border-slate-200 file:bg-slate-50 file:px-4 file:py-[10px] file:text-sm"
                  id="file"
                  onChange={(event) => setFile(event.target.files?.[0] ?? null)}
                  type="file"
                />
                <p className="mt-2 text-[15px] text-[#8d80bb]">
                  Download Sample Format :{" "}
                  <a className="text-[#1d4ed8]" href="/sample-documents.csv">
                    CSV
                  </a>
                </p>
              </div>
            </div>

            {errors.form ? (
              <div className="reference-form-grid">
                <div />
                <p className="text-sm text-red-600">{errors.form}</p>
              </div>
            ) : null}

            <div className="reference-form-grid border-t border-slate-100 pt-6">
              <div />
              <div className="flex justify-end gap-2">
                <button
                  className="rounded-lg border border-slate-200 bg-slate-500 px-6 py-3 text-sm font-semibold text-white hover:bg-slate-600"
                  onClick={handleBack}
                  type="button"
                >
                  Back
                </button>
                <button
                  className="rounded-lg border border-lime-700 bg-lime-600 px-6 py-3 text-sm font-semibold text-white hover:bg-lime-700 disabled:opacity-60"
                  disabled={isSaving}
                  type="submit"
                >
                  {isSaving ? "Saving..." : "Save"}
                </button>
              </div>
            </div>
          </form>
        </section>
      </div>

      {isSearchOpen ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/30 px-4 py-8 backdrop-blur-[2px]"
          onClick={closeSearchModal}
        >
          <div
            aria-labelledby="search-dialog-title"
            aria-modal="true"
            className="flex max-h-[80vh] min-h-[430px] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-[0_30px_80px_rgba(15,23,42,0.18)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-6 py-5">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-slate-400">
                  Search
                </p>
                <h2
                  className="mt-2 text-lg font-semibold text-slate-900"
                  id="search-dialog-title"
                >
                  {modalHeading}
                </h2>
                <p className="mt-2 text-sm text-slate-500">{modalSubheading}</p>
              </div>
              <button
                aria-label="Close search"
                className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 text-sm font-semibold text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                onClick={closeSearchModal}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto border-t border-slate-100 px-6 py-5">
              <div className="space-y-4">
                {isViewingAllEntries ? (
                  <div className="border-b border-slate-100 pb-4">
                    <input
                      className="h-[42px] w-full rounded-md border border-slate-200 bg-white px-4 text-sm outline-none ring-0 transition focus:border-slate-400"
                      onChange={(event) => setAllEntriesQuery(event.target.value)}
                      placeholder="Filter by title, URL, or content"
                      value={allEntriesQuery}
                    />
                  </div>
                ) : null}

                {isViewingAllEntries && isLoadingEntries ? (
                  <p className="text-sm text-slate-500">Loading entries...</p>
                ) : null}

                {!isViewingAllEntries && isSearching ? (
                  <p className="text-sm text-slate-500">Searching...</p>
                ) : null}

                {!isViewingAllEntries && !hasSearched && !isSearching ? (
                  <p className="text-sm text-slate-500">
                    Search results will appear here after you run a query.
                  </p>
                ) : null}

                {!isViewingAllEntries && searchError ? (
                  <p className="text-sm text-red-600">{searchError}</p>
                ) : null}

                {isViewingAllEntries && allEntriesError ? (
                  <p className="text-sm text-red-600">{allEntriesError}</p>
                ) : null}

                {!isViewingAllEntries &&
                hasSearched &&
                !isSearching &&
                searchResults.length === 0 &&
                !searchError ? (
                  <p className="text-sm text-slate-500">
                    No matching records were found.
                  </p>
                ) : null}

                {isViewingAllEntries &&
                hasLoadedEntries &&
                !isLoadingEntries &&
                allEntries.length === 0 &&
                !allEntriesError ? (
                  <p className="text-sm text-slate-500">
                    No entries were found in the database.
                  </p>
                ) : null}

                {isViewingAllEntries &&
                hasLoadedEntries &&
                !isLoadingEntries &&
                allEntries.length > 0 &&
                filteredAllEntries.length === 0 ? (
                  <p className="text-sm text-slate-500">
                    No entries match this filter.
                  </p>
                ) : null}

                {(isViewingAllEntries ? filteredAllEntries : searchResults).map(
                  (result) => (
                  <article
                    className="rounded-xl border border-slate-200 bg-slate-50/60 px-5 py-4"
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
                        onClick={() => openDeleteConfirmation(result)}
                        type="button"
                      >
                        {isDeletingId === result.id ? (
                          <span className="text-[11px] font-semibold">
                            ...
                          </span>
                        ) : (
                          <Trash2 className="h-4 w-4" />
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      {result.content}
                    </p>
                    {isViewingAllEntries ? (
                      <a
                        className="mt-3 inline-block text-sm font-medium text-[#1d4ed8]"
                        href={result.url}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {result.url}
                      </a>
                    ) : null}
                  </article>
                  ),
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}

      {deleteCandidate ? (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-[2px]"
          onClick={closeDeleteConfirmation}
        >
          <div
            aria-labelledby="delete-dialog-title"
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
                <h3
                  className="mt-2 text-lg font-semibold text-slate-900"
                  id="delete-dialog-title"
                >
                  Delete entry
                </h3>
              </div>
              <button
                aria-label="Close delete confirmation"
                className="flex h-9 w-9 items-center justify-center rounded-full border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:text-slate-900"
                onClick={closeDeleteConfirmation}
                type="button"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="mt-4 text-sm leading-6 text-slate-600">
              Are you sure you want to delete{" "}
              <span className="font-semibold text-slate-900">
                {deleteCandidate.title}
              </span>
              ?
            </p>

            <div className="mt-6 flex justify-end gap-3">
              <button
                className="h-10 rounded-md border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
                onClick={closeDeleteConfirmation}
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
