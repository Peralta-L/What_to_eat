import { useEffect, useRef, useState, type ComponentRef } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../constants/colors";
import { apiFetch } from "@/utils/api";

const UNITS = ["g", "kg", "ml", "l", "pcs"] as const;
type Unit = (typeof UNITS)[number];

type IngredientOption = {
  id: number;
  name: string;
  category?: string | null;
};

type Selected = {
  ingredient: IngredientOption;
  quantity: string;
  unit: Unit;
};

type AddIngredientFormProps = {
  onClose: () => void;
  onAdded: () => void;
};

function cleanIngredientDisplayName(value: string): string {
  return value
    .replace(/\braw\b/gi, " ")
    .replace(/\s+([,;])/g, "$1")
    .replace(/([,;])\s*([,;])+/g, "$1")
    .replace(/^[,;\s]+|[,;\s]+$/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}


function normaliseResults(value: unknown): IngredientOption[] {
  if (!Array.isArray(value)) return [];

  return value
    .filter((entry): entry is Record<string, unknown> => (
      Boolean(entry) && typeof entry === "object"
    ))
    // Include raw ingredients, cheese, milk and bread.
    .filter((entry) => {
      const name = String(entry.name ?? "");

      const allowed =
        /\b(?:raw|cheeses?|milks?|bread)\b/i.test(name);

      const excluded =
        /\b(?:soups?|dumplings?|icings?|fillings?|breaded)\b/i.test(name);

      return allowed && !excluded;
    })
    .map((entry) => ({
      id: Number(entry.id),
      name: cleanIngredientDisplayName(String(entry.name ?? "")),
      category: typeof entry.category === "string" ? entry.category : null,
    }))
    .filter((entry) =>
      Number.isInteger(entry.id) &&
      entry.id > 0 &&
      entry.name.length > 0
    );
}


const PREPARED_DISH_WORDS = new Set([
  "fried", "slices", "slice", "with", "cooked", "grilled", "baked",
  "roasted", "stewed", "casserole", "dish", "meal", "recipe",
]);

function normaliseSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Rank ingredient-like matches before dishes that only mention the search term. */
function rankIngredientResults(
  ingredients: IngredientOption[],
  query: string,
): IngredientOption[] {
  const cleanQuery = normaliseSearchText(query);
  const queryWords = cleanQuery.split(/\s+/).filter(Boolean);
  if (queryWords.length === 0) return [];

  const ranked = ingredients
    .map((ingredient, originalIndex) => {
      const cleanName = normaliseSearchText(ingredient.name);
      const words = cleanName.split(/\s+/).filter(Boolean);
      const allTermsMatch = queryWords.every((term) =>
        words.some((word) => word.startsWith(term) || word.includes(term)),
      );
      if (!allTermsMatch) return null;

      let score = 0;
      if (cleanName === cleanQuery) score -= 100;
      else if (cleanName.startsWith(cleanQuery)) score -= 60;
      else if (words[0]?.startsWith(queryWords[0])) score -= 35;

      const firstMatchPositions = queryWords.map((term) =>
        words.findIndex((word) => word.startsWith(term) || word.includes(term)),
      );

      // Do not surface a prepared dish when the ingredient is only mentioned
      // deep in its name (for example, "aubergine slices fried with tomato").
      const looksLikePreparedDish = firstMatchPositions[0] >= 2
        && words.some((word) => PREPARED_DISH_WORDS.has(word));
      if (looksLikePreparedDish) return null;

      score += firstMatchPositions.reduce((total, position) => total + Math.max(0, position) * 5, 0);

      // Prefer concise ingredient names (e.g. "cherry tomato") over long
      // descriptions, while allowing common ingredient variants such as
      // "canned tomato", "green tomato" and "sun-dried tomato".
      score += Math.max(0, words.length - queryWords.length) * 1.5;
      if (words.slice(0, -1).some((word) => PREPARED_DISH_WORDS.has(word))) score += 18;
      if (words.length >= 4 && firstMatchPositions[0] > 0) score += 10;

      return { ingredient, score, originalIndex };
    })
    .filter((entry): entry is { ingredient: IngredientOption; score: number; originalIndex: number } => entry !== null)
    .sort((a, b) => a.score - b.score || a.originalIndex - b.originalIndex);

  // Raw labels are hidden in the UI, so show only one visible result for
  // each cleaned ingredient name.
  const seenNames = new Set<string>();
  return ranked
    .filter((entry) => {
      const key = normaliseSearchText(entry.ingredient.name);
      if (seenNames.has(key)) return false;
      seenNames.add(key);
      return true;
    })
    .slice(0, 15)
    .map((entry) => entry.ingredient);
}

export default function AddIngredientForm({ onClose, onAdded }: AddIngredientFormProps) {
  const [name, setName] = useState("");
  const [results, setResults] = useState<IngredientOption[]>([]);
  const [selected, setSelected] = useState<Selected[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [pendingFocusId, setPendingFocusId] = useState<number | null>(null);
  const selectedScrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const quantityInputRef = useRef<ComponentRef<typeof TextInput>>(null);

  // Debounced search. A stale request cannot overwrite a newer search.
  useEffect(() => {
    const query = name.trim();
    let active = true;

    if (query.length < 3) {
      setResults([]);
      setSearching(false);
      setSearchError(null);
      return () => {
        active = false;
      };
    }

    setSearching(true);
    setResults([]);
    setSearchError(null);

    const timer = setTimeout(async () => {

      try {
        const response = await apiFetch(
          `/api/ingredients?ingredient=${encodeURIComponent(query)}`,
        );
        if (active) setResults(rankIngredientResults(normaliseResults(response?.ingredients), query));
      } catch (error: unknown) {
        if (active) {
          setResults([]);
          setSearchError(
            error instanceof Error ? error.message : "Ingredient search is unavailable.",
          );
        }
      } finally {
        if (active) setSearching(false);
      }
    }, 250);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [name]);

  useEffect(() => {
    if (pendingFocusId === null) return;
    const selectedItemExists = selected.some((entry) => entry.ingredient.id === pendingFocusId);
    if (!selectedItemExists) return;

    selectedScrollRef.current?.scrollToEnd({ animated: true });
    quantityInputRef.current?.focus();
    setPendingFocusId(null);
  }, [pendingFocusId, selected]);

  function selectIngredient(ingredient: IngredientOption) {
    if (selected.some((entry) => entry.ingredient.id === ingredient.id)) {
      setPendingFocusId(ingredient.id);
    } else {
      setSelected((current) => [...current, { ingredient, quantity: "", unit: "g" }]);
      setPendingFocusId(ingredient.id);
    }
    setName("");
    setResults([]);
    setSearchError(null);
  }

  function removeIngredient(id: number) {
    setSelected((current) => current.filter((entry) => entry.ingredient.id !== id));
  }

  function updateSelected(id: number, changes: Partial<Pick<Selected, "quantity" | "unit">>) {
    setSelected((current) => current.map((entry) => (
      entry.ingredient.id === id ? { ...entry, ...changes } : entry
    )));
  }

  async function handleSubmit() {
    if (saving) return;

    if (selected.length === 0) {
      Alert.alert("Nothing selected yet", "Search for an ingredient and add it to your list first.");
      return;
    }

    const invalidIngredient = selected.find((entry) => {
      const quantity = Number(entry.quantity.trim().replace(",", "."));
      return !Number.isFinite(quantity) || quantity <= 0 || !UNITS.includes(entry.unit);
    });

    if (invalidIngredient) {
      Alert.alert(
        "Check the quantities",
        `Enter a valid amount greater than zero for ${invalidIngredient.ingredient.name}.`,
      );
      return;
    }

    setSaving(true);
    try {
      await Promise.all(
        selected.map((entry) => apiFetch("/api/items", {
          method: "POST",
          body: JSON.stringify({
            ingredient_id: entry.ingredient.id,
            quantity: Number(entry.quantity.trim().replace(",", ".")),
            unit: entry.unit,
          }),
        })),
      );

      onAdded();
      onClose();
    } catch (error: unknown) {
      Alert.alert(
        "Couldn't add ingredients",
        error instanceof Error ? error.message : "Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <View className="w-full">
      {/* Minimal header: keep only the close action. */}
      <View className="mb-3 flex-row justify-end">
        <Pressable
          onPress={onClose}
          disabled={saving}
          className="h-9 w-9 items-center justify-center rounded-xl bg-light-200"
          accessibilityRole="button"
          accessibilityLabel="Close add ingredients"
        >
          <Ionicons name="close" size={19} color={colors.secondary} />
        </Pressable>
      </View>

      {/* Search */}
      <View className="mb-2">
        <Text className="mb-2 text-[10px] font-extrabold tracking-[1.2px] text-dark-300">
          FIND AN INGREDIENT
        </Text>
        <View className="h-12 flex-row items-center rounded-2xl border border-[#DEDCCF] bg-light-200 px-3">
          <Ionicons name="search-outline" size={18} color={colors.dark[300]} />
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Search tomatoes, milk, rice..."
            placeholderTextColor={colors.dark[300]}
            className="h-full min-w-0 flex-1 px-3 text-sm text-secondary"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            editable={!saving}
            accessibilityLabel="Search ingredients"
          />
          {searching ? (
            <ActivityIndicator size="small" color={colors.secondary} />
          ) : name.length > 0 ? (
            <Pressable onPress={() => setName("")} hitSlop={8} accessibilityLabel="Clear search">
              <Ionicons name="close-circle" size={19} color={colors.dark[300]} />
            </Pressable>
          ) : null}
        </View>
      </View>

      {/* Results */}
      {(results.length > 0 || searchError || (name.trim().length >= 3 && !searching)) && (
        <View className="mb-4 rounded-2xl border border-[#E1DFD3] bg-[#F2F0E8] p-3">
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="text-xs font-extrabold text-secondary">Search results</Text>
            {results.length > 0 && (
              <Text className="text-[10px] font-semibold text-dark-300">{results.length} found</Text>
            )}
          </View>

          {searchError ? (
            <View className="flex-row items-center rounded-xl bg-[#F9ECE9] px-3 py-2.5">
              <Ionicons name="alert-circle-outline" size={16} color="#A34F45" />
              <Text className="ml-2 flex-1 text-xs text-[#93473F]">{searchError}</Text>
            </View>
          ) : results.length === 0 ? (
            <View className="items-center rounded-xl bg-light-200 px-3 py-4">
              <Ionicons name="search-outline" size={20} color={colors.dark[300]} />
              <Text className="mt-1 text-xs font-semibold text-secondary">No matches found</Text>
              <Text className="mt-0.5 text-[10px] text-dark-300">Try a different ingredient name.</Text>
            </View>
          ) : (
            <ScrollView
              nestedScrollEnabled
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
              style={{ maxHeight: 214 }}
            >
              {results.map((ingredient) => {
                const isSelected = selected.some((entry) => entry.ingredient.id === ingredient.id);
                return (
                  <Pressable
                    key={ingredient.id}
                    onPress={() => selectIngredient(ingredient)}
                    disabled={isSelected || saving}
                    className={`mb-2 min-h-12 flex-row items-center rounded-xl border px-3 py-2.5 ${isSelected ? "border-[#D5DDC8] bg-[#E7EDDF]" : "border-[#E1E5D9] bg-[#E9EDDF] active:opacity-70"}`}
                    accessibilityRole="button"
                    accessibilityState={{ disabled: isSelected }}
                  >
                    <View className="mr-3 h-8 w-8 items-center justify-center rounded-lg bg-[#F5F3EC]">
                      <Ionicons name="leaf-outline" size={16} color={colors.secondary} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-sm font-extrabold text-secondary" numberOfLines={1}>
                        {ingredient.name}
                      </Text>
                    </View>
                    <View className={`ml-2 h-7 w-7 items-center justify-center rounded-full ${isSelected ? "bg-[#D5DFC9]" : "bg-[#F5F3EC]"}`}>
                      <Ionicons
                        name={isSelected ? "checkmark" : "add"}
                        size={17}
                        color={colors.secondary}
                      />
                    </View>
                  </Pressable>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}

      {/* Selected ingredients */}
      <View className="mb-4 rounded-2xl bg-light-200 p-3.5">
        <View className="mb-3 flex-row items-center justify-between">
          <View>
            <Text className="text-sm font-black text-secondary">Your ingredients</Text>
          </View>
          <View className="rounded-full bg-white px-2.5 py-1">
            <Text className="text-[10px] font-extrabold text-secondary">{selected.length} selected</Text>
          </View>
        </View>

        {selected.length === 0 ? (
          <View className="items-center rounded-xl border border-dashed border-[#C8D0BE] bg-[#F5F6F1] px-3 py-5">
            <Ionicons name="file-tray-outline" size={23} color={colors.dark[300]} />
            <Text className="mt-1.5 text-xs font-semibold text-secondary">Your list is empty</Text>
            <Text className="mt-0.5 text-center text-[10px] text-dark-300">
              Search above and tap an ingredient to add it here.
            </Text>
          </View>
        ) : (
          <ScrollView
            ref={selectedScrollRef}
            nestedScrollEnabled
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
            style={{ maxHeight: 226 }}
          >
            {selected.map((entry) => (
              <View
                key={entry.ingredient.id}
                className="mb-2.5 rounded-xl border border-[#E5E2D8] bg-[#F8F6F0] p-3"
              >
                <View className="mb-2.5 flex-row items-center justify-between">
                  <View className="min-w-0 flex-1 pr-2">
                    <Text className="text-xs font-extrabold text-secondary" numberOfLines={1}>
                      {entry.ingredient.name}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => removeIngredient(entry.ingredient.id)}
                    disabled={saving}
                    className="h-8 w-8 items-center justify-center rounded-lg bg-[#F9ECE9]"
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${entry.ingredient.name}`}
                  >
                    <Ionicons name="trash-outline" size={15} color="#A34F45" />
                  </Pressable>
                </View>

                <View className="mb-2 flex-row items-center">
                  <View className="mr-2 h-11 min-w-0 flex-1 flex-row items-center rounded-xl border border-[#DDDCCF] bg-light-200 px-3">
                    <TextInput
                      ref={pendingFocusId === entry.ingredient.id ? quantityInputRef : undefined}
                      value={entry.quantity}
                      onChangeText={(value) => updateSelected(entry.ingredient.id, { quantity: value })}
                      keyboardType="decimal-pad"
                      placeholder="0"
                      placeholderTextColor={colors.dark[300]}
                      className="min-w-0 flex-1 py-0 text-base font-black text-secondary"
                      maxLength={12}
                      editable={!saving}
                      accessibilityLabel={`Quantity for ${entry.ingredient.name}`}
                    />
                  </View>
                </View>

                <View className="flex-row flex-wrap gap-1.5">
                  {UNITS.map((unit) => {
                    const active = entry.unit === unit;
                    return (
                      <Pressable
                        key={unit}
                        onPress={() => updateSelected(entry.ingredient.id, { unit })}
                        disabled={saving}
                        className={`min-w-[42px] items-center rounded-lg px-3 py-2 ${active ? "bg-secondary" : "bg-light-200"}`}
                        accessibilityRole="button"
                        accessibilityState={{ selected: active }}
                        accessibilityLabel={`Use ${unit} for ${entry.ingredient.name}`}
                      >
                        <Text className={`text-[10px] font-extrabold ${active ? "text-light-300" : "text-secondary"}`}>
                          {unit}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            ))}
          </ScrollView>
        )}
      </View>

      {/* Actions */}
      <View className="flex-row gap-2.5">
        <Pressable
          onPress={onClose}
          disabled={saving}
          className="h-12 flex-1 items-center justify-center rounded-xl bg-light-200 active:opacity-70"
          accessibilityRole="button"
        >
          <Text className="text-xs font-extrabold text-secondary">Cancel</Text>
        </Pressable>
        <Pressable
          onPress={() => void handleSubmit()}
          disabled={saving || selected.length === 0}
          className={`h-12 w-12 items-center justify-center rounded-xl bg-secondary ${saving || selected.length === 0 ? "opacity-50" : "active:opacity-80"}`}
          accessibilityRole="button"
          accessibilityLabel={saving ? "Adding ingredients" : "Confirm and add ingredients to storage"}
        >
          {saving ? (
            <ActivityIndicator size="small" color={colors.light[300]} />
          ) : (
            <Ionicons name="checkmark" size={23} color={colors.light[300]} />
          )}
        </Pressable>
      </View>
    </View>
  );
}
