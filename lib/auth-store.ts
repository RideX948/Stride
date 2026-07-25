import AsyncStorage from "@react-native-async-storage/async-storage";

export type UserRole = "passenger" | "driver" | null;

export interface RideXUser {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  avatarUrl?: string;
  role: UserRole;
  rating?: number;
  totalRides?: number;
  walletBalance?: number;
}

const STORAGE_KEYS = {
  USER: "@ridex:user",
  ROLE: "@ridex:role",
  TOKEN: "@ridex:token",
  ONBOARDED: "@ridex:onboarded",
};

export const authStore = {
  async getUser(): Promise<RideXUser | null> {
    try {
      const data = await AsyncStorage.getItem(STORAGE_KEYS.USER);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async setUser(user: RideXUser): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.USER, JSON.stringify(user));
  },

  async getRole(): Promise<UserRole> {
    try {
      const role = await AsyncStorage.getItem(STORAGE_KEYS.ROLE);
      return (role as UserRole) ?? null;
    } catch {
      return null;
    }
  },

  async setRole(role: UserRole): Promise<void> {
    if (role) {
      await AsyncStorage.setItem(STORAGE_KEYS.ROLE, role);
    } else {
      await AsyncStorage.removeItem(STORAGE_KEYS.ROLE);
    }
  },

  async isOnboarded(): Promise<boolean> {
    const val = await AsyncStorage.getItem(STORAGE_KEYS.ONBOARDED);
    return val === "true";
  },

  async setOnboarded(): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEYS.ONBOARDED, "true");
  },

  async clearAll(): Promise<void> {
    await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  },
};
