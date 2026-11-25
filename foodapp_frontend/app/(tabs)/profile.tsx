import { Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useAuth } from "../../context/AuthContext";
import { router } from "expo-router";

export default function ProfileScreen() {
  const { logout } = useAuth();

  async function handleLogout() {
    await logout();
    router.replace("/login");
  }
  return (
    <SafeAreaView className="flex-1 justify-center px-6 bg-light-300">
      <Text className="text-sm text-dark-300 mb-1">Edit app/profile.tsx to edit this screen.</Text>
      <TouchableOpacity 
      className="bg-light-200 rounded-xl px-4 py-3 mb-4 items-center"
      onPress={handleLogout}> 
        <Text className="text-secondary">Logout</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}
