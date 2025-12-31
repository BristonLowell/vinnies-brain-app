import { Stack } from "expo-router";

export default function Layout() {
  return (
    <Stack screenOptions={{ headerTitle: "Vinnie’s Brain" }}>
      <Stack.Screen name="index" options={{ title: "Vinnie’s Brain" }} />
      <Stack.Screen name="year" options={{ title: "Airstream Year" }} />
      <Stack.Screen name="category" options={{ title: "Issue Type" }} />
      <Stack.Screen name="chat" options={{ title: "Troubleshooting" }} />
      <Stack.Screen name="escalate" options={{ title: "Request Help" }} />
      <Stack.Screen name="success" options={{ title: "Submitted" }} />
    </Stack>
  );
}
