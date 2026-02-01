import { Platform } from "react-native";
import Purchases, { LOG_LEVEL, CustomerInfo } from "react-native-purchases";

const ENTITLEMENT_ID = "pro";

function getIosKey(): string {
  const k = process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY;
  return (k || "").trim();
}

let _configured = false;

export function billingIsSupported(): boolean {
  // iOS works now. Android later when you create products + add Android key.
  return Platform.OS === "ios";
}

export async function configureBillingOnce(): Promise<void> {
  if (_configured) return;

  Purchases.setLogLevel(LOG_LEVEL.WARN);

  if (Platform.OS === "ios") {
    const apiKey = getIosKey();
    if (!apiKey) {
      // Don’t crash the app; just leave billing disabled.
      console.warn("RevenueCat iOS API key missing (EXPO_PUBLIC_REVENUECAT_IOS_API_KEY).");
      return;
    }
    Purchases.configure({ apiKey });
    _configured = true;
    return;
  }

  // Android not enabled yet in your flow.
  return;
}

export async function loginBillingUser(appUserId: string): Promise<void> {
  if (!billingIsSupported()) return;
  await configureBillingOnce();
  if (!_configured) return;

  // RevenueCat uses this as the identity key
  await Purchases.logIn(appUserId);
}

export async function getCustomerInfoSafe(): Promise<CustomerInfo | null> {
  if (!billingIsSupported()) return null;
  await configureBillingOnce();
  if (!_configured) return null;

  try {
    return await Purchases.getCustomerInfo();
  } catch (e) {
    console.warn("Purchases.getCustomerInfo failed", e);
    return null;
  }
}

export async function hasProEntitlement(): Promise<boolean> {
  const info = await getCustomerInfoSafe();
  if (!info) return false;
  return typeof info.entitlements.active[ENTITLEMENT_ID] !== "undefined";
}
