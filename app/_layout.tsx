import { Stack, router, usePathname } from "expo-router";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import { Image, View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { useEffect, useRef, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "../src/supabase";
import { setCurrentUserId, clearCurrentUserId } from "../src/api";

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

export default function Layout() {
  const pathname = usePathname();

  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);

  // Prevent double-init in strict mode / fast refresh
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;

    let active = true;

    // 1️⃣ Always resolve initial session
    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();
        if (!active) return;

        if (error) {
          console.warn("getSession error:", error.message);
          setSession(null);
        } else {
          setSession(data.session ?? null);
        }
      } catch (e) {
        console.warn("getSession threw:", e);
        setSession(null);
      } finally {
        if (active) setAuthReady(true); // ← CRITICAL: always set
      }
    })();

    // 2️⃣ Listen for auth changes
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession ?? null);

      // Bridge user id to backend
      try {
        if (newSession?.user?.id) {
          setCurrentUserId(newSession.user.id);
        } else {
          clearCurrentUserId();
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

  // 3️⃣ Route guard (never runs until authReady === true)
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

  // 4️⃣ Safe loading screen
  if (!authReady) {
    return <FullscreenLoading />;
  }

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
      {/* Auth */}
      <Stack.Screen name="login" options={{ headerShown: false }} />

      {/* Main app */}
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="year" />
      <Stack.Screen name="category" />
      <Stack.Screen name="chat" />
      <Stack.Screen name="paywall" options={{ headerShown: false }} />

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
