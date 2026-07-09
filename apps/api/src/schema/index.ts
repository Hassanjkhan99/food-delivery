// Assemble the schema: importing each domain module registers its fields on the builder.
import { builder } from "./builder.js";
import "./auth.js";
import "./marketplace.js";
import "./order.js";
import "./payment.js";
import "./restaurant.js";
import "./media.js";
import "./rider.js";

export const schema = builder.toSchema();
