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
  Keyboard,
} from "react-native";
import { getOrCreateSession, sendChat } from "../src/api";

type ChatItem = { role: "user" | "assistant"; text: string };
type Phase = "initial" | "binary";

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

  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);
  const [phase, setPhase] = useState<Phase>("initial");

  const listRef = useRef<FlatList<ChatItem>>(null);
  const lastResetAt = useRef(0);
  const didIgnoreFirstActive = useRef(false);

  const header = useMemo(() => {
    const parts: string[] = [];
    if (year) parts.push(`Year ${year}`);
    if (params.category) parts.push(String(params.category));
    return parts.join(" • ");
  }, [year, params.category]);

  const resetConversation = useCallback(async () => {
    const now = Date.now();
    if (now - lastResetAt.current < 800) return;
    lastResetAt.current = now;

    setItems([INITIAL_ASSISTANT]);
    setText("");
    setShowEscalate(false);
    setSending(false);
    setPhase("initial");

    const sid = await getOrCreateSession({ forceNew: true });
    setSessionId(sid);
  }, []);

  useEffect(() => {
    resetConversation();
  }, [resetConversation]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        if (!didIgnoreFirstActive.current) {
          didIgnoreFirstActive.current = true;
          return;
        }
        resetConversation();
      }
    });
    return () => sub.remove();
  }, [resetConversation]);

  useEffect(() => {
    const t = setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(t);
  }, [items.length]);

  async function onSend(msg?: string) {
    if (sending) return;

    const message = (msg ?? text).trim();
    if (!message) return;

    // Prevent typing during binary phase
    if (phase === "binary" && !msg) return;

    setItems((prev) => [...prev, { role: "user", text: message }]);
    setText("");
    setSending(true);

    try {
      const sid = sessionId || (await getOrCreateSession({ forceNew: true }));
      if (!sessionId) setSessionId(sid);

      const res = await sendChat(sid, message, year);
      setItems((prev) => [...prev, { role: "assistant", text: res.answer }]);
      setShowEscalate(res.show_escalation);

      if (phase === "initial") {
        setPhase("binary");
        Keyboard.dismiss();
      }
    } catch (e: any) {
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "Sorry — I couldn’t reach the server. Please try again.",
        },
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
      >
        {/* Top Bar */}
        <View style={styles.topBar}>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Vinnie’s Brain</Text>
            {!!header && <Text style={styles.subtitle}>{header}</Text>}
          </View>

          <Pressable onPress={resetConversation} style={styles.resetBtn}>
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
                <View style={[styles.bubble, styles.aiBubble]}>
                  <ActivityIndicator />
                  <Text style={styles.typingText}>Thinking…</Text>
                </View>
              </View>
            ) : null
          }
        />

        {/* Quick chips (INITIAL ONLY) */}
        {phase === "initial" && (
          <View style={styles.chipsWrap}>
            <View style={styles.chipsRow}>
              {QUICK_CHIPS.map((c) => (
                <Pressable key={c} onPress={() => onSend(c)} style={styles.chip}>
                  <Text style={styles.chipText}>{c}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        )}

        {/* YES / NO CONTROLS */}
        {phase === "binary" && (
          <View style={styles.binaryRow}>
            <Pressable
              style={[styles.binaryBtn, styles.yesBtn]}
              disabled={sending}
              onPress={() => onSend("yes")}
            >
              <Text style={styles.binaryText}>Yes</Text>
            </Pressable>

            <Pressable
              style={[styles.binaryBtn, styles.noBtn]}
              disabled={sending}
              onPress={() => onSend("no")}
            >
              <Text style={styles.binaryText}>No</Text>
            </Pressable>

            <Pressable
              style={[styles.binaryBtn, styles.skipBtn]}
              disabled={sending}
              onPress={() => onSend("skip")}
            >
              <Text style={styles.binaryText}>Not sure</Text>
            </Pressable>
          </View>
        )}

        {/* Escalate */}
        {showEscalate && (
          <Pressable
            style={styles.escalate}
            onPress={() =>
              router.push({ pathname: "/escalate", params: { year: year ? String(year) : "" } })
            }
          >
            <Text style={styles.escalateText}>Request help (email)</Text>
          </Pressable>
        )}

        {/* Text Input (INITIAL ONLY) */}
        {phase === "initial" && (
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
                style={[styles.sendBtn, !canSend && styles.sendBtnDisabled]}
              >
                <Text style={styles.sendText}>Send</Text>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B1220" },

  topBar: {
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.1)",
  },
  title: { color: "white", fontSize: 18, fontWeight: "800" },
  subtitle: { color: "rgba(255,255,255,0.6)", fontSize: 12 },
  resetBtn: {
    backgroundColor: "rgba(255,255,255,0.12)",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  resetText: { color: "white", fontWeight: "700" },

  listContent: { padding: 14, gap: 10, flexGrow: 1 },
  row: { flexDirection: "row" },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  bubble: { maxWidth: "85%", padding: 12, borderRadius: 14 },
  aiBubble: { backgroundColor: "white" },
  userBubble: { backgroundColor: "#111827" },
  bubbleText: { fontSize: 15 },
  aiText: { color: "#0B1220" },
  userText: { color: "white" },

  typingRow: { marginTop: 6 },
  typingText: { marginLeft: 8, fontWeight: "600" },

  chipsWrap: { paddingHorizontal: 14, paddingBottom: 6 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipText: { color: "white", fontSize: 12, fontWeight: "600" },

  binaryRow: {
    flexDirection: "row",
    gap: 10,
    padding: 14,
  },
  binaryBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: "center",
  },
  yesBtn: { backgroundColor: "#166534" },
  noBtn: { backgroundColor: "#7f1d1d" },
  skipBtn: { backgroundColor: "#374151" },
  binaryText: { color: "white", fontSize: 16, fontWeight: "800" },

  escalate: {
    margin: 14,
    padding: 14,
    borderRadius: 14,
    backgroundColor: "rgba(239,68,68,0.2)",
    alignItems: "center",
  },
  escalateText: { color: "white", fontWeight: "800" },

  inputWrap: {
    padding: 14,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.1)",
  },
  inputCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.06)",
  },
  input: {
    flex: 1,
    color: "white",
    minHeight: 44,
    maxHeight: 120,
  },
  sendBtn: {
    backgroundColor: "white",
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 14,
  },
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.4)" },
  sendText: { color: "#0B1220", fontWeight: "900" },
});
