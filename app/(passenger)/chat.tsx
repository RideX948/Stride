import { useLocalSearchParams } from "expo-router";
import React from "react";
import { RideChat } from "@/components/ride-chat";

export default function PassengerChatScreen() {
  const { rideId } = useLocalSearchParams<{ rideId?: string }>();
  return (
    <RideChat
      rideId={Number(rideId ?? 0)}
      accent="#00c8ff"
      title="Message Driver"
      backTo="/(passenger)/tracking"
    />
  );
}
