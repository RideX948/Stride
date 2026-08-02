import { useLocalSearchParams } from "expo-router";
import React from "react";
import { RideChat } from "@/components/ride-chat";

export default function DriverChatScreen() {
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  return (
    <RideChat
      rideId={Number(rideId ?? 0)}
      accent="#00e887"
      title="Message Passenger"
      backTo="/(driver)/home"
    />
  );
}
