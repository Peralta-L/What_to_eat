export type InventoryChangeSource = "fridge" | "explore";
type FridgeRefreshListener = (source: InventoryChangeSource) => void;

const fridgeRefreshListeners = new Set<FridgeRefreshListener>();

/** Subscribe to inventory changes made from another tab. */
export function subscribeToFridgeRefresh(
  listener: FridgeRefreshListener,
): () => void {
  fridgeRefreshListeners.add(listener);

  return () => {
    fridgeRefreshListeners.delete(listener);
  };
}

/** Notify the other screen after an inventory-changing action. */
export function notifyFridgeChanged(source: InventoryChangeSource): void {
  for (const listener of fridgeRefreshListeners) {
    listener(source);
  }
}