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
  Linking,
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

function isPhoneish(s: string) {
  const v = (s || "").trim();
  return v.length >= 7 && /^[0-9+\-\s().]+$/.test(v);
}

type Preferred = "Email" | "Text" | "Call";

export default function Escalate() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;
  const category = params.category ? String(params.category) : "";

  const [sessionId, setSessionId] = useState("");
  const [name, setName] = useState("");
  const [preferred, setPreferred] = useState<Preferred>("Email");

  // We keep a single input for "contact", but map it into phone/email for API.
  const [contact, setContact] = useState("");

  const [issue, setIssue] = useState("");
  const [location, setLocation] = useState("");
  const [trigger, setTrigger] = useState("");

  const [businessHours, setBusinessHours] = useState<boolean | null>(null);
  const [nextOpen, setNextOpen] = useState<string>("");
  const [supportEmail, setSupportEmail] = useState<string>("info@vinnies.net");

  const [sending, setSending] = useState(false);

  useEffect(() => {
    (async () => setSessionId(await getOrCreateSession()))();
  }, []);

  // Business-hours routing is decided on the server.
  useEffect(() => {
    (async () => {
      try {
        const s = await getSupportStatus();
        setBusinessHours(!!s?.business_hours);
        setNextOpen(s?.next_open ? String(s.next_open) : "");
        setSupportEmail(s?.support_email ? String(s.support_email) : "info@vinnies.net");

        // After hours: force email-only escalation.
        if (s && s.business_hours === false) {
          setPreferred("Email");
        }
      } catch {
        // If status check fails, keep current UX (do not block escalation)
        setBusinessHours(null);
      }
    })();
  }, []);

  const contactLabel = useMemo(() => {
    if (preferred === "Email") return "Email address";
    if (preferred === "Text") return "Mobile number (for text)";
    return "Phone number";
  }, [preferred]);

  const contactPlaceholder = useMemo(() => {
    if (preferred === "Email") return "you@example.com";
    return "(555) 555-5555";
  }, [preferred]);

  const contactOk = useMemo(() => {
    const v = contact.trim();
    if (!v) return false;
    if (preferred === "Email") return isEmail(v);
    return isPhoneish(v);
  }, [contact, preferred]);

  const message = useMemo(() => {
    const parts: string[] = [];
    if (year) parts.push(`Airstream year: ${year}`);
    if (category) parts.push(`Category: ${category}`);
    if (issue.trim()) parts.push(`Issue: ${issue.trim()}`);
    if (location.trim()) parts.push(`Location: ${location.trim()}`);
    if (trigger.trim()) parts.push(`When/Trigger: ${trigger.trim()}`);
    return parts.join("\n");
  }, [year, category, issue, location, trigger]);

  const canSubmit = useMemo(() => {
    return issue.trim().length > 0 && contactOk && !sending && !!sessionId;
  }, [issue, contactOk, sending, sessionId]);

  async function submit() {
    if (!canSubmit) return;

    const trimmedContact = contact.trim();
    const email = preferred === "Email" ? trimmedContact : "";
    const phone = preferred !== "Email" ? trimmedContact : "";

    setSending(true);
    try {
      const res: any = await createEscalation({
        session_id: sessionId,
        name: name.trim(),
        phone,
        email,
        message,
        preferred_contact: preferred,
      });

      // If the backend returns a pre-filled email payload, open the user's mail app.
      const routing = String(res?.routing || "").toLowerCase();
      const to = String(res?.email_to || supportEmail || "info@vinnies.net").trim();
      const subject = String(res?.email_subject || "").trim();
      const body = String(res?.email_body || "").trim();

      const shouldOpenEmail =
        routing === "email" ||
        (!businessHours && businessHours !== null) ||
        preferred === "Email";

      if (shouldOpenEmail && to && (subject || body)) {
        const url = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
          body
        )}`;
        try {
          const can = await Linking.canOpenURL(url);
          if (can) {
            await Linking.openURL(url);
          }
        } catch {
          // If mail app can't open, still show success and keep escalation stored server-side.
        }
      }

      router.replace("/success");
    } catch (e: any) {
      alert(e?.message ?? "Failed to submit request.");
    } finally {
      setSending(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : "height"}>
        <ScrollView
          contentContainerStyle={[styles.container, { paddingBottom: 18 + safeBottom }]}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.header}>
            <Text style={styles.title}>Request help from Vinnies</Text>
            <Text style={styles.note}>
              {businessHours === false
                ? "After hours: we’ll prep an email for you to send so we can follow up next business day. "
                : "We’ll capture your details so support can follow up. "}
              <Text style={{ fontWeight: "900", color: BRAND.cream }}>{supportEmail}</Text>
              {!!year ? ` (Airstream year: ${year})` : ""}
              {!!nextOpen && businessHours === false ? `  Next open: ${new Date(nextOpen).toLocaleString()}` : ""}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>What’s happening?</Text>
            <Text style={styles.cardSub}>Be specific: “leak at curbside window while driving in rain”.</Text>
            <TextInput
              style={[styles.input, styles.inputMultiline]}
              placeholder="Describe the problem…"
              placeholderTextColor={BRAND.faint}
              value={issue}
              onChangeText={setIssue}
              multiline
              returnKeyType="default"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>Details</Text>

            <Text style={styles.label}>Where is it located?</Text>
            <TextInput
              style={styles.input}
              placeholder="Window / roof / door / floor…"
              placeholderTextColor={BRAND.faint}
              value={location}
              onChangeText={setLocation}
              returnKeyType="next"
            />

            <Text style={styles.label}>When does it happen?</Text>
            <TextInput
              style={styles.input}
              placeholder="Rain / washing / travel / always…"
              placeholderTextColor={BRAND.faint}
              value={trigger}
              onChangeText={setTrigger}
              returnKeyType="next"
            />

            <Text style={styles.label}>Your name</Text>
            <TextInput
              style={styles.input}
              placeholder="First + last"
              placeholderTextColor={BRAND.faint}
              value={name}
              onChangeText={setName}
              returnKeyType="done"
            />
          </View>

          <View style={styles.card}>
            <Text style={styles.cardTitle}>How should we reach you?</Text>

            <View style={styles.segment}>
              {(["Email", "Text", "Call"] as Preferred[]).map((opt) => {
                const active = preferred === opt;
                const afterHours = businessHours === false;
                const disabled = afterHours && opt !== "Email";
                return (
                  <Pressable
                    key={opt}
                    onPress={() => {
                      if (disabled) return;
                      setPreferred(opt);
                      setContact(""); // clear so they enter the right kind
                    }}
                    disabled={disabled}
                    style={({ pressed }) => [
                      styles.segmentBtn,
                      active && styles.segmentBtnActive,
                      disabled && { opacity: 0.45 },
                      pressed && { opacity: 0.92 },
                    ]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt}</Text>
                  </Pressable>
                );
              })}
            </View>

            {businessHours === false && (
              <Text style={styles.afterHoursNote}>
                After hours: Email is required. We’ll pre-fill a message with your AI troubleshooting history.
              </Text>
            )}

            <Text style={styles.label}>{contactLabel}</Text>
            <TextInput
              style={styles.input}
              placeholder={contactPlaceholder}
              placeholderTextColor={BRAND.faint}
              value={contact}
              onChangeText={setContact}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType={preferred === "Email" ? "email-address" : "phone-pad"}
              textContentType={preferred === "Email" ? "emailAddress" : "telephoneNumber"}
              inputMode={preferred === "Email" ? "email" : "tel"}
              onSubmitEditing={() => {
                Keyboard.dismiss();
                submit();
              }}
              returnKeyType="send"
            />

            {!contactOk && contact.trim().length > 0 && (
              <Text style={styles.validation}>
                {preferred === "Email" ? "Enter a valid email (example@domain.com)." : "Enter a valid phone number."}
              </Text>
            )}
          </View>

          <Pressable
            style={({ pressed }) => [
              styles.submit,
              !canSubmit && styles.submitDisabled,
              pressed && canSubmit && { opacity: 0.92, transform: [{ scale: 0.99 }] },
            ]}
            disabled={!canSubmit}
            onPress={submit}
          >
            <Text style={styles.submitText}>{sending ? "Submitting…" : "Submit request"}</Text>
          </Pressable>

          <Text style={styles.footer}>
            Safety note: If there’s active leaking, soft floors/walls, or electrical exposure, stop using the area and
            request help.
          </Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },
  container: { padding: 16, gap: 12 },

  header: { paddingHorizontal: 2, gap: 6, paddingBottom: 2 },
  title: { color: BRAND.cream, fontSize: 22, fontWeight: "900" },
  note: { color: BRAND.muted, lineHeight: 18 },

  card: {
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    borderRadius: 18,
    padding: 14,
    gap: 10,
  },
  cardTitle: { color: BRAND.cream, fontWeight: "900", fontSize: 15 },
  cardSub: { color: BRAND.muted, fontSize: 12, lineHeight: 16, marginBottom: 4 },

  label: { color: BRAND.muted, fontWeight: "800", fontSize: 12, marginTop: 6 },

  input: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BRAND.border,
    color: "white",
    fontSize: 14,
  },
  inputMultiline: { minHeight: 96, textAlignVertical: "top" },

  segment: { flexDirection: "row", gap: 10, marginTop: 4 },
  segmentBtn: {
    flex: 1,
    height: 44,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  segmentBtnActive: {
    backgroundColor: "rgba(241,238,219,0.14)",
    borderColor: "rgba(241,238,219,0.28)",
  },
  segmentText: { color: "white", fontWeight: "900" },
  segmentTextActive: { color: BRAND.cream },

  validation: { color: "rgba(239,68,68,0.95)", fontWeight: "900", marginTop: 2 },

  afterHoursNote: { color: BRAND.muted, marginTop: 8, lineHeight: 16, fontSize: 12, fontWeight: "700" },

  submit: {
    height: 52,
    borderRadius: 18,
    backgroundColor: BRAND.cream,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  submitDisabled: { opacity: 0.4 },
  submitText: { color: BRAND.navy, fontWeight: "900", fontSize: 15 },

  footer: { marginTop: 6, color: BRAND.faint, textAlign: "center", lineHeight: 16, fontSize: 11 },
});
