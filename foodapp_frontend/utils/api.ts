import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";

const API_BASE_URL = "https://what-to-eat-kc1h.onrender.com";

export async function apiFetch(path: string, options: RequestInit = {}) {
  const token = await getToken();
  const url = `${API_BASE_URL}${path}`;

  const headers = {
    "Content-Type": "application/json",
    ...(token && { Authorization: `Bearer ${token}` }),
    ...options.headers,
  };

  const response = await fetch(url, {
    ...options,
    headers,
  });

  const data = await response.json();

  if (!response.ok) {
    let errorMessage = "Something went wrong";

    if (typeof data.detail === "string") {
      errorMessage = data.detail;
    } else if (Array.isArray(data.detail)) {
      errorMessage = data.detail
        .map((error: any) => error.msg || JSON.stringify(error))
        .join("\n");
    } else if (data.detail) {
      errorMessage = JSON.stringify(data.detail);
    }

    throw new Error(errorMessage);
  }

  return data;
}

export async function saveToken(token: string) {
  if (Platform.OS === "web") {
    localStorage.setItem("token", token);
  } else {
    await SecureStore.setItemAsync("token", token);
  }
}

export async function getToken() {
  if (Platform.OS === "web") {
    return localStorage.getItem("token");
  }

  return await SecureStore.getItemAsync("token");
}

export async function deleteToken() {
  if (Platform.OS === "web") {
    localStorage.removeItem("token");
  } else {
    await SecureStore.deleteItemAsync("token");
  }
}