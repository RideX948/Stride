import React, { createContext, useCallback, useContext, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { authStore, RideXUser, UserRole } from "./auth-store";
import * as Api from "./_core/api";
import * as Auth from "./_core/auth";

interface RideXContextValue {
  user: RideXUser | null;
  role: UserRole;
  isLoading: boolean;
  isAuthenticated: boolean;
  setUser: (user: RideXUser) => Promise<void>;
  setRole: (role: UserRole) => Promise<void>;
  logout: () => Promise<void>;
}

const RideXContext = createContext<RideXContextValue | null>(null);

export function RideXProvider({ children }: { children: React.ReactNode }) {
  const [user, setUserState] = useState<RideXUser | null>(null);
  const [role, setRoleState] = useState<UserRole>(null);
  const [isLoading, setIsLoading] = useState(true);
  const queryClient = useQueryClient();

  useEffect(() => {
    async function loadState() {
      try {
        const [savedUser, savedRole] = await Promise.all([
          authStore.getUser(),
          authStore.getRole(),
        ]);
        if (savedUser) setUserState(savedUser);
        if (savedRole) setRoleState(savedRole);
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    }
    loadState();
  }, []);

  const setUser = useCallback(async (newUser: RideXUser) => {
    await authStore.setUser(newUser);
    setUserState(newUser);
  }, []);

  const setRole = useCallback(async (newRole: UserRole) => {
    await authStore.setRole(newRole);
    setRoleState(newRole);
  }, []);

  const logout = useCallback(async () => {
    // Invalidate the server session (clears cookie on web); best-effort
    try {
      await Api.logout();
    } catch {
      // offline or server unavailable — still clear local state
    }
    await Auth.removeSessionToken();
    await Auth.clearUserInfo();
    await authStore.clearAll();
    setUserState(null);
    setRoleState(null);
    // Drop every cached query (auth.me, wallets, history, ...) so the auth
    // screen doesn't see the previous user and bounce to role-select.
    queryClient.clear();
  }, [queryClient]);

  return (
    <RideXContext.Provider
      value={{
        user,
        role,
        isLoading,
        isAuthenticated: !!user,
        setUser,
        setRole,
        logout,
      }}
    >
      {children}
    </RideXContext.Provider>
  );
}

export function useRideX() {
  const ctx = useContext(RideXContext);
  if (!ctx) throw new Error("useRideX must be used within RideXProvider");
  return ctx;
}
