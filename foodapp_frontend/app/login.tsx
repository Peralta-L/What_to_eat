import { useState } from "react";
import { TextInput, Text, View, TouchableOpacity } from "react-native";
import { router } from "expo-router";
import { apiFetch, getToken } from "../utils/api";
import { useAuth } from "../context/AuthContext";

export default function LoginScreen() {
  const [user, setUser] = useState("");
  const [password, setPassword] = useState("");
  const { login } = useAuth();

  async function handleLogin() {
    try {
      const data = await apiFetch("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ user, password }),
      });

      await login(data.access_token);

      router.replace("/(tabs)");
    } catch (error: any) {
      alert(error.message || "Login failed");
    }
  }

  async function handleRegister() {
    router.replace("/register");
  }

  return (
    <View className="flex-1 justify-center px-6 bg-light-300">
      <Text className="text-xl font-bold text-secondary mb-6">Login</Text>

      <Text className="text-sm text-dark-300 mb-1">Email or Username</Text>
      <TextInput
        className="bg-light-200 rounded-xl px-4 py-3 mb-4 text-secondary"
        placeholder="Email or Username"
        value={user}
        onChangeText={setUser}
        autoCapitalize="none"
      />

      <Text className="text-sm text-dark-300 mb-1">Password</Text>
      <TextInput
        className="bg-light-200 rounded-xl px-4 py-3 mb-4 text-secondary"
        placeholder="Password"
        value={password}
        onChangeText={setPassword}
        secureTextEntry
      />

      <TouchableOpacity
        className="bg-secondary rounded-xl py-3 items-center"
        onPress={handleLogin}
      >
        <Text className="text-light-300 font-bold">Login</Text>
      </TouchableOpacity>
      
      <TouchableOpacity
        className="bg-secondary rounded-xl py-3 items-center mt-4"
        onPress={handleRegister}
      >
        <Text className="text-light-300 font-bold">Register</Text>
      </TouchableOpacity>
    </View>
  );
}