import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";

const expo = new Expo();

export interface PushNotificationPayload {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: "default" | null;
  badge?: number;
  priority?: "default" | "normal" | "high";
  channelId?: string;
}

/**
 * Send a push notification via Expo Push Notification service.
 * Returns the ticket for tracking delivery status.
 */
export async function sendPushNotification(
  payload: PushNotificationPayload
): Promise<ExpoPushTicket | null> {
  const { to, title, body, data, sound = "default", badge, priority = "high", channelId } = payload;

  // Validate the token
  if (!Expo.isExpoPushToken(to)) {
    console.warn(`[push] Invalid Expo push token: ${to}`);
    return null;
  }

  const message: ExpoPushMessage = {
    to,
    sound,
    title,
    body,
    data,
    badge,
    priority,
    channelId,
  };

  try {
    const chunks = expo.chunkPushNotifications([message]);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    const ticket = tickets[0];
    if (ticket && ticket.status === "error") {
      console.error(`[push] Error sending notification:`, ticket.message, ticket.details);
      return null;
    }

    return ticket ?? null;
  } catch (error) {
    console.error(`[push] Failed to send push notification:`, error);
    return null;
  }
}

/**
 * Send push notifications to multiple tokens in batches.
 */
export async function sendBatchPushNotifications(
  payloads: PushNotificationPayload[]
): Promise<ExpoPushTicket[]> {
  const messages: ExpoPushMessage[] = payloads
    .filter((p) => Expo.isExpoPushToken(p.to))
    .map((p) => ({
      to: p.to,
      sound: p.sound ?? "default",
      title: p.title,
      body: p.body,
      data: p.data,
      badge: p.badge,
      priority: p.priority ?? "high",
      channelId: p.channelId,
    }));

  if (messages.length === 0) {
    console.warn("[push] No valid tokens in batch");
    return [];
  }

  try {
    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    }

    return tickets;
  } catch (error) {
    console.error(`[push] Failed to send batch notifications:`, error);
    return [];
  }
}
