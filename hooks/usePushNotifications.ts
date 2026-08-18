import { useEffect, useRef } from "react";
import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { trpc } from "@/lib/trpc";
import { useAuth } from "./use-auth";

// Configure how notifications should be handled when the app is in the foreground
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

export function usePushNotifications() {
  const { user } = useAuth();
  const notificationListener = useRef<Notifications.Subscription | null>(null);
  const responseListener = useRef<Notifications.Subscription | null>(null);
  const registerToken = trpc.notifications.registerPushToken.useMutation();

  useEffect(() => {
    if (!user?.id) return;

    // Request permission and register push token
    (async () => {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;

      if (existingStatus !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }

      if (finalStatus !== "granted") {
        console.warn("[push] Permission denied");
        return;
      }

      // Get push token
      const token = await Notifications.getExpoPushTokenAsync({
        projectId: "your-project-id", // Will be ignored in dev, but required for builds
      });

      // Register token with backend
      registerToken.mutate({
        token: token.data,
      });

      // Android: create notification channel
      if (Platform.OS === "android") {
        Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: "#3B6DFF",
        });
      }
    })();

    // Listen for notifications received while app is in foreground
    notificationListener.current = Notifications.addNotificationReceivedListener((notification) => {
      console.log("[push] Notification received:", notification);
    });

    // Listen for user tapping on notification
    responseListener.current = Notifications.addNotificationResponseReceivedListener((response) => {
      console.log("[push] Notification tapped:", response);
      // TODO: Navigate to relevant screen based on notification.request.content.data
    });

    return () => {
      if (notificationListener.current) {
        notificationListener.current.remove();
      }
      if (responseListener.current) {
        responseListener.current.remove();
      }
    };
  }, [user?.id]);
}
