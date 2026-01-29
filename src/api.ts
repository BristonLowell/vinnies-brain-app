import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "./config";
import type { CreateSessionResponse, ChatResponse, EscalationResponse } from "./types";

const SESSION_KEY = "vinniesbrain_session_id";
const ADMIN_KEY = "vinniesbrain_admin_key";

// NEW: login bridge (temporary until JWT auth)
// Store a UUID user id after login; http() will automatically send it as X-User-Id.
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

async function http<T>(
  path: string,
  opts?: { body?: any; headers?: Record<string, string>; method?: string }
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const method = opts?.method ?? (opts?.body ? "POST" : "GET");

  // Auto-attach auth header unless caller already set it
  const autoAuth = await getAuthHeaders();

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...autoAuth,
      ...(opts?.headers ?? {}),
    },
    body: opts?.body ? JSON.stringify(opts.body) : undefined,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }

  return (await res.json()) as T;
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

/**
 * After login: claim any guest session IDs so they become part of the account.
 * Call this ONCE right after login with the local issue session_ids you have saved.
 */
export async function claimSessions(sessionIds: string[]) {
  const session_ids = (sessionIds || []).map((s) => (s || "").trim()).filter(Boolean);
  return await http<ClaimSessionsResponse>("/v1/sessions/claim", { body: { session_ids } });
}

/**
 * "Previous Issues" from the backend (account-synced).
 * Use this instead of AsyncStorage once login is live.
 */
export async function listPreviousIssues() {
  return await http<SessionListResponse>("/v1/sessions");
}

// ----------------------------
// Sessions
// ----------------------------
// Supports BOTH styles:
// - getOrCreateSession({ forceNew: true })   ✅ what your chat.tsx uses
// - getOrCreateSession({ resetOld: true })   ✅ older style
export async function getOrCreateSession(opts?: {
  forceNew?: boolean;
  resetOld?: boolean;
  deleteOldMessages?: boolean;
}) {
  const existing = await AsyncStorage.getItem(SESSION_KEY);
  const shouldReset = !!(opts?.forceNew || opts?.resetOld);

  // Rotate session (optional)
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

  // Normal: reuse if valid
  if (existing) {
    try {
      await http<{ ok: boolean }>(`/v1/sessions/${existing}`);
      return existing;
    } catch {
      // fall through to create
    }
  }

  const created = await http<CreateSessionResponse>("/v1/sessions", {
    body: { channel: "mobile", mode: "customer" },
  });

  await AsyncStorage.setItem(SESSION_KEY, created.session_id);
  return created.session_id;
}

/**
 * Start a brand-new conversation (new session_id) and make it the active one.
 * ✅ Does NOT delete or reset the previous session/messages on the backend.
 * Use this for a "Start New Conversation" button.
 */
export async function startNewSession() {
  const created = await http<CreateSessionResponse>("/v1/sessions", {
    body: { channel: "mobile", mode: "customer" },
  });

  await AsyncStorage.setItem(SESSION_KEY, created.session_id);
  return created.session_id;
}

/**
 * Returns the currently stored session_id (if any) without creating a new one.
 */
export async function getSavedSessionId() {
  return await AsyncStorage.getItem(SESSION_KEY);
}

/**
 * Clears the locally stored session_id (does not delete anything on the backend).
 */
export async function clearSavedSessionId() {
  await AsyncStorage.removeItem(SESSION_KEY);
}

/**
 * ✅ 422 FIX: Do NOT send nulls. Only include fields when they have real values.
 */
export async function setContext(
  sessionId: string,
  ctx: { airstream_year?: number; category?: string }
) {
  const body: any = {};

  if (typeof ctx.airstream_year === "number" && Number.isFinite(ctx.airstream_year)) {
    body.airstream_year = ctx.airstream_year;
  }
  if (typeof ctx.category === "string" && ctx.category.trim().length > 0) {
    body.category = ctx.category.trim();
  }

  return await http<{ ok: boolean }>(`/v1/sessions/${sessionId}/context`, { body });
}

/**
 * ✅ Back to the signature your chat.tsx expects:
 * sendChat(sessionId, message, airstreamYear?)
 *
 * ✅ Also keeps the "don’t send nulls" behavior.
 */
export async function sendChat(
  sessionId: string,
  message: string,
  airstreamYear?: number
) {
  const body: any = {
    session_id: sessionId,
    message,
  };

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
// Admin key helpers
// ----------------------------
export async function getSavedAdminKey() {
  return (await AsyncStorage.getItem(ADMIN_KEY)) || "";
}

export async function saveAdminKey(key: string) {
  await AsyncStorage.setItem(ADMIN_KEY, key);
}

export async function clearAdminKey() {
  await AsyncStorage.removeItem(ADMIN_KEY);
}

// ----------------------------
// Live chat (admin)
// ----------------------------
export type AdminConversationItem = {
  conversation_id: string;
  customer_id: string; // currently equals session_id in your schema
  last_message?: {
    sender_role: "customer" | "owner" | "system";
    body: string;
    created_at: string;
  };
};

export type AdminConversationsResponse = {
  conversations: AdminConversationItem[];
};

export async function adminLiveChatConversations(adminKey: string) {
  return await http<AdminConversationsResponse>("/v1/admin/livechat/conversations", {
    headers: { "X-Admin-Key": adminKey },
  });
}

export async function adminLiveChatHistory(adminKey: string, conversationId: string) {
  return await http<LiveChatHistoryResponse>(`/v1/admin/livechat/history/${conversationId}`, {
    headers: { "X-Admin-Key": adminKey },
  });
}

export async function adminLiveChatSend(adminKey: string, conversationId: string, body: string) {
  return await http<{ ok: boolean; conversation_id: string }>("/v1/admin/livechat/send", {
    headers: { "X-Admin-Key": adminKey },
    body: { conversation_id: conversationId, body },
  });
}

// ----------------------------
// Admin: Quality control (all AI sessions) + deletes
// ----------------------------
export type AdminSessionItem = {
  session_id: string;
  user_id?: string | null;
  channel?: string | null;
  mode?: string | null;
  airstream_year?: number | null;
  category?: string | null;
  created_at?: string | null;
  last_message_at?: string | null;
  preview?: string | null;
};

export type AdminSessionsResponse = {
  sessions: AdminSessionItem[];
};

export async function adminListAllSessions(adminKey: string) {
  return await http<AdminSessionsResponse>("/v1/admin/sessions", {
    headers: { "X-Admin-Key": adminKey },
  });
}

export async function adminDeleteSession(adminKey: string, sessionId: string) {
  return await http<{ ok: boolean }>(`/v1/admin/sessions/${sessionId}`, {
    headers: { "X-Admin-Key": adminKey },
    method: "DELETE",
  });
}

export async function adminDeleteLiveChatConversation(adminKey: string, conversationId: string) {
  return await http<{ ok: boolean }>(`/v1/admin/livechat/conversations/${conversationId}`, {
    headers: { "X-Admin-Key": adminKey },
    method: "DELETE",
  });
}

