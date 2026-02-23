import { Stack, useLocalSearchParams, useRouter } from "expo-router";
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
  Alert,
  BackHandler,
  AppState,
  type AppStateStatus,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { getOrCreateSession, sendChat, getSupportStatus } from "../src/api";

const BRAND = {
  bg: "#071018",
  surface: "rgba(255,255,255,0.06)",
  border: "rgba(255,255,255,0.10)",
  navy: "#043553",
  cream: "#F1EEDB",
  text: "rgba(255,255,255,0.92)",
  muted: "rgba(255,255,255,0.70)",
  faint: "rgba(255,255,255,0.45)",

  // ✅ lighter, easier-to-read (used on key UI)
  lightBg: "#F6F7F9",
  lightSurface: "#FFFFFF",
  lightBorder: "rgba(0,0,0,0.10)",
  lightText: "#101828",
  lightMuted: "rgba(16,24,40,0.70)",
};

type CheckpointSummary = {
  known?: string[];
  ruled_out?: string[];
  likely_causes?: string[];
  next_checks?: string[];
};

type ChatItem = {
  role: "user" | "assistant";
  text: string;
  meta?: {
    usedArticles?: { id: string; title: string }[];
    showEscalation?: boolean;
    clarifyingQuestion?: string;
    checkpointSummary?: CheckpointSummary;
  };
};

const INITIAL_ASSISTANT: ChatItem = {
  role: "assistant",
  text: "What’s going on with your Airstream?",
};

const INPUT_BAR_EST_HEIGHT = 76;

// ✅ must match index.tsx
const FORCE_NEW_SESSION_KEY = "vinniesbrain_force_new_session";

// ✅ track last active so we can decide whether to reset after a full close
const LAST_ACTIVE_TS_KEY = "vinniesbrain_last_active_ts";

// ✅ if app was away longer than this, start fresh (10 minutes)
const RESET_AFTER_MS = 10 * 60 * 1000;

// ✅ AI consent (one-time)
const AI_CONSENT_KEY = "vinniesbrain_ai_consent_v1"; // "allow" | "deny"
// IMPORTANT: set this to your real AI provider name
const AI_PROVIDER_NAME = "OpenAI";

function initials(label: string) {
  const s = (label || "").trim();
  if (!s) return "?";
  const parts = s.split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase()).join("");
}

function fmtLocal(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString();
}

function renderCheckpointSummary(summary?: CheckpointSummary) {
  if (!summary) return null;

  const hasAny =
    (summary.known && summary.known.length > 0) ||
    (summary.ruled_out && summary.ruled_out.length > 0) ||
    (summary.likely_causes && summary.likely_causes.length > 0) ||
    (summary.next_checks && summary.next_checks.length > 0);

  if (!hasAny) return null;

  return (
    <View style={styles.checkpointCard}>
      <Text style={styles.checkpointTitle}>What we know so far</Text>

      {!!summary.known?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Confirmed</Text>
          {summary.known.map((s, i) => (
            <Text key={`k_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {!!summary.ruled_out?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Ruled out</Text>
          {summary.ruled_out.map((s, i) => (
            <Text key={`r_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {!!summary.likely_causes?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Likely causes</Text>
          {summary.likely_causes.map((s, i) => (
            <Text key={`c_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}

      {!!summary.next_checks?.length && (
        <View style={styles.checkpointSection}>
          <Text style={styles.checkpointLabel}>Next checks</Text>
          {summary.next_checks.map((s, i) => (
            <Text key={`n_${i}`} style={styles.checkpointItem}>
              • {s}
            </Text>
          ))}
        </View>
      )}
    </View>
  );
}

export default function Chat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const params = useLocalSearchParams<{ year?: string; category?: string }>();
  const year = params.year ? Number(params.year) : undefined;

  const [sessionId, setSessionId] = useState("");
  const [items, setItems] = useState<ChatItem[]>([INITIAL_ASSISTANT]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [showEscalate, setShowEscalate] = useState(false);

  const [businessHours, setBusinessHours] = useState<boolean | null>(null);
  const [nextOpen, setNextOpen] = useState<string>("");

  // ✅ Android keyboard visibility (helps lift input bar when keyboard is open)
  const [androidKeyboardOpen, setAndroidKeyboardOpen] = useState(false);

  // ✅ AI consent state
  const [aiConsent, setAiConsent] = useState<"unknown" | "allow" | "deny">("unknown");
  const consentPromptShownRef = useRef(false);

  const listRef = useRef<FlatList<ChatItem>>(null);
  const inputRef = useRef<TextInput>(null);

  // ✅ “Resolved?” prompt state
  const [showResolvedPrompt, setShowResolvedPrompt] = useState(false);

  const ITEMS_KEY = useMemo(
    () => (sessionId ? `vinniesbrain_chat_items_${sessionId}` : ""),
    [sessionId]
  );

  const confirmGoHome = useCallback(() => {
    Alert.alert(
      "Go to Home?",
      "This will reset your troubleshooting progress for this issue.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Go Home",
          style: "destructive",
          onPress: async () => {
            try {
              await AsyncStorage.setItem(FORCE_NEW_SESSION_KEY, "1");
            } catch {}
            router.replace("/");
          },
        },
      ]
    );
  }, [router]);

  async function goHomeResolved() {
    try {
      await AsyncStorage.setItem(FORCE_NEW_SESSION_KEY, "1");
    } catch {}
    router.replace("/");
  }

  function onResolvedNo() {
    setShowResolvedPrompt(false);
    // bring keyboard back + focus input
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  function onResolvedYes() {
    setShowResolvedPrompt(false);
    confirmGoHome();
  }

  // ✅ Load consent once on mount
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const v = await AsyncStorage.getItem(AI_CONSENT_KEY);
        if (cancelled) return;
        if (v === "allow" || v === "deny") setAiConsent(v);
        else setAiConsent("unknown");
      } catch {
        if (cancelled) return;
        setAiConsent("unknown");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const showAiConsentPrompt = useCallback(async (): Promise<"allow" | "deny"> => {
    // If already decided, return it
    if (aiConsent === "allow" || aiConsent === "deny") return aiConsent;

    // Prevent multiple Alerts from stacking
    if (consentPromptShownRef.current) {
      // Wait briefly until state updates (best-effort)
      return "deny";
    }
    consentPromptShownRef.current = true;

    const result = await new Promise<"allow" | "deny">((resolve) => {
      Alert.alert(
        "AI Data Use Permission",
        `Vinnie’s Brain uses ${AI_PROVIDER_NAME} to generate troubleshooting responses.\n\n` +
          `To do this, we send:\n` +
          `• The text you type in chat (and any details you include)\n` +
          `• Your selected Airstream year (if provided)\n\n` +
          `Do not include sensitive personal information.\n\n` +
          `Do you allow Vinnie’s Brain to send your chat content to ${AI_PROVIDER_NAME}?`,
        [
          {
            text: "Don’t Allow",
            style: "cancel",
            onPress: async () => {
              try {
                await AsyncStorage.setItem(AI_CONSENT_KEY, "deny");
              } catch {}
              setAiConsent("deny");
              resolve("deny");
            },
          },
          {
            text: "Allow AI Assistance",
            style: "default",
            onPress: async () => {
              try {
                await AsyncStorage.setItem(AI_CONSENT_KEY, "allow");
              } catch {}
              setAiConsent("allow");
              resolve("allow");
            },
          },
        ]
      );
    });

    consentPromptShownRef.current = false;
    return result;
  }, [aiConsent]);

  // ✅ If they land here and consent is unknown, prompt once (non-annoying)
  useEffect(() => {
    if (aiConsent !== "unknown") return;
    // Prompt only once per screen mount; they can still back out if they want
    showAiConsentPrompt().catch(() => {});
  }, [aiConsent, showAiConsentPrompt]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      confirmGoHome();
      return true;
    });
    return () => sub.remove();
  }, [confirmGoHome]);

  // ✅ Android keyboard listeners
  useEffect(() => {
    if (Platform.OS !== "android") return;
    const show = Keyboard.addListener("keyboardDidShow", () => setAndroidKeyboardOpen(true));
    const hide = Keyboard.addListener("keyboardDidHide", () => setAndroidKeyboardOpen(false));
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
        const s = await getSupportStatus();
        if (cancelled) return;
        setBusinessHours(!!s?.business_hours);
        setNextOpen(s?.next_open ? String(s.next_open) : "");
      } catch {
        if (cancelled) return;
        setBusinessHours(null);
        setNextOpen("");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // ✅ reset if app was fully “away”
  useEffect(() => {
    let prevState: AppStateStatus = AppState.currentState;

    const onChange = async (nextState: AppStateStatus) => {
      try {
        if (prevState === "active" && nextState.match(/inactive|background/)) {
          await AsyncStorage.setItem(LAST_ACTIVE_TS_KEY, String(Date.now()));
        }

        if (prevState.match(/inactive|background/) && nextState === "active") {
          const raw = await AsyncStorage.getItem(LAST_ACTIVE_TS_KEY);
          const lastTs = raw ? Number(raw) : 0;

          if (!lastTs || Date.now() - lastTs > RESET_AFTER_MS) {
            await AsyncStorage.setItem(FORCE_NEW_SESSION_KEY, "1");

            if (sessionId) {
              await AsyncStorage.removeItem(`vinniesbrain_chat_items_${sessionId}`);
            }

            setSessionId("");
            setItems([INITIAL_ASSISTANT]);
            setShowEscalate(false);
            setSending(false);
            setText("");
            setShowResolvedPrompt(false);

            router.replace("/");
          }
        }
      } catch {
      } finally {
        prevState = nextState;
      }
    };

    const sub = AppState.addEventListener("change", onChange);
    return () => sub.remove();
  }, [sessionId, router]);

  // ✅ honor FORCE_NEW_SESSION_KEY and restore cached messages when possible
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        let forceNew = false;
        try {
          const flag = await AsyncStorage.getItem(FORCE_NEW_SESSION_KEY);
          forceNew = flag === "1";
          if (forceNew) await AsyncStorage.removeItem(FORCE_NEW_SESSION_KEY);
        } catch {}

        const sid = forceNew ? await getOrCreateSession({ forceNew: true }) : await getOrCreateSession();

        if (cancelled) return;

        setSessionId(sid);

        if (forceNew) {
          setItems([INITIAL_ASSISTANT]);
          setShowEscalate(false);
          setShowResolvedPrompt(false);
          return;
        }

        try {
          const raw = await AsyncStorage.getItem(`vinniesbrain_chat_items_${sid}`);
          if (raw) {
            const parsed = JSON.parse(raw) as ChatItem[];
            if (Array.isArray(parsed) && parsed.length > 0) {
              setItems(parsed);
              const last = [...parsed].reverse().find((x) => x.role === "assistant");
              setShowEscalate(!!last?.meta?.showEscalation);
              return;
            }
          }
        } catch {}

        setItems([INITIAL_ASSISTANT]);
        setShowEscalate(false);
      } catch {
        setItems([INITIAL_ASSISTANT]);
        setShowEscalate(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ITEMS_KEY) return;
    (async () => {
      try {
        await AsyncStorage.setItem(ITEMS_KEY, JSON.stringify(items));
      } catch {}
    })();
  }, [ITEMS_KEY, items]);

  // ✅ Lock chat unless consent is allowed
  const aiAllowed = aiConsent === "allow";
  const canSend = useMemo(() => aiAllowed && !sending && text.trim().length > 0, [aiAllowed, sending, text]);

  // Count turns
  const assistantTurns = useMemo(() => {
    const total = items.filter((x) => x.role === "assistant").length;
    return Math.max(0, total - 1);
  }, [items]);

  const escalationEligibleByAiPrompts = assistantTurns >= 3;

  async function sendAndAppend(sid: string, message: string) {
    const res = await sendChat(sid, message, year);

    const usedArticles = (res as any).used_articles || [];
    const clarifyingQuestion =
      Array.isArray((res as any).clarifying_questions) && (res as any).clarifying_questions.length > 0
        ? (res as any).clarifying_questions[0]
        : "";

    const checkpointSummary = (res as any).checkpoint_summary as CheckpointSummary | undefined;

    setItems((prev) => [
      ...prev,
      {
        role: "assistant",
        text: (res as any).answer,
        meta: {
          usedArticles,
          showEscalation: !!(res as any).show_escalation,
          clarifyingQuestion,
          checkpointSummary,
        },
      },
    ]);

    const se = !!(res as any).show_escalation;
    setShowEscalate(se);

    // ✅ After AI responds, ask if resolved (hide keyboard so they see it)
    Keyboard.dismiss();
    inputRef.current?.blur();
    setShowResolvedPrompt(true);
  }

  async function onSend() {
    const msg = text.trim();
    if (!msg || sending) return;

    // ✅ Hide resolved prompt once user continues
    setShowResolvedPrompt(false);

    // ✅ Ensure consent before transmitting any user content to AI
    if (!aiAllowed) {
      const decision = await showAiConsentPrompt();
      if (decision !== "allow") {
        // Hard block: they can’t use the app without consent
        Alert.alert(
          "AI Permission Required",
          `Vinnie’s Brain requires AI to operate. To use the app, please allow sending your chat content to ${AI_PROVIDER_NAME}.`,
          [{ text: "OK" }]
        );
        return;
      }
    }

    Keyboard.dismiss();
    inputRef.current?.blur();

    setSending(true);
    setText("");

    setItems((prev) => [...prev, { role: "user", text: msg }]);

    try {
      let sid = sessionId;
      if (!sid) {
        sid = await getOrCreateSession();
        setSessionId(sid);
      }

      await sendAndAppend(sid, msg);
    } catch {
      setItems((prev) => [
        ...prev,
        {
          role: "assistant",
          text: "I’m having trouble reaching the server. Please try again in a moment.",
          meta: { showEscalation: true },
        },
      ]);
      setShowEscalate(true);

      // still offer resolved prompt? probably not when error
      setShowResolvedPrompt(false);
    } finally {
      setSending(false);
      scrollToBottom(true);
    }
  }

  function confirmEscalation(mode: "livechat" | "email") {
    const isEmail = mode === "email";

    Alert.alert(
      isEmail ? "Email Vinnies?" : "Chat with Vinnies now?",
      isEmail
        ? "We’ll take you to the email screen. When you submit, we’ll attach your current chat for the team."
        : "We’ll connect you to live support.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Confirm",
          style: "default",
          onPress: () => {
            setShowResolvedPrompt(false);
            if (isEmail) {
              router.push({
                pathname: "/escalate",
                params: year ? { year: String(year) } : undefined,
              });
            } else {
              router.push({ pathname: "/live-chat" });
            }
          },
        },
      ]
    );
  }

  const showEscalationCTAs = showEscalate && escalationEligibleByAiPrompts;
  const showLiveChatCTA = showEscalationCTAs && businessHours === true;
  const showEmailCTA = showEscalationCTAs;

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" />

      <Stack.Screen
        options={{
          headerShown: true,
          title: "",
          headerShadowVisible: false,
          headerStyle: { backgroundColor: BRAND.lightBg },
          headerTintColor: BRAND.lightText,
          gestureEnabled: false,
          headerLeft: () => (
            <Pressable
              onPress={() => {
                setShowResolvedPrompt(false);
                confirmGoHome();
              }}
              hitSlop={12}
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

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "padding"}
        keyboardVerticalOffset={Platform.OS === "ios" ? 120 : 80}
      >
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(_, i) => String(i)}
          contentContainerStyle={[
            styles.listContent,
            {
              // If resolved prompt is showing, the input bar is hidden, so don't reserve space for it.
              paddingBottom:
                styles.listContent.paddingBottom +
                16 +
                safeBottom +
                (showResolvedPrompt ? 96 : INPUT_BAR_EST_HEIGHT + 16),
            },
          ]}
          keyboardShouldPersistTaps="always"
          keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
          onTouchStart={Keyboard.dismiss}
          onScrollBeginDrag={Keyboard.dismiss}
          onContentSizeChange={() => scrollToBottom(false)}
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            const cq = item.meta?.clarifyingQuestion?.trim();
            const body = item.text;

            return (
              <View style={[styles.row, isUser ? styles.rowRight : styles.rowLeft]}>
                {!isUser && (
                  <View style={styles.avatar}>
                    <Text style={styles.avatarText}>{initials("VB")}</Text>
                  </View>
                )}

                <View style={[styles.bubble, isUser ? styles.userBubble : styles.aiBubble]}>
                  {!isUser && !!cq && <Text style={styles.clarifyingQuestion}>{cq}</Text>}
                  <Text style={[styles.bubbleText, isUser ? styles.userText : styles.aiText]}>{body}</Text>
                  {!isUser && renderCheckpointSummary(item.meta?.checkpointSummary)}
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

        {/* ✅ Escalation CTAs */}
        {showEscalationCTAs &&
          (businessHours === true ? (
            // Business hours: show BOTH buttons side-by-side
            <View style={styles.escalateRow}>
              {showLiveChatCTA && (
                <Pressable
                  style={({ pressed }) => [
                    styles.escalate,
                    styles.escalateHalf,
                    pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                  ]}
                  onPress={() => confirmEscalation("livechat")}
                >
                  <Text style={styles.escalateText}>Chat with Vinnies now</Text>
                  <Text style={styles.escalateSub}>Live support</Text>
                </Pressable>
              )}

              {showEmailCTA && (
                <Pressable
                  style={({ pressed }) => [
                    styles.escalate,
                    styles.escalateHalf,
                    pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                  ]}
                  onPress={() => confirmEscalation("email")}
                >
                  <Text style={styles.escalateText}>Email Vinnies</Text>
                  <Text style={styles.escalateSub}>We’ll attach your chat</Text>
                </Pressable>
              )}
            </View>
          ) : showEmailCTA ? (
            // After hours (or unknown): keep Email full-width
            <Pressable
              style={({ pressed }) => [
                styles.escalate,
                pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
              ]}
              onPress={() => confirmEscalation("email")}
            >
              <Text style={styles.escalateText}>Email Vinnies</Text>
              <Text style={styles.escalateSub}>
                {businessHours === false
                  ? `After hours — we’ll attach your chat when you submit.${
                      nextOpen ? ` Next open: ${fmtLocal(nextOpen)}` : ""
                    }`
                  : "We’ll attach your troubleshooting history when you submit."}
              </Text>
            </Pressable>
          ) : null)}

        {/* ✅ Resolved prompt (shows after AI replies) */}
        {aiAllowed && !sending && showResolvedPrompt && (
          <View style={[styles.resolvedWrap, { marginBottom: 10 }]}>
            <Text style={styles.resolvedText}>Is your problem resolved?</Text>
            <View style={styles.resolvedBtns}>
              <Pressable
                onPress={onResolvedNo}
                style={({ pressed }) => [
                  styles.resolvedBtn,
                  styles.resolvedNo,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.resolvedBtnText}>No</Text>
              </Pressable>
              <Pressable
                onPress={onResolvedYes}
                style={({ pressed }) => [
                  styles.resolvedBtn,
                  styles.resolvedYes,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.resolvedBtnText}>Yes</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ✅ If consent denied, hard-lock the chat UI */}
        {!aiAllowed && (
          <View style={[styles.lockOverlay, { paddingBottom: 10 + safeBottom }]}>
            <View style={styles.lockCard}>
              <Text style={styles.lockTitle}>AI Permission Required</Text>
              <Text style={styles.lockBody}>
                Vinnie’s Brain requires AI to operate. To use the app, you must allow sending your chat content to{" "}
                {AI_PROVIDER_NAME}.
              </Text>

              <Pressable
                onPress={() => showAiConsentPrompt()}
                style={({ pressed }) => [
                  styles.lockBtn,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.lockBtnText}>Review Permission</Text>
              </Pressable>

              <Pressable
                onPress={() => {
                  setShowResolvedPrompt(false);
                  confirmGoHome();
                }}
                style={({ pressed }) => [
                  styles.lockBtnAlt,
                  pressed && { opacity: 0.92, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.lockBtnAltText}>Go Home</Text>
              </Pressable>
            </View>
          </View>
        )}

        {/* ✅ Chat input (hide it while the resolved prompt is showing) */}
        {!showResolvedPrompt && (
          <View
            style={[
              styles.inputWrap,
              {
                paddingBottom: 10 + safeBottom,
                marginBottom: Platform.OS === "android" && androidKeyboardOpen ? 14 : 0,
                opacity: sending ? 0.75 : 1,
              },
            ]}
            pointerEvents={sending || !aiAllowed ? "none" : "auto"}
          >
            <View style={styles.inputCard}>
              <TextInput
                ref={inputRef}
                value={text}
                onChangeText={setText}
                placeholder={aiAllowed ? "Type your message…" : "AI permission required…"}
                placeholderTextColor={BRAND.lightMuted}
                style={styles.input}
                multiline
                returnKeyType="send"
                editable={!sending && aiAllowed}
                onSubmitEditing={() => {
                  if (canSend) onSend();
                }}
                blurOnSubmit={false}
                onFocus={() => {
                  // If they focus the input, assume they want to continue chatting
                  setShowResolvedPrompt(false);
                }}
              />

              <Pressable
                onPress={onSend}
                disabled={!canSend || sending || !aiAllowed}
                style={({ pressed }) => [
                  styles.sendBtn,
                  (!canSend || sending || !aiAllowed) && styles.sendBtnDisabled,
                  pressed && canSend && !sending && aiAllowed && { opacity: 0.9, transform: [{ scale: 0.99 }] },
                ]}
              >
                <Text style={styles.sendText}>{sending ? "…" : "Send"}</Text>
              </Pressable>
            </View>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  // ✅ make page light + readable
  safe: { flex: 1, backgroundColor: BRAND.lightBg },

  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    overflow: "hidden",
    backgroundColor: "rgba(4,53,83,0.12)",      // subtle navy tint
    borderWidth: 1,
    borderColor: "rgba(4,53,83,0.35)",         // darker border
  },
  headerBackIcon: {
    fontSize: 18,
    lineHeight: 18,
    color: BRAND.lightText, // ✅ visible
    marginTop: -1,
  },

  headerBackText: {
    color: BRAND.lightText, // ✅ visible
    fontWeight: "600",
    letterSpacing: 0.2,
    fontSize: 14,
  },

  listContent: {
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 18,
  },

  row: { flexDirection: "row", alignItems: "flex-end", marginBottom: 10 },
  rowLeft: { justifyContent: "flex-start" },
  rowRight: { justifyContent: "flex-end" },

  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderWidth: 1,
    borderColor: BRAND.lightBorder,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 8,
  },
  avatarText: { color: BRAND.lightText, fontWeight: "600" }, // ✅ not bold

  bubble: {
    maxWidth: "86%",
    borderRadius: 16,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: BRAND.lightBorder,
  },
  // ✅ lighter bubbles with strong contrast text
  userBubble: { backgroundColor: "rgba(4,53,83,0.10)" },
  aiBubble: { backgroundColor: BRAND.lightSurface },

  bubbleText: { fontSize: 15.5, lineHeight: 21 }, // ✅ slightly bigger, easier
  userText: { color: BRAND.lightText, fontWeight: "400" }, // ✅ not bold
  aiText: { color: BRAND.lightText, fontWeight: "400" }, // ✅ not bold

  clarifyingQuestion: {
    color: BRAND.lightText,
    fontWeight: "600", // ✅ not bold-heavy
    marginBottom: 6,
  },

  typingBubble: { flexDirection: "row", alignItems: "center", gap: 10 },
  typingText: { color: BRAND.lightMuted, fontWeight: "500" }, // ✅ not bold

  checkpointCard: {
    marginTop: 10,
    backgroundColor: "rgba(0,0,0,0.02)",
    borderColor: "rgba(0,0,0,0.08)",
    borderWidth: 1,
    borderRadius: 14,
    padding: 10,
  },
  checkpointTitle: { color: BRAND.lightText, fontWeight: "600", marginBottom: 8 }, // ✅ not bold
  checkpointSection: { marginBottom: 8 },
  checkpointLabel: { color: BRAND.lightMuted, fontWeight: "600", marginBottom: 4 }, // ✅ not bold
  checkpointItem: { color: BRAND.lightText, fontWeight: "400", marginBottom: 2 }, // ✅ not bold

  escalate: {
    marginHorizontal: 14,
    marginBottom: 10,
    backgroundColor: "rgba(4,53,83,0.10)",
    borderColor: "rgba(0,0,0,0.10)",
    borderWidth: 1,
    borderRadius: 18,
    padding: 14,
  },
  escalateText: { color: BRAND.lightText, fontWeight: "600", fontSize: 16 }, // ✅ not bold
  escalateSub: { color: BRAND.lightMuted, marginTop: 6, fontWeight: "400" }, // ✅ not bold

  escalateRow: {
    flexDirection: "row",
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 10,
  },
  escalateHalf: {
    flex: 1,
    marginHorizontal: 0,
    marginBottom: 0,
  },

  // ✅ Resolved prompt styles
  resolvedWrap: {
    marginHorizontal: 14,
    padding: 12,
    borderRadius: 18,
    backgroundColor: BRAND.lightSurface,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  resolvedText: {
    color: BRAND.lightText,
    fontWeight: "600", // ✅ not bold
    fontSize: 15,
    marginBottom: 10,
  },
  resolvedBtns: {
    flexDirection: "row",
    gap: 10,
  },
  resolvedBtn: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 10,
    alignItems: "center",
    borderWidth: 1,
  },
  resolvedNo: {
    backgroundColor: "rgba(0,0,0,0.03)",
    borderColor: "rgba(0,0,0,0.12)",
  },
  resolvedYes: {
    backgroundColor: "rgba(4,53,83,0.12)",
    borderColor: "rgba(4,53,83,0.22)",
  },
  resolvedBtnText: {
    color: BRAND.lightText,
    fontWeight: "600", // ✅ not bold
    fontSize: 15,
  },

  inputWrap: { paddingHorizontal: 14 },
  inputCard: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 10,
    padding: 10,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: BRAND.lightSurface,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    color: BRAND.lightText,
    fontWeight: "400", // ✅ not bold
    paddingHorizontal: 8,
    paddingVertical: 10,
  },
  sendBtn: {
    backgroundColor: BRAND.navy,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  sendBtnDisabled: { opacity: 0.5 },
  sendText: { color: "#FFFFFF", fontWeight: "600" }, // ✅ not bold

  // ✅ Lock overlay styles (kept darker so it reads like a modal)
  lockOverlay: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    top: 0,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 18,
    backgroundColor: "rgba(7,16,24,0.60)",
  },
  lockCard: {
    width: "100%",
    borderRadius: 18,
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    backgroundColor: BRAND.lightSurface,
    padding: 16,
  },
  lockTitle: {
    color: BRAND.lightText,
    fontWeight: "700", // slightly stronger for title
    fontSize: 18,
    marginBottom: 10,
  },
  lockBody: {
    color: BRAND.lightText,
    fontWeight: "400", // ✅ not bold
    lineHeight: 20,
    marginBottom: 14,
  },
  lockBtn: {
    backgroundColor: BRAND.navy,
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
    marginBottom: 10,
  },
  lockBtnText: { color: "#FFFFFF", fontWeight: "600" }, // ✅ not bold
  lockBtnAlt: {
    backgroundColor: "rgba(0,0,0,0.04)",
    borderRadius: 14,
    paddingVertical: 12,
    alignItems: "center",
    borderWidth: 1,
    borderColor: "rgba(0,0,0,0.10)",
  },
  lockBtnAltText: { color: BRAND.lightText, fontWeight: "600" }, // ✅ not bold
});