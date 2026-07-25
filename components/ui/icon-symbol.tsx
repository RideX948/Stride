// Fallback for using MaterialIcons on Android and web.

import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { SymbolWeight, SymbolViewProps } from "expo-symbols";
import { ComponentProps } from "react";
import { OpaqueColorValue, type StyleProp, type TextStyle } from "react-native";

type IconMapping = Record<SymbolViewProps["name"], ComponentProps<typeof MaterialIcons>["name"]>;
type IconSymbolName = keyof typeof MAPPING;

const MAPPING = {
  // Navigation
  "house.fill": "home",
  "house": "home",
  "paperplane.fill": "send",
  "chevron.left.forwardslash.chevron.right": "code",
  "chevron.right": "chevron-right",
  "chevron.left": "chevron-left",
  "chevron.down": "expand-more",
  "chevron.up": "expand-less",

  // Tabs - Passenger
  "map.fill": "map",
  "clock.fill": "history",
  "wallet.pass.fill": "account-balance-wallet",
  "person.fill": "person",
  "person.circle.fill": "account-circle",

  // Tabs - Driver
  "chart.bar.fill": "bar-chart",
  "car.fill": "directions-car",
  "car.side.fill": "directions-car",
  "list.bullet": "list",

  // Map & Location
  "location.fill": "location-on",
  "location.north.fill": "navigation",
  "mappin.and.ellipse": "place",
  "mappin": "place",
  "scope": "my-location",
  "arrow.triangle.turn.up.right.diamond.fill": "turn-right",

  // Ride Actions
  "phone.fill": "phone",
  "message.fill": "message",
  "exclamationmark.triangle.fill": "warning",
  "sos": "sos",
  "shield.fill": "shield",
  "shield.lefthalf.filled": "security",

  // Status & Ratings
  "star.fill": "star",
  "star": "star-border",
  "checkmark.circle.fill": "check-circle",
  "xmark.circle.fill": "cancel",
  "xmark": "close",
  "checkmark": "check",

  // Payment & Earnings
  "creditcard.fill": "credit-card",
  "banknote.fill": "payments",
  "dollarsign.circle.fill": "monetization-on",
  "arrow.up.right": "trending-up",
  "arrow.down.right": "trending-down",

  // UI
  "bell.fill": "notifications",
  "bell": "notifications-none",
  "gear": "settings",
  "gearshape.fill": "settings",
  "line.3.horizontal": "menu",
  "magnifyingglass": "search",
  "plus": "add",
  "minus": "remove",
  "info.circle.fill": "info",
  "questionmark.circle.fill": "help",
  "pencil": "edit",
  "trash.fill": "delete",
  "square.and.arrow.up": "share",
  "eye.fill": "visibility",
  "eye.slash.fill": "visibility-off",

  // User
  "person.badge.plus": "person-add",
  "person.2.fill": "people",
  "lock.fill": "lock",
  "key.fill": "vpn-key",

  // Misc
  "bolt.fill": "bolt",
  "gift.fill": "card-giftcard",
  "leaf.fill": "eco",
  "mic.fill": "mic",
  "wifi": "wifi",
  "wifi.slash": "wifi-off",
} as IconMapping;

export function IconSymbol({
  name,
  size = 24,
  color,
  style,
}: {
  name: IconSymbolName;
  size?: number;
  color: string | OpaqueColorValue;
  style?: StyleProp<TextStyle>;
  weight?: SymbolWeight;
}) {
  return <MaterialIcons color={color} size={size} name={MAPPING[name]} style={style} />;
}
