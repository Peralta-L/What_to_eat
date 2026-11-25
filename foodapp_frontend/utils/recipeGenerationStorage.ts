import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

export type RecipeGenerationKind = "fridge" | "selected";
export type RecipeMealType = "breakfast" | "lunch" | "dinner";

function storageKey(
  kind: RecipeGenerationKind,
  mealType?: RecipeMealType,
  batchSize?: number,
): string {
  // Keep legacy keys for old callers; separate meal types and batch sizes so
  // an interrupted 5-recipe startup batch cannot replay as a 3-recipe request.
  const mealSuffix = mealType ? `_${mealType}` : "";
  const countSuffix = batchSize ? `_${batchSize}` : "";
  return `pending_recipe_generation_${kind}${mealSuffix}${countSuffix}`;
}

/** Retrieve an unfinished generation key so uncertain retries cannot duplicate a batch. */
export async function getPendingGenerationKey(
  kind: RecipeGenerationKind,
  mealType?: RecipeMealType,
  batchSize?: number,
): Promise<string | null> {
  const key = storageKey(kind, mealType, batchSize);
  if (Platform.OS === "web") return localStorage.getItem(key);
  return SecureStore.getItemAsync(key);
}

export async function savePendingGenerationKey(
  kind: RecipeGenerationKind,
  value: string,
  mealType?: RecipeMealType,
  batchSize?: number,
): Promise<void> {
  const key = storageKey(kind, mealType, batchSize);
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function clearPendingGenerationKey(
  kind: RecipeGenerationKind,
  mealType?: RecipeMealType,
  batchSize?: number,
): Promise<void> {
  const key = storageKey(kind, mealType, batchSize);
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}