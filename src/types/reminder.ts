export type ReminderType = "call" | "whatsapp" | "email" | "visit" | "other";
export type ReminderStatus = "pending" | "done" | "dismissed";

export interface Reminder {
  id: string;
  organisation_id: string;
  lead_id: string | null;
  created_by: string | null;
  title: string;
  notes: string | null;
  remind_at: string;
  type: ReminderType;
  status: ReminderStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}
