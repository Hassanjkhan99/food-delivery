// Assemble the schema: importing each domain module registers its fields on the builder.
import { builder } from "./builder.js";
import "./auth.js";

export const schema = builder.toSchema();
