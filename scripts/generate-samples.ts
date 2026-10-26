import { mkdirSync, writeFileSync } from "node:fs";
import { buildSyntheticBundle } from "../src/lib/demo/synthetic";

const bundle = buildSyntheticBundle();
mkdirSync("samples", { recursive: true });
writeFileSync("samples/synthetic-register.xlsx", bundle.registerXlsx);
writeFileSync("samples/synthetic-register.csv", bundle.registerCsv);
writeFileSync("samples/synthetic-register.pdf", bundle.registerPdf);
writeFileSync("samples/synthetic-folder.txt", `${bundle.folderNames.join("\n")}\n`);
console.log(`Wrote synthetic samples (${bundle.expected.deliverableCount} deliverables, ${bundle.folderNames.length} filenames).`);
