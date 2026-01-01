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
    // This will show the real FastAPI error message (422 details, etc.)
    throw new Error(`HTTP ${res.status}: ${text || res.statusText}`);
  }

  return text ? (JSON.parse(text) as T) : ({} as T);
}
export async function getOrCreateSession(): Promise<string> {
  const existing = await AsyncStorage.getItem(SESSION_KEY);

  // 1) If we have a stored session id, verify it still exists
  if (existing) {
    try {
      await http<{ ok: boolean }>(`/v1/sessions/${existing}`, undefined, "GET");
      return existing;
    } catch (e: any) {
      // If backend says session not found, clear it and create a new one
      const msg = String(e?.message ?? "");
      if (msg.includes("404") || msg.toLowerCase().includes("session not found")) {
        await AsyncStorage.removeItem(SESSION_KEY);
      } else {
        // For other errors (network, etc), keep existing so app can retry
        return existing;
      }
    }
  }

  // 2) Create a new session
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
