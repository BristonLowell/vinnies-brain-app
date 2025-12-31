export type Mode = "customer" | "staff";

export type CreateSessionResponse = {
  session_id: string;
};

export type ChatResponse = {
  answer: string;
  clarifying_questions: string[];
  safety_flags: string[];
  confidence: number;
  used_articles: { id: string; title: string }[];
  show_escalation: boolean;
  message_id: string;
};

export type EscalationResponse = {
  ticket_id: string;
};
