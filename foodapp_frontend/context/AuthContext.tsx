import { createContext, useContext, useState, useEffect } from "react";
import { getToken, saveToken, deleteToken } from "../utils/api";

type AuthContextType = {
  token: string | null;
  isLoading: boolean;
  isLoggedIn: boolean;
  login: (token: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // On app startup, check if a token was already saved from a previous session
  useEffect(() => {
    async function loadToken() {
      try {
        const savedToken = await getToken();
        setToken(savedToken);
      } catch (error) {

        setToken(null);
      } finally {
        setIsLoading(false);
      }
    }
    loadToken();
  }, []);

  async function login(newToken: string) {
    await saveToken(newToken);
    setToken(newToken);
  }

  async function logout() {
    await deleteToken();
    setToken(null);
  }

  return (
    <AuthContext.Provider
      value={{
        token,
        isLoading,
        isLoggedIn: !!token,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}


export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth must be used inside AuthProvider");
  return context;
}