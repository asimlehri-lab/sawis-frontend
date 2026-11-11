// Writes the help text (src/helpContent.ts) as JSON for the backend's AI help
// chat, so the AI answers from the very same text people read in Help.
//
//   node scripts/export-help.mjs [output.json]
//
// Default output: ../sawis-backend/apps/helpchat/help_entries.json
// Run it whenever helpContent.ts changes, then commit the JSON in the backend.
// Needs Node 22.18 or newer (it reads the .ts file directly).
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(process.argv[2] ?? resolve(here, "../../sawis-backend/apps/helpchat/help_entries.json"));
const { HELP_TOPICS } = await import(pathToFileURL(resolve(here, "../src/helpContent.ts")).href);

const entries = [];
for (const topic of HELP_TOPICS) {
  topic.questions.forEach((qa, i) => {
    entries.push({
      id: qa.id ?? `${topic.id}-${i + 1}`,
      topic: topic.title,
      keywords: topic.keywords,
      q: qa.q,
      a: qa.a,
      fact: (qa.fact ?? "").replace(/^💡\s*/u, ""),
    });
  });
}
writeFileSync(out, JSON.stringify(entries, null, 1) + "\n", "utf8");
console.log(`Wrote ${entries.length} help entries to ${out}`);
