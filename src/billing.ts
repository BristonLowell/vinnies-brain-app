import { Platform, Linking } from "react-native";
import Purchases, { LOG_LEVEL } from "react-native-purchases";

// RevenueCat entitlement identifier. This must exactly match the identifier
// shown under RevenueCat -> Product Catalog -> Entitlements.
const ENTITLEMENT_ID = "Vinnies Brain Pro";

// Vinnie's Brain currently has one paid subscription. This fallback prevents
// a paying customer from being locked out when RevenueCat recognizes the
// active App Store subscription but the product is not attached to the
// entitlement correctly.
const ACCEPT_ANY_ACTIVE_SUBSCRIPTION = true;

let configured = false;

type CustomerInfo = Awaited<ReturnType<typeof Purchases.getCustomerInfo>>;

function getIosKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY || "").trim();
}

function getAndroidKey(): string {
  return (process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY || "").trim();
}

function customerHasPro(info: CustomerInfo): boolean {
  const hasEntitlement = Boolean(
    info.entitlements.active?.[ENTITLEMENT_ID]
  );

  const hasActiveSubscription =
    ACCEPT_ANY_ACTIVE_SUBSCRIPTION &&
    (info.activeSubscriptions?.length ?? 0) > 0;

  return hasEntitlement || hasActiveSubscription;
}

export function billingIsSupported(): boolean {
  if (Platform.OS === "ios") return Boolean(getIosKey());
  if (Platform.OS === "android") return Boolean(getAndroidKey());
  return false;
}

export async function configureBillingOnce(): Promise<void> {
  if (configured) return;

  Purchases.setLogLevel(LOG_LEVEL.WARN);

  const apiKey =
    Platform.OS === "ios"
      ? getIosKey()
      : Platform.OS === "android"
        ? getAndroidKey()
        : "";

  if (!apiKey) {
    throw new Error(
      Platform.OS === "ios"
        ? "Missing EXPO_PUBLIC_REVENUECAT_IOS_API_KEY"
        : Platform.OS === "android"
          ? "Missing EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY"
          : "Subscriptions are not supported on this platform."
    );
  }

  Purchases.configure({ apiKey });
  configured = true;
}

// Backwards-compatible alias.
export async function configureBilling(): Promise<void> {
  await configureBillingOnce();
}

export async function loginBillingUser(appUserId: string): Promise<void> {
  if (!billingIsSupported()) return;

  const userId = (appUserId || "").trim();
  if (!userId) return;

  await configureBillingOnce();

  try {
    await Purchases.logIn(userId);
  } catch (error) {
    console.warn("Purchases.logIn failed", error);
  }
}

export async function hasProEntitlement(): Promise<boolean> {
  if (!billingIsSupported()) return false;

  await configureBillingOnce();

  try {
    const info = await Purchases.getCustomerInfo();
    return customerHasPro(info);
  } catch (error) {
    console.warn("getCustomerInfo failed", error);
    return false;
  }
}

export async function restorePurchases(): Promise<boolean> {
  if (!billingIsSupported()) return false;

  await configureBillingOnce();

  try {
    // Use the fresh CustomerInfo returned by the restore itself. Do not discard
    // it and perform a second subscription lookup.
    const restoredInfo = await Purchases.restorePurchases();
    return customerHasPro(restoredInfo);
  } catch (error) {
    console.warn("restorePurchases failed", error);
    throw error;
  }
}

export async function debugCustomerInfo(): Promise<string> {
  await configureBillingOnce();

  const [info, currentAppUserId] = await Promise.all([
    Purchases.getCustomerInfo(),
    Purchases.getAppUserID(),
  ]);

  const activeEntitlements = Object.keys(
    info.entitlements.active || {}
  );
  const allEntitlements = Object.keys(info.entitlements.all || {});
  const activeSubscriptions = info.activeSubscriptions || [];

  const entitlementDetails = allEntitlements.map((identifier) => {
    const entitlement = info.entitlements.all[identifier];

    return {
      identifier,
      isActive: entitlement?.isActive ?? false,
      productIdentifier: entitlement?.productIdentifier ?? null,
      expirationDate: entitlement?.expirationDate ?? null,
      willRenew: entitlement?.willRenew ?? false,
    };
  });

  return [
    `currentAppUserId: ${currentAppUserId}`,
    `originalAppUserId: ${info.originalAppUserId || "n/a"}`,
    `activeEntitlements: ${JSON.stringify(activeEntitlements)}`,
    `allEntitlements: ${JSON.stringify(allEntitlements)}`,
    `activeSubscriptions: ${JSON.stringify(activeSubscriptions)}`,
    `entitlementDetails: ${JSON.stringify(entitlementDetails)}`,
    `managementURL: ${info.managementURL || "n/a"}`,
  ].join("\n");
}

export async function openManageSubscription(): Promise<void> {
  if (Platform.OS === "ios") {
    await Linking.openURL(
      "itms-apps://apps.apple.com/account/subscriptions"
    );
    return;
  }

  await Linking.openURL(
    "https://play.google.com/store/account/subscriptions"
  );
}
