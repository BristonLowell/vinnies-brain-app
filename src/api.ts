import AsyncStorage from "@react-native-async-storage/async-storage";
import { API_BASE_URL } from "./config";
import type { CreateSessionResponse, ChatResponse, EscalationResponse } from "./types";

const SESSION_KEY = "vinniesbrain_session_id";

async function http<T>(path: string, body?: any): Promise<T> {
  const url = `${API_BASE_URL}${path}`;

  const res = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`HTTP ${res.status}: ${txt}`);
  }

  return (await res.json()) as T;
}

export async function getOrCreateSession(opts?: { forceNew?: boolean }) {
  if (!opts?.forceNew) {
    const existing = await AsyncStorage.getItem(SESSION_KEY);
    if (existing) {
      try {
        await http<{ ok: boolean }>(`/v1/sessions/${existing}`);
        return existing;
      } catch {
        // fall through and create
      }
    }
  }

  const created = await http<CreateSessionResponse>("/v1/sessions", {
    channel: "mobile",
    mode: "customer",
  });

  await AsyncStorage.setItem(SESSION_KEY, created.session_id);
  return created.session_id;
}

/**
 * ✅ FIX: Do NOT send nulls. Only include fields when they have real values.
 */
export async function setContext(sessionId: string, airstreamYear?: number, category?: string) {
  const body: any = {};
  if (typeof airstreamYear === "number" && Number.isFinite(airstreamYear)) body.airstream_year = airstreamYear;
  if (typeof category === "string" && category.trim().length > 0) body.category = category.trim();

  await http<{ ok: boolean }>(`/v1/sessions/${sessionId}/context`, body);
}

/**
 * ✅ FIX: Do NOT send nulls. Only include airstream_year if you have it.
 */
export async function sendChat(sessionId: string, message: string, airstreamYear?: number) {
  const body: any = {
    session_id: sessionId,
    message,
  };

  if (typeof airstreamYear === "number" && Number.isFinite(airstreamYear)) {
    body.airstream_year = airstreamYear;
  }

  return await http<ChatResponse>("/v1/chat", body);
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
  return await http<EscalationResponse>("/v1/escalations", payload);
}

// Live chat endpoints (customer side) — leaving as-is
export async function liveChatSend(sessionId: string, body: string) {
  return await http<{ ok: boolean; conversation_id: string }>("/v1/livechat/send", {
    session_id: sessionId,
    body,
  });
}

export async function liveChatHistory(sessionId: string) {
  return await http<{
    conversation_id: string;
    messages: {
      id: string;
      conversation_id: string;
      sender_id: string;
      sender_role: "customer" | "owner" | "system";
      body: string;
      created_at: string;
    }[];
  }>(`/v1/livechat/history/${sessionId}`);
}
