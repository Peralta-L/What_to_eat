
import { useEffect, useRef, useState } from 'react';
import {
  Pressable,
  Text,
  View,
} from 'react-native';
import PagerView from 'react-native-pager-view';
import { router, usePathname } from 'expo-router';
import { MaterialCommunityIcons } from '@expo/vector-icons';

import { colors } from '../../constants/colors';

import HomeScreen from './index';
import ExploreScreen from './explore';
import FridgeScreen from './fridge';
import CalendarScreen from './calendar';
import ProfileScreen from './profile';

const TABS = [
  { name: 'Home', route: '/(tabs)', icon: 'barn' },
  { name: 'Explore', route: '/(tabs)/explore', icon: 'chef-hat' },
  { name: 'Fridge', route: '/(tabs)/fridge', icon: 'fridge-outline' },
  { name: 'Calendar', route: '/(tabs)/calendar', icon: 'calendar-heart' },
  { name: 'Profile', route: '/(tabs)/profile', icon: 'account-circle-outline' },
] as const;

// Pager pages are reversed so a left swipe from Explore goes to Home.
// The bottom navigation remains in the normal Home-to-Profile order.
const PAGES = [
  HomeScreen,
  ExploreScreen,
  FridgeScreen,
  CalendarScreen,
  ProfileScreen,
];

function getTabIndex(pathname: string): number {
  if (pathname.endsWith('/explore')) return 1;
  if (pathname.endsWith('/fridge')) return 2;
  if (pathname.endsWith('/calendar')) return 3;
  if (pathname.endsWith('/profile')) return 4;
  return 0;
}

export default function TabsLayout() {
  const pathname = usePathname();
  const pagerRef = useRef<PagerView>(null);

  const [activeTab, setActiveTab] = useState(() =>
    getTabIndex(pathname)
  );

  const currentTab = getTabIndex(pathname);

  useEffect(() => {
    setActiveTab(currentTab);
    pagerRef.current?.setPage(currentTab);
  }, [currentTab]);

  function selectTab(index: number) {
    setActiveTab(index);
    pagerRef.current?.setPage(index);
    router.navigate({ pathname: TABS[index].route as any });
  }

  function handlePageSelected(position: number) {
    setActiveTab(position);
    router.navigate({ pathname: TABS[position].route as any });
  }

  return (
    <View className="flex-1 bg-light-300">
      <PagerView
        ref={pagerRef}
        style={{ flex: 1 }}
        initialPage={currentTab}
        offscreenPageLimit={1}
        onPageSelected={(event) =>
          handlePageSelected(event.nativeEvent.position)
        }
      >
        {PAGES.map((Screen, index) => (
          <View
            key={index}
            collapsable={false}
            style={{ flex: 1 }}
          >
            <Screen />
          </View>
        ))}
      </PagerView>

      {/* Floating bottom navigation */}
      <View
        className="absolute left-[10px] right-[10px] bottom-[25px] h-16 flex-row items-center rounded-[20px] bg-light-100"
        style={{
          elevation: 5,
          shadowColor: '#000',
          shadowOpacity: 0.5,
          shadowOffset: { width: 0, height: 4 },
          shadowRadius: 8,
        }}
      >
        {TABS.map((tab, index) => {
          const focused = activeTab === index;

          return (
            <Pressable
              key={tab.name}
              onPress={() => selectTab(index)}
              className="flex-1 items-center justify-center"
              accessibilityRole="button"
              accessibilityLabel={tab.name}
              accessibilityState={{ selected: focused }}
            >
              <MaterialCommunityIcons
                name={tab.icon}
                size={24}
                color={
                  focused
                    ? colors.secondary
                    : colors.dark[200]
                }
              />

              <Text
                className={`mt-1 text-[10px] font-semibold ${
                  focused ? 'text-secondary' : 'text-dark-300'
                }`}
              >
                {tab.name}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}