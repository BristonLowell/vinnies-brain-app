import { Platform } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

const ENTITLEMENT_ID = "Vinnies Brain Pro";
let configured = false;

function getIosKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "").trim();
}
function getAndroidKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || "").trim();
}

export function billingIsSupported(): boolean {
  if (Platform.OS === "ios") return true;
  if (Platform.OS === "android") return Boolean(getAndroidKey()); // enable later
  return false;
}

export async function configureBillingOnce(): Promise<void> {
  if (configured) return;

  Purchases.setLogLevel(LOG_LEVEL.WARN);

  if (Platform.OS === "ios") {
    const apiKey = getIosKey();
    if (!apiKey) {
      console.warn("Missing EXPO_PUBLIC_REVENUECAT_IOS_API_KEY");
      return;
    }
    Purchases.configure({ apiKey });
    configured = true;
    return;
  }

  if (Platform.OS === "android") {
    const apiKey = getAndroidKey();
    if (!apiKey) return;
    Purchases.configure({ apiKey });
    configured = true;
  }
}

// Backwards-compatible alias (some files import configureBilling)
export async function configureBilling(): Promise<void> {
  return await configureBillingOnce();
}

export async function loginBillingUser(appUserId: string): Promise<void> {
  if (!billingIsSupported()) return;
  await configureBillingOnce();
  if (!configured) return;

  try {
    await Purchases.logIn(appUserId);
  } catch (e) {
    console.warn("Purchases.logIn failed", e);
  }
}

export async function hasProEntitlement(): Promise<boolean> {
  if (!billingIsSupported()) return false;
  await configureBillingOnce();
  if (!configured) return false;

  try {
    const info = await Purchases.getCustomerInfo();
    return Boolean(info.entitlements.active[ENTITLEMENT_ID]);
  } catch (e) {
    console.warn("getCustomerInfo failed", e);
    return false;
  }
}
