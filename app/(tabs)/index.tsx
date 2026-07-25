import { Redirect } from "expo-router";

// Redirect all traffic from the default (tabs) route to the auth screen.
// The actual app entry point is app/auth.tsx → role-select → (passenger) or (driver).
export default function TabsIndex() {
  return <Redirect href="/auth" />;
}
