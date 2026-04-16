import { createContext, useContext, useMemo, useState } from "react";
import { attachToken, api } from "../api/client";
import type { User } from "../types";

interface AuthValue {
  token: string | null;
  user: User | null;
  login: (email: string, password: string) => Promise<void>;
  register: (payload: {
    name: string;
    email: string;
    password: string;
    tenantId: string;
    role: User["role"];
  }) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);
const STORAGE_KEY = "video-app-auth";

function parseSavedAuth() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { token: null, user: null };
  try {
    return JSON.parse(raw) as { token: string; user: User };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const saved = parseSavedAuth();
  const [token, setToken] = useState<string | null>(saved.token);
  const [user, setUser] = useState<User | null>(saved.user);

  attachToken(token);

  const persist = (nextToken: string | null, nextUser: User | null) => {
    setToken(nextToken);
    setUser(nextUser);
    attachToken(nextToken);
    if (!nextToken || !nextUser) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ token: nextToken, user: nextUser }));
  };

  const value = useMemo<AuthValue>(
    () => ({
      token,
      user,
      login: async (email, password) => {
        const { data } = await api.post("/auth/login", { email, password });
        persist(data.token, data.user);
      },
      register: async (payload) => {
        const { data } = await api.post("/auth/register", payload);
        persist(data.token, data.user);
      },
      logout: () => persist(null, null),
    }),
    [token, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
