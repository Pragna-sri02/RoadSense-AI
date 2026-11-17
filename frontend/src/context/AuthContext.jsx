import React, { createContext, useContext, useEffect, useState } from "react";
import {
  clearStoredAuth,
  formatErrorMessage,
  getMe,
  getStoredToken,
  getStoredUser,
  loginUser,
  logoutUser,
  registerUser,
  setStoredAuth,
} from "../services/api";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(() => getStoredUser());
  const [token, setToken] = useState(() => getStoredToken());
  const [isLoading, setIsLoading] = useState(true);
  const [authError, setAuthError] = useState("");

  // Validate active session token with backend on initial load / page refresh
  useEffect(() => {
    let isMounted = true;

    async function initializeAuth() {
      const storedToken = getStoredToken();
      if (!storedToken) {
        if (isMounted) {
          setUser(null);
          setToken(null);
          setIsLoading(false);
        }
        return;
      }

      try {
        const profile = await getMe();
        if (isMounted) {
          setUser(profile);
          setToken(storedToken);
          const wasInLocalStorage = Boolean(localStorage.getItem("roadsense_auth_token"));
          setStoredAuth(storedToken, profile, wasInLocalStorage);
        }
      } catch (err) {
        // If token is invalid or expired, clear credentials and reset to logged-out state
        if (isMounted) {
          clearStoredAuth();
          setUser(null);
          setToken(null);
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    initializeAuth();

    return () => {
      isMounted = false;
    };
  }, []);

  const login = async (credentials) => {
    setAuthError("");
    try {
      const rememberMe = Boolean(credentials.remember_me);
      const data = await loginUser(credentials);
      setStoredAuth(data.access_token, data.user, rememberMe);
      setUser(data.user);
      setToken(data.access_token);
      return data;
    } catch (err) {
      const msg = formatErrorMessage(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const register = async (userData) => {
    setAuthError("");
    try {
      const data = await registerUser(userData);
      // Automatically log the user in upon successful registration
      setStoredAuth(data.access_token, data.user, true);
      setUser(data.user);
      setToken(data.access_token);
      return data;
    } catch (err) {
      const msg = formatErrorMessage(err);
      setAuthError(msg);
      throw new Error(msg);
    }
  };

  const logout = async () => {
    try {
      await logoutUser();
    } catch {
      // Ignored - local auth cleared in finally block
    } finally {
      clearStoredAuth();
      setUser(null);
      setToken(null);
      setAuthError("");
    }
  };

  const value = {
    user,
    token,
    isAuthenticated: Boolean(user && token),
    isLoading,
    authError,
    setAuthError,
    login,
    register,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
