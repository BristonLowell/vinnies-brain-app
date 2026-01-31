import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "./config";
import type { CreateSessionResponse, ChatResponse, EscalationResponse } from "./types";

const SESSION_KEY = "vinniesbrain_session_id";
const ADMIN_KEY = "vinniesbrain_admin_key";
// ✅ legacy key some admin pages used in older versions
const ADMIN_KEY_LEGACY = "vinnies_admin_key";

// NEW: login bridge (temporary until JWT auth)
const USER_ID_KEY = "vinniesbrain_user_id";

export type SessionListItem = {
  session_id: string;
  last_message_at?: string | null;
  preview?: string | null;
};

export type SessionListResponse = {
  sessions: SessionListItem[];
};

export type ClaimSessionsResponse = {
  ok: boolean;
  claimed: number;
};

async function getAuthHeaders(): Promise<Record<string, string>> {
  try {
    const uid = await AsyncStorage.getItem(USER_ID_KEY);
    if (uid && uid.trim().length > 0) {
      return { "X-User-Id": uid.trim() };
    }
  } catch {}
  return {};
}

// ✅ iOS reliability: timeout + retry
async function http<T>(
  path: string,
  opts?: { body?: any; headers?: Record<string, string>; method?: string }
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const method = opts?.method ?? (opts?.body ? "POST" : "GET");
  const autoAuth = await getAuthHeaders();

  const attempts = 3;
  let lastErr: any;

  for (let i = 0; i < attempts; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          ...autoAuth,
          ...(opts?.headers ?? {}),
        },
        body: opts?.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`HTTP ${res.status}: ${txt}`);
      }

      return (await res.json()) as T;
    } catch (e) {
      clearTimeout(timeout);
      lastErr = e;
      const delay = [300, 800, 1500][i] ?? 1500;
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

// ----------------------------
// Login / Subscription bridge helpers
// ----------------------------
export async function setCurrentUserId(userId: string) {
  const uid = (userId || "").trim();
  if (!uid) throw new Error("userId is empty");
  await AsyncStorage.setItem(USER_ID_KEY, uid);
}

export async function getCurrentUserId() {
  return (await AsyncStorage.getItem(USER_ID_KEY)) || "";
}

export async function clearCurrentUserId() {
  await AsyncStorage.removeItem(USER_ID_KEY);
}

export async function claimSessions(sessionIds: string[]) {
  const session_ids = (sessionIds || []).map((s) => (s || "").trim()).filter(Boolean);
  return await http<ClaimSessionsResponse>("/v1/sessions/claim", { body: { session_ids } });
}

export async function listPreviousIssues() {
  return await http<SessionListResponse>("/v1/sessions");
}

// ----------------------------
// Sessions
// ----------------------------
export async function getOrCreateSession(opts?: {
  forceNew?: boolean;
  resetOld?: boolean;
  deleteOldMessages?: boolean;
}) {
  const existing = await AsyncStorage.getItem(SESSION_KEY);
  const shouldReset = !!(opts?.forceNew || opts?.resetOld);

  if (shouldReset) {
    const data = await http<CreateSessionResponse>("/v1/sessions", {
      body: {
        channel: "mobile",
        mode: "customer",
        ...(existing ? { reset_old_session_id: existing } : {}),
        delete_old_messages: opts?.deleteOldMessages ?? true,
      },
    });
    await AsyncStorage.setItem(SESSION_KEY, data.session_id);
    return data.session_id;
  }

  if (existing) {
    try {
      await http<{ ok: boolean }>(`/v1/sessions/${existing}`);
      return existing;
    } catch {}
  }

  const created = await http<CreateSessionResponse>("/v1/sessions", {
    body: { channel: "mobile", mode: "customer" },
  });

  await AsyncStorage.setItem(SESSION_KEY, created.session_id);
  return created.session_id;
}

export async function startNewSession() {
  const created = await http<CreateSessionResponse>("/v1/sessions", {
    body: { channel: "mobile", mode: "customer" },
  });

  await AsyncStorage.setItem(SESSION_KEY, created.session_id);
  return created.session_id;
}

export async function getSavedSessionId() {
  return await AsyncStorage.getItem(SESSION_KEY);
}

export async function clearSavedSessionId() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

export async function setContext(sessionId: string, ctx: { airstream_year?: number; category?: string }) {
  const body: any = {};
  if (typeof ctx.airstream_year === "number" && Number.isFinite(ctx.airstream_year)) {
    body.airstream_year = ctx.airstream_year;
  }
  if (typeof ctx.category === "string" && ctx.category.trim().length > 0) {
    body.category = ctx.category.trim();
  }
  return await http<{ ok: boolean }>(`/v1/sessions/${sessionId}/context`, { body });
}

export async function sendChat(sessionId: string, message: string, airstreamYear?: number) {
  const body: any = { session_id: sessionId, message };
  if (typeof airstreamYear === "number" && Number.isFinite(airstreamYear)) {
    body.airstream_year = airstreamYear;
  }
  return await http<ChatResponse>("/v1/chat", { body });
}

export async function createEscalation(payload: {
  session_id: string;
  name: string;
  phone: string;
  email: string;
  message: string;
  preferred_contact?: string;
  reset_old?: boolean;
}) {
  return await http<EscalationResponse>("/v1/escalations", { body: payload });
}

// ----------------------------
// Live chat (customer)
// ----------------------------
export type LiveChatSendResponse = {
  ok: boolean;
  conversation_id: string;
};

export type LiveChatHistoryResponse = {
  conversation_id: string;
  messages: {
    id: string;
    conversation_id: string;
    sender_id: string;
    sender_role: "customer" | "owner" | "system";
    body: string;
    created_at: string;
  }[];
};

export async function liveChatSend(sessionId: string, body: string) {
  return await http<LiveChatSendResponse>("/v1/livechat/send", {
    body: { session_id: sessionId, body },
  });
}

export async function liveChatHistory(sessionId: string) {
  return await http<LiveChatHistoryResponse>(`/v1/livechat/history/${sessionId}`);
}

export async function registerOwnerPushToken(ownerId: string, expoPushToken: string) {
  return await http<{ ok: boolean }>("/v1/owner/push-token", {
    body: { owner_id: ownerId, expo_push_token: expoPushToken },
  });
}

// ----------------------------
// Admin: inbox + QC helpers
// ----------------------------

export async function getSavedAdminKey() {
  return (
    (await AsyncStorage.getItem(ADMIN_KEY)) ||
    (await AsyncStorage.getItem(ADMIN_KEY_LEGACY)) ||
    ""
  );
}

export async function saveAdminKey(key: string) {
  await AsyncStorage.setItem(ADMIN_KEY, key);
  await AsyncStorage.setItem(ADMIN_KEY_LEGACY, key);
}

export async function clearAdminKey() {
  await AsyncStorage.removeItem(ADMIN_KEY);
  await AsyncStorage.removeItem(ADMIN_KEY_LEGACY);
}

// Back-compat aliases (older screens might import these names)
export const getAdminKey = getSavedAdminKey;
export const setAdminKey = saveAdminKey;

export type AdminConversationItem = {
  conversation_id: string;
  customer_id: string;
  last_message?: {
    id: string;
    sender_role: "customer" | "owner" | "system";
    body: string;
    created_at: string;
  } | null;
};

export async function adminLiveChatConversations(adminKey: string) {
  return await http<{ conversations: AdminConversationItem[] }>(
    "/v1/admin/livechat/conversations",
    { headers: { "X-Admin-Key": adminKey } }
  );
}


export async function adminDeleteLiveChatConversation(adminKey: string, conversationId: string) {
  return await http<{ ok: boolean }>(`/v1/admin/livechat/conversations/${conversationId}`, {
    method: "DELETE",
    headers: { "X-Admin-Key": adminKey },
  });
}

export type AdminSessionItem = {
  session_id: string;
  created_at?: string;
  updated_at?: string;
  airstream_year?: number | null;
  category?: string | null;
  last_user_message?: string | null;
  last_assistant_message?: string | null;
  last_message_at?: string | null;
  preview?: string | null;
};

export async function adminListAllSessions(adminKey: string) {
  return await http<{ sessions: AdminSessionItem[] }>("/v1/admin/sessions", {
    headers: { "X-Admin-Key": adminKey },
  });
}

export async function adminDeleteSession(adminKey: string, sessionId: string) {
  return await http<{ ok: boolean }>(`/v1/admin/sessions/${sessionId}`, {
    method: "DELETE",
    headers: { "X-Admin-Key": adminKey },
  });
}

export type SupportStatusResponse = {
  business_hours: boolean;
  timezone: string;
  open_hour: number;
  close_hour: number;
  next_open?: string | null;
  support_email: string;
};

export async function getSupportStatus() {
  return await http<SupportStatusResponse>("/v1/support/status");
}

export type SessionHistoryResponse = {
  session_id: string;
  messages: { role: string; text: string; created_at?: string | null }[];
};

export async function getSessionHistory(sessionId: string) {
  return await http<SessionHistoryResponse>(`/v1/sessions/${sessionId}/history`);
}

export type AdminEscalationItem = {
  id: string;
  session_id: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  message?: string | null;
  message_preview?: string | null;
  preferred_contact?: string | null;
  status?: "open" | "in_progress" | "closed" | string;
  routing?: "chat" | "email" | "both" | string;
  business_hours?: boolean;
  conversation_id?: string | null;
  created_at?: string;
  handled_at?: string | null;
};

export async function adminListEscalations(adminKey: string, opts?: { status?: string }) {
  const q = (opts?.status || "").trim();
  const path = q ? `/v1/admin/escalations?status=${encodeURIComponent(q)}` : "/v1/admin/escalations";
  return await http<{ escalations: AdminEscalationItem[] }>(path, {
    headers: { "X-Admin-Key": adminKey },
  });
}

export async function adminUpdateEscalationStatus(
  adminKey: string,
  escalationId: string,
  status: "open" | "in_progress" | "closed" | string
) {
  return await http<{ ok: boolean }>(`/v1/admin/escalations/${escalationId}`, {
    body: { status },
    headers: { "X-Admin-Key": adminKey },
  });
}

