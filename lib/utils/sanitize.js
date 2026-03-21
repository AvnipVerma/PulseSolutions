import sanitizeHtml from "sanitize-html";

function stripMarkup(value) {
  return sanitizeHtml(String(value ?? ""), {
    allowedTags: [],
    allowedAttributes: {},
  });
}

export function sanitizeText(value) {
  return stripMarkup(value).replace(/\s+/g, " ").trim();
}

export function sanitizeLongText(value) {
  return stripMarkup(value).replace(/\r\n/g, "\n").trim();
}

export function sanitizeUrl(value) {
  return stripMarkup(value).trim();
}

export function sanitizeDocumentInput(input) {
  return {
    title: sanitizeText(input.title),
    content: sanitizeLongText(input.content),
    url: sanitizeUrl(input.url),
  };
}

