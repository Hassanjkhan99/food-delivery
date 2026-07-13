// Single place the rest of the app asks for "the object store". Driver is chosen once
// from env (#142): local disk for dev / the collapsed deploy, R2 for production.
import { env } from "../../env.js";
import { localDiskStore, type ObjectStore } from "./objectStore.js";
import { r2Store } from "./r2Store.js";

export const objectStore: ObjectStore = env.storageDriver === "r2" ? r2Store : localDiskStore;
