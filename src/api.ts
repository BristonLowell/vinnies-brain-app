import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "./config";
import type { CreateSessionResponse, ChatResponse, EscalationResponse } from "./types";

const SESSION_KEY = "vinniesbrain_session_id";
const ADMIN_KEY = "vinniesbrain_admin_key";

async function http<T>(
  path: string,
  opts?: { body?: any; headers?: Record<string, string>; method?: string }
): Promise<T> {
  const url = `${API_BASE_URL}${path}`;
  const method = opts?.method ?? (opts?.body ? "POST" : "GET");

  const res = await fetch(url, {
    method,
    headers: {
      "Content-Type": "application/json",
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
// Sessions
// ----------------------------
export async function getOrCreateSession(opts?: { resetOld?: boolean; deleteOldMessages?: boolean }) {
  const existing = await AsyncStorage.getItem(SESSION_KEY);

  // Optional: rotate session
  if (opts?.resetOld) {
    const data = await http<CreateSessionResponse>("/v1/sessions", {
      body: {
        channel: "mobile",
        mode: "customer",
        ...(existing ? { reset_old_session_id: existing } : {}),
        delete_old_messages: opts.deleteOldMessages ?? true,
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
 * ✅ 422 FIX: Do NOT send nulls. Only include fields when they have real values.
 */
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

/**
 * ✅ 422 FIX: Do NOT send nulls. Only include airstream_year if you have it.
 */
export async function sendChat(params: { sessionId: string; message: string; airstreamYear?: number }) {
  const body: any = {
    session_id: params.sessionId,
    message: params.message,
  };

  if (typeof params.airstreamYear === "number" && Number.isFinite(params.airstreamYear)) {
    body.airstream_year = params.airstreamYear;
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
