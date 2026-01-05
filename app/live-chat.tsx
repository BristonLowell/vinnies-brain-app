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
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { getOrCreateSession, liveChatHistory, liveChatSend } from "../src/api";

type Msg = {
  id: string;
  sender_role: "customer" | "owner" | "system";
  body: string;
  created_at: string;
  conversation_id?: string;
};

export default function LiveChat() {
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

  const scrollToBottom = useCallback(() => {
    InteractionManager.runAfterInteractions(() => {
      listRef.current?.scrollToEnd({ animated: true });
    });
  }, []);

  const computeSig = (msgs: Msg[]) => {
    // simple signature to avoid re-setting state when nothing changed
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
        // Don’t spam the UI on transient errors; show something useful though
        const msg = String(e?.message ?? "Failed to load live chat.");
        setError(msg);
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

        const sid = await getOrCreateSession(); // reuse existing session (no login needed)
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

  // Poll every 2s for new messages (no Supabase auth / realtime needed)
  useEffect(() => {
    if (!sessionId) return;

    if (pollTimerRef.current) clearInterval(pollTimerRef.current);

    pollTimerRef.current = setInterval(() => {
      refresh(sessionId);
    }, 2000);

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    };
  }, [sessionId, refresh]);

  const canSend = useMemo(() => {
    return text.trim().length > 0 && ready && !!sessionId && !loading;
  }, [text, ready, sessionId, loading]);

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
      <KeyboardAvoidingView style={styles.safe} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Live chat with Vinnies</Text>
          <Text style={styles.sub}>You’re chatting directly with the owner.</Text>
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
            contentContainerStyle={styles.list}
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

        <View style={styles.inputWrap}>
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
  safe: { flex: 1, backgroundColor: "#0B0F14" },
  header: { paddingHorizontal: 14, paddingTop: 10, paddingBottom: 8 },
  title: { color: "white", fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 2, color: "rgba(255,255,255,0.65)" },
  meta: { marginTop: 6, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },

  loadingWrap: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  errorBox: {
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: { color: "white", fontWeight: "800" },

  list: { paddingHorizontal: 14, paddingVertical: 10, gap: 10, flexGrow: 1 },

  bubble: { maxWidth: "82%", padding: 12, borderRadius: 16, borderWidth: 1 },
  mine: { alignSelf: "flex-end", backgroundColor: "#2563EB", borderColor: "rgba(255,255,255,0.10)" },
  theirs: { alignSelf: "flex-start", backgroundColor: "#111827", borderColor: "rgba(255,255,255,0.10)" },
  msgText: { color: "white", fontSize: 15, lineHeight: 20 },

  inputWrap: {
    flexDirection: "row",
    gap: 10,
    padding: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    backgroundColor: "#0B0F14",
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
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  btn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: "#0B0F14", fontWeight: "900" },
});
