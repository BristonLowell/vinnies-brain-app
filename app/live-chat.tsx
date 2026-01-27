import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  InteractionManager,
  ActivityIndicator,
  Keyboard,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { getOrCreateSession, liveChatHistory, liveChatSend } from "../src/api";

const BRAND = {
  bg: "#071018",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  navy: "#043553",
  cream: "#F1EEDB",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.70)",
};

type Msg = {
  id: string;
  sender_role: "customer" | "owner" | "system";
  body: string;
  created_at: string;
  conversation_id?: string;
};

const INPUT_BAR_EST_HEIGHT = 76;
const IOS_KEYBOARD_OFFSET = 120;

export default function LiveChat() {
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [sessionId, setSessionId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>("");

  const listRef = useRef<FlatList<Msg>>(null);
  const pollTimerRef = useRef<any>(null);
  const lastSigRef = useRef<string>("");

  useEffect(() => {
    const show = Keyboard.addListener("keyboardDidShow", () => setKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setKeyboardOpen(false));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const scrollToBottom = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const computeSig = (msgs: Msg[]) => {
    const last = msgs?.[msgs.length - 1];
    return `${msgs.length}:${last?.id ?? ""}:${last?.created_at ?? ""}`;
  };

  const refresh = useCallback(
    async (sid: string) => {
      try {
        const hist = await liveChatHistory(sid);

        const cid = String(hist.conversation_id || "");
        const msgs = Array.isArray(hist.messages) ? (hist.messages as Msg[]) : [];

        const sig = computeSig(msgs);
        if (sig !== lastSigRef.current) {
          lastSigRef.current = sig;
          setConversationId(cid);
          setMessages(msgs);
          requestAnimationFrame(scrollToBottom);
        }
      } catch (e: any) {
        setError(String(e?.message ?? "Failed to load live chat."));
      }
    },
    [scrollToBottom]
  );

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        setError("");
        setReady(false);
        setLoading(true);

        const sid = await getOrCreateSession();
        if (cancelled) return;

        setSessionId(sid);

        await refresh(sid);
        if (cancelled) return;

        setReady(true);
      } catch (e: any) {
        if (!cancelled) setError(String(e?.message ?? "Unable to start live chat."));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [refresh]);

  useEffect(() => {
    if (!sessionId) return;

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(() => refresh(sessionId), 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [sessionId, refresh]);

  const canSend = useMemo(() => text.trim().length > 0 && ready && !!sessionId && !loading, [text, ready, sessionId, loading]);

  async function send() {
    try {
      const body = text.trim();
      if (!body || !sessionId) return;

      setText("");
      setError("");

      await liveChatSend(sessionId, body);
      await refresh(sessionId);
    } catch (e: any) {
      setError(String(e?.message ?? "Failed to send message."));
    }
  }

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? IOS_KEYBOARD_OFFSET : 0}
      >
        <View style={styles.header}>
          <Text style={styles.title}>Live chat with Vinnies</Text>
          <Text style={styles.sub}>You are chatting with Vinnies</Text>
          {!!conversationId && <Text style={styles.meta}>Conversation: {conversationId.slice(0, 8)}…</Text>}
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        {loading && messages.length === 0 ? (
          <View style={styles.loadingWrap}>
            <ActivityIndicator />
            <Text style={styles.loadingText}>Loading chat…</Text>
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[styles.list, { paddingBottom: INPUT_BAR_EST_HEIGHT + 16 + safeBottom }]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToBottom()}
            renderItem={({ item }) => {
              const mine = item.sender_role === "customer";
              return (
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={styles.msgText}>{item.body}</Text>
                </View>
              );
            }}
          />
        )}

        <View
          style={[
            styles.inputWrap,
            { paddingBottom: 12 + safeBottom },
            keyboardOpen ? { paddingBottom: 28 + safeBottom } : null,
          ]}
        >
          <TextInput
            value={text}
            onChangeText={setText}
            placeholder="Type a message…"
            placeholderTextColor="rgba(255,255,255,0.45)"
            style={styles.input}
            multiline
            editable={ready && !loading}
          />
          <Pressable style={[styles.btn, !canSend && styles.btnDisabled]} disabled={!canSend} onPress={send}>
            <Text style={styles.btnText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  title: { color: BRAND.cream, fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 2, color: BRAND.muted },
  meta: { marginTop: 6, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: BRAND.muted, fontWeight: "800" },

  errorBox: {
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.20)",
    backgroundColor: "rgba(241,238,219,0.08)",
  },
  errorText: { color: BRAND.cream, fontWeight: "900" },

  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 10, flexGrow: 1 },

  bubble: { maxWidth: "82%", padding: 12, borderRadius: 16, borderWidth: 1 },
  mine: { alignSelf: "flex-end", backgroundColor: BRAND.navy, borderColor: "rgba(241,238,219,0.18)" },
  theirs: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.05)", borderColor: BRAND.border },
  msgText: { color: BRAND.text, fontSize: 15, lineHeight: 20 },

  inputWrap: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: BRAND.border,
    backgroundColor: BRAND.bg,
    alignItems: "flex-end",
  },
  input: {
    flex: 1,
    color: "white",
    minHeight: 44,
    maxHeight: 130,
    fontSize: 15,
    lineHeight: 20,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  btn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: BRAND.cream,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: BRAND.navy, fontWeight: "900" },
});
