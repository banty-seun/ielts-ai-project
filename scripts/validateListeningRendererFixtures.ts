import { listeningRendererRootSchema } from "../shared/listening/renderer";
import { listeningRendererFixtures } from "../client/src/fixtures/listeningRendererFixtures";

let failed = false;

for (const fixture of listeningRendererFixtures) {
  const result = listeningRendererRootSchema.safeParse(fixture);
  if (!result.success) {
    failed = true;
    const issue = result.error.issues[0];
    console.error("[renderer-fixture][invalid]", {
      section_id: fixture.section_id,
      path: issue?.path?.join(".") ?? "unknown",
      message: issue?.message,
    });
  }
}

if (failed) {
  process.exitCode = 1;
  throw new Error("Listening renderer fixture validation failed");
}

console.log(`[renderer-fixture] validated ${listeningRendererFixtures.length} fixtures`);
