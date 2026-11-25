import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

function storageKey(recipeId: number): string {
  return `pending_recipe_cook_${recipeId}`;
}

/**
 * Persist the idempotency key for an in-flight cooking action.
 * This lets the app safely retry after a timeout or app restart.
 */
export async function getPendingCookKey(recipeId: number): Promise<string | null> {
  const key = storageKey(recipeId);
  if (Platform.OS === "web") {
    return localStorage.getItem(key);
  }
  return SecureStore.getItemAsync(key);
}

export async function savePendingCookKey(recipeId: number, value: string): Promise<void> {
  const key = storageKey(recipeId);
  if (Platform.OS === "web") {
    localStorage.setItem(key, value);
    return;
  }
  await SecureStore.setItemAsync(key, value);
}

export async function clearPendingCookKey(recipeId: number): Promise<void> {
  const key = storageKey(recipeId);
  if (Platform.OS === "web") {
    localStorage.removeItem(key);
    return;
  }
  await SecureStore.deleteItemAsync(key);
}