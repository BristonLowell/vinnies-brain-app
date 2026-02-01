import { Stack, router, usePathname } from "expo-router";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import { Image, View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../src/supabase";
import { setCurrentUserId, clearCurrentUserId } from "../src/api";

const BRAND = {
  bg: "#071018",
  headerBg: "#043553", // logo navy
  cream: "#F1EEDB", // logo cream
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

export default function Layout() {
  const pathname = usePathname();
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // 1) Load initial session + listen for changes
  useEffect(() => {
    let isMounted = true;

    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!isMounted) return;
        setSession(data.session ?? null);
      } finally {
        if (isMounted) setAuthReady(true);
      }
    })();

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      setSession(newSession ?? null);

      // Maintain your existing backend bridge (X-User-Id)
      try {
        if (newSession?.user?.id) await setCurrentUserId(newSession.user.id);
        else await clearCurrentUserId();
      } catch {
        // ignore
      }
    });

    return () => {
      isMounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  // 2) Route guard
  useEffect(() => {
    if (!authReady) return;

    const onLogin = pathname === "/login";

    if (!session && !onLogin) {
      router.replace("/login");
      return;
    }
    if (session && onLogin) {
      router.replace("/");
      return;
    }
  }, [authReady, session, pathname]);

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
      {/* Login is outside the normal app flow */}
      <Stack.Screen name="login" options={{ headerShown: false }} />

      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="year" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="category" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="paywall" options={{ headerShown: false }} />


      {/* ✅ Chat back goes Home */}
      <Stack.Screen
        name="chat"
        options={{
          headerTitle: () => <HeaderBrand />,
          headerBackVisible: false,
          headerLeft: () => (
            <Pressable
              onPress={() => router.replace("/")}
              hitSlop={12}
              style={{ paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <Text style={{ color: "#FFFFFF", fontWeight: "900", fontSize: 16 }}>‹ Home</Text>
            </Pressable>
          ),
        }}
      />

      <Stack.Screen name="live-chat" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="escalate" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="success" options={{ headerTitle: () => <HeaderBrand /> }} />

      {/* Admin / owner tools */}
      <Stack.Screen name="admin" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="admin-inbox" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="admin-chat" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="admin-session" options={{ headerTitle: () => <HeaderBrand /> }} />

      <Stack.Screen name="inbox" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="modal" options={{ presentation: "modal", title: "Modal" }} />
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
  title: { color: BRAND.cream, fontWeight: "900", fontSize: 14, letterSpacing: 0.2 },
  sub: { marginTop: 1, color: BRAND.muted, fontWeight: "700", fontSize: 11 },

  loadingWrap: {
    flex: 1,
    backgroundColor: BRAND.bg,
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
  },
  loadingText: { color: "rgba(255,255,255,0.70)", fontWeight: "800" },
});
