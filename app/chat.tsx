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
  ActivityIndicator,
  Keyboard,
  StatusBar,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateSession, sendChat } from "../src/api";

const BRAND = {
  bg: "#071018",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  navy: "#043553",
  cream: "#F1EEDB",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.70)",
};

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  meta?: {
    usedArticles?: { id: string; title: string }[];
    showEscalation?: boolean;
    clarifyingQuestion?: string;
  };
};

const INITIAL_ASSISTANT: ChatItem = {
  role: "assistant",
  text: "What’s going on with your Airstream?",
};

const INPUT_BAR_EST_HEIGHT = 76;
const NOT_FROM_VINNIES_PREFIX = "⚠️ This information is NOT from Vinnies";

function parseNonVinniesBanner(text: string): { hasBanner: boolean; body: string } {
  const raw = (text ?? "").trimStart();
  if (!raw.startsWith(NOT_FROM_VINNIES_PREFIX)) return { hasBanner: false, body: text };

  const lines = raw.split("\n");
  lines.shift();
  while (lines.length > 0 && lines[0].trim() === "") lines.shift();
  return { hasBanner: true, body: lines.join("\n") };
}

function initials(label: string) {
  const s = (label || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

export default function Chat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

  const listRef = useRef<FlatList<ChatItem>>(null);
  const inputRef = useRef<TextInput>(null);

  const storageKeySuffix = useMemo(() => {
    const y = year ? String(year) : "any";
    return `y:${y}`;
  }, [year]);

  const CHAT_ITEMS_KEY = useMemo(() => `vinniesbrain_chat_items_${storageKeySuffix}`, [storageKeySuffix]);
  const CHAT_SESSION_KEY = useMemo(() => `vinniesbrain_chat_session_${storageKeySuffix}`, [storageKeySuffix]);

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToBottom = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    scrollToBottom(true);
  }, [items.length, scrollToBottom]);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [storedItemsRaw, storedSid] = await Promise.all([
          AsyncStorage.getItem(CHAT_ITEMS_KEY),
          AsyncStorage.getItem(CHAT_SESSION_KEY),
        ]);

        if (cancelled) return;

        if (storedItemsRaw) {
          try {
            const parsed = JSON.parse(storedItemsRaw) as ChatItem[];
            setItems(Array.isArray(parsed) && parsed.length > 0 ? parsed : [INITIAL_ASSISTANT]);
          } catch {
            setItems([INITIAL_ASSISTANT]);
          }
        } else {
          setItems([INITIAL_ASSISTANT]);
        }

        if (storedSid) {
          setSessionId(storedSid);
        } else {
          const sid = await getOrCreateSession({ forceNew: true });
          if (cancelled) return;
          setSessionId(sid);
          await AsyncStorage.setItem(CHAT_SESSION_KEY, sid);
        }
      } catch {
        setItems([INITIAL_ASSISTANT]);
        try {
          const sid = await getOrCreateSession({ forceNew: true });
          if (!cancelled) setSessionId(sid);
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [CHAT_ITEMS_KEY, CHAT_SESSION_KEY]);

  useEffect(() => {
    (async () => {
      try {
        await AsyncStorage.setItem(CHAT_ITEMS_KEY, JSON.stringify(items));
      } catch {}
    })();
  }, [CHAT_ITEMS_KEY, items]);

  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        await AsyncStorage.setItem(CHAT_SESSION_KEY, sessionId);
      } catch {}
    })();
  }, [CHAT_SESSION_KEY, sessionId]);

  async function onSend(msg?: string) {
    if (sending) return;

    const message = (msg ?? text).trim();
    if (!message) return;

    setItems((prev) => [...prev, { role: "user", text: message }]);
    setText("");
    setSending(true);

    Keyboard.dismiss();
    scrollToBottom(true);

    try {
      const sid = sessionId || (await getOrCreateSession({ forceNew: true }));
      if (!sessionId) setSessionId(sid);

      const res = await sendChat(sid, message, year);

      const usedArticles = Array.isArray(res.used_articles)
        ? res.used_articles.map((a: any) => ({ id: a.id, title: a.title }))
        : [];

      const cq = Array.isArray(res.clarifying_questions) ? res.clarifying_questions : [];
      const clarifyingQuestion = cq?.[0] ? String(cq[0]) : "";

      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: res.answer,
          meta: { usedArticles, showEscalation: !!res.show_escalation, clarifyingQuestion },
        },
      ]);

      setShowEscalate(!!res.show_escalation);
    } catch {
      setItems((prev) => [...prev, { role: "assistant", text: "Sorry — I couldn’t reach the server. Please try again." }]);
    } finally {
      setSending(false);
      scrollToBottom(true);
    }
  }

  const canSend = text.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="light-content" />

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 120 : 0}
      >
        <Pressable onPress={Keyboard.dismiss} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={StyleSheet.absoluteFill} pointerEvents="none" />
        </Pressable>

        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={[
            styles.listContent,
            { paddingBottom: styles.listContent.paddingBottom + INPUT_BAR_EST_HEIGHT + 16 + safeBottom },
          ]}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onScrollBeginDrag={Keyboard.dismiss}
          onContentSizeChange={() => scrollToBottom(false)}
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            const cq = item.meta?.clarifyingQuestion?.trim();
            const parsed = !isUser ? parseNonVinniesBanner(item.text) : { hasBanner: false, body: item.text };

            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                {!isUser && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials("VB")}</Text>
                  </View>
                )}

                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  {!isUser && parsed.hasBanner && (
                    <View style={styles.notFromVinniesBanner}>
                      <Text style={styles.notFromVinniesText}>⚠️ This information is NOT from Vinnies Brain’s database.</Text>
                    </View>
                  )}

                  {!isUser && !!cq && <Text style={styles.clarifyingQuestion}>{cq}</Text>}

                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>{parsed.body}</Text>
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

        {showEscalate && (
          <Pressable
            style={({ pressed }) => [styles.escalate, pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] }]}
            onPress={() => router.push({ pathname: "/live-chat" })}
          >
            <Text style={styles.escalateText}>Chat with Vinnies now</Text>
            <Text style={styles.escalateSub}>You’re chatting directly with the owner.</Text>
          </Pressable>
        )}

        <View
          style={[
            styles.inputWrap,
            { paddingBottom: 10 + safeBottom },
            keyboardOpen ? { paddingBottom: 28 + safeBottom } : null,
          ]}
        >
          <View style={styles.inputCard}>
            <TextInput
              ref={inputRef}
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
                pressed && canSend && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              ]}
            >
              <Text style={styles.sendText}>Send</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },

  listContent: { paddingHorizontal: 14, paddingTop: 14, paddingBottom: 10, gap: 10, flexGrow: 1 },

  row: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(241,238,219,0.10)",
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.20)",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: BRAND.cream, fontSize: 11, fontWeight: "900" },

  bubble: { maxWidth: "82%", paddingVertical: 10, paddingHorizontal: 12, borderRadius: 18, borderWidth: 1 },
  aiBubble: { backgroundColor: "rgba(255,255,255,0.05)", borderColor: BRAND.border },
  userBubble: { backgroundColor: BRAND.navy, borderColor: "rgba(241,238,219,0.18)" },

  notFromVinniesBanner: {
    paddingVertical: 8,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 10,
    backgroundColor: "rgba(241,238,219,0.10)",
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.18)",
  },
  notFromVinniesText: { color: BRAND.cream, fontSize: 12, lineHeight: 16, fontWeight: "900" },

  clarifyingQuestion: { fontSize: 15, lineHeight: 20, fontWeight: "900", color: BRAND.cream, marginBottom: 8 },

  bubbleText: { fontSize: 15, lineHeight: 20 },
  aiText: { color: BRAND.text },
  userText: { color: BRAND.cream, fontWeight: "700" },

  typingBubble: { flexDirection: "row", alignItems: "center", gap: 8 },
  typingText: { color: BRAND.muted, fontWeight: "800" },

  escalate: {
    marginHorizontal: 14,
    marginTop: 4,
    marginBottom: 10,
    padding: 14,
    borderRadius: 16,
    backgroundColor: "rgba(4,53,83,0.22)",
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.18)",
    alignItems: "flex-start",
  },
  escalateText: { color: BRAND.cream, fontWeight: "900", fontSize: 15 },
  escalateSub: { marginTop: 4, color: BRAND.muted, fontSize: 12 },

  inputWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderTopWidth: 1,
    borderTopColor: BRAND.border,
    backgroundColor: BRAND.bg,
  },
  inputCard: {
    flexDirection: "row",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
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
    backgroundColor: BRAND.cream,
  },
  sendBtnDisabled: { backgroundColor: "rgba(241,238,219,0.35)" },
  sendText: { color: BRAND.navy, fontWeight: "900" },
});
