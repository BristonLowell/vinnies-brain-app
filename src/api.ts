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

  const text = await res.text(); // read raw body for debugging

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}

/**
 * Gets an existing session if valid, otherwise creates a new one.
 *
 * Option B support:
 * - forceNew: always create a new session and overwrite stored session id
 * - resetOld: when forceNew is true, also ask backend to reset old session (if supported)
 */
export async function getOrCreateSession(opts?: {
  forceNew?: boolean;
  resetOld?: boolean; // requires backend support (optional)
}): Promise<string> {
  const existing = await AsyncStorage.getItem(SESSION_KEY);

  // ----------------------------
  // OPTION B: Force a fresh session
  // ----------------------------
  if (opts?.forceNew) {
    const data = await http<CreateSessionResponse>("/v1/sessions", {
      channel: "mobile",
      mode: "customer",

      // Only send these if you implemented the backend reset behavior.
      // If your backend doesn't accept these fields yet, leave resetOld=false.
      ...(opts.resetOld && existing
        ? { reset_old_session_id: existing, delete_old_messages: true }
        : {}),
    });

    await AsyncStorage.setItem(SESSION_KEY, data.session_id);
    return data.session_id;
  }

  // ----------------------------
  // Normal behavior: reuse saved session if still valid
  // ----------------------------
  if (existing) {
    try {
      await http<{ ok: boolean }>(`/v1/sessions/${existing}`);
      return existing;
    } catch (e: any) {
      const msg = String(e?.message ?? "");

      // If backend says session not found (404), clear it so we can create a fresh one
      if (msg.includes("HTTP 404") || msg.toLowerCase().includes("session not found")) {
        await AsyncStorage.removeItem(SESSION_KEY);
      } else {
        // For other errors (network, temporary backend error), keep existing so app can retry
        return existing;
      }
    }
  }

  // Create a new session
  const data = await http<CreateSessionResponse>("/v1/sessions", {
    channel: "mobile",
    mode: "customer",
  });

  await AsyncStorage.setItem(SESSION_KEY, data.session_id);
  return data.session_id;
}

export async function setContext(sessionId: string, airstreamYear?: number, category?: string) {
  await http<{ ok: boolean }>(`/v1/sessions/${sessionId}/context`, {
    airstream_year: airstreamYear ?? null,
    category: category ?? null,
  });
}

export async function sendChat(sessionId: string, message: string, airstreamYear?: number) {
  return await http<ChatResponse>("/v1/chat", {
    session_id: sessionId,
    message,
    airstream_year: airstreamYear ?? null,
  });
}

export async function createEscalation(payload: {
  session_id: string;
  airstream_year?: number;
  issue_summary: string;
  location?: string;
  trigger?: string;
  name?: string;
  contact?: string;
  preferred_contact?: string;
}) {
  return await http<EscalationResponse>("/v1/escalations", payload);
}
