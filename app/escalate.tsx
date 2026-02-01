import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Keyboard,
  ActivityIndicator,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { createEscalation, getOrCreateSession, getSupportStatus } from "../src/api";

const BRAND = {
  bg: "#071018",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  navy: "#043553",
  cream: "#F1EEDB",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",
};

function isEmail(s: string) {
  const v = (s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

export default function Escalate() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;
  const category = params.category ? String(params.category) : "";

  const [sessionId, setSessionId] = useState("");

  const [name, setName] = useState("");
  const [email, setEmail] = useState("");

  const [businessHours, setBusinessHours] = useState<boolean | null>(null);
  const [nextOpen, setNextOpen] = useState<string>("");
  const [supportEmail, setSupportEmail] = useState<string>("info@vinnies.net");

  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    (async () => setSessionId(await getOrCreateSession()))();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s = await getSupportStatus();
        setBusinessHours(!!s?.business_hours);
        setNextOpen(s?.next_open ? String(s.next_open) : "");
        setSupportEmail(s?.support_email ? String(s.support_email) : "info@vinnies.net");
      } catch {
        setBusinessHours(null);
      }
    })();
  }, []);

  const message = useMemo(() => {
    const parts: string[] = [];
    parts.push("User requested EMAIL escalation from the app.");
    if (year) parts.push(`Airstream year: ${year}`);
    if (category) parts.push(`Category: ${category}`);
    return parts.join("\n");
  }, [year, category]);

  const canSubmit = useMemo(() => {
    return (
      !!sessionId &&
      name.trim().length > 0 &&
      isEmail(email) &&
      !sending &&
      !done
    );
  }, [sessionId, name, email, sending, done]);

  async function submit() {
    if (!canSubmit) return;
    Keyboard.dismiss();

    setSending(true);
    try {
      await createEscalation({
        session_id: sessionId,
        name: name.trim(),
        email: email.trim(),
        message,
        preferred_contact: "Email", // harmless legacy field; ok if backend stores it
      });

      setDone(true);
    } catch (e: any) {
      alert(e?.message ?? "Failed to submit request.");
    } finally {
      setSending(false);
    }
  }

  if (done) {
    return (
      <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
        <View style={[styles.container, { paddingBottom: 18 + safeBottom }]}>
          <View style={styles.card}>
            <Text style={styles.title}>Request received ✅</Text>
            <Text style={styles.note}>
              We saved your conversation and your request.{" "}
              {businessHours === false
                ? "We’re currently after hours — we’ll follow up next business day."
                : "We’ll follow up as soon as possible."}
            </Text>

            <Text style={styles.mini}>
              Support email: <Text style={{ fontWeight: "900", color: BRAND.cream }}>{supportEmail}</Text>
            </Text>

            {!!nextOpen && businessHours === false ? (
              <Text style={styles.mini}>Next open: {new Date(nextOpen).toLocaleString()}</Text>
            ) : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
              ]}
              onPress={() => router.replace("/chat")}
            >
              <Text style={styles.primaryBtnText}>Back to chat</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: 18 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>Email Vinnie’s</Text>
            <Text style={styles.note}>
              Enter your name + email and we’ll attach your conversation for the team to review.
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Your info</Text>

            <TextInput
              style={styles.input}
              placeholder="First & Last Name"
              placeholderTextColor={BRAND.faint}
              value={name}
              onChangeText={setName}
              autoCapitalize="words"
              returnKeyType="next"
            />

            <TextInput
              style={styles.input}
              placeholder="Email address"
              placeholderTextColor={BRAND.faint}
              value={email}
              onChangeText={setEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
              returnKeyType="done"
              onSubmitEditing={submit}
            />

            <Pressable
              onPress={submit}
              disabled={!canSubmit}
              style={({ pressed }) => [
                styles.primaryBtn,
                !canSubmit && { opacity: 0.45 },
                pressed && canSubmit && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              ]}
            >
              {sending ? (
                <View style={{ flexDirection: "row", gap: 10, alignItems: "center" }}>
                  <ActivityIndicator />
                  <Text style={styles.primaryBtnText}>Sending…</Text>
                </View>
              ) : (
                <Text style={styles.primaryBtnText}>Send</Text>
              )}
            </Pressable>

            <Text style={styles.micro}>
              Tip: The more detail you use in chat, the easier it is for us to pinpoint the fix.
            </Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },
  container: { flexGrow: 1, paddingHorizontal: 18, paddingTop: 20, gap: 16, justifyContent: "center" },
  header: { gap: 8 },

  title: { color: "white", fontSize: 26, fontWeight: "900" },
  note: { color: BRAND.muted, fontSize: 13, lineHeight: 18 },

  card: {
    backgroundColor: BRAND.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  cardTitle: { color: BRAND.cream, fontSize: 15, fontWeight: "900" },

  input: {
    height: 48,
    borderRadius: 14,
    paddingHorizontal: 12,
    color: "white",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    fontWeight: "800",
  },

  primaryBtn: {
    height: 52,
    borderRadius: 16,
    backgroundColor: BRAND.cream,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },
  primaryBtnText: { color: BRAND.navy, fontWeight: "900", fontSize: 15 },

  micro: { color: BRAND.faint, fontSize: 11, lineHeight: 15, marginTop: 2 },
  mini: { color: BRAND.muted, fontSize: 12, lineHeight: 16, marginTop: 2 },
});
