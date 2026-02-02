import { Platform, Linking } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

// Your RevenueCat entitlement identifier (you said this is correct)
const ENTITLEMENT_ID = "Vinnies Brain Pro";

// ✅ Since you only have ONE subscription right now,
// we’ll treat ANY active subscription as “pro” even if entitlements are misconfigured.
const ACCEPT_ANY_ACTIVE_SUBSCRIPTION = false;

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

export async function debugCustomerInfo(): Promise<string> {
  await configureBillingOnce();
  const info = await Purchases.getCustomerInfo();

  const activeEntitlements = Object.keys(info.entitlements.active || {});
  const allEntitlements = Object.keys(info.entitlements.all || {});
  const activeSubs = info.activeSubscriptions || [];

  const latestExp =
    (activeEntitlements[0] &&
      info.entitlements.active[activeEntitlements[0]]?.expirationDate) ||
    null;

  return [
    `activeEntitlements: ${JSON.stringify(activeEntitlements)}`,
    `allEntitlements: ${JSON.stringify(allEntitlements)}`,
    `activeSubscriptions: ${JSON.stringify(activeSubs)}`,
    `exampleExpiration: ${latestExp ?? "n/a"}`,
  ].join("\n");
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

    // Primary: entitlement check
    const hasEnt = Boolean(info.entitlements.active?.[ENTITLEMENT_ID]);

    // Fallback: treat any active subscription as pro (since you have one sub)
    const hasActiveSub =
      ACCEPT_ANY_ACTIVE_SUBSCRIPTION && (info.activeSubscriptions?.length ?? 0) > 0;

    return hasEnt || hasActiveSub;
  } catch (e) {
    console.warn("getCustomerInfo failed", e);
    return false;
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!billingIsSupported()) return false;
  await configureBillingOnce();
  if (!configured) return false;

  try {
    await Purchases.restorePurchases();
    return await hasProEntitlement();
  } catch (e) {
    console.warn("restorePurchases failed", e);
    return false;
  }
}

export async function openManageSubscription(): Promise<void> {
  if (Platform.OS === "ios") {
    await Linking.openURL("itms-apps://apps.apple.com/account/subscriptions");
    return;
  }
  await Linking.openURL("https://play.google.com/store/account/subscriptions");
}
