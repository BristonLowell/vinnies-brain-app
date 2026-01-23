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
import { getOrCreateSession, sendChat, startNewSession } from "../src/api";

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

type Issue = {
  sessionId: string;
  lastUpdatedAt: number; // epoch ms
  preview: string; // short snippet
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

function formatPreview(s: string) {
  const t = (s || "").replace(/\s+/g, " ").trim();
  if (!t) return "";
  return t.length > 70 ? t.slice(0, 70) + "…" : t;
}

function formatTime(ts: number) {
  try {
    const d = new Date(ts);
    const now = new Date();
    const sameDay =
      d.getFullYear() === now.getFullYear() &&
      d.getMonth() === now.getMonth() &&
      d.getDate() === now.getDate();

    if (sameDay) {
      return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    }
    return d.toLocaleDateString([], { month: "short", day: "numeric" });
  } catch {
    return "";
  }
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

  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesOpen, setIssuesOpen] = useState(false);

  const listRef = useRef<FlatList<ChatItem>>(null);
  const inputRef = useRef<TextInput>(null);

  const storageKeySuffix = useMemo(() => {
    const y = year ? String(year) : "any";
    return `y:${y}`;
  }, [year]);

  // Legacy keys (single-convo per year)
  const LEGACY_CHAT_ITEMS_KEY = useMemo(
    () => `vinniesbrain_chat_items_${storageKeySuffix}`,
    [storageKeySuffix]
  );
  const CHAT_SESSION_KEY = useMemo(
    () => `vinniesbrain_chat_session_${storageKeySuffix}`,
    [storageKeySuffix]
  );

  // New: issues index + per-session items key
  const ISSUES_KEY = useMemo(
    () => `vinniesbrain_issue_index_${storageKeySuffix}`,
    [storageKeySuffix]
  );
  const itemsKeyForSession = useCallback(
    (sid: string) => `vinniesbrain_chat_items_${storageKeySuffix}_${sid}`,
    [storageKeySuffix]
  );

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

  const persistIssues = useCallback(
    async (next: Issue[]) => {
      try {
        await AsyncStorage.setItem(ISSUES_KEY, JSON.stringify(next));
      } catch {}
    },
    [ISSUES_KEY]
  );

  const loadItemsForSession = useCallback(
    async (sid: string) => {
      // Load per-session items; if none, try legacy and migrate
      try {
        const key = itemsKeyForSession(sid);
        const stored = await AsyncStorage.getItem(key);
        if (stored) {
          const parsed = JSON.parse(stored) as ChatItem[];
          const nextItems = Array.isArray(parsed) && parsed.length > 0 ? parsed : [INITIAL_ASSISTANT];
          setItems(nextItems);

          // restore escalate state based on last assistant meta
          const last = [...nextItems].reverse().find((x) => x.role === "assistant");
          setShowEscalate(!!last?.meta?.showEscalation);
          return;
        }

        // migrate legacy, if present
        const legacy = await AsyncStorage.getItem(LEGACY_CHAT_ITEMS_KEY);
        if (legacy) {
          try {
            const parsedLegacy = JSON.parse(legacy) as ChatItem[];
            const nextItems =
              Array.isArray(parsedLegacy) && parsedLegacy.length > 0 ? parsedLegacy : [INITIAL_ASSISTANT];
            setItems(nextItems);
            await AsyncStorage.setItem(key, JSON.stringify(nextItems));
            await AsyncStorage.removeItem(LEGACY_CHAT_ITEMS_KEY);

            const last = [...nextItems].reverse().find((x) => x.role === "assistant");
            setShowEscalate(!!last?.meta?.showEscalation);
            return;
          } catch {
            // ignore
          }
        }
      } catch {}

      setItems([INITIAL_ASSISTANT]);
      setShowEscalate(false);
    },
    [itemsKeyForSession, LEGACY_CHAT_ITEMS_KEY]
  );

  // Initial load: issues index + last session + items
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const [issuesRaw, storedSid] = await Promise.all([
          AsyncStorage.getItem(ISSUES_KEY),
          AsyncStorage.getItem(CHAT_SESSION_KEY),
        ]);

        if (cancelled) return;

        let parsedIssues: Issue[] = [];
        if (issuesRaw) {
          try {
            const p = JSON.parse(issuesRaw) as Issue[];
            parsedIssues = Array.isArray(p) ? p : [];
          } catch {
            parsedIssues = [];
          }
        }

        // keep newest first
        parsedIssues.sort((a, b) => (b.lastUpdatedAt || 0) - (a.lastUpdatedAt || 0));
        setIssues(parsedIssues);

        let sid = storedSid || "";

        // If no stored session, pick most recent issue if exists
        if (!sid && parsedIssues.length > 0) {
          sid = parsedIssues[0].sessionId;
        }

        // If still none, create a new session
        if (!sid) {
          sid = await getOrCreateSession({ forceNew: true });
          if (cancelled) return;

          const now = Date.now();
          const nextIssues: Issue[] = [{ sessionId: sid, lastUpdatedAt: now, preview: "" }, ...parsedIssues];
          setIssues(nextIssues);
          await persistIssues(nextIssues);

          setSessionId(sid);
          await AsyncStorage.setItem(CHAT_SESSION_KEY, sid);
          await loadItemsForSession(sid);
          return;
        }

        // use existing
        setSessionId(sid);
        await AsyncStorage.setItem(CHAT_SESSION_KEY, sid);
        await loadItemsForSession(sid);
      } catch {
        setItems([INITIAL_ASSISTANT]);
        setShowEscalate(false);
        try {
          const sid = await getOrCreateSession({ forceNew: true });
          if (!cancelled) setSessionId(sid);
        } catch {}
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [ISSUES_KEY, CHAT_SESSION_KEY, persistIssues, loadItemsForSession]);

  // Persist items to per-session key whenever items change
  useEffect(() => {
    (async () => {
      if (!sessionId) return;
      try {
        await AsyncStorage.setItem(itemsKeyForSession(sessionId), JSON.stringify(items));
      } catch {}
    })();
  }, [itemsKeyForSession, items, sessionId]);

  // Persist active session id
  useEffect(() => {
    if (!sessionId) return;
    (async () => {
      try {
        await AsyncStorage.setItem(CHAT_SESSION_KEY, sessionId);
      } catch {}
    })();
  }, [CHAT_SESSION_KEY, sessionId]);

  const touchIssue = useCallback(
    async (sid: string, previewText?: string) => {
      const now = Date.now();
      setIssues((prev) => {
        const next = [...prev];
        const idx = next.findIndex((x) => x.sessionId === sid);
        const preview = typeof previewText === "string" ? formatPreview(previewText) : (idx >= 0 ? next[idx].preview : "");
        const updated: Issue = { sessionId: sid, lastUpdatedAt: now, preview };

        if (idx >= 0) next.splice(idx, 1);
        next.unshift(updated);

        // persist (fire and forget)
        persistIssues(next);
        return next;
      });
    },
    [persistIssues]
  );

  async function onStartNewConversation() {
    if (sending) return;

    try {
      const newSid = await startNewSession();

      // reset UI
      setSessionId(newSid);
      setItems([INITIAL_ASSISTANT]);
      setShowEscalate(false);
      setText("");
      setIssuesOpen(false);

      // mark as new issue
      await touchIssue(newSid, "");

      // set as active session
      await AsyncStorage.setItem(CHAT_SESSION_KEY, newSid);

      scrollToBottom(false);
    } catch {
      setItems((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry — I couldn’t start a new conversation. Please try again." },
      ]);
    }
  }

  async function onSelectIssue(sid: string) {
    if (sending) return;
    if (!sid || sid === sessionId) {
      setIssuesOpen(false);
      return;
    }

    setSessionId(sid);
    setIssuesOpen(false);
    setShowEscalate(false);
    setText("");

    try {
      await AsyncStorage.setItem(CHAT_SESSION_KEY, sid);
    } catch {}

    await loadItemsForSession(sid);
    scrollToBottom(false);
  }

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

      // Update issue preview with user's message
      await touchIssue(sid, message);

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

      // If assistant answered something substantial and user message was empty preview,
      // keep user preview as primary (already set). Just bump timestamp.
      await touchIssue(sid);
    } catch {
      setItems((prev) => [
        ...prev,
        { role: "assistant", text: "Sorry — I couldn’t reach the server. Please try again." },
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

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 120 : 0}
      >
        <Pressable onPress={Keyboard.dismiss} style={StyleSheet.absoluteFill} pointerEvents="box-none">
          <View style={StyleSheet.absoluteFill} pointerEvents="none" />
        </Pressable>

        {/* Header + Start New + Previous Issues */}
        <View style={styles.headerRow}>
          <Pressable
            onPress={() => setIssuesOpen((v) => !v)}
            style={({ pressed }) => [styles.issuesBtn, pressed && { opacity: 0.9 }]}
          >
            <Text style={styles.issuesBtnText}>Previous Issues</Text>
            <Text style={styles.issuesBtnSub}>
              {issues.length > 0 ? `${issues.length} saved` : "none yet"}
            </Text>
          </Pressable>

          <Pressable
            onPress={onStartNewConversation}
            disabled={sending}
            style={({ pressed }) => [
              styles.newChatBtn,
              sending && { opacity: 0.5 },
              pressed && !sending && { opacity: 0.85, transform: [{ scale: 0.98 }] },
            ]}
          >
            <Text style={styles.newChatText}>Start New Issue</Text>
          </Pressable>
        </View>

        {issuesOpen && (
          <View style={styles.issuesPanel}>
            {issues.length === 0 ? (
              <Text style={styles.issuesEmpty}>No previous issues yet.</Text>
            ) : (
              issues.map((it) => {
                const isActive = it.sessionId === sessionId;
                return (
                  <Pressable
                    key={it.sessionId}
                    onPress={() => onSelectIssue(it.sessionId)}
                    style={({ pressed }) => [
                      styles.issueRow,
                      isActive && styles.issueRowActive,
                      pressed && { opacity: 0.92 },
                    ]}
                  >
                    <View style={{ flex: 1 }}>
                      <Text style={styles.issueTitle}>
                        {isActive ? "Current issue" : "Issue"}
                        <Text style={styles.issueTime}> · {formatTime(it.lastUpdatedAt)}</Text>
                      </Text>
                      <Text style={styles.issuePreview} numberOfLines={2}>
                        {it.preview || "Tap to open"}
                      </Text>
                    </View>

                    <Text style={styles.issueChevron}>›</Text>
                  </Pressable>
                );
              })
            )}
          </View>
        )}

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

  // Header / Issues UI
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.border,
    backgroundColor: BRAND.bg,
  },
  issuesBtn: {
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  issuesBtnText: { color: BRAND.cream, fontSize: 13, fontWeight: "900" },
  issuesBtnSub: { marginTop: 2, color: BRAND.muted, fontSize: 11, fontWeight: "700" },

  newChatBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "rgba(241,238,219,0.12)",
    borderWidth: 1,
    borderColor: "rgba(241,238,219,0.25)",
  },
  newChatText: { color: BRAND.cream, fontSize: 12, fontWeight: "900" },

  issuesPanel: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 6,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: BRAND.border,
    backgroundColor: "rgba(255,255,255,0.04)",
    overflow: "hidden",
  },
  issuesEmpty: { padding: 12, color: BRAND.muted, fontWeight: "800" },

  issueRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    gap: 10,
  },
  issueRowActive: {
    backgroundColor: "rgba(4,53,83,0.20)",
  },
  issueTitle: { color: BRAND.cream, fontWeight: "900", fontSize: 13 },
  issueTime: { color: BRAND.muted, fontWeight: "800", fontSize: 12 },
  issuePreview: { marginTop: 4, color: BRAND.muted, fontSize: 12, lineHeight: 16 },
  issueChevron: { color: BRAND.cream, fontWeight: "900", fontSize: 20, opacity: 0.75 },
});
