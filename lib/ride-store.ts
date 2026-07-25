import AsyncStorage from "@react-native-async-storage/async-storage";

export type RideType = "economy" | "comfort" | "premium";
export type RideStatus =
  | "idle"
  | "searching"
  | "accepted"
  | "arriving"
  | "in_progress"
  | "completed"
  | "cancelled";

export interface Location {
  address: string;
  lat: number;
  lng: number;
}

export interface RideRequest {
  id?: string;
  pickup: Location;
  destination: Location;
  rideType: RideType;
  estimatedFare: number;
  estimatedDuration: number;
  estimatedDistance: number;
  paymentMethod: string;
  promoCode?: string;
}

export interface ActiveRide {
  id: string;
  status: RideStatus;
  rideType: RideType;
  pickup: Location;
  destination: Location;
  driver?: {
    id: string;
    name: string;
    phone: string;
    avatarUrl?: string;
    rating: number;
    totalTrips: number;
    vehicleModel: string;
    vehiclePlate: string;
    vehicleColor: string;
    isVerified: boolean;
    currentLat?: number;
    currentLng?: number;
  };
  fare: number;
  distanceKm: number;
  durationMin: number;
  startedAt?: Date;
  completedAt?: Date;
}

const ACTIVE_RIDE_KEY = "@ridex:active_ride";

export const rideStore = {
  async getActiveRide(): Promise<ActiveRide | null> {
    try {
      const data = await AsyncStorage.getItem(ACTIVE_RIDE_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  },

  async setActiveRide(ride: ActiveRide): Promise<void> {
    await AsyncStorage.setItem(ACTIVE_RIDE_KEY, JSON.stringify(ride));
  },

  async clearActiveRide(): Promise<void> {
    await AsyncStorage.removeItem(ACTIVE_RIDE_KEY);
  },
};

// Fare calculation utility
export const fareConfig = {
  economy: { base: 2.5, perKm: 0.8, perMin: 0.1, label: "Economy", description: "Affordable everyday rides" },
  comfort: { base: 4.0, perKm: 1.2, perMin: 0.15, label: "Comfort", description: "Newer cars, extra legroom" },
  premium: { base: 8.0, perKm: 2.0, perMin: 0.25, label: "Premium", description: "Luxury vehicles & top-rated drivers" },
};

export function calculateFare(
  rideType: RideType,
  distanceKm: number,
  durationMin: number,
  surgeMultiplier = 1.0
): number {
  const config = fareConfig[rideType];
  const fare = (config.base + config.perKm * distanceKm + config.perMin * durationMin) * surgeMultiplier;
  return Math.round(fare * 100) / 100;
}
