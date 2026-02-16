const PII_KEYS = [
  "fullName",
  "name",
  "firstName",
  "lastName",
  "email",
  "phone",
  "phoneNumber",
  "userId",
  "firebaseUid",
  "uid",
  "notes",
  "token",
  "authorization",
  "scriptText",
  "script",
  "rawResponse",
] as const;

const MASK = "[REDACTED]";
const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const PHONE_PATTERN = /\b(?:\+?\d{1,2}[\s.-]?)?(?:\(?\d{3}\)?[\s.-]?){2}\d{4}\b/g;
const OPENAI_KEY_PATTERN = /\bsk-[A-Za-z0-9]{20,}\b/g;
const BEARER_PATTERN = /^Bearer\s+[A-Za-z0-9\-._~+/]+=*$/i;

export const getPiiClasses = () => {
  return ["name", "email", "phone", "uid_mapping", "free_text_notes"] as const;
};

const shouldRedactKey = (key: string) => {
  const lowered = key.toLowerCase();
  return PII_KEYS.some((candidate) => lowered.includes(candidate.toLowerCase()));
};

export const redactSensitive = (value: unknown): unknown => {
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    if (BEARER_PATTERN.test(value.trim())) {
      return MASK;
    }
    if (value.length > 2048) {
      return `${MASK}:long_text`;
    }
    return value
      .replace(EMAIL_PATTERN, `${MASK}:email`)
      .replace(PHONE_PATTERN, `${MASK}:phone`)
      .replace(OPENAI_KEY_PATTERN, MASK);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactSensitive(entry));
  }
  if (typeof value === "object") {
    const output: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, entry]) => {
      if (shouldRedactKey(key)) {
        output[key] = MASK;
      } else {
        output[key] = redactSensitive(entry);
      }
    });
    return output;
  }
  return value;
};

export const isPrivacySafeLogMode = () => {
  return process.env.LISTENING_PRIVACY_SAFE_LOG_MODE !== "false";
};
