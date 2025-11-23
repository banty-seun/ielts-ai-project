const DEFAULT_MIN_WORDS = 220;
const danglingPatterns = [/continued\.*\)?$/i, /\[\s*\.\.\.\s*\]$/i, /\(\s*\.\.\.\s*\)$/];

export function validateTranscriptComplete(
  text: string,
  opts?: { minWords?: number },
): { ok: boolean; reason?: string; wordCount?: number } {
  if (typeof text !== "string") {
    return { ok: false, reason: "invalid" };
  }

  const normalized = text.trim();
  if (!normalized) {
    return { ok: false, reason: "empty" };
  }

  const wordCount = normalized.split(/\s+/).length;
  const minWords = opts?.minWords ?? DEFAULT_MIN_WORDS;
  if (wordCount < minWords) {
    return { ok: false, reason: "short", wordCount };
  }

  const trailing = normalized.replace(/["')\]]+$/, "");
  if (!/[.!?]$/.test(trailing)) {
    return { ok: false, reason: "missing_terminal" };
  }

  if (danglingPatterns.some((pattern) => pattern.test(normalized))) {
    return { ok: false, reason: "dangling_marker" };
  }

  const sentences = normalized.split(/(?<=[.!?])\s+/).filter(Boolean);
  if (sentences.length > 1) {
    const avgSentenceLength = wordCount / sentences.length;
    if (avgSentenceLength < 5 || avgSentenceLength > 45) {
      return { ok: false, reason: "sentence_balance" };
    }
  }

  return { ok: true, wordCount };
}
