import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { colors } from "../constants/colors";

type CategoryOption = {
  name: string;
  subtitle: string;
  icon: keyof typeof Ionicons.glyphMap;
  surface: string;
};

const CATEGORIES: CategoryOption[] = [
  { name: "Meat", subtitle: "Meat and poultry", icon: "restaurant-outline", surface: "bg-[#F4E7DE]" },
  { name: "Dairy", subtitle: "Milk, cheese and eggs", icon: "water-outline", surface: "bg-[#E8EEF0]" },
  { name: "Vegetables", subtitle: "Greens and vegetables", icon: "leaf-outline", surface: "bg-[#E9EDDF]" },
  { name: "Fruits", subtitle: "Fresh and seasonal fruit", icon: "nutrition-outline", surface: "bg-[#F5EBDD]" },
];

export default function CategoryFilter({
  onSelect,
}: {
  onSelect: (category: string) => void;
}) {
  return (
    <View className="w-full rounded-2xl border border-light-100 bg-light-300 p-3.5 shadow-xl">
      <View className="mb-3 flex-row items-center">
        <View className="mr-2.5 h-9 w-9 items-center justify-center rounded-xl bg-[#E9EDDF]">
          <Ionicons name="options-outline" size={18} color={colors.secondary} />
        </View>
        <View className="flex-1">
          <Text className="text-sm font-black text-secondary">Categories</Text>
          <Text className="mt-0.5 text-[9px] text-dark-300">Choose what to show</Text>
        </View>
      </View>

      {CATEGORIES.map((category) => (
        <Pressable
          key={category.name}
          onPress={() => onSelect(category.name)}
          className="mb-1.5 min-h-12 flex-row items-center rounded-xl bg-light-200 px-2.5 py-2 active:opacity-70"
          accessibilityRole="button"
          accessibilityLabel={`Filter by ${category.name}`}
        >
          <View className={`mr-2.5 h-8 w-8 items-center justify-center rounded-lg ${category.surface}`}>
            <Ionicons name={category.icon} size={16} color={colors.secondary} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[11px] font-extrabold text-secondary">{category.name}</Text>
            <Text className="mt-0.5 text-[8px] text-dark-300">{category.subtitle}</Text>
          </View>
          <Ionicons name="chevron-forward" size={14} color={colors.dark[300]} />
        </Pressable>
      ))}
    </View>
  );
}
