import { Stack, useLocalSearchParams, useRouter } from "expo-router";
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
  BackHandler,
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

const SUPPORT_EMAIL_FALLBACK = "BristonLowell@gmail.com";

function isEmail(s: string) {
  const v = (s || "").trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
}

function fmtLocal(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
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

  const [supportEmail, setSupportEmail] = useState<string>(SUPPORT_EMAIL_FALLBACK);

  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  // ✅ FIX: this is the missing state that caused your TS error
  const [emailed, setEmailed] = useState<boolean | null>(null);

  const goHome = () => {
    router.replace("/");
  };

  // Android hardware back should go Home (not back to chat)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goHome();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const sid = await getOrCreateSession();
        setSessionId(sid);
      } catch {
        setSessionId("");
      }
    })();
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const s: any = await getSupportStatus();
        setBusinessHours(!!s?.business_hours);
        setNextOpen(s?.next_open ? String(s.next_open) : "");
        setSupportEmail((s?.support_email as string) || SUPPORT_EMAIL_FALLBACK);
      } catch {
        setBusinessHours(null);
        setNextOpen("");
        setSupportEmail(SUPPORT_EMAIL_FALLBACK);
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
    return !!sessionId && name.trim().length > 0 && isEmail(email) && !sending && !done;
  }, [sessionId, name, email, sending, done]);

  async function submit() {
    if (!canSubmit) return;
    Keyboard.dismiss();

    setSending(true);
    try {
      const res: any = await createEscalation({
        session_id: sessionId,
        name: name.trim(),
        email: email.trim(),
        message,
        preferred_contact: "Email",
      });

      // ✅ show whether SMTP send succeeded
      if (typeof res?.emailed === "boolean") setEmailed(res.emailed);
      else setEmailed(null);

      // ✅ show backend destination (if present)
      if (typeof res?.email_to === "string" && res.email_to.trim()) {
        setSupportEmail(res.email_to.trim());
      }

      setDone(true);
    } catch (e: any) {
      alert(e?.message ?? "Failed to submit request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "Email Vinnie’s",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: BRAND.bg },
          headerTintColor: BRAND.cream,
          gestureEnabled: false, // ✅ no swipe-back into chat
          headerLeft: () => (
            <Pressable
              onPress={goHome}
              hitSlop={10}
              style={({ pressed }) => [
                styles.headerBack,
                pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
              ]}
            >
              <Text style={styles.headerBackIcon}>←</Text>
              <Text style={styles.headerBackText}>Home</Text>
            </Pressable>
          ),
        }}
      />

      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: 18 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            {done ? (
              <>
                <Text style={styles.title}>Request received ✅</Text>

                <Text style={styles.note}>
                  {emailed === true
                    ? "Email sent successfully. We saved your conversation and your request."
                    : emailed === false
                    ? "We saved your conversation and request. Email delivery is pending (server couldn’t send right now)."
                    : `We saved your conversation and your request.${
                        businessHours === false ? " We’re currently after hours." : ""
                      }`}
                </Text>

                <Text style={[styles.note, { marginTop: 6 }]}>
                  You can expect a response within{" "}
                  <Text style={{ fontWeight: "900", color: BRAND.cream }}>
                    24–48 hours
                  </Text>.
                </Text>

                <Text style={styles.mini}>
                  Destination:{" "}
                  <Text style={{ fontWeight: "900", color: BRAND.cream }}>
                    {supportEmail}
                  </Text>
                </Text>

                {!!nextOpen && businessHours === false ? (
                  <Text style={styles.mini}>Next open: {fmtLocal(nextOpen)}</Text>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.primaryBtn,
                    pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                  ]}
                  onPress={goHome}
                >
                  <Text style={styles.primaryBtnText}>Back to home</Text>
                </Pressable>
              </>
            ) : (
              <>
                <Text style={styles.title}>Send an email to Vinnie’s</Text>
                <Text style={styles.note}>
                  Enter your name + email and we’ll attach your conversation for review.
                </Text>

                <View style={{ height: 8 }} />

                <Text style={styles.cardTitle}>Your info</Text>

                <TextInput
                  style={styles.input}
                  placeholder="First & Last Name"
                  placeholderTextColor={BRAND.faint}
                  value={name}
                  onChangeText={setName}
                  autoCapitalize="words"
                  returnKeyType="next"
                  editable={!sending}
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
                  editable={!sending}
                />

                <Text style={styles.micro}>
                  This will be sent to:{" "}
                  <Text style={{ fontWeight: "900", color: BRAND.cream }}>{supportEmail}</Text>
                </Text>

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
                  Tip: The more detail you use in chat, the easier it is to pinpoint the fix.
                </Text>
              </>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },

  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
  },
  headerBackIcon: { fontSize: 18, lineHeight: 18, color: BRAND.cream, marginTop: -1 },
  headerBackText: { color: BRAND.cream, fontWeight: "900", letterSpacing: 0.2, fontSize: 14 },

  container: {
    flexGrow: 1,
    paddingHorizontal: 18,
    paddingTop: 20,
    gap: 16,
    justifyContent: "center",
  },

  card: {
    backgroundColor: BRAND.surface,
    borderRadius: 18,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: BRAND.border,
  },

  title: { color: "white", fontSize: 22, fontWeight: "900" },
  note: { color: BRAND.muted, fontSize: 13, lineHeight: 18 },

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
