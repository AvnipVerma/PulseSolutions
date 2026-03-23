const DEBUG_ENABLED =
  process.env.NODE_ENV !== "production" || process.env.DEBUG_FLOW === "true";

export function logDebug(scope, message, details) {
  if (!DEBUG_ENABLED) {
    return;
  }

  if (typeof details === "undefined") {
    console.debug(`[${scope}] ${message}`);
    return;
  }

  console.debug(`[${scope}] ${message}`, details);
}
