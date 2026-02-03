import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Stack, useRouter } from "expo-router";
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
  RefreshControl,
  BackHandler,
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

function SkeletonBubble({ mine }: { mine?: boolean }) {
  return (
    <View style={[styles.skelBubble, mine ? styles.skelMine : styles.skelTheirs]}>
      <View style={styles.skelLine} />
      <View style={[styles.skelLine, { width: "72%", marginTop: 8 }]} />
    </View>
  );
}

export default function LiveChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const goHome = useCallback(() => {
    // Replace so users can't go back into prior chat screens / cached sessions.
    router.replace("/");
  }, [router]);

  const [keyboardOpen, setKeyboardOpen] = useState(false);

  const [sessionId, setSessionId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
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

  // Android hardware back should go Home (not back to prior chat screens)
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goHome();
      return true;
    });
    return () => sub.remove();
  }, [goHome]);
;

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
    async (sid: string, asPull?: boolean) => {
      try {
        if (asPull) setRefreshing(true);
        const hist = await liveChatHistory(sid);

        const cid = String(hist.conversation_id || "");
        const msgs = Array.isArray(hist.messages) ? (hist.messages as Msg[]) : [];

        const sig = computeSig(msgs);
        if (sig !== lastSigRef.current) {
          lastSigRef.current = sig;
          setConversationId(cid);
          setMessages(msgs);
          requestAnimationFrame(scrollToBottom);
        } else {
          // still ensure CID stays in sync
          if (cid && cid !== conversationId) setConversationId(cid);
        }

        setError("");
      } catch (e: any) {
        setError(String(e?.message ?? "Failed to load live chat."));
      } finally {
        if (asPull) setRefreshing(false);
      }
    },
    [scrollToBottom, conversationId]
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

  const canSend = useMemo(
    () => text.trim().length > 0 && ready && !!sessionId && !loading,
    [text, ready, sessionId, loading]
  );

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
      <Stack.Screen
        options={{
          headerShown: false,
          // Prevent swipe-back (iOS) into previous screens where cached chat could appear.
          gestureEnabled: false,
        }}
      />
      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? IOS_KEYBOARD_OFFSET : 0}
      >
        <View style={styles.header}>
          <Pressable
            onPress={goHome}
            hitSlop={10}
            style={({ pressed }) => [styles.headerBack, pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] }]}
          >
            <Text style={styles.headerBackIcon}>←</Text>
            <Text style={styles.headerBackText}>Home</Text>
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Live chat with Vinnies</Text>
            <Text style={styles.sub}>You are chatting with Vinnies</Text>
            {!!conversationId && <Text style={styles.meta}>Conversation: {conversationId.slice(0, 8)}…</Text>}
          </View>

          <Pressable
            onPress={() => sessionId && refresh(sessionId, true)}
            style={({ pressed }) => [styles.hdrBtn, pressed && { opacity: 0.9 }]}
            hitSlop={10}
          >
            <Text style={styles.hdrBtnText}>Refresh</Text>
          </Pressable>
        </View>

        {!!error && (
          <View style={styles.errorBox}>
            <Text style={styles.errorText} numberOfLines={3}>
              {error}
            </Text>

            <Pressable
              onPress={() => sessionId && refresh(sessionId, true)}
              style={({ pressed }) => [styles.retryBtn, pressed && { opacity: 0.9 }]}
            >
              <Text style={styles.retryBtnText}>Retry</Text>
            </Pressable>
          </View>
        )}

        {loading && messages.length === 0 ? (
          <View style={styles.skelWrap}>
            <SkeletonBubble />
            <SkeletonBubble mine />
            <SkeletonBubble />
            <SkeletonBubble mine />
            <SkeletonBubble />
          </View>
        ) : (
          <FlatList
            ref={listRef}
            data={messages}
            keyExtractor={(m) => m.id}
            contentContainerStyle={[styles.list, { paddingBottom: INPUT_BAR_EST_HEIGHT + 16 + safeBottom }]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToBottom()}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => sessionId && refresh(sessionId, true)}
                tintColor="white"
              />
            }
            renderItem={({ item }) => {
              const mine = item.sender_role === "customer";
              return (
                <View style={[styles.bubble, mine ? styles.mine : styles.theirs]}>
                  <Text style={styles.msgText}>{item.body}</Text>
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>No messages yet</Text>
                <Text style={styles.emptySub}>Send a message and Vinnies will see it here.</Text>
              </View>
            }
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

  header: {
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 8,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
  },
  title: { color: BRAND.cream, fontSize: 18, fontWeight: "900" },
  sub: { marginTop: 2, color: BRAND.muted },
  meta: { marginTop: 6, color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },

  hdrBtn: {
    height: 40,
    paddingHorizontal: 12,
    borderRadius: 12,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  hdrBtnText: { color: "white", fontWeight: "900", fontSize: 12 },

  errorBox: {
    marginHorizontal: 14,
    marginBottom: 6,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.20)",
    backgroundColor: "rgba(241,238,219,0.08)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { color: BRAND.cream, fontWeight: "900", flex: 1 },
  retryBtn: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: BRAND.cream,
  },
  retryBtnText: { color: BRAND.navy, fontWeight: "900" },

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

  empty: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  emptySub: { color: "rgba(255,255,255,0.65)", textAlign: "center" },

  skelWrap: { paddingHorizontal: 14, paddingTop: 10, gap: 10, flex: 1 },
  skelBubble: { maxWidth: "82%", padding: 12, borderRadius: 16, borderWidth: 1 },
  skelMine: { alignSelf: "flex-end", backgroundColor: "rgba(4,53,83,0.22)", borderColor: "rgba(241,238,219,0.12)" },
  skelTheirs: { alignSelf: "flex-start", backgroundColor: "rgba(255,255,255,0.05)", borderColor: BRAND.border },
  skelLine: {
    height: 10,
    borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.12)",
    width: "92%",
  },
});
