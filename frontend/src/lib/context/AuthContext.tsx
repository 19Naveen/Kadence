import { createContext, ReactNode, useContext, useEffect, useMemo, useState } from "react";
import { clearSession, readSession, writeSession } from "../auth/storage";
import { readError } from "../http";
import {
  AuthContextValue,
  AuthSession,
  LoginInput,
  SignupInput,
} from "../auth/types";

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000/api/v1";

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

interface AuthApiResponse {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
  user: {
    id: string;
    username: string;
    email: string;
    created_at: string;
    auth_provider: "local" | "google" | "github" | "microsoft";
  };
}

async function requestAuth(
  endpoint: "login" | "signup",
  payload: LoginInput | SignupInput
): Promise<AuthSession> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/auth/${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new Error("Can't reach the server. Check your connection and try again.");
  }

  if (!response.ok) {
    throw new Error(
      await readError(response, endpoint === "login" ? "Sign in failed. Please try again." : "Sign up failed. Please try again.")
    );
  }

  const data = (await response.json()) as AuthApiResponse;

  return {
    accessToken: data.access_token,
    tokenType: data.token_type,
    expiresIn: data.expires_in,
    user: {
      id: data.user.id,
      username: data.user.username,
      email: data.user.email,
      createdAt: data.user.created_at,
      authProvider: data.user.auth_provider,
    },
  };
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [session, setSession] = useState<AuthSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const existingSession = readSession();
    setSession(existingSession);
    setIsLoading(false);
  }, []);

  const loginWithCredentials = async (input: LoginInput): Promise<void> => {
    const nextSession = await requestAuth("login", input);
    writeSession(nextSession);
    setSession(nextSession);
  };

  const signupWithCredentials = async (input: SignupInput): Promise<void> => {
    const nextSession = await requestAuth("signup", input);
    writeSession(nextSession);
    setSession(nextSession);
  };

  const logout = (): void => {
    clearSession();
    setSession(null);
  };

  const value = useMemo<AuthContextValue>(
    () => ({
      isAuthenticated: Boolean(session?.accessToken),
      isLoading,
      user: session?.user ?? null,
      session,
      loginWithCredentials,
      signupWithCredentials,
      logout,
    }),
    [isLoading, session]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuthContext(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider.");
  }

  return context;
}
