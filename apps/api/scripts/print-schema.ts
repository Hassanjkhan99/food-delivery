// Print the executable schema as SDL for client codegen (apps/web reads apps/api/schema.graphql).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { lexicographicSortSchema, printSchema } from "graphql";
import { schema } from "../src/schema/index.js";

const sdl = printSchema(lexicographicSortSchema(schema));
const out = resolve(process.cwd(), "schema.graphql");
writeFileSync(out, sdl);
console.log(`[codegen] wrote ${out} (${sdl.length} chars)`);
