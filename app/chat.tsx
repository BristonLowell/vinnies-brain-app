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
  Keyboard,
  TouchableWithoutFeedback,
  StatusBar,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getOrCreateSession, sendChat } from "../src/api";

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  meta?: {
    usedArticles?: { id: string; title: string }[];
    showEscalation?: boolean;
  };
};

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

function looksLikeYesNoQuestion(text: string) {
  const t = (text || "").toLowerCase();
  return (
    t.includes("yes/no") ||
    t.includes("quick question") ||
    t.includes("does this") ||
    t.includes("is it") ||
    t.includes("are you") ||
    t.trim().endsWith("?")
  );
}

function initials(label: string) {
  const s = (label || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

export default function Chat() {
  const router = useRouter();
  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

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

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => {
      listRef.current?.scrollToEnd({ animated });
    });
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [items.length, scrollToBottom]);

  const lastAssistant = useMemo(() => {
    for (let i = items.length - 1; i >= 0; i--) {
      if (items[i].role === "assistant") return items[i];
    }
    return null;
  }, [items]);

  const showBinaryControls = useMemo(() => {
    if (sending) return false;
    if (!lastAssistant) return false;
    return looksLikeYesNoQuestion(lastAssistant.text);
  }, [lastAssistant, sending]);

  async function onSend(msg?: string) {
    if (sending) return;

    const message = (msg ?? text).trim();
    if (!message) return;

    setItems((prev) => [...prev, { role: "user", text: message }]);
    setText("");
    setSending(true);
    scrollToBottom(true);

    try {
      const sid = sessionId || (await getOrCreateSession({ forceNew: true }));
      if (!sessionId) setSessionId(sid);

      const res = await sendChat(sid, message, year);

      const usedArticles = Array.isArray(res.used_articles)
        ? res.used_articles.map((a: any) => ({ id: a.id, title: a.title }))
        : [];

      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          meta: {
            usedArticles,
            showEscalation: !!res.show_escalation,
          },
        },
      ]);

      setShowEscalate(!!res.show_escalation);
      Keyboard.dismiss();
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
      scrollToBottom(true);
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />
      <TouchableWithoutFeedback onPress={Keyboard.dismiss} accessible={false}>
        <KeyboardAvoidingView
          style={styles.safe}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          // This offset is the #1 thing that prevents the keyboard from covering your input.
          // If you have a nav header, increase this (try 40–90).
          keyboardVerticalOffset={Platform.OS === "ios" ? 88 : 0}
        >
          {/* Top Bar
          <View style={styles.topBar}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Vinnie’s Brain</Text>
              {!!header && <Text style={styles.subtitle}>{header}</Text>}
            </View>

            <Pressable
              onPress={resetConversation}
              style={({ pressed }) => [
                styles.resetBtn,
                pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] },
              ]}
            >
              <Text style={styles.resetText}>New</Text>
            </Pressable>
          // </View> */}

          {/* Messages */}
          <FlatList
            ref={listRef}
            data={items}
            keyExtractor={(_, i) => String(i)}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToBottom(false)}
            renderItem={({ item }) => {
              const isUser = item.role === "user";
              const used = item.meta?.usedArticles || [];

              return (
                <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                  {!isUser && (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{initials("VB")}</Text>
                    </View>
                  )}

                  <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                    <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>
                      {item.text}
                    </Text>

                    {!isUser && used.length > 0 && (
                      <View style={styles.sourcesWrap}>
                        <Text style={styles.sourcesLabel}>Sources used</Text>
                        <Text style={styles.sourcesText}>{used.map((u) => u.title).join(" • ")}</Text>
                      </View>
                    )}
                  </View>
                </View>
              );
            }}
            ListFooterComponent={
              sending ? (
                <View style={[styles.row, styles.rowLeft, { marginTop: 2 }]}>
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials("VB")}</Text>
                  </View>
                  <View style={[styles.bubble, styles.aiBubble, styles.typingBubble]}>
                    <ActivityIndicator />
                    <Text style={styles.typingText}>Thinking…</Text>
                  </View>
                </View>
              ) : null
            }
          />

          {/* Quick chips */}
          {items.length <= 2 && (
            <View style={styles.chipsWrap}>
              <View style={styles.chipsRow}>
                {QUICK_CHIPS.map((c) => (
                  <Pressable
                    key={c}
                    onPress={() => onSend(c)}
                    style={({ pressed }) => [
                      styles.chip,
                      pressed && { opacity: 0.85, transform: [{ scale: 0.99 }] },
                    ]}
                    disabled={sending}
                  >
                    <Text style={styles.chipText}>{c}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          )}

          {/* YES / NO controls */}
          {showBinaryControls && (
            <View style={styles.binaryRow}>
              <Pressable
                style={({ pressed }) => [
                  styles.binaryBtn,
                  styles.yesBtn,
                  pressed && { opacity: 0.9 },
                ]}
                disabled={sending}
                onPress={() => onSend("yes")}
              >
                <Text style={styles.binaryText}>Yes</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.binaryBtn,
                  styles.noBtn,
                  pressed && { opacity: 0.9 },
                ]}
                disabled={sending}
                onPress={() => onSend("no")}
              >
                <Text style={styles.binaryText}>No</Text>
              </Pressable>

              <Pressable
                style={({ pressed }) => [
                  styles.binaryBtn,
                  styles.skipBtn,
                  pressed && { opacity: 0.9 },
                ]}
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
              style={({ pressed }) => [
                styles.escalate,
                pressed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
              ]}
              onPress={() =>
                router.push({ pathname: "/escalate", params: { year: year ? String(year) : "" } })
              }
            >
              <Text style={styles.escalateText}>Request help (email)</Text>
              <Text style={styles.escalateSub}>Share photos and details with the team.</Text>
            </Pressable>
          )}

          {/* Input */}
          <View style={styles.inputWrap}>
            <View style={styles.inputCard}>
              <TextInput
                value={text}
                onChangeText={setText}
                placeholder="Type your message…"
                placeholderTextColor="rgba(255,255,255,0.45)"
                style={styles.input}
                multiline
                editable={!sending}
                returnKeyType="send"
                onSubmitEditing={() => onSend()}
                blurOnSubmit={false}
              />

              <Pressable
                onPress={() => onSend()}
                disabled={!canSend}
                style={({ pressed }) => [
                  styles.sendBtn,
                  !canSend && styles.sendBtnDisabled,
                  pressed && canSend && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.sendText}>Send</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              Tip: include where the leak is, when it happens, and if it’s dripping.
            </Text>
          </View>
        </KeyboardAvoidingView>
      </TouchableWithoutFeedback>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  topBar: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0B0F14",
  },
  title: { color: "white", fontSize: 18, fontWeight: "900" },
  subtitle: { color: "rgba(255,255,255,0.55)", fontSize: 12, marginTop: 2 },

  resetBtn: {
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
  },
  resetText: { color: "white", fontWeight: "800" },

  listContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 10,
    gap: 10,
    flexGrow: 1,
  },

  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
  },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "rgba(255,255,255,0.85)", fontSize: 11, fontWeight: "900" },

  bubble: {
    maxWidth: "82%",
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 18,
    borderWidth: 1,
  },
  aiBubble: {
    backgroundColor: "#111827",
    borderColor: "rgba(255,255,255,0.10)",
  },
  userBubble: {
    backgroundColor: "#2563EB",
    borderColor: "rgba(255,255,255,0.10)",
  },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  aiText: { color: "rgba(255,255,255,0.92)" },
  userText: { color: "white", fontWeight: "600" },

  typingBubble: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  typingText: { color: "rgba(255,255,255,0.75)", fontWeight: "700" },

  sourcesWrap: {
    marginTop: 10,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.10)",
  },
  sourcesLabel: { fontSize: 11, fontWeight: "900", color: "rgba(255,255,255,0.65)" },
  sourcesText: { marginTop: 2, fontSize: 12, color: "rgba(255,255,255,0.65)" },

  chipsWrap: { paddingHorizontal: 14, paddingBottom: 6 },
  chipsRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  chipText: { color: "rgba(255,255,255,0.92)", fontSize: 12, fontWeight: "700" },

  binaryRow: {
    flexDirection: "row",
    gap: 10,
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 8,
  },
  binaryBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 14,
    alignItems: "center",
  },
  yesBtn: { backgroundColor: "#16A34A" },
  noBtn: { backgroundColor: "#EF4444" },
  skipBtn: { backgroundColor: "#374151" },
  binaryText: { color: "white", fontSize: 15, fontWeight: "900" },

  escalate: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(239,68,68,0.15)",
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.25)",
    alignItems: "flex-start",
  },
  escalateText: { color: "white", fontWeight: "900", fontSize: 15 },
  escalateSub: { marginTop: 4, color: "rgba(255,255,255,0.7)", fontSize: 12 },

  inputWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0B0F14",
  },
  inputCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    color: "white",
    minHeight: 44,
    maxHeight: 130,
    fontSize: 15,
    lineHeight: 20,
    paddingTop: 10,
    paddingBottom: 10,
  },
  sendBtn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "white",
  },
  sendBtnDisabled: { backgroundColor: "rgba(255,255,255,0.35)" },
  sendText: { color: "#0B0F14", fontWeight: "900" },

  hint: {
    marginTop: 6,
    color: "rgba(255,255,255,0.45)",
    fontSize: 11,
  },
});
