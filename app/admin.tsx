import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import {
  View,
  Text,
  TextInput,
  Pressable,
  StyleSheet,
  FlatList,
  ActivityIndicator,
  RefreshControl,
  Alert,
  Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import * as Device from "expo-device";

import {
  adminLiveChatConversations,
  clearAdminKey,
  getSavedAdminKey,
  saveAdminKey,
  type AdminConversationItem,
} from "../src/api";
import { API_BASE_URL } from "../src/config";

// ✅ OPTION A: put your Supabase user UUID here (same value as Render env OWNER_SUPABASE_USER_ID)
const OWNER_ID = "PASTE_YOUR_SUPABASE_USER_UUID_HERE";

function fmt(ts?: string) {
  if (!ts) return "";
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return ts;
  return d.toLocaleString();
}

// Recommended by Expo so notifications show while app open (optional)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: false,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

async function registerForPushAndSendToBackend(ownerId: string) {
  if (!ownerId || ownerId.includes("PASTE_YOUR")) {
    // Don’t crash; just skip until you paste it in
    return;
  }

  if (!Device.isDevice) {
    // Push tokens don’t work on simulators
    return;
  }

  // Ask permission
  const existing = await Notifications.getPermissionsAsync();
  let status = existing.status;

  if (status !== "granted") {
    const req = await Notifications.requestPermissionsAsync();
    status = req.status;
  }

  if (status !== "granted") return;

  // Needed on Android
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  // Get Expo push token
  const projectId =
    // modern
    (Constants.expoConfig as any)?.extra?.eas?.projectId ||
    // fallback
    (Constants as any)?.easConfig?.projectId;

  const tokenResp = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  const expoPushToken = tokenResp.data;

  // Send to backend
  await fetch(`${API_BASE_URL}/v1/owner/push-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ owner_id: ownerId, expo_push_token: expoPushToken }),
  });
}

export default function AdminInbox() {
  const router = useRouter();

  const [adminKey, setAdminKeyState] = useState("");
  const [keyDraft, setKeyDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [items, setItems] = useState<AdminConversationItem[]>([]);

  const mounted = useRef(true);
  const pushRegisteredRef = useRef(false);

  const hasKey = useMemo(() => adminKey.trim().length > 0, [adminKey]);

  const load = useCallback(
    async (isRefresh?: boolean) => {
      if (!hasKey) return;
      try {
        setError("");
        if (isRefresh) setRefreshing(true);
        else setLoading(true);

        const res = await adminLiveChatConversations(adminKey.trim());
        if (!mounted.current) return;
        setItems(res.conversations || []);
      } catch (e: any) {
        if (!mounted.current) return;
        setError(String(e?.message ?? "Failed to load inbox."));
      } finally {
        if (!mounted.current) return;
        setLoading(false);
        setRefreshing(false);
      }
    },
    [adminKey, hasKey]
  );

  useEffect(() => {
    mounted.current = true;
    (async () => {
      const saved = await getSavedAdminKey();
      if (!mounted.current) return;
      setAdminKeyState(saved);
      setKeyDraft(saved);
      setLoading(false);
    })();
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!hasKey) return;
    load(false);
  }, [hasKey, load]);

  // ✅ Register push token after admin key exists (once per app launch; backend upserts)
  useEffect(() => {
    if (!hasKey) return;
    if (pushRegisteredRef.current) return;

    pushRegisteredRef.current = true;

    (async () => {
      try {
        await registerForPushAndSendToBackend(OWNER_ID);
      } catch (e) {
        // don't block inbox if push fails
      }
    })();
  }, [hasKey]);

  async function applyKey() {
    const k = keyDraft.trim();
    if (!k) return;
    await saveAdminKey(k);
    setAdminKeyState(k);
  }

  async function logout() {
    await clearAdminKey();
    setAdminKeyState("");
    setKeyDraft("");
    setItems([]);
    setError("");
    pushRegisteredRef.current = false;
  }

  const renderItem = ({ item }: { item: AdminConversationItem }) => {
    const last = item.last_message;
    return (
      <Pressable
        onPress={() =>
          router.push({
            pathname: "/admin-chat",
            params: {
              conversation_id: item.conversation_id,
              customer_id: item.customer_id,
            },
          })
        }
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
      >
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={styles.rowTitle}>Session: {item.customer_id?.slice(0, 8)}…</Text>
          {!!last?.body && (
            <Text style={styles.rowSub} numberOfLines={2}>
              {last.sender_role === "owner" ? "You: " : "Customer: "}
              {last.body}
            </Text>
          )}
          {!!last?.created_at && <Text style={styles.rowMeta}>{fmt(last.created_at)}</Text>}
        </View>
        <Text style={styles.chev}>›</Text>
      </Pressable>
    );
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <Text style={styles.title}>Live Chat Inbox</Text>
        <Text style={styles.sub}>Reply to customers as the owner.</Text>
      </View>

      {!hasKey ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>Admin key required</Text>
          <Text style={styles.help}>Paste the same ADMIN_API_KEY you use for saving KB articles.</Text>
          <TextInput
            value={keyDraft}
            onChangeText={setKeyDraft}
            placeholder="Paste ADMIN_API_KEY"
            placeholderTextColor="rgba(255,255,255,0.35)"
            autoCapitalize="none"
            style={styles.input}
          />
          <Pressable
            onPress={applyKey}
            disabled={!keyDraft.trim()}
            style={({ pressed }) => [
              styles.btn,
              !keyDraft.trim() && styles.btnDisabled,
              pressed && keyDraft.trim() && { opacity: 0.92 },
            ]}
          >
            <Text style={styles.btnText}>Unlock Inbox</Text>
          </Pressable>

          {!!error && <Text style={styles.error}>{error}</Text>}
        </View>
      ) : (
        <>
          <View style={styles.toolbar}>
            <Pressable onPress={() => load(true)} style={({ pressed }) => [styles.toolbarBtn, pressed && { opacity: 0.92 }]}>
              <Text style={styles.toolbarText}>Refresh</Text>
            </Pressable>
            <Pressable onPress={logout} style={({ pressed }) => [styles.toolbarBtn, pressed && { opacity: 0.92 }]}>
              <Text style={styles.toolbarText}>Change Key</Text>
            </Pressable>
          </View>

          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {loading ? (
            <View style={styles.loading}>
              <ActivityIndicator />
              <Text style={styles.loadingText}>Loading conversations…</Text>
            </View>
          ) : (
            <FlatList
              data={items}
              keyExtractor={(x) => x.conversation_id}
              contentContainerStyle={styles.list}
              renderItem={renderItem}
              refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load(true)} />}
              ListEmptyComponent={
                <View style={styles.empty}>
                  <Text style={styles.emptyTitle}>No conversations yet</Text>
                  <Text style={styles.emptySub}>When customers message you, they’ll show up here.</Text>
                </View>
              }
            />
          )}
        </>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0B0F14" },

  header: { paddingHorizontal: 16, paddingTop: 10, paddingBottom: 6 },
  title: { color: "white", fontSize: 20, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.65)", marginTop: 4 },

  card: {
    margin: 16,
    padding: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    gap: 10,
  },
  cardTitle: { color: "white", fontSize: 15, fontWeight: "900" },
  help: { color: "rgba(255,255,255,0.55)", fontSize: 12, lineHeight: 16 },

  input: {
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 12,
    backgroundColor: "rgba(255,255,255,0.07)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    color: "white",
  },

  btn: {
    height: 48,
    borderRadius: 16,
    backgroundColor: "white",
    alignItems: "center",
    justifyContent: "center",
  },
  btnDisabled: { opacity: 0.45 },
  btnText: { color: "#0B0F14", fontWeight: "900" },

  error: { color: "rgba(239,68,68,0.95)", fontWeight: "800" },

  toolbar: { flexDirection: "row", gap: 10, paddingHorizontal: 16, paddingBottom: 10 },
  toolbarBtn: {
    height: 44,
    paddingHorizontal: 14,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.08)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignItems: "center",
    justifyContent: "center",
  },
  toolbarText: { color: "white", fontWeight: "900" },

  errorBox: {
    marginHorizontal: 16,
    marginBottom: 10,
    padding: 10,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(239,68,68,0.35)",
    backgroundColor: "rgba(239,68,68,0.12)",
  },
  errorText: { color: "white", fontWeight: "900" },

  loading: { flex: 1, alignItems: "center", justifyContent: "center", gap: 10 },
  loadingText: { color: "rgba(255,255,255,0.75)", fontWeight: "800" },

  list: { paddingHorizontal: 16, paddingBottom: 20 },

  row: {
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 10,
  },
  rowTitle: { color: "white", fontWeight: "900" },
  rowSub: { color: "rgba(255,255,255,0.70)", lineHeight: 18 },
  rowMeta: { color: "rgba(255,255,255,0.45)", fontSize: 12, fontWeight: "700" },
  chev: { color: "rgba(255,255,255,0.55)", fontSize: 26, fontWeight: "900" },

  empty: { padding: 24, alignItems: "center", gap: 8 },
  emptyTitle: { color: "white", fontWeight: "900", fontSize: 16 },
  emptySub: { color: "rgba(255,255,255,0.65)", textAlign: "center" },
});
