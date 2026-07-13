// Library entry for @fd/api. The standalone HTTP server (server.ts) is one consumer;
// the Next.js web app is the other — it mounts the same schema/context/handlers inside
// route handlers so the whole stack ships as a single deploy. Keeping this barrel means
// splitting the API back out later is just re-pointing at server.ts.
export { schema } from "./schema/index.js";
export { buildContext, type AppContext } from "./context.js";
export { maskError, type FieldError } from "./errors.js";
export { pubsub } from "./pubsub.js";
export { handleLocalUploadPut, handleLocalFileGet } from "./services/storage/objectStore.js";
export { sweepExpiredOrders } from "./jobs/expirePendingOrders.js";
export { sweepExpiredOffers } from "./jobs/expireStaleOffers.js";
export { recomputeAllTrustScores } from "./services/riderTrustService.js";
