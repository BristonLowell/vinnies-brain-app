import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  AppState,
  ActivityIndicator,
  SafeAreaView,
} from "react-native";
import { getOrCreateSession, sendChat } from "../src/api";

type ChatItem = { role: "user" | "assistant"; text: string };

const QUICK_CHIPS = [
  "Active leak right now",
  "Stains only",
  "Musty smell",
  "Soft floor",
  "Only happens in heavy rain",
];

const INITIAL_ASSISTANT: ChatItem = {
  role: "assistant",
  text:
    "Tell me what’s happening. If you can, include: where it is (window/roof/door/floor), when it happens (rain/washing/travel), and whether there’s active dripping.",
};

export default function Chat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [sessionId, setSessionId] = useState<string>("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

  const listRef = useRef<FlatList<ChatItem>>(null);

  // Prevent double-resets from iOS event quirks
  const lastResetAt = useRef<number>(0);

  // Ignore the first "active" event that happens right after mount
  const didIgnoreFirstActive = useRef(false);

  const header = useMemo(() => {
    const parts: string[] = [];
    if (year) parts.push(`Year ${year}`);
    if (params.category) parts.push(String(params.category));
    return parts.join(" • ");
  }, [year, params.category]);

  const resetConversation = useCallback(async () => {
    const now = Date.now();
    if (now - lastResetAt.current < 800) return; // debounce
    lastResetAt.current = now;

    // Reset UI
    setItems([INITIAL_ASSISTANT]);
    setText("");
    setShowEscalate(false);
    setSending(false);

    // ✅ Always force a new session for cold start + resume
    const sid = await getOrCreateSession({ forceNew: true });
    setSessionId(sid);
  }, []);

  // ✅ Cold start: reset once on mount
  useEffect(() => {
    resetConversation();
  }, [resetConversation]);

  // ✅ Resume: reset when app comes back to foreground (but ignore first "active")
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (!didIgnoreFirstActive.current) {
          didIgnoreFirstActive.current = true; // ignore initial activation
          return;
        }
        resetConversation();
      }
    });

    return () => sub.remove();
  }, [resetConversation]);

  // Auto-scroll to bottom when messages update
  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(t);
  }, [items.length]);

  async function onSend(msg?: string) {
    const message = (msg ?? text).trim();
    if (!message || sending) return;

    setItems((prev) => [...prev, { role: "user", text: message }]);
    setText("");
    setSending(true);

    try {
      // If something tried to send before session finished resetting, ensure one exists
      const sid = sessionId || (await getOrCreateSession({ forceNew: true }));
      if (!sessionId) setSessionId(sid);

      const res = await sendChat(sid, message, year);
      setItems((prev) => [...prev, { role: "assistant", text: res.answer }]);
      setShowEscalate(res.show_escalation);
    } catch (e: any) {
      setItems((prev) => [
        ...prev,
        { role: "assistant", text: `Sorry — I couldn’t reach the server.\n\n${e?.message ?? ""}` },
      ]);
    } finally {
      setSending(false);
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={styles.safe}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 6 : 0}
      >
        {/* Top bar */}
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Vinnie’s Brain</Text>
            {!!header && <Text style={styles.subtitle}>{header}</Text>}
          </View>

          <Pressable
            onPress={resetConversation}
            style={({ pressed }) => [styles.resetBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.resetText}>New</Text>
          </Pressable>
        </View>

        {/* Messages */}
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={styles.listContent}
          keyboardShouldPersistTaps="handled"
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
                    {item.text}
                  </Text>
                </View>
              </View>
            );
          }}
          ListFooterComponent={
            sending ? (
              <View style={styles.typingRow}>
                <View style={[styles.bubble, styles.aiBubble, styles.typingBubble]}>
                  <ActivityIndicator />
                  <Text style={styles.typingText}>Thinking…</Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Quick chips */}
        <View style={styles.chipsWrap}>
          <View style={styles.chipsHeader}>
            <Text style={styles.chipsTitle}>Quick options</Text>
            <Text style={styles.chipsHint}>Tap one to send</Text>
          </View>
          <View style={styles.chipsRow}>
            {QUICK_CHIPS.map((c) => (
              <Pressable
                key={c}
                onPress={() => onSend(c)}
                style={({ pressed }) => [styles.chip, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.chipText}>{c}</Text>
              </Pressable>
            ))}
          </View>
        </View>

        {/* Escalate */}
        {showEscalate && (
          <Pressable
            style={({ pressed }) => [styles.escalate, pressed && { opacity: 0.85 }]}
            onPress={() =>
              router.push({ pathname: "/escalate", params: { year: year ? String(year) : "" } })
            }
          >
            <View style={styles.escalateBadge}>
              <Text style={styles.escalateBadgeText}>Safety</Text>
            </View>
            <Text style={styles.escalateText}>Request help (email)</Text>
          </Pressable>
        )}

        {/* Input */}
        <View style={styles.inputWrap}>
          <View style={styles.inputCard}>
            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Describe the issue…"
              placeholderTextColor="#9CA3AF"
              style={styles.input}
              multiline
              editable={!sending}
            />

            <Pressable
              onPress={() => onSend()}
              disabled={!canSend}
              style={({ pressed }) => [
                styles.sendBtn,
                !canSend && styles.sendBtnDisabled,
                pressed && canSend && { opacity: 0.85 },
              ]}
            >
              <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
            </Pressable>
          </View>

          <Text style={styles.footer}>
            Safety: if active leaking, soft floors/walls, mold smell, or electrical exposure—request help.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1220" },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
  },
  title: { color: "white", fontSize: 18, fontWeight: "800", letterSpacing: 0.2 },
  subtitle: { color: "rgba(255,255,255,0.7)", fontSize: 12, marginTop: 2 },
  resetBtn: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  resetText: { color: "white", fontWeight: "700", fontSize: 12 },

  listContent: { paddingHorizontal: 14, paddingVertical: 14, gap: 10, flexGrow: 1 },
  row: { flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  bubble: { maxWidth: "86%", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 14 },
  aiBubble: {
    backgroundColor: "rgba(255,255,255,0.92)",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.06)",
  },
  userBubble: {
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  aiText: { color: "#0B1220" },
  userText: { color: "white" },

  typingRow: { flexDirection: "row", justifyContent: "flex-start", marginTop: 4 },
  typingBubble: { flexDirection: "row", alignItems: "center", gap: 10 },
  typingText: { color: "#0B1220", fontWeight: "600" },

  chipsWrap: { paddingHorizontal: 14, paddingTop: 8, paddingBottom: 6 },
  chipsHeader: { flexDirection: "row", justifyContent: "space-between", marginBottom: 8 },
  chipsTitle: { color: "rgba(255,255,255,0.9)", fontWeight: "700", fontSize: 12 },
  chipsHint: { color: "rgba(255,255,255,0.55)", fontSize: 12 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 999,
  },
  chipText: { color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: "600" },

  escalate: {
    marginHorizontal: 14,
    marginTop: 6,
    marginBottom: 10,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.14)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  escalateBadge: {
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 999,
    backgroundColor: "rgba(239,68,68,0.25)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
  },
  escalateBadgeText: { color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: "800" },
  escalateText: { color: "rgba(255,255,255,0.96)", fontWeight: "800", fontSize: 14 },

  inputWrap: {
    paddingHorizontal: 14,
    paddingBottom: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  inputCard: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    color: "white",
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 6,
    paddingHorizontal: 8,
  },
  sendBtn: { paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: "white" },
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.35)" },
  sendText: { color: "#0B1220", fontWeight: "900", fontSize: 14 },

  footer: {
    marginTop: 8,
    textAlign: "center",
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    lineHeight: 14,
  },
});
