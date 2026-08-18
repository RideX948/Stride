/**
 * SMS delivery abstraction.
 *
 * In development (no SMS_PROVIDER configured) codes are logged to the server
 * console and returned to the client so the flow is fully testable.
 *
 * To go live, set SMS_PROVIDER and implement the provider branch below
 * (Arkesel and Hubtel are popular in Ghana; Twilio works globally).
 */

export const smsConfig = {
  provider: process.env.SMS_PROVIDER ?? "", // "" = dev mode
  apiKey: process.env.SMS_API_KEY ?? "",
  senderId: process.env.SMS_SENDER_ID ?? "RideX",
  /** Hubtel only: SMS client ID */
  clientId: process.env.SMS_CLIENT_ID ?? "",
};

export const isDevSmsMode = () => !smsConfig.provider;

async function sendViaArkesel(phone: string, message: string): Promise<void> {
  const res = await fetch("https://sms.arkesel.com/api/v2/sms/send", {
    method: "POST",
    headers: {
      "api-key": smsConfig.apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: smsConfig.senderId,
      message,
      recipients: [phone.replace(/^\+/, "")],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Arkesel SMS failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

async function sendViaHubtel(phone: string, message: string): Promise<void> {
  const auth = Buffer.from(`${smsConfig.clientId}:${smsConfig.apiKey}`).toString("base64");
  const res = await fetch("https://smsc.hubtel.com/v1/messages/send", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      From: smsConfig.senderId,
      To: phone,
      Content: message,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Hubtel SMS failed (${res.status}): ${body.slice(0, 200)}`);
  }
}

async function sendViaTwilio(phone: string, message: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID ?? "";
  const from = process.env.TWILIO_FROM_NUMBER ?? smsConfig.senderId;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;
  const body = new URLSearchParams({ To: phone, From: from, Body: message });
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${smsConfig.apiKey}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Twilio SMS failed (${res.status}): ${text.slice(0, 200)}`);
  }
}

export async function sendSms(phone: string, message: string): Promise<void> {
  if (isDevSmsMode()) {
    console.log(`[SMS:dev] to ${phone}: ${message}`);
    return;
  }

  switch (smsConfig.provider) {
    case "arkesel":
      return sendViaArkesel(phone, message);
    case "hubtel":
      return sendViaHubtel(phone, message);
    case "twilio":
      return sendViaTwilio(phone, message);
    default:
      throw new Error(`SMS provider "${smsConfig.provider}" is not implemented`);
  }
}
