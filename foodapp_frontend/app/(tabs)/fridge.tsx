import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../constants/colors";
import { apiFetch } from "../../utils/api";
import AddIngredientForm from "../../forms/AddIngredientForm";
import CategoryFilter from "../../forms/CategoryFilter";
import { notifyFridgeChanged, subscribeToFridgeRefresh } from "../../utils/fridgeRefresh";

type StorageLocation = "fridge" | "freezer" | "dry";

type StorageItem = {
  id: number;
  ingredient_id: number;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  expiration_date: string | null;
  storage_location: StorageLocation;
};

type ZoneConfig = {
  key: StorageLocation;
  eyebrow: string;
  title: string;
  description: string;
  icon: keyof typeof Ionicons.glyphMap;
  surface: string;
  selectedSurface: string;
  iconSurface: string;
};

const ZONES: ZoneConfig[] = [
  {
    key: "fridge",
    eyebrow: "COLD",
    title: "Fridge",
    description: "Fresh and chilled",
    icon: "thermometer-outline",
    surface: "bg-[#F4E7DE]",
    selectedSurface: "border-[#9B6A5D]",
    iconSurface: "bg-[#E8D2C6]",
  },
  {
    key: "freezer",
    eyebrow: "FROZEN",
    title: "Freezer",
    description: "Keep it for later",
    icon: "snow-outline",
    surface: "bg-[#E8EEF0]",
    selectedSurface: "border-[#7895A1]",
    iconSurface: "bg-[#D4E1E5]",
  },
  {
    key: "dry",
    eyebrow: "ROOM TEMPERATURE",
    title: "Dry goods",
    description: "Cupboard and pantry",
    icon: "file-tray-stacked-outline",
    surface: "bg-[#E9EDDF]",
    selectedSurface: "border-[#89966F]",
    iconSurface: "bg-[#D9E1CA]",
  },
];

function normaliseLocation(value: unknown): StorageLocation {
  const location = String(value ?? "fridge").trim().toLowerCase();
  if (["freezer", "frozen", "frozen goods"].includes(location)) return "freezer";
  if (["dry", "pantry", "cupboard", "shelf", "dry goods"].includes(location)) return "dry";
  return "fridge";
}

function formatExpiry(value: string): string {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return "Expiry date set";

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return "Past date";
  if (days === 0) return "Expires today";
  if (days === 1) return "1 day left";
  if (days <= 7) return `${days} days left`;
  return new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);
}

function ZoneTile({
  zone,
  items,
  selected,
  onPress,
}: {
  zone: ZoneConfig;
  items: StorageItem[];
  selected: boolean;
  onPress: () => void;
}) {
  const previewItems = items.slice(0, 2);

  return (
    <Pressable
      onPress={onPress}
      className={`min-w-0 flex-1 overflow-hidden rounded-[25px] border-2 p-3.5 ${zone.surface} ${selected ? zone.selectedSurface : "border-transparent"} active:opacity-80`}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      accessibilityLabel={`Show ${zone.title} items, ${items.length} items`}
    >
      <View className="flex-row items-start justify-between">
        <View className={`h-10 w-10 items-center justify-center rounded-2xl ${zone.iconSurface}`}>
          <Ionicons name={zone.icon} size={20} color={colors.secondary} />
        </View>
        {selected ? (
          <View className="h-6 w-6 items-center justify-center rounded-full bg-secondary">
            <Ionicons name="checkmark" size={14} color={colors.light[300]} />
          </View>
        ) : (
          <Ionicons name="arrow-up-outline" size={17} color={colors.secondary} />
        )}
      </View>

      <Text className="mt-4 text-[8px] font-black tracking-[1.8px] text-dark-300">
        {zone.eyebrow}
      </Text>
      <Text className="mt-1 text-base font-black text-secondary" numberOfLines={1}>
        {zone.title}
      </Text>
      <Text className="mt-0.5 text-[9px] text-dark-300" numberOfLines={1}>
        {zone.description}
      </Text>

      <View className="mt-3 border-t border-secondary/10 pt-2.5">
        <Text className="text-[17px] font-black text-secondary">
          {items.length}
          <Text className="text-[9px] font-semibold text-dark-300"> {items.length === 1 ? "item" : "items"}</Text>
        </Text>
        {previewItems.length > 0 ? (
          previewItems.map((item) => (
            <Text key={item.id} className="mt-1 text-[9px] font-semibold text-secondary" numberOfLines={1}>
              {item.name}
            </Text>
          ))
        ) : (
          <Text className="mt-1 text-[9px] text-dark-300">Nothing stored here yet</Text>
        )}
        {items.length > 2 && (
          <Text className="mt-1 text-[8px] font-bold text-dark-300">+ {items.length - 2} more</Text>
        )}
      </View>
    </Pressable>
  );
}

export default function StorageScreen() {
  const [items, setItems] = useState<StorageItem[]>([]);
  const [activeLocation, setActiveLocation] = useState<StorageLocation>("fridge");
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [showAddIngredient, setShowAddIngredient] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);
  const [movingItem, setMovingItem] = useState<StorageItem | null>(null);
  const [moving, setMoving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const loadItems = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);

    try {
      const response = await apiFetch("/api/items");
      if (!Array.isArray(response?.items)) {
        throw new Error("The inventory endpoint returned an unexpected response.");
      }

      setItems(response.items.map((item: Record<string, unknown>) => ({
        id: Number(item.id),
        ingredient_id: Number(item.ingredient_id),
        name: String(item.name ?? "Ingredient"),
        quantity: Number(item.quantity ?? 0),
        unit: String(item.unit ?? ""),
        category: typeof item.category === "string" ? item.category : null,
        expiration_date: typeof item.expiration_date === "string"
          ? item.expiration_date
          : null,
        storage_location: normaliseLocation(item.storage_location),
      })));
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Could not load your storage.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadItems(true);
    return subscribeToFridgeRefresh(() => {
      void loadItems(false);
    });
  }, [loadItems]);

  const zoneItems = useMemo(() => {
    return ZONES.map((zone) => ({
      ...zone,
      items: items.filter((item) => item.storage_location === zone.key),
    }));
  }, [items]);

  const activeZone = ZONES.find((zone) => zone.key === activeLocation) ?? ZONES[0];
  const activeItems = useMemo(() => {
    const inZone = items.filter((item) => item.storage_location === activeLocation);
    return selectedCategory
      ? inZone.filter((item) => item.category === selectedCategory)
      : inZone;
  }, [items, activeLocation, selectedCategory]);

  const handleMoveItem = async (location: StorageLocation) => {
    if (!movingItem || moving || movingItem.storage_location === location) return;

    setMoving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/items/${movingItem.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ingredient_id: movingItem.ingredient_id,
          quantity: movingItem.quantity,
          unit: movingItem.unit,
          storage_location: location,
        }),
      });

      setMovingItem(null);
      // The refresh subscription reloads this screen and notifies Home/Explorer.
      notifyFridgeChanged("fridge");
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not move this ingredient.");
    } finally {
      setMoving(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!movingItem || moving) return;

    setMoving(true);
    setActionError(null);
    try {
      await apiFetch(`/api/items/${movingItem.id}`, { method: "DELETE" });
      setMovingItem(null);
      // Home, Explorer, Storage and Calendar all reload from the same inventory
      // source after this event, while the backend has already deleted the row.
      notifyFridgeChanged("fridge");
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : "Could not remove this ingredient.");
    } finally {
      setMoving(false);
    }
  };

  const confirmDeleteItem = () => {
    if (!movingItem || moving) return;
    Alert.alert(
      "Remove ingredient?",
      `Remove ${movingItem.name} from your storage? This also removes it from your current inventory in the calendar and recipe availability checks.`,
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: () => void handleDeleteItem() },
      ],
    );
  };

  const totalItems = items.length;

  return (
    <SafeAreaView className="flex-1 bg-light-300" edges={["top", "left", "right"]}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingBottom: 122 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadItems(false)}
            tintColor={colors.secondary}
            colors={[colors.secondary]}
          />
        }
      >
        <View className="w-full self-center px-5 pt-4" style={{ maxWidth: 760 }}>
          {/* HEADER */}
          <View className="mb-5 flex-row items-center justify-between">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-[9px] font-black tracking-[2.2px] text-dark-300">
                EVERYTHING IN ITS PLACE
              </Text>
              <Text className="mt-1 text-[29px] font-black tracking-tight text-secondary">
                Storage
              </Text>
              <Text className="mt-1 text-[11px] text-dark-300">
                {totalItems} {totalItems === 1 ? "ingredient" : "ingredients"} across your kitchen
              </Text>
            </View>

            <View className="flex-row gap-2">
              <Pressable
                onPress={() => setShowPreferences(true)}
                className="h-11 w-11 items-center justify-center rounded-2xl border border-light-100 bg-light-200"
                accessibilityRole="button"
                accessibilityLabel="Filter by ingredient category"
              >
                <Ionicons name="options-outline" size={20} color={colors.secondary} />
              </Pressable>
              <Pressable
                onPress={() => setShowAddIngredient(true)}
                className="h-11 w-11 items-center justify-center rounded-2xl bg-secondary"
                accessibilityRole="button"
                accessibilityLabel="Add ingredient"
              >
                <Ionicons name="add" size={24} color={colors.light[300]} />
              </Pressable>
            </View>
          </View>

          {selectedCategory && (
            <View className="mb-4 flex-row items-center justify-between rounded-xl bg-light-200 px-3 py-2.5">
              <Text className="text-[11px] font-semibold text-secondary">
                Showing: {selectedCategory}
              </Text>
              <Pressable onPress={() => setSelectedCategory(null)} hitSlop={8}>
                <Text className="text-[10px] font-black text-secondary">CLEAR</Text>
              </Pressable>
            </View>
          )}

          {loading ? (
            <View className="items-center rounded-[25px] bg-light-200 py-12">
              <ActivityIndicator size="large" color={colors.secondary} />
              <Text className="mt-3 text-xs text-dark-300">Arranging your storage...</Text>
            </View>
          ) : loadError ? (
            <View className="rounded-[25px] bg-light-200 p-5">
              <Text className="text-sm font-black text-secondary">Storage could not be loaded</Text>
              <Text className="mt-1 text-xs leading-5 text-dark-300">{loadError}</Text>
              <Pressable
                onPress={() => void loadItems(true)}
                className="mt-4 self-start rounded-full bg-secondary px-4 py-2.5"
              >
                <Text className="text-xs font-bold text-light-300">Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* ZONES: COLD LEFT, FROZEN RIGHT */}
              <View className="mb-3 flex-row gap-3">
                <ZoneTile
                  zone={ZONES[0]}
                  items={zoneItems[0].items}
                  selected={activeLocation === "fridge"}
                  onPress={() => setActiveLocation("fridge")}
                />
                <ZoneTile
                  zone={ZONES[1]}
                  items={zoneItems[1].items}
                  selected={activeLocation === "freezer"}
                  onPress={() => setActiveLocation("freezer")}
                />
              </View>

              {/* DRY STORAGE: FULL-WIDTH LOWER ZONE */}
              <Pressable
                onPress={() => setActiveLocation("dry")}
                className={`mb-6 overflow-hidden rounded-[25px] border-2 p-4 ${ZONES[2].surface} ${activeLocation === "dry" ? ZONES[2].selectedSurface : "border-transparent"} active:opacity-80`}
                accessibilityRole="button"
                accessibilityState={{ selected: activeLocation === "dry" }}
                accessibilityLabel={`Show Dry goods, ${zoneItems[2].items.length} items`}
              >
                <View className="flex-row items-center">
                  <View className={`mr-3 h-11 w-11 items-center justify-center rounded-2xl ${ZONES[2].iconSurface}`}>
                    <Ionicons name={ZONES[2].icon} size={21} color={colors.secondary} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[8px] font-black tracking-[1.8px] text-dark-300">DRY STORAGE</Text>
                    <Text className="mt-1 text-base font-black text-secondary">Dry goods</Text>
                    <Text className="mt-0.5 text-[9px] text-dark-300">Cupboard, pantry and shelf</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-xl font-black text-secondary">{zoneItems[2].items.length}</Text>
                    <Text className="text-[9px] font-semibold text-dark-300">
                      {zoneItems[2].items.length === 1 ? "item" : "items"}
                    </Text>
                  </View>
                  <Ionicons
                    name={activeLocation === "dry" ? "checkmark-circle" : "chevron-forward"}
                    size={19}
                    color={colors.secondary}
                    style={{ marginLeft: 10 }}
                  />
                </View>
                {zoneItems[2].items.length > 0 ? (
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    {zoneItems[2].items.slice(0, 4).map((item) => (
                      <View key={item.id} className="rounded-full bg-[#F7F7EF] px-3 py-1.5">
                        <Text className="text-[9px] font-semibold text-secondary" numberOfLines={1}>
                          {item.name}
                        </Text>
                      </View>
                    ))}
                    {zoneItems[2].items.length > 4 && (
                      <View className="rounded-full bg-[#F7F7EF] px-3 py-1.5">
                        <Text className="text-[9px] font-bold text-secondary">
                          +{zoneItems[2].items.length - 4} more
                        </Text>
                      </View>
                    )}
                  </View>
                ) : (
                  <Text className="mt-3 text-[10px] text-dark-300">Your cupboard is ready for its first ingredient.</Text>
                )}
              </Pressable>

              {/* SELECTED ZONE INVENTORY */}
              <View className="mb-3 flex-row items-end justify-between">
                <View className="min-w-0 flex-1 pr-3">
                  <Text className="text-[9px] font-black tracking-[2px] text-dark-300">IN THIS ZONE</Text>
                  <Text className="mt-1 text-xl font-black text-secondary">{activeZone.title}</Text>
                </View>
                <Text className="pb-1 text-[10px] font-semibold text-dark-300">
                  {activeItems.length} {activeItems.length === 1 ? "item" : "items"}
                </Text>
              </View>

              {activeItems.length === 0 ? (
                <View className="mb-5 rounded-[23px] border border-dashed border-primary bg-light-200 px-4 py-6">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-light-100">
                    <Ionicons name={activeZone.icon} size={20} color={colors.secondary} />
                  </View>
                  <Text className="mt-3 text-sm font-black text-secondary">
                    {selectedCategory ? "No ingredients in this category" : `Nothing in ${activeZone.title.toLowerCase()} yet`}
                  </Text>
                  <Text className="mt-1 text-[10px] leading-4 text-dark-300">
                    {selectedCategory
                      ? "Choose another category or clear the filter."
                      : "Add an ingredient, then move it here from its current zone."}
                  </Text>
                </View>
              ) : (
                <View className="mb-5 overflow-hidden rounded-[23px] border border-light-100 bg-light-200">
                  {activeItems.map((item, index) => (
                    <View key={item.id}>
                      {index > 0 && <View className="mx-4 h-px bg-light-100" />}
                      <View className="flex-row items-center px-3.5 py-3">
                        <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-light-100">
                          <Ionicons name="leaf-outline" size={18} color={colors.secondary} />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-xs font-extrabold text-secondary" numberOfLines={1}>
                            {item.name}
                          </Text>
                          <Text className="mt-1 text-[10px] text-dark-300">
                            {item.quantity} {item.unit}{item.category ? ` · ${item.category}` : ""}
                          </Text>
                          {item.expiration_date && (
                            <Text className="mt-1 text-[9px] font-semibold text-dark-300">
                              {formatExpiry(item.expiration_date)}
                            </Text>
                          )}
                        </View>
                        <Pressable
                          onPress={() => {
                            setActionError(null);
                            setMovingItem(item);
                          }}
                          className="ml-2 flex-row items-center rounded-full bg-neutral px-3 py-2"
                          accessibilityRole="button"
                          accessibilityLabel={`Move ${item.name} to another storage area`}
                        >
                          <Ionicons name="swap-horizontal" size={13} color={colors.secondary} />
                          <Text className="ml-1 text-[9px] font-black text-secondary">MOVE</Text>
                        </Pressable>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

          <View className="mb-4 items-center py-2">
            <Text className="text-[9px] font-bold tracking-wide text-dark-300">
              COLD. FROZEN. DRY. ALL IN ONE PLACE.
            </Text>
          </View>
        </View>
      </ScrollView>

      {/* ADD INGREDIENT OVERLAY — existing form retained */}
      {showAddIngredient && (
        <Pressable
          className="absolute inset-0 items-center bg-dark-300/50"
          onPress={() => setShowAddIngredient(false)}
        >
          <Pressable
            className="top-[15%] w-[90%] rounded-2xl bg-light-100 p-5"
            onPress={(event) => event.stopPropagation()}
          >
            <AddIngredientForm
              onClose={() => setShowAddIngredient(false)}
              onAdded={() => {
                setShowAddIngredient(false);
                notifyFridgeChanged("fridge");
              }}
            />
          </Pressable>
        </Pressable>
      )}

      {/* CATEGORY FILTER OVERLAY — existing filter retained */}
      {showPreferences && (
        <Pressable
          className="absolute inset-0 bg-dark-300/50"
          onPress={() => setShowPreferences(false)}
        >
          <Pressable
            className="absolute right-4 top-[12%] w-52 rounded-2xl bg-light-300"
            onPress={(event) => event.stopPropagation()}
          >
            <CategoryFilter
              onSelect={(category) => {
                setSelectedCategory(category);
                setShowPreferences(false);
              }}
            />
          </Pressable>
        </Pressable>
      )}

      {/* CHANGE LOCATION — native modal sits above the tab bar and safe area. */}
      <Modal
        visible={movingItem !== null}
        transparent
        animationType="slide"
        onRequestClose={() => {
          if (!moving) setMovingItem(null);
        }}
      >
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 justify-end" edges={["bottom", "left", "right"]}>
            <Pressable
              className="absolute inset-0 bg-dark-300/55"
              onPress={() => {
                if (!moving) setMovingItem(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Close change location panel"
            />
            {movingItem && (
              <View className="rounded-t-[28px] bg-light-300 px-5 pb-5 pt-5">
                <View className="mb-4 flex-row items-center justify-between">
                  <View className="min-w-0 flex-1 pr-3">
                    <Text className="text-[9px] font-black tracking-[2px] text-dark-300">CHANGE LOCATION</Text>
                    <Text className="mt-1 text-lg font-black text-secondary" numberOfLines={1}>
                      {movingItem.name}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => setMovingItem(null)}
                    disabled={moving}
                    className="h-10 w-10 items-center justify-center rounded-xl bg-light-200"
                    accessibilityRole="button"
                    accessibilityLabel="Close change location"
                  >
                    <Ionicons name="close" size={19} color={colors.secondary} />
                  </Pressable>
                </View>

                {actionError && (
                  <Text className="mb-3 text-xs leading-5 text-red-700">{actionError}</Text>
                )}

                {ZONES.map((zone) => {
                  const current = movingItem.storage_location === zone.key;
                  return (
                    <Pressable
                      key={zone.key}
                      onPress={() => void handleMoveItem(zone.key)}
                      disabled={current || moving}
                      className={`mb-2 flex-row items-center rounded-2xl border border-light-100 px-4 py-3.5 ${current ? zone.surface : "bg-light-200"} ${moving && !current ? "opacity-50" : ""}`}
                    >
                      <View className={`mr-3 h-9 w-9 items-center justify-center rounded-xl ${zone.iconSurface}`}>
                        <Ionicons name={zone.icon} size={18} color={colors.secondary} />
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-xs font-extrabold text-secondary">{zone.title}</Text>
                        <Text className="mt-0.5 text-[9px] text-dark-300">{zone.description}</Text>
                      </View>
                      {current ? (
                        <Text className="text-[9px] font-black text-secondary">CURRENT</Text>
                      ) : moving ? (
                        <ActivityIndicator size="small" color={colors.secondary} />
                      ) : (
                        <Ionicons name="arrow-forward" size={16} color={colors.secondary} />
                      )}
                    </Pressable>
                  );
                })}

                {/* Fourth action: permanently remove this user's inventory row. */}
                <Pressable
                  onPress={confirmDeleteItem}
                  disabled={moving}
                  className="mt-2 h-12 flex-row items-center justify-center rounded-2xl border border-[#E7C9C3] bg-[#F8ECE8] active:opacity-80"
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${movingItem.name} from storage`}
                >
                  <Ionicons name="trash-outline" size={17} color="#9B443B" />
                  <Text className="ml-2 text-xs font-black text-[#9B443B]">Remove ingredient</Text>
                </Pressable>
                <Text className="mt-2 text-center text-[9px] leading-4 text-dark-300">
                  Removing an ingredient updates your inventory and all screens that use it.
                </Text>
              </View>
            )}
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}