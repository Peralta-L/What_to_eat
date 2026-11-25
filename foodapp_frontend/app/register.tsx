import { apiFetch } from "@/utils/api";
import { router } from "expo-router";
import { useState } from "react";
import { Text, TextInput, TouchableOpacity, View } from "react-native";

export default function Register() {
    const [username, setUsername] = useState("");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [name, setFirstName] = useState("");
    const [lastname, setLastName] = useState("");
    
    async function handleRegister() {
        try {
            if (!username || !email || !password || !name || !lastname) {
                alert("Please fill in all fields");
                return;
            }
            const data = await apiFetch("/api/auth/register", {
                method: "POST",
                body: JSON.stringify({ username, email, password, name, lastname }),
            });
            alert("Registration successful");
            goToLogin();
        } catch (error: any) {
            alert(error.message || "Registration failed");
        }
    }

    async function goToLogin() {
        router.replace("/login");
    }

    return (
    <View className="flex-1 justify-center px-6 bg-light-300">
        <Text className="text-xl font-bold text-secondary mb-6">Register</Text>

        <View className="flex-row gap-3 mb-1">

            <View className="flex-1">
                <Text className="text-sm text-dark-300 mb-1">First Name</Text>
                <TextInput
                    className="bg-light-200 rounded-xl px-4 py-3 mb-4 text-secondary"
                    placeholder="First Name"
                    value={name}
                    onChangeText={setFirstName}
                    autoCapitalize="none"
                />
            </View>
            <View className="flex-1">
                <Text className="text-sm text-dark-300 mb-1">Last Name</Text>
                <TextInput
                    className="bg-light-200 rounded-xl px-4 py-3 mb-4 text-secondary"
                    placeholder="Last Name"
                    value={lastname}
                    onChangeText={setLastName}
                    autoCapitalize="none"
                />
            </View>
        </View>

        <Text className="text-sm text-dark-300 mb-1">Username</Text>
        <TextInput
            className="bg-light-200 rounded-xl px-4 py-3 mb-4 text-secondary"
            placeholder="Username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
        />

        <Text className="text-sm text-dark-300 mb-1">Email</Text>
        <TextInput
            className="bg-light-200 rounded-xl px-4 py-3 mb-4 text-secondary"
            placeholder="Email"
            value={email}
            onChangeText={setEmail}
            autoCapitalize="none"
        />

        <Text className="text-sm text-dark-300 mb-1">Password</Text>
        <TextInput
            className="bg-light-200 rounded-xl px-4 py-3 mb-6 text-secondary"
            placeholder="Password"
            value={password}
            onChangeText={setPassword}
            secureTextEntry
        />

        <TouchableOpacity
            className="bg-secondary rounded-xl py-3 items-center"
            onPress={handleRegister}
        >
            <Text className="text-light-300 font-bold">Register</Text>
        </TouchableOpacity>
        
        <TouchableOpacity
            className="mt-4 items-center"
            onPress={goToLogin}
        >
            <Text className="text-secondary font-bold">Already have an account? Login</Text>
        </TouchableOpacity>
        </View>
    );
}