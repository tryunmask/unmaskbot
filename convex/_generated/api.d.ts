/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as companies from "../companies.js";
import type * as http from "../http.js";
import type * as httpHelpers from "../httpHelpers.js";
import type * as intros from "../intros.js";
import type * as outbound from "../outbound.js";
import type * as referrals from "../referrals.js";
import type * as scouts from "../scouts.js";
import type * as talent from "../talent.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  companies: typeof companies;
  http: typeof http;
  httpHelpers: typeof httpHelpers;
  intros: typeof intros;
  outbound: typeof outbound;
  referrals: typeof referrals;
  scouts: typeof scouts;
  talent: typeof talent;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
