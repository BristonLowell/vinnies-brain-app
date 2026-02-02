import Purchases, { LOG_LEVEL, CustomerInfo } from "react-native-purchases";
import { Platform } from "react-native";

const ENTITLEMENT_ID = "pro";

let configured = false;

export function billingIsSupported(): boolean {
  return Platform.OS === "ios";
}

export async function configureBilling(): Promise<boolean> {
  if (!billingIsSupported()) return false;
  if (configured) return true;

  const apiKey = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;

  if (!apiKey) {
    console.warn("RevenueCat iOS API key missing");
    return false;
  }

  Purchases.setLogLevel(LOG_LEVEL.WARN);
  await Purchases.configure({ apiKey });

  configured = true;
  return true;
}

export async function loginBillingUser(userId: string) {
  if (!billingIsSupported()) return;
  const ok = await configureBilling();
  if (!ok) return;

  await Purchases.logIn(userId);
}

export async function getCustomerInfo(): Promise<CustomerInfo | null> {
  if (!billingIsSupported()) return null;
  const ok = await configureBilling();
  if (!ok) return null;

  try {
    return await Purchases.getCustomerInfo();
  } catch {
    return null;
  }
}

export async function hasProEntitlement(): Promise<boolean> {
  const info = await getCustomerInfo();
  if (!info) return false;
  return !!info.entitlements.active[ENTITLEMENT_ID];
}
