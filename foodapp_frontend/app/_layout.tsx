import { Redirect, Stack, Tabs, usePathname } from "expo-router";
import "../global.css";
import { AuthProvider, useAuth } from "../context/AuthContext";
import { Text, View } from "react-native";

function RootNavigation() {
  const { isLoading, isLoggedIn } = useAuth();
  const pathname = usePathname();
  if (isLoading) {
    return (
      <View className="flex-1 justify-center items-center">
        <Text className="text-secondary text-lg">
          Esta Cargando Prro...
        </Text>
      </View>
    );
  }
  const isPublicRoute =
    pathname === "/login" || pathname === "/register";

  // User is NOT logged in
  if (!isLoggedIn && !isPublicRoute) {
    // They're already on login, so let the Stack render it
    if (pathname === "/login") {
      return (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: {
              backgroundColor: "#FAEEE7",
            },
          }}
        />
      );
    }

    // They're trying to access a protected route
    return <Redirect href="/login" />;
  }

  // User IS logged in
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        contentStyle: {
          backgroundColor: "#FAEEE7",
        },
      }}
    />
  );
}

export default function RootLayout() {
  return (
    <AuthProvider>
      <RootNavigation />
    </AuthProvider>
  );
}