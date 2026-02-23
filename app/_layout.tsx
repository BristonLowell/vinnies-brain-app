import { Stack } from "expo-router";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import { Image, View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase, ensureAnon } from "../src/supabase";
import { setCurrentUserId, clearCurrentUserId } from "../src/api";
import { loginBillingUser } from "../src/billing";
import * as Notifications from "expo-notifications";

const BRAND = {
  bg: "#071018",
  headerBg: "#043553",
  cream: "#F1EEDB",
  text: "#FFFFFF",
  muted: "rgba(255,255,255,0.70)",
};

const VINNIES_LOGO_URI =
  "https://images.squarespace-cdn.com/content/v1/661d985f1ab48c261e33cff9/584e4ae4-e0ca-4dd5-abb7-5944ac019238/VINNIES%2BLogo%2Bwith%2Bnew%2Brivets%281%29.png";

function HeaderBrand() {
  return (
    <View style={styles.brand}>
      <Image source={{ uri: VINNIES_LOGO_URI }} style={styles.logo} resizeMode="contain" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Vinnie’s Brain</Text>
        <Text style={styles.sub}>Airstream troubleshooting</Text>
      </View>
    </View>
  );
}

function FullscreenLoading() {
  return (
    <View style={styles.loadingWrap}>
      <ActivityIndicator />
      <Text style={styles.loadingText}>Loading…</Text>
    </View>
  );
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export default function Layout() {
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Prevent double-init in strict mode / fast refresh
  const initialized = useRef(false);



  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let active = true;

    (async () => {
      try {
        // 1) Resolve initial session
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;

        if (error) {
          console.warn("getSession error:", error.message);
          setSession(null);
        } else {
          setSession(data.session ?? null);
        }

        // 2) Ensure anon session exists (no UI login)
        const user = await ensureAnon();
        if (!active) return;

        // Bridge to backend + link RevenueCat to this (anon) user id
        if (user?.id) {
          try {
            await setCurrentUserId(user.id);
            await loginBillingUser(user.id);
          } catch {
            // ignore
          }
        }
      } catch (e) {
        console.warn("auth init threw:", e);
        setSession(null);
      } finally {
        if (active) setAuthReady(true);
      }
    })();

    // 3) Listen for auth changes (anon sign-in will trigger this)
    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession ?? null);

      try {
        if (newSession?.user?.id) {
          await setCurrentUserId(newSession.user.id);
          await loginBillingUser(newSession.user.id);
        } else {
          await clearCurrentUserId();
        }
      } catch {
        // ignore
      }
    });

    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  if (!authReady) return <FullscreenLoading />;

  return (
    <Stack
      screenOptions={{
        headerTitle: () => <HeaderBrand />,
        headerStyle: { backgroundColor: BRAND.headerBg },
        headerTintColor: BRAND.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: BRAND.bg },
        headerBackTitle: "",
        headerBackButtonMenuEnabled: false,
      }}
    >
      {/* Main app */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="year" />
      <Stack.Screen name="category" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="paywall" options={{ headerShown: false }} />

      {/* Settings */}
      <Stack.Screen name="settings" options={{ title: "Account" }} />

      {/* Support / escalation */}
      <Stack.Screen name="live-chat" />
      <Stack.Screen name="escalate" />
      <Stack.Screen name="success" />

      {/* Admin */}
      <Stack.Screen name="admin" />
      <Stack.Screen name="admin-inbox" />
      <Stack.Screen name="admin-chat" />
      <Stack.Screen name="admin-session" />

      <Stack.Screen name="inbox" />
      <Stack.Screen name="modal" options={{ presentation: "modal" }} />
    </Stack>
  );
}

const styles = StyleSheet.create({
  brand: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: 300,
  },
  logo: { width: 56, height: 22 },
  title: { color: BRAND.cream, fontWeight: "900", fontSize: 14 },
  sub: { color: BRAND.muted, fontWeight: "700", fontSize: 11 },

  loadingWrap: {
    flex: 1,
    backgroundColor: BRAND.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: { color: BRAND.muted, fontWeight: "800" },
});
