import { Stack } from "expo-router";
import "react-native-url-polyfill/auto";
import "react-native-get-random-values";


export default function Layout() {
  return (
    <Stack
      screenOptions={{
        headerTitle: "Vinnie’s Brain",
        headerStyle: { backgroundColor: "#0B0F14" },
        headerTintColor: "white",
        headerTitleStyle: { fontWeight: "900" },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: "#0B0F14" },
      }}
    >
      <Stack.Screen name="index" options={{ title: "Vinnie’s Brain" }} />
      <Stack.Screen name="year" options={{ title: "Airstream Year" }} />
      <Stack.Screen name="category" options={{ title: "Issue Type" }} />
      <Stack.Screen name="chat" options={{ title: "Troubleshooting" }} />
      <Stack.Screen name="escalate" options={{ title: "Request Help" }} />
      <Stack.Screen name="success" options={{ title: "Submitted" }} />
    </Stack>
  );
}
