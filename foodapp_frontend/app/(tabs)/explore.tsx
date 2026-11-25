import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Image,
  Keyboard,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../../constants/colors";
import { apiFetch } from "../../utils/api";
import {
  clearPendingCookKey,
  getPendingCookKey,
  savePendingCookKey,
} from "../../utils/recipeCookingStorage";
import {
  clearPendingGenerationKey,
  getPendingGenerationKey,
  savePendingGenerationKey,
  type RecipeMealType,
} from "../../utils/recipeGenerationStorage";
import {
  notifyFridgeChanged,
  subscribeToFridgeRefresh,
} from "../../utils/fridgeRefresh";

type RecipeIngredient = {
  ingredient_id: number | null;
  name: string;
  quantity: number;
  unit: string;
  is_available?: boolean;
};

type RecipeNutrition = {
  calories?: number;
  protein?: number;
  carbs?: number;
  fat?: number;
};

type RecipeContent = {
  meal_type?: RecipeMealType;
  title: string;
  description: string;
  cooking_time: number;
  difficulty: string;
  servings: number;
  image_url: string | null;
  ingredients: RecipeIngredient[];
  instructions: string[];
  nutrition: RecipeNutrition;
};

type RecipeRecord = {
  id: number;
  source: string;
  request: string | null;
  content: RecipeContent;
  created_at: string;
  cooked_at: string | null;
  cooking_count: number;
  last_cooked_at: string | null;
  is_favourite: boolean;
  viewed_at?: string | null;
  favourited_at?: string | null;
};

type StorageLocation = "fridge" | "freezer" | "dry";

type InventoryItem = {
  id: number;
  ingredient_id: number;
  name: string;
  quantity: number;
  unit: string;
  category: string | null;
  storage_location: StorageLocation;
};

type CookingEvent = {
  id: number;
  cooked_at: string;
  deducted_ingredients: Array<{
    ingredient_id?: number;
    name: string;
    quantity: number;
    unit: string;
    remaining?: number;
  }>;
  is_legacy: boolean;
};

type Notice = { type: "success" | "error" | "info"; message: string } | null;
type CollectionSection = "fridge" | "history" | "loved";
type LoadMode = "initial" | "refresh";

type ExplorerData = {
  recipes: RecipeRecord[];
  inventory: InventoryItem[];
  history: RecipeRecord[];
  favourites: RecipeRecord[];
};

function createIdempotencyKey(): string {
  // This identifies one deliberate cooking action; it is not an auth secret.
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (character) => {
    const random = Math.floor(Math.random() * 16);
    const value = character === "x" ? random : (random & 0x3) | 0x8;
    return value.toString(16);
  });
}

function formatDateTime(value?: string | null): string {
  if (!value) return "Not cooked yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";

  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  }).format(date);
}

function asObject(value: unknown): Record<string, unknown> {
  if (typeof value === "string") {
    const parsed: unknown = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    throw new Error("The recipe content is not a JSON object.");
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  throw new Error("This recipe has an invalid content format.");
}

function normalizeRecipe(record: unknown): RecipeRecord {
  if (!record || typeof record !== "object") {
    throw new Error("The recipes endpoint returned an invalid recipe.");
  }

  const raw = record as Record<string, unknown>;
  const content = asObject(raw.content);
  const rawIngredients = Array.isArray(content.ingredients) ? content.ingredients : [];
  const ingredients: RecipeIngredient[] = rawIngredients.map((entry: unknown) => {
    const ingredient = entry && typeof entry === "object"
      ? entry as Record<string, unknown>
      : {};

    const rawId = ingredient.ingredient_id;
    return {
      ingredient_id: rawId === null || rawId === undefined ? null : Number(rawId),
      name: String(ingredient.name ?? "Ingredient"),
      quantity: Number(ingredient.quantity ?? 0),
      unit: String(ingredient.unit ?? ""),
      ...(typeof ingredient.is_available === "boolean"
        ? { is_available: ingredient.is_available }
        : {}),
    };
  });

  const rawNutrition = content.nutrition && typeof content.nutrition === "object"
    ? content.nutrition as Record<string, unknown>
    : {};

  return {
    id: Number(raw.id),
    source: String(raw.source ?? "ai"),
    request: typeof raw.request === "string" ? raw.request : null,
    content: {
      meal_type: content.meal_type === "breakfast" || content.meal_type === "lunch" || content.meal_type === "dinner"
        ? content.meal_type
        : undefined,
      title: String(content.title ?? "Untitled recipe"),
      description: String(content.description ?? "A kitchen idea made for you."),
      cooking_time: Number(content.cooking_time ?? 0),
      difficulty: String(content.difficulty ?? "Easy"),
      servings: Number(content.servings ?? 1),
      image_url: typeof content.image_url === "string" ? content.image_url : null,
      ingredients,
      instructions: Array.isArray(content.instructions)
        ? content.instructions.map((step: unknown) => String(step))
        : [],
      nutrition: {
        calories: rawNutrition.calories === undefined ? undefined : Number(rawNutrition.calories),
        protein: rawNutrition.protein === undefined ? undefined : Number(rawNutrition.protein),
        carbs: rawNutrition.carbs === undefined ? undefined : Number(rawNutrition.carbs),
        fat: rawNutrition.fat === undefined ? undefined : Number(rawNutrition.fat),
      },
    },
    created_at: String(raw.created_at ?? ""),
    cooked_at: typeof raw.cooked_at === "string" ? raw.cooked_at : null,
    cooking_count: Number(raw.cooking_count ?? 0),
    last_cooked_at: typeof raw.last_cooked_at === "string"
      ? raw.last_cooked_at
      : typeof raw.cooked_at === "string"
        ? raw.cooked_at
        : null,
    is_favourite: raw.is_favourite === true,
    viewed_at: typeof raw.viewed_at === "string" ? raw.viewed_at : null,
    favourited_at: typeof raw.favourited_at === "string" ? raw.favourited_at : null,
  };
}

function normalizeStorageLocation(value: unknown): StorageLocation {
  const location = String(value ?? "fridge").trim().toLowerCase();
  if (location === "freezer") return "freezer";
  if (location === "dry") return "dry";
  return "fridge";
}

function storageLocationLabel(location: StorageLocation): string {
  if (location === "freezer") return "Freezer";
  if (location === "dry") return "Dry goods";
  return "Fridge";
}

function normalizeUnit(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function normalizeInventory(response: unknown): InventoryItem[] {
  if (!response || typeof response !== "object") return [];
  const items = (response as Record<string, unknown>).items;
  if (!Array.isArray(items)) {
    throw new Error("The fridge endpoint returned an unexpected response.");
  }

  return items.map((entry: unknown) => {
    const item = entry && typeof entry === "object"
      ? entry as Record<string, unknown>
      : {};
    return {
      id: Number(item.id),
      ingredient_id: Number(item.ingredient_id),
      name: String(item.name ?? "Ingredient"),
      quantity: Number(item.quantity ?? 0),
      unit: String(item.unit ?? ""),
      category: typeof item.category === "string" ? item.category : null,
      storage_location: normalizeStorageLocation(item.storage_location),
    };
  });
}

/** Current stock is the source of truth, not the availability at recipe-generation time. */
function getRecipeAvailability(
  recipe: RecipeRecord,
  inventory: InventoryItem[],
): { canCook: boolean; missing: string[] } {
  const ingredients = recipe.content.ingredients;
  if (!ingredients.length) return { canCook: false, missing: ["Recipe has no ingredients"] };

  const inventoryById = new Map<number, InventoryItem>();
  for (const item of inventory) inventoryById.set(item.ingredient_id, item);

  const required = new Map<number, { quantity: number; unit: string; name: string }>();
  const missing = new Set<string>();

  for (const ingredient of ingredients) {
    const id = ingredient.ingredient_id;
    const quantity = Number(ingredient.quantity);
    const unit = ingredient.unit.trim();

    if (id === null || !Number.isFinite(id) || !Number.isFinite(quantity) || quantity <= 0 || !unit) {
      missing.add(ingredient.name);
      continue;
    }

    // Search recipes may have been marked unavailable when generated. If the AI
    // supplied no canonical ingredient ID, the item cannot safely be deducted.
    if (ingredient.is_available === false) {
      missing.add(ingredient.name);
      continue;
    }

    const existing = required.get(id);
    if (!existing) {
      required.set(id, { quantity, unit, name: ingredient.name });
    } else if (normalizeUnit(existing.unit) !== normalizeUnit(unit)) {
      missing.add(ingredient.name);
    } else {
      existing.quantity += quantity;
    }
  }

  for (const [ingredientId, need] of required) {
    const stock = inventoryById.get(ingredientId);
    if (!stock) {
      missing.add(need.name);
      continue;
    }
    if (normalizeUnit(stock.unit) !== normalizeUnit(need.unit)) {
      missing.add(need.name);
      continue;
    }
    if (!Number.isFinite(stock.quantity) || stock.quantity < need.quantity) {
      missing.add(need.name);
    }
  }

  return { canCook: missing.size === 0, missing: Array.from(missing) };
}

/** Return a timer duration only when the recipe instruction states one explicitly. */
function getInstructionDurationSeconds(instruction: string): number | null {
  const match = instruction.match(/\b(?:for\s+)?(\d{1,3})\s*(seconds?|secs?|minutes?|mins?|hours?|hrs?)\b/i);
  if (!match) return null;
  const amount = Number(match[1]);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const unit = match[2].toLowerCase();
  if (/^(seconds?|secs?)$/.test(unit)) return amount;
  if (/^(hours?|hrs?)$/.test(unit)) return amount * 60 * 60;
  return amount * 60;
}

function formatCountdown(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remainingSeconds = safeSeconds % 60;
  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
  }
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}

function RecipeArtwork({
  imageUrl,
  large = false,
}: {
  imageUrl?: string | null;
  large?: boolean;
}) {
  const imageClass = large ? "h-56 w-full rounded-3xl" : "h-32 w-28 rounded-2xl";
  const validImage = typeof imageUrl === "string" && /^https?:\/\//i.test(imageUrl);

  if (validImage) {
    return (
      <Image
        source={{ uri: imageUrl! }}
        resizeMode="cover"
        className={`${imageClass} overflow-hidden`}
        accessibilityLabel="Recipe image"
      />
    );
  }

  return (
    <View className={`${imageClass} relative items-center justify-center overflow-hidden bg-primary`}>
      <View className="absolute -left-7 -top-7 h-24 w-24 rounded-full bg-light-100" />
      <View className="absolute -bottom-10 -right-6 h-28 w-28 rounded-full bg-neutral" />
      <View className="h-16 w-16 items-center justify-center rounded-full bg-light-200">
        <View className="h-12 w-12 items-center justify-center rounded-full border-4 border-light-100 bg-light-300">
          <Ionicons name="restaurant-outline" size={large ? 30 : 25} color={colors.secondary} />
        </View>
      </View>
      <View className="absolute bottom-2 right-2 h-7 w-7 items-center justify-center rounded-xl bg-light-300">
        <Ionicons name="leaf-outline" size={15} color={colors.secondary} />
      </View>
      {large && (
        <Text className="absolute bottom-4 left-4 text-[9px] font-extrabold tracking-[2px] text-secondary">
          MADE IN YOUR KITCHEN
        </Text>
      )}
    </View>
  );
}

function RecipeCard({
  recipe,
  canCook,
  missing,
  favouriteBusy,
  onPress,
  onToggleFavourite,
}: {
  recipe: RecipeRecord;
  canCook: boolean;
  missing: string[];
  favouriteBusy: boolean;
  onPress: () => void;
  onToggleFavourite: () => void;
}) {
  return (
    <View className="mb-3 flex-row rounded-3xl border border-light-100 bg-light-200 p-3">
      <View className="relative">
        <Pressable onPress={onPress} accessibilityRole="button" accessibilityLabel={`Open ${recipe.content.title}`}>
          <RecipeArtwork imageUrl={recipe.content.image_url} />
        </Pressable>
        <Pressable
          onPress={onToggleFavourite}
          disabled={favouriteBusy}
          hitSlop={6}
          className={`absolute left-2 top-2 h-9 w-9 items-center justify-center rounded-full border border-white/80 bg-light-300/95 ${favouriteBusy ? "opacity-50" : ""}`}
          accessibilityRole="button"
          accessibilityLabel={recipe.is_favourite ? "Remove from Loved ones" : "Add to Loved ones"}
        >
          {favouriteBusy
            ? <ActivityIndicator size="small" color={colors.secondary} />
            : <Ionicons
                name={recipe.is_favourite ? "heart" : "heart-outline"}
                size={19}
                color={recipe.is_favourite ? colors.secondary : colors.dark[300]}
              />}
        </Pressable>
      </View>

      <Pressable
        onPress={onPress}
        className="ml-3 min-w-0 flex-1 justify-between py-1"
        accessibilityRole="button"
        accessibilityLabel={`Open recipe ${recipe.content.title}`}
      >
        <View>
          <View className="mb-2 flex-row flex-wrap items-center gap-1.5">
            <View className={`flex-row items-center gap-1 rounded-full px-2 py-1 ${recipe.source === "search" ? "bg-light-100" : recipe.source === "selected" ? "bg-primary" : "bg-neutral"}`}>
              <Ionicons
                name={recipe.source === "search" ? "search-outline" : recipe.source === "selected" ? "options-outline" : "leaf-outline"}
                size={11}
                color={colors.secondary}
              />
              <Text className="text-[8px] font-extrabold tracking-wide text-secondary">
                {recipe.source === "search" ? "SEARCH IDEA" : recipe.source === "selected" ? "YOUR PICKS" : "FROM YOUR FRIDGE"}
              </Text>
            </View>
            {recipe.cooking_count > 0 && (
              <View className="flex-row items-center gap-1 rounded-full bg-[#E7EDDF] px-2 py-1">
                <Ionicons name="checkmark-circle" size={12} color={colors.secondary} />
                <Text className="text-[8px] font-extrabold text-secondary">{recipe.cooking_count}× cooked</Text>
              </View>
            )}
          </View>

          <Text className="text-sm font-extrabold leading-5 text-secondary" numberOfLines={2}>
            {recipe.content.title}
          </Text>
          <Text className="mt-1 text-[10px] leading-4 text-dark-300" numberOfLines={2}>
            {recipe.content.description}
          </Text>
        </View>

        <View className="mt-2 flex-row flex-wrap items-center gap-3">
          <View className="flex-row items-center gap-1">
            <Ionicons name="time-outline" size={13} color={colors.dark[300]} />
            <Text className="text-[9px] font-bold text-dark-300">{recipe.content.cooking_time || "—"} min</Text>
          </View>
          <View className="flex-row items-center gap-1">
            <Ionicons name="speedometer-outline" size={13} color={colors.dark[300]} />
            <Text className="text-[9px] font-bold text-dark-300">{recipe.content.difficulty}</Text>
          </View>
          {!canCook && missing.length > 0 && (
            <View className="rounded-full bg-[#F5E3E0] px-2 py-1">
              <Text className="text-[8px] font-extrabold text-secondary">{missing.length} missing</Text>
            </View>
          )}
        </View>
      </Pressable>

      <Pressable onPress={onPress} className="justify-center pl-1" hitSlop={5}>
        <Ionicons name="chevron-forward" size={17} color={colors.secondary} />
      </Pressable>
    </View>
  );
}

type RecipePreferences = {
  allergies: string[];
  cuisines: string[];
  diets: string[];
  gluten_free: boolean;
};

const ALLERGY_OPTIONS = [
  "Peanuts", "Tree nuts", "Milk", "Eggs", "Fish", "Crustaceans",
  "Molluscs", "Soy", "Wheat", "Sesame", "Mustard", "Celery",
  "Lupin", "Sulphites",
];
const CUISINE_OPTIONS = [
  "Italian", "Mexican", "Japanese", "Indian", "Thai", "Chinese",
  "Mediterranean", "Korean", "Greek", "French", "Middle Eastern", "American",
];
const DIET_OPTIONS = [
  "Vegetarian", "Vegan", "Pescatarian", "Flexitarian", "Low-carb",
  "Keto", "High-protein", "Paleo", "Halal", "Kosher",
];
const EMPTY_RECIPE_PREFERENCES: RecipePreferences = {
  allergies: [],
  cuisines: [],
  diets: [],
  gluten_free: false,
};

export default function ExploreScreen() {
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const horizontalPadding = windowWidth < 360 ? 12 : 16;
  const isCompactScreen = windowWidth < 380;

  const [recipes, setRecipes] = useState<RecipeRecord[]>([]);
  const [inventory, setInventory] = useState<InventoryItem[]>([]);
  const [inventoryFresh, setInventoryFresh] = useState(false);
  const [viewHistory, setViewHistory] = useState<RecipeRecord[]>([]);
  const [favourites, setFavourites] = useState<RecipeRecord[]>([]);
  const [section, setSection] = useState<CollectionSection>("fridge");
  const [mealType, setMealType] = useState<RecipeMealType>("lunch");
  const [showRecipePreferences, setShowRecipePreferences] = useState(false);
  const [recipePreferences, setRecipePreferences] = useState<RecipePreferences>(EMPTY_RECIPE_PREFERENCES);
  const [preferencesLoading, setPreferencesLoading] = useState(false);
  const [savingPreferences, setSavingPreferences] = useState(false);
  const [preferencesError, setPreferencesError] = useState<string | null>(null);
  const [customAllergy, setCustomAllergy] = useState("");

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [generatingSelected, setGeneratingSelected] = useState(false);
  const [showIngredientPicker, setShowIngredientPicker] = useState(false);
  const [selectedIngredientIds, setSelectedIngredientIds] = useState<number[]>([]);
  const generationLocks = useRef({ fridge: false, selected: false });
  const searchLock = useRef(false);
  const [searching, setSearching] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [showSearchSuggestions, setShowSearchSuggestions] = useState(false);
  const autoGenerationStarted = useRef(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [favouriteBusyId, setFavouriteBusyId] = useState<number | null>(null);

  const [selectedRecipe, setSelectedRecipe] = useState<RecipeRecord | null>(null);
  const [cookings, setCookings] = useState<CookingEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [showCookConfirmation, setShowCookConfirmation] = useState(false);
  const [showCookingMode, setShowCookingMode] = useState(false);
  const [cookingStage, setCookingStage] = useState<"prep" | "steps" | "done">("prep");
  const [cookingStepIndex, setCookingStepIndex] = useState(0);
  const [completedCookingSteps, setCompletedCookingSteps] = useState<number[]>([]);
  const [stepTimerRemaining, setStepTimerRemaining] = useState<number | null>(null);
  const [stepTimerRunning, setStepTimerRunning] = useState(false);
  const [stepTimerEndsAt, setStepTimerEndsAt] = useState<number | null>(null);
  const [cooking, setCooking] = useState(false);
  const [cookFeedback, setCookFeedback] = useState<Notice>(null);
  const pendingKeys = useRef<Record<number, string>>({});

  const loadExplorerData = useCallback(async (mode: LoadMode = "initial"): Promise<ExplorerData | null> => {
    if (mode === "initial") setLoading(true);
    else setRefreshing(true);
    setLoadError(null);

    try {
      const [recipeResponse, inventoryResponse, historyResponse, favouriteResponse] = await Promise.all([
        apiFetch("/api/ai_food/recipes"),
        apiFetch("/api/items"),
        apiFetch("/api/ai_food/recipes/history"),
        apiFetch("/api/ai_food/recipes/favourites"),
      ]);

      if (!Array.isArray(recipeResponse?.recipes)) {
        throw new Error("The recipes endpoint returned an unexpected response.");
      }
      if (!Array.isArray(historyResponse?.history)) {
        throw new Error("The recipe history endpoint returned an unexpected response.");
      }
      if (!Array.isArray(favouriteResponse?.favourites)) {
        throw new Error("The Loved ones endpoint returned an unexpected response.");
      }

      const data: ExplorerData = {
        recipes: recipeResponse.recipes.map((record: unknown) => normalizeRecipe(record)),
        inventory: normalizeInventory(inventoryResponse),
        history: historyResponse.history.map((record: unknown) => normalizeRecipe(record)),
        favourites: favouriteResponse.favourites.map((record: unknown) => normalizeRecipe(record)),
      };

      // The favourites endpoint is authoritative if a stale response omits the
      // is_favourite field from the main recipe feed.
      const favouriteIds = new Set(data.favourites.map((recipe) => recipe.id));
      data.recipes = data.recipes.map((recipe) => ({
        ...recipe,
        is_favourite: recipe.is_favourite || favouriteIds.has(recipe.id),
      }));
      data.history = data.history.map((recipe) => ({
        ...recipe,
        is_favourite: recipe.is_favourite || favouriteIds.has(recipe.id),
      }));

      setRecipes(data.recipes);
      setInventory(data.inventory);
      setInventoryFresh(true);
      setViewHistory(data.history);
      setFavourites(data.favourites);
      setSelectedRecipe((current) => {
        if (!current) return current;
        return data.recipes.find((recipe) => recipe.id === current.id)
          ?? data.history.find((recipe) => recipe.id === current.id)
          ?? data.favourites.find((recipe) => recipe.id === current.id)
          ?? current;
      });
      return data;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Could not load Explorer.";
      setLoadError(message);
      // Never leave stale stock marked as safe to cook from after a failed refresh.
      setInventoryFresh(false);
      return null;
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void loadExplorerData("initial");
    return subscribeToFridgeRefresh((source) => {
      if (source === "fridge") {
        void loadExplorerData("refresh");
      }
    });
  }, [loadExplorerData]);

  // Use an absolute deadline so a timer catches up after the app is briefly backgrounded.
  // It still runs only while Cooking Mode is visible; closing the mode pauses it.
  useEffect(() => {
    if (!showCookingMode || !stepTimerRunning || stepTimerEndsAt === null) return;

    const updateRemaining = () => {
      const remaining = Math.max(0, Math.ceil((stepTimerEndsAt - Date.now()) / 1000));
      setStepTimerRemaining(remaining);
      if (remaining === 0) {
        setStepTimerRunning(false);
        setStepTimerEndsAt(null);
      }
    };

    updateRemaining();
    const interval = setInterval(updateRemaining, 1000);
    return () => clearInterval(interval);
  }, [showCookingMode, stepTimerRunning, stepTimerEndsAt]);

  const fromFridgeRecipes = useMemo(
    () => inventoryFresh
      ? recipes.filter((recipe) => getRecipeAvailability(recipe, inventory).canCook)
      : [],
    [recipes, inventory, inventoryFresh],
  );

  // Give a new user a useful fridge collection without requiring a manual tap.
  // This runs once per screen session and never loops after a failed request.
  useEffect(() => {
    if (loading || !inventoryFresh || autoGenerationStarted.current) return;
    const alreadyHasFridgeIdeas = recipes.some(
      (recipe) => recipe.source === "ai" || recipe.source === "selected",
    );
    if (alreadyHasFridgeIdeas) {
      autoGenerationStarted.current = true;
      return;
    }
    if (inventory.length === 0) return;
    autoGenerationStarted.current = true;
    void handleGenerate(5);
  }, [loading, inventoryFresh, inventory.length, recipes]);

  const searchSuggestions = useMemo(() => {
    const query = searchText.trim().toLocaleLowerCase();
    if (!query) return [] as string[];
    const candidates = [
      ...recipes.map((recipe) => recipe.content.title),
      ...inventory.map((item) => `${item.name} recipe`),
      ...inventory.map((item) => `What can I make with ${item.name}?`),
      "Quick and easy meal",
      "High-protein dinner",
      "Vegetarian meal",
      "Healthy pasta",
      "Something with rice",
      "A meal using my leftovers",
    ];
    const unique = Array.from(new Set(candidates.map((value) => value.trim()).filter(Boolean)));
    const matches = unique.filter((value) => value.toLocaleLowerCase().includes(query));
    const selected = matches.slice(0, 4);
    if (query.length >= 3 && !selected.some((value) => value.toLocaleLowerCase() === query)) {
      selected.push(searchText.trim());
    }
    return selected.slice(0, 5);
  }, [searchText, recipes, inventory]);

  const visibleRecipes = section === "fridge"
    ? fromFridgeRecipes
    : section === "history"
      ? viewHistory
      : favourites;

  const sectionTitle = section === "fridge"
    ? "From my fridge"
    : section === "history"
      ? "My history"
      : "Loved ones";

  const sectionDescription = section === "fridge"
    ? "Only recipes you can make with your current stock."
    : section === "history"
      ? "Your ten most recent searches and opened recipes."
      : "Recipes you kept close with a heart.";

  function showNotice(type: "success" | "error" | "info", message: string) {
    setNotice({ type, message });
  }

  const loadRecipePreferences = useCallback(async () => {
    setPreferencesLoading(true);
    setPreferencesError(null);
    try {
      const response = await apiFetch("/api/preferences");
      setRecipePreferences({
        allergies: Array.isArray(response?.allergies) ? response.allergies.map(String) : [],
        cuisines: Array.isArray(response?.cuisines) ? response.cuisines.map(String) : [],
        diets: Array.isArray(response?.diets) ? response.diets.map(String) : [],
        gluten_free: response?.gluten_free === true,
      });
    } catch (error: unknown) {
      setPreferencesError(error instanceof Error ? error.message : "Could not load your recipe preferences.");
    } finally {
      setPreferencesLoading(false);
    }
  }, []);

  const toggleRecipePreference = (field: "allergies" | "cuisines" | "diets", value: string) => {
    setRecipePreferences((current) => ({
      ...current,
      [field]: current[field].includes(value)
        ? current[field].filter((entry) => entry !== value)
        : [...current[field], value],
    }));
  };

  const saveRecipePreferences = async () => {
    if (savingPreferences) return;
    setSavingPreferences(true);
    setPreferencesError(null);
    try {
      await apiFetch("/api/preferences", {
        method: "PUT",
        body: JSON.stringify(recipePreferences),
      });
      setShowRecipePreferences(false);
      showNotice("info", "Preferences saved. Finding fresh recipes that match your settings...");
      await handleGenerate(5);
    } catch (error: unknown) {
      setPreferencesError(error instanceof Error ? error.message : "Could not save your recipe preferences.");
    } finally {
      setSavingPreferences(false);
    }
  };

  const addCustomAllergy = () => {
    const value = customAllergy.trim();
    if (!value) return;
    setRecipePreferences((current) => ({
      ...current,
      allergies: current.allergies.includes(value) ? current.allergies : [...current.allergies, value],
    }));
    setCustomAllergy("");
  };

  async function handleGenerate(batchSize: 3 | 5 = 3) {
    // A ref closes the tiny window before React applies the disabled state.
    if (generationLocks.current.fridge || generationLocks.current.selected || searchLock.current) return;
    generationLocks.current.fridge = true;
    setGenerating(true);
    setNotice(null);

    try {
      let idempotencyKey = await getPendingGenerationKey("fridge", mealType, batchSize);
      if (!idempotencyKey) {
        idempotencyKey = createIdempotencyKey();
        await savePendingGenerationKey("fridge", idempotencyKey, mealType, batchSize);
      }

      const response = await apiFetch("/api/ai_food/generate-recipe", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          meal_type: mealType,
          count: batchSize,
        }),
      });

      await clearPendingGenerationKey("fridge", mealType, batchSize);
      const count = Array.isArray(response?.recipes) ? response.recipes.length : 0;
      await loadExplorerData("refresh");
      setSection("fridge");
      showNotice(
        "success",
        response?.replayed
          ? "Your previous generation request has finished. No duplicate recipes were created."
          : `${count || batchSize} new ${mealType} recipes added. Showing only what you can cook now.`,
      );
    } catch (error: unknown) {
      // Keep the key after uncertain network failures so a retry cannot create
      // another batch if the server already completed the first request.
      showNotice("error", error instanceof Error ? error.message : "Recipe generation failed.");
    } finally {
      generationLocks.current.fridge = false;
      setGenerating(false);
    }
  }

  function toggleSelectedIngredient(ingredientId: number) {
    setSelectedIngredientIds((current) => (
      current.includes(ingredientId)
        ? current.filter((id) => id !== ingredientId)
        : [...current, ingredientId]
    ));
  }

  async function handleGenerateSelected() {
    if (generationLocks.current.selected || generationLocks.current.fridge || searchLock.current) return;
    if (!inventoryFresh) {
      showNotice("info", "Refresh your fridge before choosing ingredients.");
      await loadExplorerData("refresh");
      return;
    }
    if (selectedIngredientIds.length === 0) {
      showNotice("info", "Choose at least one ingredient first.");
      return;
    }

    generationLocks.current.selected = true;
    setGeneratingSelected(true);
    setNotice(null);

    try {
      let idempotencyKey = await getPendingGenerationKey("selected", mealType);
      if (!idempotencyKey) {
        idempotencyKey = createIdempotencyKey();
        await savePendingGenerationKey("selected", idempotencyKey, mealType);
      }

      const response = await apiFetch("/api/ai_food/generate-selected-recipes", {
        method: "POST",
        body: JSON.stringify({
          idempotency_key: idempotencyKey,
          ingredient_ids: selectedIngredientIds,
          meal_type: mealType,
        }),
      });

      await clearPendingGenerationKey("selected", mealType);
      const count = Array.isArray(response?.recipes) ? response.recipes.length : 0;
      await loadExplorerData("refresh");
      setSection("fridge");
      setSelectedIngredientIds([]);
      setShowIngredientPicker(false);
      showNotice(
        "success",
        response?.replayed
          ? "Your previous selected-ingredient request has finished. No duplicates were created."
          : `${count} recipes created using only your selected ingredients.`,
      );
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "Could not create recipes from your selection.");
    } finally {
      generationLocks.current.selected = false;
      setGeneratingSelected(false);
    }
  }

  async function handleSearch(chosenRequest?: string) {
    if (searchLock.current || generationLocks.current.fridge || generationLocks.current.selected) return;
    const request = (chosenRequest ?? searchText).trim();
    if (request.length < 3) {
      showNotice("info", "Add a little more detail to your search (at least 3 characters).");
      return;
    }

    Keyboard.dismiss();
    setShowSearchSuggestions(false);
    searchLock.current = true;
    setSearching(true);
    setNotice(null);

    try {
      const response = await apiFetch(
        `/api/ai_food/search-recipes?request=${encodeURIComponent(request)}&meal_type=${mealType}`,
        { method: "GET" },
      );
      if (!response?.recipe) throw new Error("The search endpoint did not return a saved recipe.");

      const recipe = normalizeRecipe(response.recipe);
      setSearchText("");
      setShowSearchSuggestions(false);
      const refreshed = await loadExplorerData("refresh");
      setSection("history");
      // Use the refreshed record so a duplicate recipe keeps its existing
      // Loved status and cooking metadata in the detail header.
      const canonicalRecipe = refreshed?.recipes.find((item) => item.id === recipe.id)
        ?? refreshed?.history.find((item) => item.id === recipe.id)
        ?? refreshed?.favourites.find((item) => item.id === recipe.id)
        ?? recipe;
      openRecipe(canonicalRecipe);
      showNotice("success", "Recipe found and added to My history.");
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "Recipe search failed.");
    } finally {
      searchLock.current = false;
      setSearching(false);
    }
  }

  const loadCookingHistory = useCallback(async (recipeId: number) => {
    setHistoryLoading(true);
    setHistoryError(null);
    setCookings([]);

    try {
      const response = await apiFetch(`/api/ai_food/recipes/${recipeId}/cookings`);
      setCookings(Array.isArray(response?.cookings) ? response.cookings : []);
    } catch (error: unknown) {
      setHistoryError(error instanceof Error ? error.message : "Could not load cooking history.");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  async function refreshViewedHistory() {
    const response = await apiFetch("/api/ai_food/recipes/history");
    const history = Array.isArray(response?.history)
      ? response.history.map((record: unknown) => normalizeRecipe(record))
      : [];
    setViewHistory(history);
  }

  function openRecipe(recipe: RecipeRecord) {
    setSelectedRecipe(recipe);
    setShowCookConfirmation(false);
    setShowCookingMode(false);
    setCookingStage("prep");
    setCookingStepIndex(0);
    setCompletedCookingSteps([]);
    resetStepTimer();
    setCookFeedback(null);
    setHistoryError(null);
    setNotice(null);

    // Opening a card records a unique recently-viewed recipe. Reopening it
    // moves it to the top; the backend trims the collection to ten entries.
    void (async () => {
      try {
        await apiFetch(`/api/ai_food/recipes/${recipe.id}/viewed`, { method: "POST" });
        await refreshViewedHistory();
      } catch (error: unknown) {
        console.warn("Could not record recipe view:", error);
        showNotice("error", "This recipe opened, but My history could not be updated.");
      }
    })();

    void loadCookingHistory(recipe.id);
  }

  function closeRecipe() {
    if (cooking) return;
    setSelectedRecipe(null);
    setCookings([]);
    setShowCookConfirmation(false);
    setShowCookingMode(false);
    setCookingStage("prep");
    setCookingStepIndex(0);
    setCompletedCookingSteps([]);
    resetStepTimer();
    setHistoryError(null);
    setCookFeedback(null);
  }

  function resetStepTimer() {
    setStepTimerRunning(false);
    setStepTimerRemaining(null);
    setStepTimerEndsAt(null);
  }

  function pauseStepTimer() {
    if (stepTimerRunning && stepTimerEndsAt !== null) {
      setStepTimerRemaining(Math.max(0, Math.ceil((stepTimerEndsAt - Date.now()) / 1000)));
    }
    setStepTimerRunning(false);
    setStepTimerEndsAt(null);
  }

  function startStepTimer(duration: number, restart = false) {
    const remaining = restart ? duration : (stepTimerRemaining ?? duration);
    setStepTimerRemaining(remaining);
    setStepTimerEndsAt(Date.now() + remaining * 1000);
    setStepTimerRunning(true);
  }

  function openCookingMode() {
    if (!selectedRecipe) return;
    if (!inventoryFresh || !selectedAvailability.canCook) {
      setCookFeedback({
        type: "error",
        message: !inventoryFresh
          ? "Refresh your fridge before starting so we can check your ingredients."
          : `You're missing: ${selectedAvailability.missing.join(", ")}.`,
      });
      return;
    }
    if (selectedRecipe.content.instructions.length === 0) {
      setCookFeedback({ type: "error", message: "This recipe does not have cooking steps yet." });
      return;
    }
    setCookFeedback(null);
    setCookingStage("prep");
    setCookingStepIndex(0);
    setCompletedCookingSteps([]);
    resetStepTimer();
    setShowCookingMode(true);
  }

  function closeCookingMode() {
    if (cooking) return;
    pauseStepTimer();
    setShowCookingMode(false);
  }

  function beginCookingSteps() {
    setCookingStage("steps");
    setCookingStepIndex(0);
    resetStepTimer();
  }

  function completeCurrentCookingStep() {
    if (!selectedRecipe || cookingStage !== "steps") return;
    if (cookingStepIndex < 0 || cookingStepIndex >= selectedRecipe.content.instructions.length) return;
    setCompletedCookingSteps((current) => (
      current.includes(cookingStepIndex) ? current : [...current, cookingStepIndex]
    ));
    resetStepTimer();

    if (cookingStepIndex >= selectedRecipe.content.instructions.length - 1) {
      setCookingStage("done");
    } else {
      setCookingStepIndex((current) => current + 1);
    }
  }

  function goToPreviousCookingStep() {
    if (!selectedRecipe || cookingStage !== "steps") return;
    setCookingStepIndex((current) => Math.max(0, Math.min(current - 1, selectedRecipe.content.instructions.length - 1)));
    resetStepTimer();
  }

  async function handleToggleFavourite(recipe: RecipeRecord) {
    if (favouriteBusyId !== null) return;
    setFavouriteBusyId(recipe.id);
    try {
      await apiFetch(
        `/api/ai_food/recipes/${recipe.id}/favourite`,
        { method: recipe.is_favourite ? "DELETE" : "POST" },
      );
      await loadExplorerData("refresh");
      showNotice(
        "success",
        recipe.is_favourite ? "Removed from Loved ones." : "Saved to Loved ones.",
      );
    } catch (error: unknown) {
      showNotice("error", error instanceof Error ? error.message : "Could not update Loved ones.");
    } finally {
      setFavouriteBusyId(null);
    }
  }

  async function confirmCooking(fromCookingMode = false): Promise<boolean> {
    if (!selectedRecipe || cooking) return false;

    const availability = inventoryFresh
      ? getRecipeAvailability(selectedRecipe, inventory)
      : { canCook: false, missing: ["Refresh your fridge to verify current stock"] };
    if (!availability.canCook) {
      setCookFeedback({
        type: "error",
        message: `Not enough ingredients: ${availability.missing.join(", ")}.`,
      });
      setShowCookConfirmation(false);
      return false;
    }

    const recipeId = selectedRecipe.id;
    setCooking(true);
    setCookFeedback(null);

    try {
      // Reuse the same key on uncertain retries; a later deliberate cook
      // receives a new key after the previous action succeeds.
      let idempotencyKey = pendingKeys.current[recipeId];
      if (!idempotencyKey) {
        idempotencyKey = (await getPendingCookKey(recipeId)) ?? createIdempotencyKey();
        await savePendingCookKey(recipeId, idempotencyKey);
        pendingKeys.current[recipeId] = idempotencyKey;
      }

      const response = await apiFetch(`/api/ai_food/recipes/${recipeId}/cooked`, {
        method: "POST",
        body: JSON.stringify({ idempotency_key: idempotencyKey }),
      });

      delete pendingKeys.current[recipeId];
      try {
        await clearPendingCookKey(recipeId);
      } catch (storageError) {
        console.warn("Could not clear the pending cooking key:", storageError);
      }

      setShowCookConfirmation(false);
      if (fromCookingMode) {
        resetStepTimer();
        setShowCookingMode(false);
        setCookingStage("prep");
        setCookingStepIndex(0);
        setCompletedCookingSteps([]);
      }
      // Force the UI to stop offering this recipe until fresh stock is confirmed.
      setInventoryFresh(false);
      notifyFridgeChanged("explore");

      const data = await loadExplorerData("refresh");
      await loadCookingHistory(recipeId);

      const updatedRecipe = data?.recipes.find((recipe) => recipe.id === recipeId)
        ?? data?.history.find((recipe) => recipe.id === recipeId)
        ?? data?.favourites.find((recipe) => recipe.id === recipeId);
      if (updatedRecipe) setSelectedRecipe(updatedRecipe);

      setCookFeedback({
        type: "success",
        message: response?.replayed
          ? "This cooking action was already recorded. Stock was not deducted twice."
          : "Recipe cooked! Your fridge and recipe availability are updated.",
      });
      return true;
    } catch (error: unknown) {
      // Keep the key for this same action if the server result is uncertain.
      setCookFeedback({
        type: "error",
        message: error instanceof Error ? error.message : "Could not confirm cooking.",
      });
      return false;
    } finally {
      setCooking(false);
    }
  }

  const selectedAvailability = selectedRecipe && inventoryFresh
    ? getRecipeAvailability(selectedRecipe, inventory)
    : {
        canCook: false,
        missing: inventoryFresh ? [] as string[] : ["Refresh your fridge to verify current stock"],
      };

  const currentCookingInstruction = selectedRecipe?.content.instructions[cookingStepIndex] ?? "";
  const currentCookingStepDuration = currentCookingInstruction
    ? getInstructionDurationSeconds(currentCookingInstruction)
    : null;
  const cookingStepCount = selectedRecipe?.content.instructions.length ?? 0;
  const cookingProgress = cookingStepCount > 0
    ? Math.round((completedCookingSteps.length / cookingStepCount) * 100)
    : 0;

  const sections: Array<{
    value: CollectionSection;
    label: string;
    icon: keyof typeof Ionicons.glyphMap;
    count: number;
  }> = [
    { value: "fridge", label: "From my fridge", icon: "leaf-outline", count: fromFridgeRecipes.length },
    { value: "history", label: "My history", icon: "time-outline", count: viewHistory.length },
    { value: "loved", label: "Loved ones", icon: "heart-outline", count: favourites.length },
  ];

  return (
    <SafeAreaView className="flex-1 bg-light-300" edges={["top", "left", "right"]}>
      <ScrollView
        className="w-full flex-1"
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 116 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void loadExplorerData("refresh")}
            tintColor={colors.secondary}
            colors={[colors.secondary]}
          />
        }
      >
        <View
          className="w-full self-stretch pt-3"
          style={{ paddingHorizontal: horizontalPadding, maxWidth: 760, alignSelf: "center" }}
        >
          {/* PAGE HEADER */}
          <View className="mb-5 flex-row items-center justify-between">
            <View className="flex-1 pr-4">
              <Text className="mb-1 text-[10px] font-extrabold tracking-[2px] text-dark-300">
                A LITTLE INSPIRATION
              </Text>
              <Text className={`${isCompactScreen ? "text-2xl" : "text-3xl"} font-black tracking-tight text-secondary`}>
                Explore
              </Text>
              <Text className="mt-1 text-xs text-dark-300">
                Good food starts with what you have.
              </Text>
            </View>
            <Pressable
              onPress={() => {
                setShowRecipePreferences(true);
                void loadRecipePreferences();
              }}
              className="h-12 w-12 items-center justify-center rounded-2xl border border-primary bg-light-100 active:opacity-70"
              accessibilityRole="button"
              accessibilityLabel="Open recipe preferences filter"
            >
              <Ionicons name="options-outline" size={23} color={colors.secondary} />
            </Pressable>
          </View>

          {/* MEAL TYPE */}
          <View className="mb-4 rounded-2xl border border-light-100 bg-light-200 p-3">
            <Text className="mb-2 text-[10px] font-extrabold tracking-wider text-dark-300">
              WHAT ARE WE MAKING?
            </Text>
            <View className="flex-row gap-2">
              {([
                { value: "breakfast", label: "Breakfast", icon: "sunny-outline" },
                { value: "lunch", label: "Lunch", icon: "restaurant-outline" },
                { value: "dinner", label: "Dinner", icon: "moon-outline" },
              ] as const).map((meal) => {
                const active = mealType === meal.value;
                return (
                  <Pressable
                    key={meal.value}
                    onPress={() => setMealType(meal.value)}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    className={`min-h-11 flex-1 flex-row items-center justify-center gap-1.5 rounded-xl px-2 ${active ? "bg-secondary" : "bg-light-300"}`}
                  >
                    <Ionicons
                      name={meal.icon}
                      size={15}
                      color={active ? colors.light[300] : colors.dark[300]}
                    />
                    <Text className={`text-[10px] font-extrabold ${active ? "text-light-300" : "text-dark-300"}`}>
                      {meal.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* SEARCH WITH LIVE SUGGESTIONS */}
          <View className="z-20 mb-5">
            <View className="flex-row items-center rounded-2xl border border-light-100 bg-white px-3 py-2">
              <Ionicons name="search-outline" size={19} color={colors.dark[300]} />
              <TextInput
                value={searchText}
                onChangeText={(value) => {
                  setSearchText(value);
                  setShowSearchSuggestions(value.trim().length > 0);
                }}
                onFocus={() => setShowSearchSuggestions(searchText.trim().length > 0)}
                onSubmitEditing={() => void handleSearch()}
                returnKeyType="search"
                placeholder="Find a dish or ingredient..."
                placeholderTextColor={colors.dark[300]}
                className="h-10 flex-1 px-3 text-sm text-secondary"
                maxLength={200}
                editable={!searching && !generating && !generatingSelected}
              />
              {searchText.length > 0 && (
                <Pressable onPress={() => { setSearchText(""); setShowSearchSuggestions(false); }} hitSlop={8} className="mr-2">
                  <Ionicons name="close-circle" size={18} color={colors.dark[300]} />
                </Pressable>
              )}
              <Pressable
                onPress={() => void handleSearch()}
                disabled={searching || generating || generatingSelected}
                className={`h-10 w-10 items-center justify-center rounded-xl bg-secondary ${searching || generating || generatingSelected ? "opacity-50" : ""}`}
                accessibilityRole="button"
                accessibilityLabel="Search recipes"
              >
                {searching
                  ? <ActivityIndicator size="small" color={colors.light[300]} />
                  : <Ionicons name="arrow-forward" size={18} color={colors.light[300]} />}
              </Pressable>
            </View>
            {showSearchSuggestions && searchSuggestions.length > 0 && (
              <View className="mt-1 overflow-hidden rounded-2xl border border-light-100 bg-white shadow-sm">
                {searchSuggestions.map((suggestion, index) => (
                  <Pressable
                    key={`${suggestion}-${index}`}
                    onPress={() => void handleSearch(suggestion)}
                    disabled={searching || generating || generatingSelected}
                    className={`min-h-11 flex-row items-center gap-3 px-4 py-3 ${index < searchSuggestions.length - 1 ? "border-b border-light-100" : ""}`}
                  >
                    <View className="h-7 w-7 items-center justify-center rounded-lg bg-light-200">
                      <Ionicons name={suggestion === searchText.trim() ? "search" : "restaurant-outline"} size={14} color={colors.secondary} />
                    </View>
                    <Text className="flex-1 text-xs font-semibold text-secondary" numberOfLines={1}>{suggestion}</Text>
                    <Ionicons name="arrow-up" size={14} color={colors.dark[300]} />
                  </Pressable>
                ))}
              </View>
            )}
          </View>

          {/* PRIMARY ACTION: CHOOSE EXACTLY WHAT TO COOK */}
          <Pressable
            onPress={() => {
              setSelectedIngredientIds([]);
              setShowIngredientPicker(true);
            }}
            disabled={!inventoryFresh || generating || generatingSelected || searching}
            className={`mb-5 overflow-hidden rounded-[26px] border border-primary bg-light-200 p-4 ${!inventoryFresh || generating || generatingSelected || searching ? "opacity-60" : "active:opacity-80"}`}
            accessibilityRole="button"
            accessibilityLabel="Choose ingredients for a custom recipe"
          >
            <View className="flex-row items-center">
              <View className="mr-3 h-14 w-14 items-center justify-center rounded-2xl bg-neutral">
                <Ionicons name="options-outline" size={25} color={colors.secondary} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-base font-black text-secondary">What do you want to cook?</Text>
                <Text className="mt-1 text-[10px] leading-4 text-dark-300">
                  Choose exactly what goes into your next meal.
                </Text>
              </View>
              <View className="h-9 w-9 items-center justify-center rounded-full bg-light-300">
                <Ionicons name="arrow-forward" size={17} color={colors.secondary} />
              </View>
            </View>
            <View className="mt-4 flex-row items-center gap-2">
              <View className="rounded-full bg-white/80 px-3 py-1.5"><Text className="text-[9px] font-extrabold text-secondary">YOUR INGREDIENTS</Text></View>
              <View className="rounded-full bg-white/80 px-3 py-1.5"><Text className="text-[9px] font-extrabold text-secondary">YOUR CHOICE</Text></View>
              <Text className="ml-auto text-[9px] font-bold text-dark-300">{inventory.length} in stock</Text>
            </View>
          </Pressable>

          {/* FEEDBACK */}
          {notice && (
            <View className={`mb-4 flex-row items-center gap-2 rounded-2xl p-3 ${notice.type === "success" ? "bg-[#E7EDDF]" : notice.type === "error" ? "bg-[#F5E3E0]" : "bg-light-100"}`}>
              <Ionicons
                name={notice.type === "success" ? "checkmark-circle" : notice.type === "error" ? "alert-circle" : "information-circle"}
                size={19}
                color={colors.secondary}
              />
              <Text className="flex-1 text-xs leading-5 text-secondary">{notice.message}</Text>
              <Pressable onPress={() => setNotice(null)} hitSlop={8}>
                <Ionicons name="close" size={17} color={colors.secondary} />
              </Pressable>
            </View>
          )}

          {/* THREE COLLECTIONS */}
          <View className="mb-3">
            <Text className="text-xl font-black text-secondary">Your collections</Text>
            <Text className="mt-1 text-[11px] text-dark-300">{sectionDescription}</Text>
          </View>

          <View className="mb-4 flex-row rounded-2xl bg-light-200 p-1">
            {sections.map((item) => {
              const active = section === item.value;
              return (
                <Pressable
                  key={item.value}
                  onPress={() => setSection(item.value)}
                  className={`min-w-0 flex-1 items-center justify-center rounded-xl px-1.5 py-2.5 ${active ? "bg-neutral" : "bg-transparent"}`}
                  accessibilityRole="tab"
                  accessibilityState={{ selected: active }}
                >
                  <Ionicons
                    name={item.icon}
                    size={16}
                    color={active ? colors.secondary : colors.dark[300]}
                  />
                  <Text
                    numberOfLines={1}
                    className={`mt-1 text-center text-[9px] font-extrabold ${active ? "text-secondary" : "text-dark-300"}`}
                  >
                    {item.label}
                  </Text>
                  <Text className={`mt-0.5 text-[8px] font-bold ${active ? "text-secondary" : "text-dark-300"}`}>
                    {item.count}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {/* COLLECTION HEADING + REFRESH */}
          <View className="mb-3 flex-row items-center justify-between">
            <View className="flex-1 pr-3">
              <Text className="text-base font-black text-secondary">{sectionTitle}</Text>
              <Text className="mt-0.5 text-[10px] text-dark-300">
                {section === "fridge"
                  ? `${fromFridgeRecipes.length} ready to cook with current stock`
                  : section === "history"
                    ? `${viewHistory.length} of 10 recent recipes`
                    : `${favourites.length} saved favourites`}
              </Text>
            </View>
            {section === "fridge" && (
              <Pressable
                onPress={() => void handleGenerate(3)}
                disabled={generating || generatingSelected || searching || !inventoryFresh || inventory.length === 0}
                className={`min-h-10 flex-row items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 ${generating || generatingSelected || searching || !inventoryFresh || inventory.length === 0 ? "opacity-50" : "active:opacity-80"}`}
                accessibilityRole="button"
                accessibilityLabel="Generate three more recipes from my fridge"
              >
                {generating
                  ? <ActivityIndicator size="small" color={colors.light[300]} />
                  : <Ionicons name="sparkles-outline" size={14} color={colors.light[300]} />}
                <Text className="text-[10px] font-black text-light-300">{generating ? "Creating..." : "3 more"}</Text>
              </Pressable>
            )}
          </View>

          {/* RECIPE FEED */}
          {loading ? (
            <View className="items-center justify-center rounded-3xl bg-light-200 py-14">
              <ActivityIndicator size="large" color={colors.secondary} />
              <Text className="mt-3 text-xs font-semibold text-dark-300">Setting the table...</Text>
            </View>
          ) : loadError ? (
            <View className="items-center rounded-3xl bg-light-200 px-6 py-8">
              <View className="mb-3 h-14 w-14 items-center justify-center rounded-2xl bg-neutral">
                <Ionicons name="cloud-offline-outline" size={26} color={colors.secondary} />
              </View>
              <Text className="text-center text-base font-extrabold text-secondary">Couldn't load Explorer</Text>
              <Text className="mt-2 text-center text-xs leading-5 text-dark-300">{loadError}</Text>
              <Pressable
                onPress={() => void loadExplorerData("initial")}
                className="mt-4 rounded-xl bg-secondary px-5 py-3"
              >
                <Text className="text-xs font-extrabold text-light-300">Try again</Text>
              </Pressable>
            </View>
          ) : visibleRecipes.length === 0 ? (
            <View className="items-center rounded-3xl bg-light-200 px-6 py-9">
              <View className="mb-4 h-16 w-16 items-center justify-center rounded-2xl bg-neutral">
                <Ionicons
                  name={section === "fridge" ? "basket-outline" : section === "history" ? "time-outline" : "heart-outline"}
                  size={29}
                  color={colors.secondary}
                />
              </View>
              <Text className="text-center text-lg font-black text-secondary">
                {section === "fridge"
                  ? "Nothing ready to cook just yet"
                  : section === "history"
                    ? "Your history starts here"
                    : "Keep the recipes you love"}
              </Text>
              <Text className="mt-2 text-center text-xs leading-5 text-dark-300">
                {section === "fridge"
                  ? "Generate fresh ideas or add ingredients to your fridge. Recipes appear here only when you have enough stock."
                  : section === "history"
                    ? "Recipes you search for or open appear here. We keep your ten most recent unique recipes."
                    : "Tap the heart on a recipe card to keep it in Loved ones."}
              </Text>
              {section === "fridge" && (
                <Pressable
                  onPress={() => void handleGenerate(3)}
                  disabled={generating || generatingSelected || searching}
                  className="mt-5 rounded-xl bg-secondary px-5 py-3"
                >
                  <Text className="text-xs font-extrabold text-light-300">
                    {generating
                      ? "Creating recipes..."
                      : "Generate 3 more recipes"}
                  </Text>
                </Pressable>
              )}
            </View>
          ) : (
            <View>
              {visibleRecipes.map((recipe) => {
                const availability = getRecipeAvailability(recipe, inventory);
                return (
                  <RecipeCard
                    key={recipe.id}
                    recipe={recipe}
                    canCook={availability.canCook}
                    missing={availability.missing}
                    favouriteBusy={favouriteBusyId === recipe.id}
                    onPress={() => openRecipe(recipe)}
                    onToggleFavourite={() => void handleToggleFavourite(recipe)}
                  />
                );
              })}
            </View>
          )}

          <View className="flex-row items-center justify-center gap-2 pb-4 pt-6">
            <Ionicons name="heart-outline" size={14} color={colors.dark[300]} />
            <Text className="text-[10px] italic text-dark-300">A little less waste. A lot more delicious.</Text>
          </View>
        </View>
      </ScrollView>

      {/* SELECT INGREDIENTS FOR A CUSTOM RECIPE */}
      <Modal
        visible={showIngredientPicker}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!generatingSelected) setShowIngredientPicker(false);
        }}
      >
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 bg-light-300" edges={["top", "bottom", "left", "right"]}>
          <View className="flex-row items-center justify-between border-b border-light-100 px-4 py-3">
            <Pressable
              onPress={() => setShowIngredientPicker(false)}
              disabled={generatingSelected}
              className="h-10 w-10 items-center justify-center rounded-xl bg-light-100"
              accessibilityRole="button"
              accessibilityLabel="Close ingredient selection"
            >
              <Ionicons name="close" size={22} color={colors.secondary} />
            </Pressable>
            <Text className="flex-1 text-center text-[10px] font-black tracking-[1.5px] text-secondary">
              YOUR INGREDIENT SELECTION
            </Text>
            <View className="h-10 w-10" />
          </View>

          <View className="px-4 pb-2 pt-4">
            <Text className="text-2xl font-black text-secondary">What do you want to cook?</Text>
            <Text className="mt-1 text-xs leading-5 text-dark-300">
              Select the ingredients you want to use. Recipes will be made using only this selection.
            </Text>
            <View className="mt-3 flex-row items-center justify-between rounded-xl bg-light-200 px-3 py-2">
              <Text className="text-[11px] font-bold text-secondary">
                {selectedIngredientIds.length} selected
              </Text>
              <Pressable onPress={() => setSelectedIngredientIds([])} disabled={selectedIngredientIds.length === 0}>
                <Text className={`text-[10px] font-extrabold ${selectedIngredientIds.length ? "text-secondary" : "text-dark-300"}`}>
                  Clear selection
                </Text>
              </Pressable>
            </View>
          </View>

          <ScrollView
            className="flex-1 px-4"
            contentContainerStyle={{ paddingBottom: 18 }}
            showsVerticalScrollIndicator={false}
          >
            {!inventoryFresh ? (
              <View className="items-center rounded-2xl bg-light-200 px-5 py-8">
                <ActivityIndicator color={colors.secondary} />
                <Text className="mt-3 text-xs text-dark-300">Refreshing your fridge...</Text>
              </View>
            ) : inventory.length === 0 ? (
              <View className="items-center rounded-2xl bg-light-200 px-5 py-8">
                <Ionicons name="basket-outline" size={30} color={colors.secondary} />
                <Text className="mt-3 text-sm font-extrabold text-secondary">Your fridge is empty</Text>
                <Text className="mt-1 text-center text-xs text-dark-300">Add ingredients before creating a recipe.</Text>
              </View>
            ) : (
              inventory.map((item) => {
                const selected = selectedIngredientIds.includes(item.ingredient_id);
                return (
                  <Pressable
                    key={item.ingredient_id}
                    onPress={() => toggleSelectedIngredient(item.ingredient_id)}
                    className={`mb-2 flex-row items-center rounded-2xl border p-3 ${selected ? "border-neutral bg-[#E7EDDF]" : "border-light-100 bg-light-200"}`}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: selected }}
                  >
                    <View className={`mr-3 h-10 w-10 items-center justify-center rounded-xl ${selected ? "bg-neutral" : "bg-light-100"}`}>
                      <Ionicons name="restaurant-outline" size={19} color={colors.secondary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs font-extrabold text-secondary" numberOfLines={2}>{item.name}</Text>
                      <Text className="mt-1 text-[10px] text-dark-300">
                        Available: {item.quantity} {item.unit}
                      </Text>
                    </View>
                    <View className={`ml-2 h-6 w-6 items-center justify-center rounded-full border ${selected ? "border-neutral bg-neutral" : "border-dark-200 bg-transparent"}`}>
                      {selected && <Ionicons name="checkmark" size={15} color={colors.secondary} />}
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View
            className="border-t border-light-100 bg-light-300 px-4 pt-3"
            style={{ paddingBottom: Math.max(insets.bottom, 12) }}
          >
            <Pressable
              onPress={() => void handleGenerateSelected()}
              disabled={generatingSelected || generating || searching || !inventoryFresh || selectedIngredientIds.length === 0}
              className={`h-12 w-full flex-row items-center justify-center gap-2 rounded-2xl bg-secondary px-4 ${generatingSelected || !inventoryFresh || selectedIngredientIds.length === 0 ? "opacity-50" : "active:opacity-80"}`}
              accessibilityRole="button"
              accessibilityLabel="Generate five recipes using only the selected ingredients"
            >
              {generatingSelected
                ? <ActivityIndicator size="small" color={colors.light[300]} />
                : <Ionicons name="sparkles" size={17} color={colors.light[300]} />}
              <Text className="text-sm font-black text-light-300">
                {generatingSelected ? "Creating your recipes..." : "Create up to 5 recipes"}
              </Text>
            </Pressable>
            <Text className="mt-2 text-center text-[9px] text-dark-300">
              Only selected ingredients will be sent for recipe creation.
            </Text>
          </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {/* RECIPE PREFERENCES FILTER */}
      <Modal
        visible={showRecipePreferences}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => setShowRecipePreferences(false)}
      >
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 bg-light-300" edges={["top", "bottom", "left", "right"]}>
            <View className="flex-row items-center justify-between border-b border-light-100 px-4 py-3">
              <Pressable
                onPress={() => setShowRecipePreferences(false)}
                disabled={savingPreferences}
                className="h-10 w-10 items-center justify-center rounded-xl bg-light-100"
                accessibilityRole="button"
                accessibilityLabel="Close recipe preferences"
              >
                <Ionicons name="close" size={22} color={colors.secondary} />
              </Pressable>
              <Text className="flex-1 text-center text-[10px] font-black tracking-[1.5px] text-secondary">
                RECIPE PREFERENCES
              </Text>
              <View className="h-10 w-10" />
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingHorizontal: horizontalPadding, paddingTop: 20, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              <Text className="text-2xl font-black text-secondary">Make recipes fit you</Text>
              <Text className="mt-1 text-xs leading-5 text-dark-300">
                These settings guide new AI-generated recipes and searches. Allergies are treated as ingredients to avoid; cuisine and diet choices guide the style of food.
              </Text>

              {preferencesLoading ? (
                <View className="mt-6 items-center rounded-2xl bg-light-200 py-8">
                  <ActivityIndicator color={colors.secondary} />
                  <Text className="mt-2 text-xs text-dark-300">Loading your preferences...</Text>
                </View>
              ) : (
                <>
                  <View className="mt-6">
                    <Text className="text-sm font-black text-secondary">Allergies and ingredients to avoid</Text>
                    <Text className="mt-1 text-[10px] leading-4 text-dark-300">Select every allergen that recipes must exclude. You can also add a custom item.</Text>
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {ALLERGY_OPTIONS.map((option) => {
                        const selected = recipePreferences.allergies.includes(option);
                        return (
                          <Pressable
                            key={option}
                            onPress={() => toggleRecipePreference("allergies", option)}
                            className={`rounded-full border px-3 py-2 ${selected ? "border-secondary bg-secondary" : "border-light-100 bg-light-200"}`}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected }}
                          >
                            <Text className={`text-[10px] font-bold ${selected ? "text-light-300" : "text-secondary"}`}>{option}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <View className="mt-3 flex-row items-center rounded-xl border border-light-100 bg-light-200 px-3">
                      <TextInput
                        value={customAllergy}
                        onChangeText={setCustomAllergy}
                        placeholder="Add another ingredient to avoid"
                        placeholderTextColor={colors.dark[300]}
                        className="h-11 min-w-0 flex-1 text-xs text-secondary"
                        maxLength={60}
                        returnKeyType="done"
                        onSubmitEditing={addCustomAllergy}
                      />
                      <Pressable onPress={addCustomAllergy} className="ml-2 rounded-lg bg-neutral px-3 py-2">
                        <Text className="text-[10px] font-black text-secondary">ADD</Text>
                      </Pressable>
                    </View>
                    {recipePreferences.allergies.filter((value) => !ALLERGY_OPTIONS.includes(value)).length > 0 && (
                      <View className="mt-2 flex-row flex-wrap gap-2">
                        {recipePreferences.allergies.filter((value) => !ALLERGY_OPTIONS.includes(value)).map((value) => (
                          <Pressable key={value} onPress={() => toggleRecipePreference("allergies", value)} className="flex-row items-center rounded-full bg-secondary px-3 py-2">
                            <Text className="text-[10px] font-bold text-light-300">{value}</Text>
                            <Ionicons name="close" size={12} color={colors.light[300]} style={{ marginLeft: 5 }} />
                          </Pressable>
                        ))}
                      </View>
                    )}
                  </View>

                  <View className="mt-7 border-t border-light-100 pt-5">
                    <Text className="text-sm font-black text-secondary">Preferred cuisines</Text>
                    <Text className="mt-1 text-[10px] leading-4 text-dark-300">Choose one or more styles. Leave empty for no cuisine preference.</Text>
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {CUISINE_OPTIONS.map((option) => {
                        const selected = recipePreferences.cuisines.includes(option);
                        return (
                          <Pressable
                            key={option}
                            onPress={() => toggleRecipePreference("cuisines", option)}
                            className={`rounded-full border px-3 py-2 ${selected ? "border-secondary bg-secondary" : "border-light-100 bg-light-200"}`}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected }}
                          >
                            <Text className={`text-[10px] font-bold ${selected ? "text-light-300" : "text-secondary"}`}>{option}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  </View>

                  <View className="mt-7 border-t border-light-100 pt-5">
                    <Text className="text-sm font-black text-secondary">Dietary preferences</Text>
                    <Text className="mt-1 text-[10px] leading-4 text-dark-300">Choose dietary patterns that should shape your recipes. Avoid selecting conflicting diets together.</Text>
                    <View className="mt-3 flex-row flex-wrap gap-2">
                      {DIET_OPTIONS.map((option) => {
                        const selected = recipePreferences.diets.includes(option);
                        return (
                          <Pressable
                            key={option}
                            onPress={() => toggleRecipePreference("diets", option)}
                            className={`rounded-full border px-3 py-2 ${selected ? "border-secondary bg-secondary" : "border-light-100 bg-light-200"}`}
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: selected }}
                          >
                            <Text className={`text-[10px] font-bold ${selected ? "text-light-300" : "text-secondary"}`}>{option}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    <Pressable
                      onPress={() => setRecipePreferences((current) => ({ ...current, gluten_free: !current.gluten_free }))}
                      className={`mt-4 flex-row items-center justify-between rounded-2xl border px-4 py-3 ${recipePreferences.gluten_free ? "border-secondary bg-[#E7EDDF]" : "border-light-100 bg-light-200"}`}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: recipePreferences.gluten_free }}
                    >
                      <View className="min-w-0 flex-1 pr-3">
                        <Text className="text-xs font-extrabold text-secondary">Gluten-free</Text>
                        <Text className="mt-0.5 text-[9px] leading-4 text-dark-300">Exclude wheat, barley, rye and other gluten sources.</Text>
                      </View>
                      <View className={`h-6 w-11 justify-center rounded-full px-1 ${recipePreferences.gluten_free ? "bg-secondary" : "bg-dark-200"}`}>
                        <View className={`h-4 w-4 rounded-full bg-light-300 ${recipePreferences.gluten_free ? "self-end" : "self-start"}`} />
                      </View>
                    </Pressable>
                  </View>

                  <View className="mt-5 rounded-2xl bg-neutral px-4 py-3">
                    <View className="flex-row items-center">
                      <Ionicons name="information-circle-outline" size={16} color={colors.secondary} />
                      <Text className="ml-2 text-[10px] font-black text-secondary">How this works</Text>
                    </View>
                    <Text className="mt-1 text-[10px] leading-4 text-dark-300">
                      Your settings are saved to your existing preferences table and used when the backend creates new recipes. They do not change recipes you have already saved.
                    </Text>
                  </View>
                </>
              )}

              {preferencesError && (
                <View className="mt-4 rounded-xl border border-[#E8C9C2] bg-[#F8ECE8] px-3 py-2.5">
                  <Text className="text-[10px] leading-4 text-[#8F5148]">{preferencesError}</Text>
                </View>
              )}
            </ScrollView>

            <View className="border-t border-light-100 bg-light-300 px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <Pressable
                onPress={() => void saveRecipePreferences()}
                disabled={preferencesLoading || savingPreferences}
                className={`h-12 flex-row items-center justify-center rounded-2xl bg-secondary ${preferencesLoading || savingPreferences ? "opacity-50" : "active:opacity-80"}`}
                accessibilityRole="button"
                accessibilityLabel="Save recipe preferences"
              >
                {savingPreferences ? <ActivityIndicator size="small" color={colors.light[300]} /> : <Ionicons name="checkmark" size={17} color={colors.light[300]} />}
                <Text className="ml-2 text-sm font-black text-light-300">{savingPreferences ? "Saving preferences..." : "Save preferences"}</Text>
              </Pressable>
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>

      {/* RECIPE DETAIL */}
      <Modal
        visible={selectedRecipe !== null && !showCookingMode}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeRecipe}
      >
        {selectedRecipe && (
          <SafeAreaProvider>
            <SafeAreaView className="flex-1 bg-light-300" edges={["top", "bottom", "left", "right"]}>
              {/* Same left-side position and 40px touch target as Fridge header controls. */}
              <View className="flex-row items-center justify-between border-b border-light-100 px-4 py-3">
                <Pressable
                  onPress={closeRecipe}
                  disabled={cooking}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-light-100 active:opacity-70"
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Close recipe details"
                >
                  <Ionicons name="close" size={23} color={colors.secondary} />
                </Pressable>
                <Text className="flex-1 text-center text-[10px] font-black tracking-[2px] text-secondary">
                  RECIPE DETAILS
                </Text>
                <Pressable
                  onPress={() => void handleToggleFavourite(selectedRecipe)}
                  disabled={favouriteBusyId === selectedRecipe.id}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-light-100"
                  accessibilityRole="button"
                  accessibilityLabel={selectedRecipe.is_favourite ? "Remove from Loved ones" : "Add to Loved ones"}
                >
                  <Ionicons
                    name={selectedRecipe.is_favourite ? "heart" : "heart-outline"}
                    size={21}
                    color={selectedRecipe.is_favourite ? colors.secondary : colors.dark[300]}
                  />
                </Pressable>
              </View>

              <ScrollView
                className="flex-1"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{
                  paddingHorizontal: horizontalPadding,
                  paddingBottom: 24,
                  width: "100%",
                  maxWidth: 760,
                  alignSelf: "center",
                }}
              >
                <View className="pt-4">
                  <RecipeArtwork imageUrl={selectedRecipe.content.image_url} large />
                </View>

                <View className="mb-2 mt-4 flex-row items-center justify-between gap-3">
                  <View className={`rounded-full px-3 py-1.5 ${selectedRecipe.source === "search" ? "bg-light-100" : selectedRecipe.source === "selected" ? "bg-primary" : "bg-neutral"}`}>
                    <Text className="text-[9px] font-black tracking-wide text-secondary">
                      {selectedRecipe.source === "search" ? "YOUR SEARCH" : selectedRecipe.source === "selected" ? "YOUR PICKS" : "FROM YOUR FRIDGE"}
                    </Text>
                  </View>
                  <Text className="text-[10px] text-dark-300">Added {formatDateTime(selectedRecipe.created_at)}</Text>
                </View>

                <Text className="text-3xl font-black leading-9 text-secondary">
                  {selectedRecipe.content.title}
                </Text>
                <Text className="mt-2 text-sm leading-6 text-dark-300">
                  {selectedRecipe.content.description}
                </Text>

                {/* QUICK FACTS */}
                <View className="mt-5 flex-row gap-2">
                  <View className="flex-1 items-center rounded-2xl border border-light-100 bg-light-200 py-3">
                    <Ionicons name="time-outline" size={19} color={colors.secondary} />
                    <Text className="mt-1 text-xs font-black text-secondary">{selectedRecipe.content.cooking_time || "—"} min</Text>
                    <Text className="mt-1 text-[8px] font-extrabold tracking-wider text-dark-300">TIME</Text>
                  </View>
                  <View className="flex-1 items-center rounded-2xl border border-light-100 bg-light-200 py-3">
                    <Ionicons name="speedometer-outline" size={19} color={colors.secondary} />
                    <Text className="mt-1 text-xs font-black text-secondary">{selectedRecipe.content.difficulty}</Text>
                    <Text className="mt-1 text-[8px] font-extrabold tracking-wider text-dark-300">LEVEL</Text>
                  </View>
                  <View className="flex-1 items-center rounded-2xl border border-light-100 bg-light-200 py-3">
                    <Ionicons name="people-outline" size={19} color={colors.secondary} />
                    <Text className="mt-1 text-xs font-black text-secondary">{selectedRecipe.content.servings}</Text>
                    <Text className="mt-1 text-[8px] font-extrabold tracking-wider text-dark-300">SERVINGS</Text>
                  </View>
                </View>

                {/* INGREDIENTS */}
                <View className="mt-7">
                  <View className="mb-3 flex-row items-center justify-between">
                    <Text className="text-xl font-black text-secondary">Ingredients</Text>
                    <Text className="text-[10px] font-bold text-dark-300">
                      {selectedRecipe.content.ingredients.length} items
                    </Text>
                  </View>
                  {selectedRecipe.content.ingredients.map((ingredient, index) => {
                    const stock = ingredient.ingredient_id === null
                      ? undefined
                      : inventory.find((item) => item.ingredient_id === ingredient.ingredient_id);
                    const enough = Boolean(
                      stock
                      && stock.unit.trim().toLowerCase() === ingredient.unit.trim().toLowerCase()
                      && stock.quantity >= ingredient.quantity
                      && ingredient.is_available !== false,
                    );
                    return (
                      <View key={`${ingredient.ingredient_id ?? "missing"}-${index}`} className="mb-2 flex-row items-center rounded-2xl bg-light-200 p-3">
                        <View className={`mr-3 h-8 w-8 items-center justify-center rounded-xl ${enough ? "bg-neutral" : "bg-[#F5E3E0]"}`}>
                          <Ionicons
                            name={enough ? "checkmark" : "alert-outline"}
                            size={16}
                            color={colors.secondary}
                          />
                        </View>
                        <View className="min-w-0 flex-1">
                          <Text className="text-xs font-extrabold text-secondary">{ingredient.name}</Text>
                          <Text className="mt-0.5 text-[9px] text-dark-300">
                            {stock ? `In ${storageLocationLabel(stock.storage_location)}: ${stock.quantity} ${stock.unit}` : "Not in your storage"}
                          </Text>
                        </View>
                        <Text className="ml-2 text-xs font-black text-secondary">
                          {ingredient.quantity} {ingredient.unit}
                        </Text>
                      </View>
                    );
                  })}
                </View>

                {/* INSTRUCTIONS */}
                <View className="mt-7">
                  <Text className="mb-4 text-xl font-black text-secondary">Let's make it</Text>
                  {selectedRecipe.content.instructions.map((instruction, index) => (
                    <View key={`${index}-${instruction.slice(0, 18)}`} className="mb-4 flex-row items-start gap-3">
                      <View className="h-8 w-8 items-center justify-center rounded-xl bg-neutral">
                        <Text className="text-xs font-black text-secondary">{index + 1}</Text>
                      </View>
                      <Text className="flex-1 pt-1 text-xs leading-5 text-dark-300">{instruction}</Text>
                    </View>
                  ))}
                </View>

                {/* NUTRITION */}
                {selectedRecipe.content.nutrition && (
                  <View className="mt-3">
                    <Text className="mb-3 text-xl font-black text-secondary">Estimated nutrition</Text>
                    <View className="flex-row flex-wrap gap-2">
                      {([
                        ["Calories", selectedRecipe.content.nutrition.calories, "kcal"],
                        ["Protein", selectedRecipe.content.nutrition.protein, "g"],
                        ["Carbs", selectedRecipe.content.nutrition.carbs, "g"],
                        ["Fat", selectedRecipe.content.nutrition.fat, "g"],
                      ] as Array<[string, number | undefined, string]>).map(([label, value, unit]) => (
                        <View key={label} className="w-[48%] rounded-2xl bg-light-200 p-3">
                          <Text className="text-lg font-black text-secondary">
                            {value ?? "—"}<Text className="text-[10px] font-bold text-dark-300"> {unit}</Text>
                          </Text>
                          <Text className="mt-1 text-[10px] text-dark-300">{label}</Text>
                        </View>
                      ))}
                    </View>
                    <Text className="mt-2 text-[9px] leading-4 text-dark-300">
                      Nutrition values are estimates and may vary by ingredient and preparation.
                    </Text>
                  </View>
                )}

                {/* COOKING HISTORY */}
                <View className="mt-7 rounded-3xl bg-light-200 p-4">
                  <View className="mb-2 flex-row items-center justify-between">
                    <Text className="text-lg font-black text-secondary">Cooking history</Text>
                    <View className="rounded-xl bg-neutral px-3 py-1.5">
                      <Text className="text-xs font-black text-secondary">{selectedRecipe.cooking_count}×</Text>
                    </View>
                  </View>
                  <Text className="text-[11px] leading-5 text-dark-300">
                    {selectedRecipe.cooking_count === 0
                      ? "This one is waiting for its first kitchen moment."
                      : `You've made this ${selectedRecipe.cooking_count} time${selectedRecipe.cooking_count === 1 ? "" : "s"}. Last cooked ${formatDateTime(selectedRecipe.last_cooked_at)}.`}
                  </Text>

                  {historyLoading ? (
                    <ActivityIndicator color={colors.secondary} className="mt-3" />
                  ) : historyError ? (
                    <Text className="mt-3 text-xs text-secondary">{historyError}</Text>
                  ) : cookings.length > 0 ? (
                    <View className="mt-3">
                      {cookings.slice(0, 5).map((event) => (
                        <View key={event.id} className="flex-row items-start gap-3 border-t border-light-100 py-3">
                          <View className="mt-1.5 h-2 w-2 rounded-full bg-neutral" />
                          <View className="flex-1">
                            <Text className="text-[11px] font-extrabold text-secondary">{formatDateTime(event.cooked_at)}</Text>
                            <Text className="mt-1 text-[9px] text-dark-300">
                              {event.is_legacy
                                ? "Earlier cooking record"
                                : `${event.deducted_ingredients?.length ?? 0} ingredient types used`}
                            </Text>
                          </View>
                        </View>
                      ))}
                    </View>
                  ) : null}
                </View>

                <View className="mb-2 mt-5 flex-row items-center justify-between border-t border-light-100 py-3">
                  <Text className="text-[10px] font-bold text-dark-300">Last cooked</Text>
                  <Text className="text-[10px] font-extrabold text-secondary">{formatDateTime(selectedRecipe.last_cooked_at)}</Text>
                </View>
              </ScrollView>

              {/* COMPACT STICKY COOK ACTION AREA */}
              <View
                className="w-full border-t border-light-100 bg-light-300 px-3 pt-2 pb-0"
                style={{ paddingHorizontal: horizontalPadding, paddingBottom: 0 }}
              >
                {cookFeedback && (
                  <View className={`mb-2 w-full flex-row items-center gap-2 rounded-lg px-2.5 py-2 ${cookFeedback.type === "success" ? "bg-[#E7EDDF]" : "bg-[#F5E3E0]"}`}>
                    <Ionicons
                      name={cookFeedback.type === "success" ? "checkmark-circle" : "alert-circle"}
                      size={15}
                      color={colors.secondary}
                    />
                    <Text className="min-w-0 flex-1 text-left text-[10px] leading-4 text-secondary">{cookFeedback.message}</Text>
                  </View>
                )}

                {showCookConfirmation ? (
                  <View className="w-full flex-row items-center gap-2">
                    <View className="min-w-0 flex-1">
                      <Text className="text-xs font-black text-secondary">Ready to cook?</Text>
                      <Text className="mt-0.5 text-[10px] leading-4 text-dark-300">
                        We'll deduct these amounts from your fridge.
                      </Text>
                    </View>
                    <Pressable
                      onPress={() => setShowCookConfirmation(false)}
                      disabled={cooking}
                      className="h-10 min-w-[58px] items-center justify-center rounded-xl bg-light-200 px-3"
                    >
                      <Text className="text-[10px] font-extrabold text-secondary">Cancel</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void confirmCooking()}
                      disabled={cooking || !selectedAvailability.canCook}
                      className={`h-10 min-w-[112px] flex-row items-center justify-center gap-1.5 rounded-xl bg-secondary px-3 ${cooking || !selectedAvailability.canCook ? "opacity-50" : ""}`}
                    >
                      {cooking
                        ? <ActivityIndicator size="small" color={colors.light[300]} />
                        : <Ionicons name="checkmark-circle-outline" size={15} color={colors.light[300]} />}
                      <Text className="shrink text-center text-[10px] font-black text-light-300">
                        {cooking ? "Saving..." : "Confirm"}
                      </Text>
                    </Pressable>
                  </View>
                ) : (
                  <View className="w-full flex-row gap-3">
                    <Pressable
                      onPress={() => setShowCookConfirmation(true)}
                      disabled={!selectedAvailability.canCook || cooking}
                      className={`h-[76px] min-w-0 flex-1 items-center justify-center rounded-2xl border border-secondary bg-light-200 px-2 py-2 active:opacity-80 ${selectedAvailability.canCook && !cooking ? "" : "opacity-40"}`}
                      accessibilityRole="button"
                      accessibilityLabel="Cooked it. Already made it."
                      accessibilityState={{ disabled: !selectedAvailability.canCook || cooking }}
                    >
                      <Ionicons name="checkmark-circle-outline" size={21} color={colors.secondary} />
                      <Text className="mt-1 text-xs font-black text-secondary">Cooked it</Text>
                      <Text className="mt-0.5 text-[9px] font-medium text-dark-300">Already made it</Text>
                    </Pressable>
                    <Pressable
                      onPress={openCookingMode}
                      disabled={!selectedAvailability.canCook || cooking || selectedRecipe.content.instructions.length === 0}
                      className={`h-[76px] min-w-0 flex-1 items-center justify-center rounded-2xl bg-secondary px-2 py-2 shadow-sm active:opacity-80 ${selectedAvailability.canCook && !cooking && selectedRecipe.content.instructions.length > 0 ? "" : "opacity-40"}`}
                      accessibilityRole="button"
                      accessibilityLabel="Let's cook! Start cooking."
                      accessibilityState={{ disabled: !selectedAvailability.canCook || cooking || selectedRecipe.content.instructions.length === 0 }}
                    >
                      <Ionicons name="restaurant-outline" size={21} color={colors.light[300]} />
                      <Text className="mt-1 text-xs font-black text-light-300">Let's cook!</Text>
                      <Text className="mt-0.5 text-[9px] font-medium text-light-300/80">Starting to cook!</Text>
                    </Pressable>
                  </View>
                )}

                {!selectedAvailability.canCook && !showCookConfirmation && (
                  <View className="mt-2 w-full items-center">
                    <View className="max-w-full flex-row items-center gap-1.5 rounded-full bg-light-200 px-3 py-1.5">
                      <Ionicons name="information-circle-outline" size={13} color={colors.secondary} />
                      <Text className="shrink text-center text-[9px] leading-3 text-secondary">
                        {selectedAvailability.missing.length > 0
                          ? `Not enough in your fridge: ${selectedAvailability.missing.join(", ")}.`
                          : "Add the required ingredients before cooking."}
                      </Text>
                    </View>
                  </View>
                )}
              </View>
            </SafeAreaView>
          </SafeAreaProvider>
        )}
      </Modal>

      {/* COOKING MODE — guided steps that finish through the existing safe cooking endpoint. */}
      <Modal
        visible={showCookingMode}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={closeCookingMode}
      >
        {selectedRecipe && (
          <SafeAreaProvider>
            <SafeAreaView className="flex-1 bg-light-300" edges={["top", "bottom", "left", "right"]}>
              <View className="flex-row items-center justify-between border-b border-light-100 px-4 py-3">
                <Pressable
                  onPress={closeCookingMode}
                  disabled={cooking}
                  className="h-10 w-10 items-center justify-center rounded-xl bg-light-100"
                  accessibilityRole="button"
                  accessibilityLabel="Close Cooking Mode"
                >
                  <Ionicons name="close" size={22} color={colors.secondary} />
                </Pressable>
                <View className="flex-1 items-center px-3">
                  <Text className="text-[9px] font-black tracking-[2px] text-dark-300">YOUR KITCHEN COMPANION</Text>
                  <Text className="mt-0.5 text-xs font-black text-secondary">COOKING MODE</Text>
                </View>
                <View className="h-10 w-10 items-center justify-center rounded-xl bg-light-100">
                  <Ionicons name="restaurant-outline" size={19} color={colors.secondary} />
                </View>
              </View>

              <ScrollView
                className="flex-1"
                showsVerticalScrollIndicator={false}
                contentContainerStyle={{ paddingHorizontal: horizontalPadding, paddingTop: 18, paddingBottom: 28, width: "100%", maxWidth: 760, alignSelf: "center" }}
              >
                <View className="overflow-hidden rounded-[26px] bg-[#E9EDDF] p-5">
                  <View className="flex-row items-center justify-between">
                    <View className="rounded-full bg-white/70 px-3 py-1.5">
                      <Text className="text-[9px] font-black tracking-wide text-secondary">
                        {cookingStage === "prep" ? "GET SET" : cookingStage === "done" ? "NICELY DONE" : `STEP ${cookingStepIndex + 1} OF ${cookingStepCount}`}
                      </Text>
                    </View>
                    <Ionicons name={cookingStage === "done" ? "checkmark-circle" : "sparkles"} size={22} color={colors.secondary} />
                  </View>
                  <Text className="mt-4 text-2xl font-black leading-8 text-secondary">
                    {cookingStage === "prep" ? "Let's make something good." : cookingStage === "done" ? "You did it!" : "One step at a time."}
                  </Text>
                  <Text className="mt-1 text-xs leading-5 text-secondary/80">
                    {cookingStage === "prep"
                      ? "Everything is checked and ready. Take a quick look, then start cooking."
                      : cookingStage === "done"
                        ? "All the recipe steps are complete. Ready to update your fridge?"
                        : "Take your time. Mark each step complete when you're happy to move on."}
                  </Text>
                  <Text className="mt-3 text-sm font-extrabold text-secondary" numberOfLines={2}>
                    {selectedRecipe.content.title}
                  </Text>
                  <View className="mt-3 flex-row flex-wrap gap-2">
                    <View className="flex-row items-center rounded-full bg-white/75 px-3 py-1.5">
                      <Ionicons name="time-outline" size={13} color={colors.secondary} />
                      <Text className="ml-1.5 text-[10px] font-bold text-secondary">{selectedRecipe.content.cooking_time || "—"} min total</Text>
                    </View>
                    <View className="flex-row items-center rounded-full bg-white/75 px-3 py-1.5">
                      <Ionicons name="people-outline" size={13} color={colors.secondary} />
                      <Text className="ml-1.5 text-[10px] font-bold text-secondary">{selectedRecipe.content.servings} servings</Text>
                    </View>
                  </View>
                </View>

                {cookingStage === "prep" && (
                  <View className="mt-6">
                    <View className="mb-3 flex-row items-end justify-between">
                      <View>
                        <Text className="text-lg font-black text-secondary">Your ingredients</Text>
                        <Text className="mt-0.5 text-[10px] text-dark-300">A quick check before you begin</Text>
                      </View>
                      <View className="rounded-full bg-[#E7EDDF] px-3 py-1.5">
                        <Text className="text-[9px] font-black text-secondary">{selectedAvailability.canCook ? "All ready" : `${selectedAvailability.missing.length} to check`}</Text>
                      </View>
                    </View>
                    {selectedRecipe.content.ingredients.map((ingredient, index) => {
                      const stock = ingredient.ingredient_id === null
                        ? undefined
                        : inventory.find((item) => item.ingredient_id === ingredient.ingredient_id);
                      const enough = Boolean(
                        stock
                        && stock.unit.trim().toLowerCase() === ingredient.unit.trim().toLowerCase()
                        && stock.quantity >= ingredient.quantity
                        && ingredient.is_available !== false,
                      );
                      return (
                        <View key={`cook-${ingredient.ingredient_id ?? "missing"}-${index}`} className="mb-2 flex-row items-center rounded-2xl border border-light-100 bg-light-200 px-3 py-3">
                          <View className={`mr-3 h-9 w-9 items-center justify-center rounded-xl ${enough ? "bg-[#E7EDDF]" : "bg-[#F5E3E0]"}`}>
                            <Ionicons name={enough ? "checkmark" : "alert-outline"} size={17} color={colors.secondary} />
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-xs font-extrabold text-secondary" numberOfLines={1}>{ingredient.name}</Text>
                            <Text className="mt-0.5 text-[9px] text-dark-300">
                              {stock ? `In ${storageLocationLabel(stock.storage_location)}: ${stock.quantity} ${stock.unit}` : "Not in your storage"}
                            </Text>
                          </View>
                          <Text className="ml-2 text-xs font-black text-secondary">{ingredient.quantity} {ingredient.unit}</Text>
                        </View>
                      );
                    })}
                    <View className="mt-3 rounded-2xl border border-[#DCE5D1] bg-[#F3F6EE] p-3.5">
                      <View className="flex-row items-center gap-2">
                        <Ionicons name="shield-checkmark-outline" size={17} color={colors.secondary} />
                        <Text className="text-[11px] font-black text-secondary">Your fridge is checked</Text>
                      </View>
                      <Text className="mt-1 text-[10px] leading-4 text-dark-300">
                        We'll only update your inventory after you finish and confirm the recipe. Used amounts are deducted; anything left stays in your fridge.
                      </Text>
                    </View>
                  </View>
                )}

                {cookingStage === "steps" && (
                  <View className="mt-6">
                    <View className="mb-3 flex-row items-center justify-between">
                      <Text className="text-sm font-black text-secondary">Your progress</Text>
                      <Text className="text-[10px] font-extrabold text-dark-300">{completedCookingSteps.length} of {cookingStepCount} done</Text>
                    </View>
                    <View className="h-2 overflow-hidden rounded-full bg-light-100">
                      <View className="h-full rounded-full bg-[#8A9A70]" style={{ width: `${cookingProgress}%` }} />
                    </View>
                    <View className="mt-6 rounded-[26px] border border-light-100 bg-white p-5">
                      <View className="flex-row items-center justify-between">
                        <View className="rounded-full bg-[#E9EDDF] px-3 py-1.5">
                          <Text className="text-[9px] font-black tracking-wide text-secondary">STEP {cookingStepIndex + 1}</Text>
                        </View>
                        {completedCookingSteps.includes(cookingStepIndex) && (
                          <View className="flex-row items-center gap-1">
                            <Ionicons name="checkmark-circle" size={16} color="#71845C" />
                            <Text className="text-[9px] font-bold text-secondary">Completed</Text>
                          </View>
                        )}
                      </View>
                      <Text className="mt-5 text-lg font-black leading-7 text-secondary">{currentCookingInstruction}</Text>
                      {currentCookingStepDuration !== null && (
                        <View className="mt-5 rounded-2xl bg-light-200 p-4">
                          <View className="flex-row items-center justify-between">
                            <View className="flex-row items-center gap-2">
                              <Ionicons name="timer-outline" size={18} color={colors.secondary} />
                              <Text className="text-xs font-black text-secondary">Step timer</Text>
                            </View>
                            <Text className="text-lg font-black tabular-nums text-secondary">
                              {stepTimerRemaining === null ? formatCountdown(currentCookingStepDuration) : formatCountdown(stepTimerRemaining)}
                            </Text>
                          </View>
                          {stepTimerRemaining === 0 ? (
                            <View className="mt-3 flex-row items-center justify-between gap-2">
                              <Text className="min-w-0 flex-1 text-[10px] font-bold text-secondary">Timer finished — check your food.</Text>
                              <Pressable
                                onPress={() => startStepTimer(currentCookingStepDuration, true)}
                                className="h-9 flex-row items-center justify-center gap-1 rounded-xl bg-white px-3"
                                accessibilityRole="button"
                                accessibilityLabel="Start step timer again"
                              >
                                <Ionicons name="refresh" size={13} color={colors.secondary} />
                                <Text className="text-[9px] font-black text-secondary">Again</Text>
                              </Pressable>
                            </View>
                          ) : (
                            <View className="mt-3 flex-row gap-2">
                              <Pressable
                                onPress={() => {
                                  if (stepTimerRunning) {
                                    pauseStepTimer();
                                  } else {
                                    startStepTimer(currentCookingStepDuration);
                                  }
                                }}
                                className="h-10 flex-1 flex-row items-center justify-center gap-2 rounded-xl bg-secondary"
                              >
                                <Ionicons name={stepTimerRunning ? "pause" : "play"} size={14} color={colors.light[300]} />
                                <Text className="text-[10px] font-black text-light-300">
                                  {stepTimerRunning ? "Pause timer" : stepTimerRemaining === null ? "Start timer" : "Resume timer"}
                                </Text>
                              </Pressable>
                              {stepTimerRemaining !== null && (
                                <Pressable
                                  onPress={() => {
                                    setStepTimerRunning(false);
                                    setStepTimerRemaining(currentCookingStepDuration);
                                    setStepTimerEndsAt(null);
                                  }}
                                  className="h-10 w-11 items-center justify-center rounded-xl bg-white"
                                  accessibilityRole="button"
                                  accessibilityLabel="Reset step timer"
                                >
                                  <Ionicons name="refresh" size={16} color={colors.secondary} />
                                </Pressable>
                              )}
                            </View>
                          )}
                        </View>
                      )}
                      <Text className="mt-4 text-[10px] leading-4 text-dark-300">
                        {currentCookingStepDuration === null
                          ? "No timer was specified for this step. Follow the instruction and move on when ready."
                          : "The timer is a helper based on the time written in this instruction. Keep an eye on your food as it cooks."}
                      </Text>
                    </View>
                    <View className="mt-4 flex-row flex-wrap gap-2">
                      {selectedRecipe.content.instructions.map((_, index) => (
                        <View key={`step-dot-${index}`} className={`h-2.5 flex-1 rounded-full ${completedCookingSteps.includes(index) ? "bg-[#8A9A70]" : index === cookingStepIndex ? "bg-secondary" : "bg-light-100"}`} />
                      ))}
                    </View>
                  </View>
                )}

                {cookingStage === "done" && (
                  <View className="mt-7 items-center rounded-[26px] border border-[#DCE5D1] bg-[#F3F6EE] px-5 py-7">
                    <View className="h-16 w-16 items-center justify-center rounded-full bg-[#E2EBD8]">
                      <Ionicons name="checkmark" size={34} color={colors.secondary} />
                    </View>
                    <Text className="mt-4 text-xl font-black text-secondary">All steps complete</Text>
                    <Text className="mt-2 text-center text-xs leading-5 text-dark-300">
                      When you're ready, confirm that you've made this recipe. We'll then deduct the exact ingredient amounts from your fridge.
                    </Text>
                    <View className="mt-4 w-full rounded-2xl bg-white p-4">
                      <Text className="text-[10px] font-black text-secondary">WHAT HAPPENS NEXT</Text>
                      <Text className="mt-1 text-[10px] leading-4 text-dark-300">Your cooking history is updated, the available quantities are recalculated, and any leftover amounts remain in storage.</Text>
                    </View>
                  </View>
                )}

                {cookFeedback?.type === "error" && (
                  <View className="mt-4 flex-row items-start gap-2 rounded-xl bg-[#F5E3E0] px-3 py-2.5">
                    <Ionicons name="alert-circle" size={15} color={colors.secondary} />
                    <Text className="flex-1 text-[10px] leading-4 text-secondary">{cookFeedback.message}</Text>
                  </View>
                )}
              </ScrollView>

              <View className="border-t border-light-100 bg-light-300 px-4 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 10) }}>
                {cookingStage === "prep" ? (
                  <Pressable
                    onPress={beginCookingSteps}
                    disabled={!selectedAvailability.canCook || cookingStepCount === 0 || cooking}
                    className={`h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-secondary ${!selectedAvailability.canCook || cookingStepCount === 0 || cooking ? "opacity-50" : "active:opacity-80"}`}
                  >
                    <Ionicons name="play-circle-outline" size={18} color={colors.light[300]} />
                    <Text className="text-sm font-black text-light-300">Start cooking</Text>
                  </Pressable>
                ) : cookingStage === "steps" ? (
                  <View className="flex-row gap-2">
                    <Pressable
                      onPress={goToPreviousCookingStep}
                      disabled={cookingStepIndex === 0 || cooking}
                      className={`h-12 w-12 items-center justify-center rounded-2xl bg-light-200 ${cookingStepIndex === 0 || cooking ? "opacity-40" : ""}`}
                      accessibilityRole="button"
                      accessibilityLabel="Previous cooking step"
                    >
                      <Ionicons name="arrow-back" size={18} color={colors.secondary} />
                    </Pressable>
                    <Pressable
                      onPress={completeCurrentCookingStep}
                      disabled={cooking}
                      className="h-12 flex-1 flex-row items-center justify-center gap-2 rounded-2xl bg-secondary"
                    >
                      <Text className="text-sm font-black text-light-300">
                        {cookingStepIndex === cookingStepCount - 1 ? "Finish steps" : "Done — next step"}
                      </Text>
                      <Ionicons name="arrow-forward" size={16} color={colors.light[300]} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable
                    onPress={() => void confirmCooking(true)}
                    disabled={cooking || !selectedAvailability.canCook}
                    className={`h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-secondary ${cooking || !selectedAvailability.canCook ? "opacity-50" : "active:opacity-80"}`}
                    accessibilityRole="button"
                    accessibilityLabel="Confirm cooking and update fridge quantities"
                  >
                    {cooking
                      ? <ActivityIndicator size="small" color={colors.light[300]} />
                      : <Ionicons name="checkmark-circle-outline" size={18} color={colors.light[300]} />}
                    <Text className="text-sm font-black text-light-300">
                      {cooking ? "Updating your fridge..." : "Finish & update my fridge"}
                    </Text>
                  </Pressable>
                )}
                <Text className="mt-2 text-center text-[9px] text-dark-300">
                  Your inventory only changes after you confirm the finished recipe.
                </Text>
              </View>
            </SafeAreaView>
          </SafeAreaProvider>
        )}
      </Modal>
    </SafeAreaView>
  );
}