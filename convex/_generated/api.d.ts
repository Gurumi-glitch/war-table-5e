/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as batch from "../batch.js";
import type * as battleDraftHelpers from "../battleDraftHelpers.js";
import type * as battleDrafts from "../battleDrafts.js";
import type * as cardGuards from "../cardGuards.js";
import type * as characters from "../characters.js";
import type * as colors from "../colors.js";
import type * as combatLog from "../combatLog.js";
import type * as combatants from "../combatants.js";
import type * as demoSeed from "../demoSeed.js";
import type * as dice from "../dice.js";
import type * as diceHelpers from "../diceHelpers.js";
import type * as effects from "../effects.js";
import type * as enemies from "../enemies.js";
import type * as enemyFields from "../enemyFields.js";
import type * as enemySeed from "../enemySeed.js";
import type * as flavorDice from "../flavorDice.js";
import type * as games from "../games.js";
import type * as library from "../library.js";
import type * as maps from "../maps.js";
import type * as modifiers from "../modifiers.js";
import type * as ownership from "../ownership.js";
import type * as pieces from "../pieces.js";
import type * as recipeLibrary from "../recipeLibrary.js";
import type * as recipes from "../recipes.js";
import type * as resources from "../resources.js";
import type * as rules from "../rules.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  batch: typeof batch;
  battleDraftHelpers: typeof battleDraftHelpers;
  battleDrafts: typeof battleDrafts;
  cardGuards: typeof cardGuards;
  characters: typeof characters;
  colors: typeof colors;
  combatLog: typeof combatLog;
  combatants: typeof combatants;
  demoSeed: typeof demoSeed;
  dice: typeof dice;
  diceHelpers: typeof diceHelpers;
  effects: typeof effects;
  enemies: typeof enemies;
  enemyFields: typeof enemyFields;
  enemySeed: typeof enemySeed;
  flavorDice: typeof flavorDice;
  games: typeof games;
  library: typeof library;
  maps: typeof maps;
  modifiers: typeof modifiers;
  ownership: typeof ownership;
  pieces: typeof pieces;
  recipeLibrary: typeof recipeLibrary;
  recipes: typeof recipes;
  resources: typeof resources;
  rules: typeof rules;
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
