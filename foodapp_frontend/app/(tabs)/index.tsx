import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { colors } from "../../constants/colors";
import { apiFetch } from "../../utils/api";
import { subscribeToFridgeRefresh } from "../../utils/fridgeRefresh";

type StorageArea = "fridge" | "freezer" | "dry";

type HomeItem = {
  id: number;
  ingredient_id: number;
  name: string;
  quantity: number;
  unit: string;
  storage_area: StorageArea;
  expiration_date: string | null;
};

type HomeRecipe = {
  id: number;
  content: { title?: string };
  cooking_count?: number;
  created_at?: string;
};

type HomeState = {
  items: HomeItem[];
  recipes: HomeRecipe[];
  recent: HomeRecipe[];
};

type StorageSection = {
  key: StorageArea;
  title: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: string;
  iconTone: string;
};

const STORAGE_SECTIONS: StorageSection[] = [
  {
    key: "fridge",
    title: "Fridge",
    subtitle: "Fresh and chilled",
    icon: "thermometer-outline",
    tone: "bg-[#F4E7DE]",
    iconTone: "bg-[#E8D2C6]",
  },
  {
    key: "freezer",
    title: "Freezer",
    subtitle: "Frozen for later",
    icon: "snow-outline",
    tone: "bg-[#E8EEF0]",
    iconTone: "bg-[#D4E1E5]",
  },
  {
    key: "dry",
    title: "Dry goods",
    subtitle: "Cupboard and pantry",
    icon: "file-tray-stacked-outline",
    tone: "bg-[#E9EDDF]",
    iconTone: "bg-[#D9E1CA]",
  },
];

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function getTodayLabel(): string {
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date());
}

function daysUntil(value: string): number | null {
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((date.getTime() - today.getTime()) / 86_400_000);
}

function expiryLabel(value: string): string {
  const days = daysUntil(value);
  const date = new Date(`${value.slice(0, 10)}T00:00:00`);
  const formattedDate = Number.isNaN(date.getTime())
    ? "Date unavailable"
    : new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short" }).format(date);

  if (days === null) return formattedDate;
  if (days < 0) return `Past date · ${formattedDate}`;
  if (days === 0) return "Expires today";
  if (days === 1) return "1 day left";
  return `${days} days left`;
}

function normaliseStorageArea(value: unknown): StorageArea {
  const area = String(value ?? "fridge").trim().toLowerCase();
  if (["freezer", "frozen"].includes(area)) return "freezer";
  if (["dry", "pantry", "cupboard", "shelf", "dry goods"].includes(area)) return "dry";
  return "fridge";
}

function mapRecipeRows(rows: unknown): HomeRecipe[] {
  if (!Array.isArray(rows)) return [];
  return rows.map((value: Record<string, unknown>) => ({
    id: Number(value.id),
    content: value.content && typeof value.content === "object"
      ? value.content as { title?: string }
      : {},
    cooking_count: Number(value.cooking_count ?? 0),
    created_at: typeof value.created_at === "string" ? value.created_at : undefined,
  }));
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<HomeState>({ items: [], recipes: [], recent: [] });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storageTrackingAvailable, setStorageTrackingAvailable] = useState(false);

  const loadDashboard = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setError(null);

    try {
      const [itemsResult, recipesResult, historyResult] = await Promise.allSettled([
        apiFetch("/api/items"),
        apiFetch("/api/ai_food/recipes"),
        apiFetch("/api/ai_food/recipes/history"),
      ]);

      if (itemsResult.status !== "fulfilled") throw itemsResult.reason;

      const itemRows = itemsResult.value?.items;
      if (!Array.isArray(itemRows)) {
        throw new Error("The inventory endpoint returned an unexpected response.");
      }

      const hasStorageField = itemRows.some((item: Record<string, unknown>) =>
        Object.prototype.hasOwnProperty.call(item, "storage_location")
        || Object.prototype.hasOwnProperty.call(item, "storage_area"),
      );
      setStorageTrackingAvailable(hasStorageField);

      setData({
        items: itemRows.map((item: Record<string, unknown>) => ({
          id: Number(item.id),
          ingredient_id: Number(item.ingredient_id),
          name: String(item.name ?? "Ingredient"),
          quantity: Number(item.quantity ?? 0),
          unit: String(item.unit ?? ""),
          // Existing API rows have no storage field, so they remain in Fridge.
          // New rows can be grouped as fridge/freezer/dry once the API exposes it.
          storage_area: normaliseStorageArea(item.storage_location ?? item.storage_area),
          expiration_date: typeof (item.expiration_date ?? item.experation_date) === "string"
            ? String(item.expiration_date ?? item.experation_date)
            : null,
        })),
        recipes: recipesResult.status === "fulfilled"
          ? mapRecipeRows(recipesResult.value?.recipes)
          : [],
        recent: historyResult.status === "fulfilled"
          ? mapRecipeRows(historyResult.value?.history)
          : [],
      });

      if (recipesResult.status === "rejected" || historyResult.status === "rejected") {
        console.warn("Some Home recipe summaries could not be loaded.");
      }
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Could not load your kitchen overview.",
      );
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadDashboard(true);
    return subscribeToFridgeRefresh(() => {
      void loadDashboard(false);
    });
  }, [loadDashboard]);

  const storageGroups = useMemo(() => {
    return STORAGE_SECTIONS.map((section) => ({
      ...section,
      items: data.items.filter((item) => item.storage_area === section.key),
    }));
  }, [data.items]);

  const cookedCount = useMemo(
    () => data.recipes.reduce((total, recipe) => total + (recipe.cooking_count ?? 0), 0),
    [data.recipes],
  );

  const totalTrackedItems = data.items.length;
  const recentRecipes = data.recent.slice(0, 3);
  const expiringItems = useMemo(() => data.items
    .filter((item) => item.expiration_date !== null)
    .map((item) => ({ ...item, days: daysUntil(item.expiration_date as string) }))
    .filter((item) => item.days !== null && item.days <= 7)
    .sort((a, b) => (a.days ?? 9999) - (b.days ?? 9999)), [data.items]);

  return (
    <SafeAreaView className="flex-1 bg-light-300" edges={["top", "left", "right"]}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 108 }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadDashboard(false)}
            tintColor={colors.secondary}
            colors={[colors.secondary]}
          />
        }
      >
        <View className="w-full self-center px-5 pt-5" style={{ maxWidth: 760 }}>
          {/* A quiet editorial header instead of a stack of repeated dashboard cards. */}
          <View className="mb-6 flex-row items-end justify-between">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-[10px] font-black tracking-[2.4px] text-dark-300">
                YOUR KITCHEN JOURNAL
              </Text>
              <Text className="mt-2 text-[29px] font-black leading-9 tracking-tight text-secondary">
                {getGreeting()}.
              </Text>
              <Text className="mt-1 text-xs text-dark-300">{getTodayLabel()}</Text>
            </View>
            <View className="mb-1 h-11 w-11 items-center justify-center rounded-2xl bg-neutral">
              <Ionicons name="leaf-outline" size={22} color={colors.secondary} />
            </View>
          </View>

          {/* EXPIRY ATTENTION */}
          <Pressable
            onPress={() => router.push("/(tabs)/calendar" as never)}
            className="mb-6 overflow-hidden rounded-[28px] bg-secondary p-5 active:opacity-90"
            accessibilityRole="button"
            accessibilityLabel="Open the expiration calendar"
          >
            <View className="absolute -right-8 -top-8 h-32 w-32 rounded-full bg-primary opacity-20" />
            <View className="flex-row items-center justify-between">
              <View className="min-w-0 flex-1 pr-3">
                <View className="mb-2 self-start flex-row items-center gap-1.5 rounded-full bg-neutral px-2.5 py-1">
                  <Ionicons name="leaf-outline" size={12} color={colors.secondary} />
                  <Text className="text-[9px] font-black tracking-wide text-secondary">USE IT, DON'T LOSE IT</Text>
                </View>
                <Text className="text-xl font-black text-light-300">
                  {expiringItems.length > 0
                    ? `${expiringItems.length} item${expiringItems.length === 1 ? "" : "s"} need attention`
                    : "Keep an eye on freshness"}
                </Text>
                <Text className="mt-1 text-[11px] leading-4 text-light-100">
                  {expiringItems.length > 0
                    ? "Some fridge items are past date or approaching their expiry date."
                    : "Add expiry dates to your ingredients and see what needs using soon."}
                </Text>
              </View>
              <View className="h-12 w-12 items-center justify-center rounded-2xl bg-light-300/15">
                <Ionicons name="calendar-outline" size={25} color={colors.light[300]} />
              </View>
            </View>
            {expiringItems.length > 0 && (
              <View className="mt-3 border-t border-light-100/30 pt-2">
                {expiringItems.slice(0, 3).map((item) => (
                  <View key={item.id} className="flex-row items-center justify-between py-1.5">
                    <Text className="min-w-0 flex-1 pr-2 text-[11px] font-bold text-light-300" numberOfLines={1}>
                      {item.name}
                    </Text>
                    <Text className="text-[10px] font-extrabold text-light-100">
                      {expiryLabel(item.expiration_date as string)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
            <View className="mt-3 flex-row items-center justify-end gap-1">
              <Text className="text-[10px] font-black text-light-300">Open calendar</Text>
              <Ionicons name="arrow-forward" size={13} color={colors.light[300]} />
            </View>
          </Pressable>

          {loading ? (
            <View className="mb-6 items-center rounded-3xl bg-light-200 py-9">
              <ActivityIndicator size="large" color={colors.secondary} />
              <Text className="mt-3 text-xs text-dark-300">Getting your kitchen ready...</Text>
            </View>
          ) : error ? (
            <View className="mb-6 rounded-3xl border border-light-100 bg-light-200 p-4">
              <Text className="text-sm font-extrabold text-secondary">Your overview could not refresh</Text>
              <Text className="mt-1 text-xs leading-5 text-dark-300">{error}</Text>
              <Pressable
                onPress={() => void loadDashboard(true)}
                className="mt-3 self-start rounded-full bg-secondary px-4 py-2.5"
              >
                <Text className="text-xs font-bold text-light-300">Try again</Text>
              </Pressable>
            </View>
          ) : null}

          {/* Storage is shown as three named zones. Legacy inventory stays in Fridge. */}
          <View className="mb-3 flex-row items-end justify-between">
            <View>
              <Text className="text-[10px] font-black tracking-[2px] text-dark-300">AT A GLANCE</Text>
              <Text className="mt-1 text-xl font-black text-secondary">Your storage</Text>
            </View>
            <Text className="pb-1 text-[10px] font-semibold text-dark-300">
              {totalTrackedItems} {totalTrackedItems === 1 ? "item" : "items"} tracked
            </Text>
          </View>

          <View className="mb-7 overflow-hidden rounded-[24px] border border-light-100 bg-light-200">
            {storageGroups.map((section, index) => {
              const locationReady = section.key === "fridge" || storageTrackingAvailable;
              const quantityLabel = locationReady
                ? `${section.items.length} ${section.items.length === 1 ? "item" : "items"}`
                : "Not tracked yet";
              const preview = section.items.slice(0, 2).map((item) => item.name).join(" · ");

              return (
                <View key={section.key}>
                  {index > 0 && <View className="mx-4 h-px bg-light-100" />}
                  <View className={`flex-row items-center px-4 py-4 ${section.tone}`}>
                    <View className={`mr-3 h-11 w-11 items-center justify-center rounded-2xl ${section.iconTone}`}>
                      <Ionicons name={section.icon} size={21} color={colors.secondary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-black text-secondary">{section.title}</Text>
                      <Text className="mt-0.5 text-[10px] text-dark-300">{section.subtitle}</Text>
                      {locationReady && preview.length > 0 ? (
                        <Text className="mt-1 text-[10px] text-dark-300" numberOfLines={1}>
                          {preview}{section.items.length > 2 ? " and more" : ""}
                        </Text>
                      ) : !locationReady ? (
                        <Text className="mt-1 text-[10px] text-dark-300">
                          Storage locations need to be enabled
                        </Text>
                      ) : (
                        <Text className="mt-1 text-[10px] text-dark-300">Nothing stored here yet</Text>
                      )}
                    </View>
                    <View className="ml-3 items-end">
                      <Text className="text-sm font-black text-secondary">{quantityLabel}</Text>
                      {section.key === "fridge" && (
                        <Pressable
                          onPress={() => router.push("/(tabs)/fridge" as never)}
                          className="mt-1 flex-row items-center"
                          hitSlop={8}
                          accessibilityRole="button"
                          accessibilityLabel="Manage fridge ingredients"
                        >
                          <Text className="text-[9px] font-black text-secondary">MANAGE</Text>
                          <Ionicons name="arrow-forward" size={11} color={colors.secondary} />
                        </Pressable>
                      )}
                    </View>
                  </View>
                </View>
              );
            })}
          </View>

          {/* Compact activity line, rather than another pair of metric tiles. */}
          <View className="mb-7 flex-row items-center rounded-2xl border border-light-100 bg-light-200 px-4 py-3.5">
            <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-neutral">
              <Ionicons name="restaurant-outline" size={18} color={colors.secondary} />
            </View>
            <View className="flex-1">
              <Text className="text-[10px] font-bold text-dark-300">COOKING MILESTONES</Text>
              <Text className="mt-0.5 text-xs font-extrabold text-secondary">
                {cookedCount} {cookedCount === 1 ? "meal" : "meals"} made so far
              </Text>
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/explore" as never)}
              className="flex-row items-center rounded-full bg-neutral px-3 py-2"
              accessibilityRole="button"
              accessibilityLabel="Open Explorer"
            >
              <Text className="mr-1 text-[9px] font-black text-secondary">EXPLORE</Text>
              <Ionicons name="arrow-forward" size={11} color={colors.secondary} />
            </Pressable>
          </View>

          {/* Recently opened recipes are presented as a simple reading list. */}
          <View className="mb-3 flex-row items-end justify-between">
            <View>
              <Text className="text-[10px] font-black tracking-[2px] text-dark-300">YOUR COOKING TRAIL</Text>
              <Text className="mt-1 text-xl font-black text-secondary">Back to a recipe</Text>
            </View>
            <Pressable
              onPress={() => router.push("/(tabs)/explore" as never)}
              className="mb-1 flex-row items-center"
              accessibilityRole="button"
            >
              <Text className="mr-1 text-[10px] font-black text-secondary">All recipes</Text>
              <Ionicons name="arrow-forward" size={12} color={colors.secondary} />
            </Pressable>
          </View>

          {recentRecipes.length === 0 ? (
            <View className="mb-6 rounded-2xl border border-dashed border-primary bg-light-200 px-4 py-5">
              <View className="mb-3 h-10 w-10 items-center justify-center rounded-xl bg-neutral">
                <Ionicons name="book-outline" size={20} color={colors.secondary} />
              </View>
              <Text className="text-sm font-extrabold text-secondary">Your recipe list is waiting</Text>
              <Text className="mt-1 text-[11px] leading-5 text-dark-300">
                Open a recipe in Explorer and it will be saved here for an easy return.
              </Text>
              <Pressable
                onPress={() => router.push("/(tabs)/explore" as never)}
                className="mt-3 flex-row items-center self-start"
              >
                <Text className="mr-1 text-[11px] font-black text-secondary">Find your first recipe</Text>
                <Ionicons name="arrow-forward" size={12} color={colors.secondary} />
              </Pressable>
            </View>
          ) : (
            <View className="mb-6 overflow-hidden rounded-2xl border border-light-100 bg-light-200">
              {recentRecipes.map((recipe, index) => (
                <View key={recipe.id}>
                  {index > 0 && <View className="mx-4 h-px bg-light-100" />}
                  <Pressable
                    onPress={() => router.push("/(tabs)/explore" as never)}
                    className="flex-row items-center px-4 py-3.5 active:opacity-70"
                    accessibilityRole="button"
                    accessibilityLabel={`Open Explorer for ${recipe.content.title || "recipe"}`}
                  >
                    <Text className="mr-3 w-6 text-[10px] font-black text-dark-300">
                      {String(index + 1).padStart(2, "0")}
                    </Text>
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs font-extrabold text-secondary" numberOfLines={1}>
                        {recipe.content.title || "Untitled recipe"}
                      </Text>
                      <Text className="mt-1 text-[10px] text-dark-300">
                        Cooked {recipe.cooking_count ?? 0} {recipe.cooking_count === 1 ? "time" : "times"}
                      </Text>
                    </View>
                    <Ionicons name="chevron-forward" size={17} color={colors.secondary} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}

          <View className="mb-3 items-center py-3">
            <Ionicons name="leaf-outline" size={17} color={colors.neutral} />
            <Text className="mt-2 text-[10px] font-black tracking-wide text-secondary">
              GOOD FOOD. LESS WASTE. MORE IDEAS.
            </Text>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}