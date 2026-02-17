import { pool } from "../server/db";
import {
  LISTENING_RELEASE_SCHEMA_REMEDIATION,
  runListeningReleaseSchemaGate,
} from "../server/services/listeningReleaseSchemaGate";

async function run() {
  if (!process.env.DATABASE_URL || process.env.DATABASE_URL.trim().length === 0) {
    console.error(
      `[ListeningSchemaGate] FAIL DATABASE_URL is required. Remediation: ${LISTENING_RELEASE_SCHEMA_REMEDIATION}`,
    );
    process.exit(1);
  }

  const result = await runListeningReleaseSchemaGate(pool);
  if (!result.ok) {
    console.error(result.message);
    process.exit(1);
  }

  console.log(result.message);
  process.exit(0);
}

run().catch(async (error: any) => {
  const errorMessage =
    typeof error?.message === "string" && error.message.trim().length > 0
      ? error.message.trim()
      : typeof error?.code === "string" && error.code.trim().length > 0
        ? error.code.trim()
        : typeof error?.name === "string" && error.name.trim().length > 0
          ? error.name.trim()
          : "unknown";
  console.error(
    `[ListeningSchemaGate] FAIL schema check execution error: ${errorMessage}. ` +
      `Remediation: ${LISTENING_RELEASE_SCHEMA_REMEDIATION}`,
  );
  process.exit(1);
});
