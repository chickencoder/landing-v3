/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as crons from "../crons.js";
import type * as http from "../http.js";
import type * as index from "../index.js";
import type * as lib_clerk from "../lib/clerk.js";
import type * as lib_daytona from "../lib/daytona.js";
import type * as lib_slugGenerator from "../lib/slugGenerator.js";
import type * as messages from "../messages.js";
import type * as organizations from "../organizations.js";
import type * as presence from "../presence.js";
import type * as sandbox from "../sandbox.js";
import type * as sites from "../sites.js";
import type * as users from "../users.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  crons: typeof crons;
  http: typeof http;
  index: typeof index;
  "lib/clerk": typeof lib_clerk;
  "lib/daytona": typeof lib_daytona;
  "lib/slugGenerator": typeof lib_slugGenerator;
  messages: typeof messages;
  organizations: typeof organizations;
  presence: typeof presence;
  sandbox: typeof sandbox;
  sites: typeof sites;
  users: typeof users;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
