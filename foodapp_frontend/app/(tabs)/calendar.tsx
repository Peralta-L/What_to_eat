import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  Text,
  View,
} from "react-native";
import { SafeAreaProvider, SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { colors } from "../../constants/colors";
import { apiFetch } from "../../utils/api";
import { notifyFridgeChanged, subscribeToFridgeRefresh } from "../../utils/fridgeRefresh";

type StorageLocation = "fridge" | "freezer" | "dry";

type CalendarItem = {
  id: number;
  ingredient_id: number;
  name: string;
  quantity: number;
  unit: string;
  expiration_date: string | null;
  storage_location: StorageLocation;
};

type CalendarCell = {
  key: string;
  date: Date;
  inCurrentMonth: boolean;
};

type ExpiryStatus = "expired" | "today" | "soon" | "later";

const WEEKDAYS = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

function dateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseDateKey(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(year, month - 1, day);
  if (
    parsed.getFullYear() !== year ||
    parsed.getMonth() !== month - 1 ||
    parsed.getDate() !== day
  ) return null;

  return parsed;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysFromToday(key: string): number | null {
  const expiry = parseDateKey(key);
  if (!expiry) return null;
  const today = startOfDay(new Date());
  return Math.round((expiry.getTime() - today.getTime()) / 86_400_000);
}

function getExpiryStatus(key: string): ExpiryStatus {
  const days = daysFromToday(key);
  if (days !== null && days < 0) return "expired";
  if (days === 0) return "today";
  if (days !== null && days <= 7) return "soon";
  return "later";
}

function statusLabel(key: string): string {
  const days = daysFromToday(key);
  if (days === null) return "Date unavailable";
  if (days < 0) return `${Math.abs(days)} ${Math.abs(days) === 1 ? "day" : "days"} overdue`;
  if (days === 0) return "Expires today";
  if (days === 1) return "Expires tomorrow";
  if (days <= 7) return `${days} days left`;

  const date = parseDateKey(key);
  return date
    ? new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(date)
    : "Date unavailable";
}

function statusColor(status: ExpiryStatus): string {
  if (status === "expired") return "#B65F51";
  if (status === "today") return "#D28A4B";
  if (status === "soon") return "#B39B52";
  return "#82926B";
}

function storageLabel(location: StorageLocation): string {
  if (location === "freezer") return "Freezer";
  if (location === "dry") return "Dry goods";
  return "Fridge";
}

function storageIcon(location: StorageLocation): keyof typeof Ionicons.glyphMap {
  if (location === "freezer") return "snow-outline";
  if (location === "dry") return "file-tray-stacked-outline";
  return "thermometer-outline";
}

function makeCalendarCells(month: Date): CalendarCell[] {
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const first = new Date(year, monthIndex, 1);
  const leadingDays = (first.getDay() + 6) % 7; // Monday-first calendar.
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const date = new Date(year, monthIndex, index - leadingDays + 1);
    return {
      key: dateKey(date),
      date,
      inCurrentMonth: date.getMonth() === monthIndex,
    };
  });
}

function mapInventoryItem(raw: Record<string, unknown>): CalendarItem {
  const rawLocation = String(raw.storage_location ?? "fridge").toLowerCase();
  const storageLocation: StorageLocation = rawLocation === "freezer"
    ? "freezer"
    : rawLocation === "dry"
      ? "dry"
      : "fridge";

  return {
    id: Number(raw.id),
    ingredient_id: Number(raw.ingredient_id),
    name: String(raw.name ?? "Ingredient"),
    quantity: Number(raw.quantity ?? 0),
    unit: String(raw.unit ?? ""),
    expiration_date:
      typeof raw.expiration_date === "string" && parseDateKey(raw.expiration_date.slice(0, 10))
        ? raw.expiration_date
        : null,
    storage_location: storageLocation,
  };
}

function ItemRow({
  item,
  onOpenStorage,
  onEditExpiry,
}: {
  item: CalendarItem;
  onOpenStorage: () => void;
  onEditExpiry: () => void;
}) {
  const expiryKey = item.expiration_date?.slice(0, 10) ?? "";
  const status = getExpiryStatus(expiryKey);

  return (
    <View className="flex-row items-center rounded-2xl border border-light-100 bg-light-200 px-3 py-3">
      <Pressable
        onPress={onOpenStorage}
        className="min-w-0 flex-1 flex-row items-center active:opacity-80"
        accessibilityRole="button"
        accessibilityLabel={`${item.name}, ${statusLabel(expiryKey)}, stored in ${storageLabel(item.storage_location)}`}
      >
        <View className="mr-3 h-10 w-10 items-center justify-center rounded-xl bg-light-100">
          <Ionicons name="leaf-outline" size={18} color={colors.secondary} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-xs font-extrabold text-secondary" numberOfLines={1}>{item.name}</Text>
          <View className="mt-1 flex-row items-center gap-1.5">
            <Ionicons name={storageIcon(item.storage_location)} size={11} color={colors.dark[300]} />
            <Text className="text-[9px] text-dark-300">
              {item.quantity} {item.unit} · {storageLabel(item.storage_location)}
            </Text>
          </View>
          <View className="mt-1 flex-row items-center gap-1">
            <View className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor(status) }} />
            <Text className="text-[9px] font-extrabold" style={{ color: statusColor(status) }}>
              {expiryKey ? statusLabel(expiryKey) : "No date set"}
            </Text>
          </View>
        </View>
      </Pressable>
      <Pressable
        onPress={onEditExpiry}
        className="ml-2 items-center justify-center rounded-xl bg-neutral px-3 py-2"
        accessibilityRole="button"
        accessibilityLabel={`Set or edit expiry date for ${item.name}`}
      >
        <Ionicons name="calendar-outline" size={15} color={colors.secondary} />
        <Text className="mt-0.5 text-[8px] font-black text-secondary">EDIT DATE</Text>
      </Pressable>
    </View>
  );
}

export default function CalendarScreen() {
  const insets = useSafeAreaInsets();
  const todayKey = dateKey(new Date());
  const [items, setItems] = useState<CalendarItem[]>([]);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [selectedDate, setSelectedDate] = useState(todayKey);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [estimatingId, setEstimatingId] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [editingItem, setEditingItem] = useState<CalendarItem | null>(null);
  const [draftExpiryDate, setDraftExpiryDate] = useState(todayKey);
  const [pickerMonth, setPickerMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [savingExpiry, setSavingExpiry] = useState(false);

  const loadItems = useCallback(async (initial = false) => {
    if (initial) setLoading(true);
    else setRefreshing(true);
    setLoadError(null);

    try {
      const response = await apiFetch("/api/items");
      if (!Array.isArray(response?.items)) {
        throw new Error("The inventory endpoint returned an unexpected response.");
      }
      setItems(response.items.map((item: Record<string, unknown>) => mapInventoryItem(item)));
    } catch (error: unknown) {
      setLoadError(error instanceof Error ? error.message : "Could not load expiry dates.");
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

  const datedItems = useMemo(() => items
    .filter((item) => item.expiration_date && parseDateKey(item.expiration_date.slice(0, 10)))
    .sort((a, b) => (a.expiration_date ?? "").localeCompare(b.expiration_date ?? "")), [items]);

  const itemsByDate = useMemo(() => {
    return datedItems.reduce<Record<string, CalendarItem[]>>((groups, item) => {
      const key = item.expiration_date!.slice(0, 10);
      (groups[key] ??= []).push(item);
      return groups;
    }, {});
  }, [datedItems]);

  const cells = useMemo(() => makeCalendarCells(visibleMonth), [visibleMonth]);
  const monthKey = `${visibleMonth.getFullYear()}-${String(visibleMonth.getMonth() + 1).padStart(2, "0")}`;
  const selectedItems = itemsByDate[selectedDate] ?? [];
  const withoutDate = items.filter((item) => !item.expiration_date);
  const expiredCount = datedItems.filter((item) => getExpiryStatus(item.expiration_date!.slice(0, 10)) === "expired").length;
  const dueSoonCount = datedItems.filter((item) => {
    const days = daysFromToday(item.expiration_date!.slice(0, 10));
    return days !== null && days >= 0 && days <= 7;
  }).length;
  const thisMonthCount = datedItems.filter((item) => item.expiration_date!.slice(0, 7) === monthKey).length;

  const selectedDateLabel = useMemo(() => {
    const parsed = parseDateKey(selectedDate);
    return parsed
      ? new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" }).format(parsed)
      : "Selected day";
  }, [selectedDate]);

  const changeMonth = (offset: number) => {
    const next = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + offset, 1);
    setVisibleMonth(next);
    setSelectedDate(dateKey(next));
  };

  const goToToday = () => {
    const now = new Date();
    setVisibleMonth(new Date(now.getFullYear(), now.getMonth(), 1));
    setSelectedDate(dateKey(now));
  };

  const estimateExpiry = async (item: CalendarItem) => {
    if (estimatingId !== null) return;
    setEstimatingId(item.id);
    setActionError(null);

    try {
      await apiFetch(`/api/ai_food/expiration-date/${item.ingredient_id}`);
      // Other screens and Home should pick up the newly saved expiry date too.
      notifyFridgeChanged("fridge");
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : `Could not estimate a date for ${item.name}.`);
    } finally {
      setEstimatingId(null);
    }
  };

  const openManualDateEditor = (item: CalendarItem) => {
    const initialDate = item.expiration_date?.slice(0, 10) ?? selectedDate ?? todayKey;
    const parsed = parseDateKey(initialDate) ?? new Date();
    setEditingItem(item);
    setDraftExpiryDate(dateKey(parsed));
    setPickerMonth(new Date(parsed.getFullYear(), parsed.getMonth(), 1));
    setActionError(null);
  };

  const saveManualExpiry = async (value: string | null) => {
    if (!editingItem || savingExpiry) return;
    setSavingExpiry(true);
    setActionError(null);

    try {
      await apiFetch(`/api/items/${editingItem.id}`, {
        method: "PUT",
        body: JSON.stringify({
          ingredient_id: editingItem.ingredient_id,
          quantity: editingItem.quantity,
          unit: editingItem.unit,
          expiration_date: value,
        }),
      });
      setEditingItem(null);
      notifyFridgeChanged("fridge");
    } catch (error: unknown) {
      setActionError(error instanceof Error ? error.message : `Could not save the expiry date for ${editingItem.name}.`);
    } finally {
      setSavingExpiry(false);
    }
  };

  const pickerCells = useMemo(() => makeCalendarCells(pickerMonth), [pickerMonth]);
  const pickerMonthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(pickerMonth);

  const monthLabel = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(visibleMonth);

  return (
    <SafeAreaView className="flex-1 bg-light-300" edges={["top", "left", "right"]}>
      <ScrollView
        className="flex-1"
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom, 16) + 112 }}
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
          {/* PAGE INTRO */}
          <View className="mb-5 flex-row items-center justify-between">
            <View className="min-w-0 flex-1 pr-3">
              <Text className="text-[9px] font-black tracking-[2.2px] text-dark-300">PLAN AHEAD, WASTE LESS</Text>
              <Text className="mt-1 text-[29px] font-black tracking-tight text-secondary">Freshness calendar</Text>
              <Text className="mt-1 text-[11px] text-dark-300">Know what needs using and when.</Text>
            </View>
            <View className="h-11 w-11 items-center justify-center rounded-2xl bg-neutral">
              <Ionicons name="calendar-outline" size={22} color={colors.secondary} />
            </View>
          </View>

          {loading ? (
            <View className="items-center rounded-[25px] bg-light-200 py-12">
              <ActivityIndicator size="large" color={colors.secondary} />
              <Text className="mt-3 text-xs text-dark-300">Checking your ingredient dates...</Text>
            </View>
          ) : loadError ? (
            <View className="rounded-[25px] bg-light-200 p-5">
              <Text className="text-sm font-black text-secondary">Your calendar could not load</Text>
              <Text className="mt-1 text-xs leading-5 text-dark-300">{loadError}</Text>
              <Pressable onPress={() => void loadItems(true)} className="mt-4 self-start rounded-full bg-secondary px-4 py-2.5">
                <Text className="text-xs font-bold text-light-300">Try again</Text>
              </Pressable>
            </View>
          ) : (
            <>
              {/* QUICK FRESHNESS COUNTS */}
              <View className="mb-5 flex-row gap-2.5">
                <View className="min-w-0 flex-1 rounded-2xl bg-[#F1E2DD] p-3">
                  <Text className="text-[9px] font-black tracking-wide text-[#8F5148]">PAST DATE</Text>
                  <Text className="mt-1 text-2xl font-black text-[#8F5148]">{expiredCount}</Text>
                </View>
                <View className="min-w-0 flex-1 rounded-2xl bg-[#F4EBDD] p-3">
                  <Text className="text-[9px] font-black tracking-wide text-[#98713D]">NEXT 7 DAYS</Text>
                  <Text className="mt-1 text-2xl font-black text-[#98713D]">{dueSoonCount}</Text>
                </View>
                <View className="min-w-0 flex-1 rounded-2xl bg-[#E9EDDF] p-3">
                  <Text className="text-[9px] font-black tracking-wide text-[#66734F]">THIS MONTH</Text>
                  <Text className="mt-1 text-2xl font-black text-[#66734F]">{thisMonthCount}</Text>
                </View>
              </View>

              {/* MONTH GRID */}
              <View className="mb-5 rounded-[26px] border border-light-100 bg-light-200 p-4">
                <View className="mb-4 flex-row items-center justify-between">
                  <View>
                    <Text className="text-[9px] font-black tracking-[1.8px] text-dark-300">YOUR MONTH</Text>
                    <Text className="mt-1 text-xl font-black capitalize text-secondary">{monthLabel}</Text>
                  </View>
                  <View className="flex-row items-center gap-1.5">
                    <Pressable onPress={goToToday} className="mr-1 rounded-full bg-neutral px-3 py-2" accessibilityRole="button" accessibilityLabel="Go to today">
                      <Text className="text-[9px] font-black text-secondary">TODAY</Text>
                    </Pressable>
                    <Pressable onPress={() => changeMonth(-1)} className="h-9 w-9 items-center justify-center rounded-xl bg-light-100" accessibilityRole="button" accessibilityLabel="Previous month">
                      <Ionicons name="chevron-back" size={17} color={colors.secondary} />
                    </Pressable>
                    <Pressable onPress={() => changeMonth(1)} className="h-9 w-9 items-center justify-center rounded-xl bg-light-100" accessibilityRole="button" accessibilityLabel="Next month">
                      <Ionicons name="chevron-forward" size={17} color={colors.secondary} />
                    </Pressable>
                  </View>
                </View>

                <View className="mb-2 flex-row">
                  {WEEKDAYS.map((day) => (
                    <View key={day} className="flex-1 items-center py-2">
                      <Text className="text-[8px] font-black tracking-wide text-dark-300">{day}</Text>
                    </View>
                  ))}
                </View>

                <View className="flex-row flex-wrap">
                  {cells.map((cell) => {
                    const cellItems = itemsByDate[cell.key] ?? [];
                    const selected = cell.key === selectedDate;
                    const isToday = cell.key === todayKey;
                    const markers = cellItems.slice(0, 3);
                    return (
                      <Pressable
                        key={cell.key}
                        onPress={() => {
                          setSelectedDate(cell.key);
                          if (!cell.inCurrentMonth) {
                            setVisibleMonth(new Date(cell.date.getFullYear(), cell.date.getMonth(), 1));
                          }
                        }}
                        className="w-[14.2857%] items-center py-1.5"
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={`${new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(cell.date)}, ${cellItems.length} expiry ${cellItems.length === 1 ? "item" : "items"}`}
                      >
                        <View className={`h-9 w-9 items-center justify-center rounded-xl ${selected ? "bg-secondary" : isToday ? "border border-primary bg-neutral" : "bg-transparent"} ${!cell.inCurrentMonth ? "opacity-30" : ""}`}>
                          <Text className={`text-xs font-bold ${selected ? "text-light-300" : "text-secondary"}`}>{cell.date.getDate()}</Text>
                        </View>
                        <View className="mt-1 h-2.5 flex-row items-center justify-center gap-0.5">
                          {markers.map((item) => (
                            <View key={item.id} className="h-1 w-1 rounded-full" style={{ backgroundColor: statusColor(getExpiryStatus(cell.key)) }} />
                          ))}
                          {cellItems.length > 3 && <View className="h-1 w-1 rounded-full bg-dark-300" />}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>

                <View className="mt-3 flex-row flex-wrap items-center gap-x-4 gap-y-2 border-t border-light-100 pt-3">
                  {[
                    {label:"Past date", color:"#B65F51"},
                    {label:"Today", color:"#D28A4B"},
                    {label:"Coming up", color:"#B39B52"},
                    {label:"Later", color:"#82926B"},
                  ].map((legend) => (
                    <View key={legend.label} className="flex-row items-center gap-1.5">
                      <View className="h-2 w-2 rounded-full" style={{ backgroundColor: legend.color }} />
                      <Text className="text-[9px] text-dark-300">{legend.label}</Text>
                    </View>
                  ))}
                </View>
              </View>

              {/* SELECTED DAY */}
              <View className="mb-3 flex-row items-end justify-between">
                <View className="min-w-0 flex-1 pr-3">
                  <Text className="text-[9px] font-black tracking-[1.8px] text-dark-300">SELECTED DAY</Text>
                  <Text className="mt-1 text-xl font-black text-secondary">{selectedDateLabel}</Text>
                </View>
                <Text className="pb-1 text-[10px] font-semibold text-dark-300">
                  {selectedItems.length} {selectedItems.length === 1 ? "ingredient" : "ingredients"}
                </Text>
              </View>

              {selectedItems.length > 0 ? (
                <View className="mb-6 gap-2">
                  {selectedItems.map((item) => (
                    <ItemRow
                      key={item.id}
                      item={item}
                      onOpenStorage={() => router.push("/(tabs)/fridge" as never)}
                      onEditExpiry={() => openManualDateEditor(item)}
                    />
                  ))}
                </View>
              ) : (
                <View className="mb-6 rounded-[23px] border border-dashed border-primary bg-light-200 px-4 py-5">
                  <View className="h-10 w-10 items-center justify-center rounded-xl bg-light-100">
                    <Ionicons name="leaf-outline" size={19} color={colors.secondary} />
                  </View>
                  <Text className="mt-3 text-sm font-black text-secondary">Nothing expiring on this day</Text>
                  <Text className="mt-1 text-[10px] leading-4 text-dark-300">Choose another date to see which ingredients are due.</Text>
                </View>
              )}

              {/* ITEMS WITHOUT A DATE */}
              {withoutDate.length > 0 && (
                <View className="mb-5">
                  <View className="mb-3 flex-row items-end justify-between">
                    <View className="min-w-0 flex-1 pr-3">
                      <Text className="text-[9px] font-black tracking-[1.8px] text-dark-300">NEEDS A DATE</Text>
                      <Text className="mt-1 text-xl font-black text-secondary">Not scheduled yet</Text>
                    </View>
                    <Text className="pb-1 text-[10px] font-semibold text-dark-300">{withoutDate.length} items</Text>
                  </View>

                  {actionError && (
                    <View className="mb-3 rounded-xl border border-[#E8C9C2] bg-[#F8ECE8] px-3 py-2.5">
                      <Text className="text-[10px] leading-4 text-[#8F5148]">{actionError}</Text>
                    </View>
                  )}

                  <View className="overflow-hidden rounded-[23px] border border-light-100 bg-light-200">
                    {withoutDate.map((item, index) => (
                      <View key={item.id}>
                        {index > 0 && <View className="mx-4 h-px bg-light-100" />}
                        <View className="flex-row items-center px-3.5 py-3">
                          <View className="mr-3 h-9 w-9 items-center justify-center rounded-xl bg-light-100">
                            <Ionicons name={storageIcon(item.storage_location)} size={17} color={colors.secondary} />
                          </View>
                          <View className="min-w-0 flex-1">
                            <Text className="text-xs font-extrabold text-secondary" numberOfLines={1}>{item.name}</Text>
                            <Text className="mt-1 text-[9px] text-dark-300">{storageLabel(item.storage_location)}</Text>
                          </View>
                          <Pressable
                            onPress={() => openManualDateEditor(item)}
                            className="ml-1 flex-row items-center rounded-full border border-light-100 bg-light-100 px-2.5 py-2"
                            accessibilityRole="button"
                            accessibilityLabel={`Set expiry date manually for ${item.name}`}
                          >
                            <Ionicons name="calendar-outline" size={12} color={colors.secondary} />
                            <Text className="ml-1 text-[8px] font-black text-secondary">Set date</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => void estimateExpiry(item)}
                            disabled={estimatingId !== null}
                            className={`ml-1 flex-row items-center rounded-full bg-neutral px-2.5 py-2 ${estimatingId !== null ? "opacity-50" : ""}`}
                            accessibilityRole="button"
                            accessibilityLabel={`Estimate expiry date for ${item.name}`}
                          >
                            {estimatingId === item.id
                              ? <ActivityIndicator size="small" color={colors.secondary} />
                              : <Ionicons name="sparkles-outline" size={12} color={colors.secondary} />}
                            <Text className="ml-1 text-[8px] font-black text-secondary">Estimate</Text>
                          </Pressable>
                        </View>
                      </View>
                    ))}
                  </View>
                  <Text className="mt-2 text-[9px] leading-4 text-dark-300">
                    Estimates use the ingredient’s typical storage life. Check the packaging and your own judgement for the final date.
                  </Text>
                </View>
              )}

              {datedItems.length === 0 && withoutDate.length === 0 && (
                <View className="mb-6 rounded-[23px] bg-neutral px-5 py-6">
                  <Text className="text-sm font-black text-secondary">Your kitchen is empty</Text>
                  <Text className="mt-1 text-[10px] leading-4 text-dark-300">Add ingredients in Storage to start tracking their freshness here.</Text>
                  <Pressable onPress={() => router.push("/(tabs)/fridge" as never)} className="mt-4 flex-row items-center self-start">
                    <Text className="text-[10px] font-black text-secondary">Open Storage</Text>
                    <Ionicons name="arrow-forward" size={13} color={colors.secondary} style={{ marginLeft: 5 }} />
                  </Pressable>
                </View>
              )}
            </>
          )}

          <View className="items-center py-3">
            <Ionicons name="leaf-outline" size={16} color={colors.neutral} />
            <Text className="mt-2 text-[9px] font-black tracking-wide text-secondary">GOOD FOOD. LESS WASTE.</Text>
          </View>
        </View>
      </ScrollView>
      <Modal
        visible={editingItem !== null}
        animationType="slide"
        presentationStyle="fullScreen"
        onRequestClose={() => {
          if (!savingExpiry) setEditingItem(null);
        }}
      >
        <SafeAreaProvider>
          <SafeAreaView className="flex-1 bg-light-300" edges={["top", "bottom", "left", "right"]}>
            <View className="flex-row items-center justify-between border-b border-light-100 px-4 py-3">
              <Pressable
                onPress={() => setEditingItem(null)}
                disabled={savingExpiry}
                className="h-10 w-10 items-center justify-center rounded-xl bg-light-100"
                accessibilityRole="button"
                accessibilityLabel="Close expiry date editor"
              >
                <Ionicons name="close" size={22} color={colors.secondary} />
              </Pressable>
              <Text className="flex-1 text-center text-[10px] font-black tracking-[1.5px] text-secondary">
                MANUAL EXPIRY DATE
              </Text>
              <View className="h-10 w-10" />
            </View>

            <ScrollView
              className="flex-1"
              contentContainerStyle={{ paddingHorizontal: 20, paddingTop: 22, paddingBottom: 24 }}
              showsVerticalScrollIndicator={false}
            >
              <Text className="text-[9px] font-black tracking-[2px] text-dark-300">SET A DATE YOURSELF</Text>
              <Text className="mt-1 text-2xl font-black text-secondary" numberOfLines={2}>
                {editingItem?.name ?? "Ingredient"}
              </Text>

              <View className="mt-5 rounded-[24px] border border-light-100 bg-light-200 p-4">
                <View className="mb-4 flex-row items-center justify-between">
                  <Pressable
                    onPress={() => setPickerMonth((current) => new Date(current.getFullYear(), current.getMonth() - 1, 1))}
                    className="h-9 w-9 items-center justify-center rounded-xl bg-light-100"
                    accessibilityRole="button"
                    accessibilityLabel="Previous month"
                  >
                    <Ionicons name="chevron-back" size={18} color={colors.secondary} />
                  </Pressable>
                  <Text className="text-sm font-black text-secondary">{pickerMonthLabel}</Text>
                  <Pressable
                    onPress={() => setPickerMonth((current) => new Date(current.getFullYear(), current.getMonth() + 1, 1))}
                    className="h-9 w-9 items-center justify-center rounded-xl bg-light-100"
                    accessibilityRole="button"
                    accessibilityLabel="Next month"
                  >
                    <Ionicons name="chevron-forward" size={18} color={colors.secondary} />
                  </Pressable>
                </View>

                <View className="mb-2 flex-row">
                  {WEEKDAYS.map((day) => (
                    <View key={day} className="flex-1 items-center py-1">
                      <Text className="text-[8px] font-black text-dark-300">{day.slice(0, 1)}</Text>
                    </View>
                  ))}
                </View>

                <View className="flex-row flex-wrap">
                  {pickerCells.map((cell) => {
                    const selected = cell.key === draftExpiryDate;
                    const today = cell.key === todayKey;
                    return (
                      <Pressable
                        key={cell.key}
                        onPress={() => setDraftExpiryDate(cell.key)}
                        className="w-[14.2857%] items-center py-1.5"
                        accessibilityRole="button"
                        accessibilityState={{ selected }}
                        accessibilityLabel={new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" }).format(cell.date)}
                      >
                        <View className={`h-9 w-9 items-center justify-center rounded-xl ${selected ? "bg-secondary" : today ? "border border-primary bg-neutral" : ""} ${!cell.inCurrentMonth ? "opacity-30" : ""}`}>
                          <Text className={`text-xs font-bold ${selected ? "text-light-300" : "text-secondary"}`}>{cell.date.getDate()}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              <View className="mt-4 rounded-2xl bg-neutral px-4 py-3">
                <Text className="text-[9px] font-black tracking-[1.5px] text-dark-300">SELECTED DATE</Text>
                <Text className="mt-1 text-lg font-black text-secondary">
                  {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(parseDateKey(draftExpiryDate) ?? new Date())}
                </Text>
              </View>

              {actionError && (
                <Text className="mt-3 text-xs leading-5 text-red-700">{actionError}</Text>
              )}
            </ScrollView>

            <View className="border-t border-light-100 bg-light-300 px-5 pt-3" style={{ paddingBottom: Math.max(insets.bottom, 12) }}>
              <Pressable
                onPress={() => void saveManualExpiry(draftExpiryDate)}
                disabled={savingExpiry || !parseDateKey(draftExpiryDate)}
                className={`h-12 flex-row items-center justify-center rounded-2xl bg-secondary ${savingExpiry ? "opacity-60" : "active:opacity-80"}`}
                accessibilityRole="button"
                accessibilityLabel="Save expiry date"
              >
                {savingExpiry ? <ActivityIndicator size="small" color={colors.light[300]} /> : <Ionicons name="checkmark" size={17} color={colors.light[300]} />}
                <Text className="ml-2 text-sm font-black text-light-300">{savingExpiry ? "Saving date..." : "Save expiry date"}</Text>
              </Pressable>
              {editingItem?.expiration_date && (
                <Pressable
                  onPress={() => void saveManualExpiry(null)}
                  disabled={savingExpiry}
                  className="mt-2 h-10 items-center justify-center"
                  accessibilityRole="button"
                  accessibilityLabel="Remove expiry date"
                >
                  <Text className="text-[10px] font-black text-[#9B443B]">Remove date</Text>
                </Pressable>
              )}
            </View>
          </SafeAreaView>
        </SafeAreaProvider>
      </Modal>
    </SafeAreaView>
  );
}