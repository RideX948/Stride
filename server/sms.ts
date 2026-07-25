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
};

export const isDevSmsMode = () => !smsConfig.provider;

export async function sendSms(phone: string, message: string): Promise<void> {
  if (isDevSmsMode()) {
    console.log(`[SMS:dev] to ${phone}: ${message}`);
    return;
  }

  switch (smsConfig.provider) {
    // case "arkesel": ... POST https://sms.arkesel.com/api/v2/sms/send
    // case "hubtel":  ... POST https://smsc.hubtel.com/v1/messages/send
    // case "twilio":  ... POST https://api.twilio.com/2010-04-01/Accounts/.../Messages.json
    default:
      throw new Error(`SMS provider "${smsConfig.provider}" is not implemented`);
  }
}
