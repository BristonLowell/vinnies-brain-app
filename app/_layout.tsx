import { Stack } from "expo-router";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";
import { Image, View, Text, StyleSheet } from "react-native";

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

export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: () => <HeaderBrand />,
        headerStyle: { backgroundColor: BRAND.headerBg },
        headerTintColor: BRAND.text,
        headerShadowVisible: false,
        contentStyle: { backgroundColor: BRAND.bg },

        // ✅ Native-stack safe replacements for headerBackTitleVisible:
        headerBackTitle: "",
        headerBackButtonMenuEnabled: false,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="year" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="category" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="chat" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="live-chat" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="escalate" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="success" options={{ headerTitle: () => <HeaderBrand /> }} />

      {/* Admin / owner tools */}
      <Stack.Screen name="admin" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="admin-inbox" options={{ headerTitle: () => <HeaderBrand /> }} />
      <Stack.Screen name="admin-chat" options={{ headerTitle: () => <HeaderBrand /> }} />
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
});
