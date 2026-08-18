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
  Keyboard,
  RefreshControl,
  BackHandler,
  Image,
  Alert,
  StatusBar,
} from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import * as ImagePicker from "expo-image-picker";
import { getOrCreateSession, liveChatHistory, liveChatSend, liveChatOpened } from "../src/api";

const BRAND = {
  bg: "#F6F7F9",
  surface: "#FFFFFF",
  border: "rgba(0,0,0,0.10)",
  navy: "#043553",
  navySoft: "rgba(4,53,83,0.10)",
  cream: "#F1EEDB",
  text: "#101828",
  muted: "rgba(16,24,40,0.70)",
  faint: "rgba(16,24,40,0.48)",
  headerBg: "#FFFFFF",
  danger: "#B42318",
};

type Msg = {
  id: string;
  sender_role: "customer" | "owner" | "system";
  body: string;
  created_at: string;
  conversation_id?: string;
};

const INPUT_BAR_EST_HEIGHT = 86; // slightly taller now with attach button

function SkeletonBubble({ mine }: { mine?: boolean }) {
  return (
    <View style={[styles.skelBubble, mine ? styles.skelMine : styles.skelTheirs]}>
      <View style={styles.skelLine} />
      <View style={[styles.skelLine, { width: "72%", marginTop: 8 }]} />
    </View>
  );
}

function isDataImage(body: string) {
  return typeof body === "string" && body.startsWith("data:image/");
}

export default function LiveChat() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const safeBottom = Math.max(insets.bottom, 12);

  const goHome = useCallback(() => {
    router.replace("/");
  }, [router]);

  const [sessionId, setSessionId] = useState<string>("");
  const [conversationId, setConversationId] = useState<string>("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string>("");

  // photo attachment (stored as data URI so it works with your existing backend)
  const [photoDataUri, setPhotoDataUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const listRef = useRef<FlatList<Msg>>(null);
  const pollTimerRef = useRef<any>(null);
  const lastSigRef = useRef<string>("");

  // ✅ only call /v1/livechat/opened once per screen mount
  const didOpenedRef = useRef(false);
  const sendInFlightRef = useRef(false);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      goHome();
      return true;
    });
    return () => sub.remove();
  }, [goHome]);

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

        // Load history first
        await refresh(sid);
        if (cancelled) return;

        setReady(true);

        // ✅ Call backend ONCE when live chat is opened
        if (!didOpenedRef.current) {
          didOpenedRef.current = true;
          try {
            const res = await liveChatOpened(sid);
            if ((res as any)?.conversation_id) {
              setConversationId(String((res as any).conversation_id));
            }
            await refresh(sid);
          } catch {
            // don't block UX
          }
        }
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

  const canSend = useMemo(() => {
    const hasText = text.trim().length > 0;
    const hasPhoto = !!photoDataUri;
    return (hasText || hasPhoto) && ready && !!sessionId && !loading && !sending;
  }, [text, photoDataUri, ready, sessionId, loading, sending]);

  async function pickPhoto() {
    try {
      if (Platform.OS !== "web") {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) {
          Alert.alert("Permission needed", "Please allow photo library access to attach an image.");
          return;
        }
      }

      const res = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        allowsEditing: true,
        quality: 0.7,
        base64: true,
      });

      if (res.canceled) return;

      const asset = res.assets?.[0];
      if (!asset?.base64) {
        Alert.alert("Photo error", "Could not read the selected image. Please try a different photo.");
        return;
      }

      const mime =
        (asset as any).mimeType ||
        (asset.uri?.toLowerCase().includes(".png") ? "image/png" : "image/jpeg");

      const dataUri = `data:${mime};base64,${asset.base64}`;
      setPhotoDataUri(dataUri);

      // Scroll so the preview/input is visible
      requestAnimationFrame(scrollToBottom);
    } catch (e: any) {
      Alert.alert("Photo error", String(e?.message ?? "Failed to pick a photo."));
    }
  }

  async function send() {
    // Guard against accidental multi-taps / duplicate triggers
    if (sendInFlightRef.current) return;
    sendInFlightRef.current = true;

    try {
      if (!sessionId) return;

      const bodyText = text.trim();
      const bodyPhoto = photoDataUri;

      if (!bodyText && !bodyPhoto) return;

      setSending(true);
      setError("");

      // clear input immediately
      setText("");
      setPhotoDataUri(null);

      // If they included both, send text then image (keeps display nice)
      if (bodyText) {
        await liveChatSend(sessionId, bodyText);
      }
      if (bodyPhoto) {
        await liveChatSend(sessionId, bodyPhoto);
      }

      await refresh(sessionId);
      requestAnimationFrame(scrollToBottom);
    } catch (e: any) {
      setError(String(e?.message ?? "Failed to send message."));
    } finally {
      sendInFlightRef.current = false;
      setSending(false);
    }
  }

  // ✅ Smaller iOS offset = less “dead space” above keyboard.
  // Since your header is inside this screen and you hide the native header, a tiny offset works best.
  const iosKeyboardOffset = Math.max(insets.top, 6);

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <StatusBar barStyle="dark-content" backgroundColor={BRAND.headerBg} />

      <Stack.Screen
        options={{
          headerShown: false,
          gestureEnabled: false,
        }}
      />

      <KeyboardAvoidingView
        style={styles.safe}
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        keyboardVerticalOffset={Platform.OS === "ios" ? iosKeyboardOffset : 0}
      >
        <View style={styles.header}>
          <Pressable
            onPress={goHome}
            hitSlop={10}
            style={({ pressed }) => [
              styles.headerBack,
              pressed && { opacity: 0.88, transform: [{ scale: 0.99 }] },
            ]}
          >
            <Text style={styles.headerBackIcon}>←</Text>
            <Text style={styles.headerBackText}>Home</Text>
          </Pressable>

          <View style={{ flex: 1 }}>
            <Text style={styles.title}>Live chat with Vinnies</Text>
            <Text style={styles.sub}>You are chatting with Vinnies</Text>
            {!!conversationId && (
              <Text style={styles.meta}>Conversation: {conversationId.slice(0, 8)}…</Text>
            )}
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
            keyExtractor={(m, idx) => String((m as any).id ?? `${(m as any).created_at ?? "t"}-${idx}`)}
            contentContainerStyle={[
              styles.list,
              { paddingBottom: INPUT_BAR_EST_HEIGHT + 16 + safeBottom },
            ]}
            keyboardShouldPersistTaps="handled"
            onContentSizeChange={() => scrollToBottom()}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => sessionId && refresh(sessionId, true)}
                tintColor={BRAND.navy}
              />
            }
            renderItem={({ item }) => {
              const role = String((item as any).sender_role || "").trim().toLowerCase();
              const mine = role === "customer";
              const isSystem = role === "system";
              const showImg = !isSystem && isDataImage(item.body);

              return (
                <View style={[styles.bubble, mine ? styles.mine : isSystem ? styles.system : styles.theirs]}>
                  {showImg ? (
                    <Image source={{ uri: item.body }} style={styles.msgImage} />
                  ) : (
                    <Text style={[styles.msgText, isSystem ? styles.systemText : null]}>{item.body}</Text>
                  )}
                </View>
              );
            }}
            ListEmptyComponent={
              <View style={styles.empty}>
                <Text style={styles.emptyTitle}>Hello, Thank you for reaching out!</Text>
                <Text style={styles.emptySub}>Tell us your name here and we will be with you shortly.</Text>
              </View>
            }
          />
        )}

        <View style={[styles.inputWrap, { paddingBottom: 12 + safeBottom }]}>
          {photoDataUri ? (
            <View style={styles.photoPreviewRow}>
              <Image source={{ uri: photoDataUri }} style={styles.photoPreview} />
              <Pressable
                onPress={() => setPhotoDataUri(null)}
                style={({ pressed }) => [styles.removePhotoBtn, pressed && { opacity: 0.9 }]}
                hitSlop={10}
              >
                <Text style={styles.removePhotoText}>Remove</Text>
              </Pressable>
            </View>
          ) : null}

          <View style={styles.inputRow}>
            <Pressable
              onPress={pickPhoto}
              style={({ pressed }) => [styles.attachBtn, pressed && { opacity: 0.9 }]}
              hitSlop={10}
              disabled={!ready || loading || sending}
            >
              <Text style={styles.attachBtnText}>＋</Text>
            </Pressable>

            <TextInput
              value={text}
              onChangeText={setText}
              placeholder="Type a message…"
              placeholderTextColor={BRAND.muted}
              style={styles.input}
              multiline
              editable={ready && !loading && !sending}
            />

            <Pressable
              style={[styles.btn, !canSend && styles.btnDisabled]}
              disabled={!canSend}
              onPress={send}
            >
              <Text style={styles.btnText}>{sending ? "Sending…" : "Send"}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: BRAND.bg },

  header: {
    paddingHorizontal: 14,
    paddingTop: 8,
    paddingBottom: 10,
    flexDirection: "row",
    gap: 10,
    alignItems: "center",
    backgroundColor: BRAND.headerBg,
    borderBottomWidth: 1,
    borderBottomColor: BRAND.border,
  },
  headerBack: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 4,
    paddingVertical: 8,
    backgroundColor: "transparent",
  },
  headerBackIcon: {
    fontSize: 18,
    lineHeight: 18,
    color: BRAND.navy,
    marginTop: -1,
  },
  headerBackText: {
    color: BRAND.navy,
    fontWeight: "600",
    letterSpacing: 0.2,
    fontSize: 14,
  },
  title: { color: BRAND.text, fontSize: 17, fontWeight: "700" },
  sub: { marginTop: 2, color: BRAND.muted, fontSize: 12.5, fontWeight: "500" },
  meta: { marginTop: 4, color: BRAND.faint, fontSize: 11, fontWeight: "500" },

  hdrBtn: {
    minHeight: 38,
    paddingHorizontal: 11,
    borderRadius: 12,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  hdrBtnText: { color: BRAND.navy, fontWeight: "600", fontSize: 12 },

  errorBox: {
    marginHorizontal: 14,
    marginTop: 10,
    marginBottom: 2,
    padding: 12,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(180,35,24,0.18)",
    backgroundColor: "rgba(180,35,24,0.06)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { color: BRAND.danger, fontWeight: "500", flex: 1, lineHeight: 19 },
  retryBtn: {
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 11,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: "rgba(180,35,24,0.18)",
  },
  retryBtnText: { color: BRAND.danger, fontWeight: "600" },

  list: { paddingHorizontal: 14, paddingVertical: 12, gap: 10, flexGrow: 1 },
  bubble: {
    maxWidth: "84%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: 1,
  },
  mine: {
    alignSelf: "flex-end",
    backgroundColor: BRAND.navySoft,
    borderColor: "rgba(4,53,83,0.18)",
  },
  theirs: {
    alignSelf: "flex-start",
    backgroundColor: BRAND.surface,
    borderColor: BRAND.border,
  },
  system: {
    alignSelf: "center",
    maxWidth: "92%",
    backgroundColor: "rgba(4,53,83,0.06)",
    borderColor: "rgba(4,53,83,0.14)",
  },
  systemText: { color: BRAND.navy, fontWeight: "500", textAlign: "center" },
  msgText: { color: BRAND.text, fontSize: 15.5, lineHeight: 21, fontWeight: "400" },
  msgImage: {
    width: 220,
    height: 220,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.04)",
  },

  inputWrap: {
    paddingHorizontal: 14,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: BRAND.border,
    backgroundColor: BRAND.bg,
  },
  inputRow: { flexDirection: "row", gap: 10, alignItems: "flex-end" },
  attachBtn: {
    height: 44,
    width: 44,
    borderRadius: 14,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
    alignItems: "center",
    justifyContent: "center",
  },
  attachBtnText: { color: BRAND.navy, fontWeight: "500", fontSize: 22, marginTop: -2 },
  input: {
    flex: 1,
    color: BRAND.text,
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
    fontWeight: "400",
  },
  btn: {
    height: 44,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: BRAND.navy,
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.42 },
  btnText: { color: "#FFFFFF", fontWeight: "600" },

  photoPreviewRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  photoPreview: {
    width: 64,
    height: 64,
    borderRadius: 14,
    backgroundColor: "rgba(0,0,0,0.04)",
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  removePhotoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: 12,
    backgroundColor: BRAND.surface,
    borderWidth: 1,
    borderColor: BRAND.border,
  },
  removePhotoText: { color: BRAND.navy, fontWeight: "600" },

  empty: { padding: 28, alignItems: "center", gap: 8 },
  emptyTitle: { color: BRAND.text, fontWeight: "600", fontSize: 16 },
  emptySub: { color: BRAND.muted, textAlign: "center", lineHeight: 19 },

  skelWrap: { paddingHorizontal: 14, paddingTop: 12, gap: 10, flex: 1 },
  skelBubble: { maxWidth: "82%", padding: 12, borderRadius: 16, borderWidth: 1 },
  skelMine: {
    alignSelf: "flex-end",
    backgroundColor: BRAND.navySoft,
    borderColor: "rgba(4,53,83,0.14)",
  },
  skelTheirs: { alignSelf: "flex-start", backgroundColor: BRAND.surface, borderColor: BRAND.border },
  skelLine: {
    height: 10,
    borderRadius: 8,
    backgroundColor: "rgba(16,24,40,0.10)",
    width: "92%",
  },
});
