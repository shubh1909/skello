import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ExportRow {
  phone: string;
  name: string | null;
  status: string;
  attempt: number;
  next_attempt_at: string | null;
  last_status: string | null;
  last_error: string | null;
  last_call_started_at: string | null;
  last_call_ended_at: string | null;
  last_call_duration_seconds: number | null;
  last_call_recording_url: string | null;
}

const COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "Phone", value: (r) => r.phone },
  { header: "Name", value: (r) => r.name },
  { header: "Status", value: (r) => r.status },
  { header: "Attempts", value: (r) => r.attempt },
  { header: "Next Attempt At", value: (r) => r.next_attempt_at },
  { header: "Last Call Status", value: (r) => r.last_status },
  { header: "Last Error", value: (r) => r.last_error },
  { header: "Started At", value: (r) => r.last_call_started_at },
  { header: "Ended At", value: (r) => r.last_call_ended_at },
  { header: "Duration (s)", value: (r) => r.last_call_duration_seconds },
  { header: "Recording", value: (r) => r.last_call_recording_url },
];

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await requireSession();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Invalid campaign id" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: campaign } = await admin
    .from("campaigns")
    .select("id, organisation_id, name, file_name")
    .eq("id", id)
    .maybeSingle<{
      id: string;
      organisation_id: string;
      name: string;
      file_name: string | null;
    }>();
  if (!campaign) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (campaign.organisation_id !== session.organisation.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { data, error } = await admin
    .from("campaign_contacts")
    .select(
      "phone, name, status, attempt, next_attempt_at, last_status, last_error, call:calls!last_call_id(started_at, ended_at, duration_seconds, recording_url)",
    )
    .eq("campaign_id", campaign.id)
    .order("phone", { ascending: true })
    .returns<
      Array<{
        phone: string;
        name: string | null;
        status: string;
        attempt: number;
        next_attempt_at: string | null;
        last_status: string | null;
        last_error: string | null;
        call: {
          started_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          recording_url: string | null;
        } | null;
      }>
    >();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows: ExportRow[] = (data ?? []).map((r) => ({
    phone: r.phone,
    name: r.name,
    status: r.status,
    attempt: r.attempt,
    next_attempt_at: r.next_attempt_at,
    last_status: r.last_status,
    last_error: r.last_error,
    last_call_started_at: r.call?.started_at ?? null,
    last_call_ended_at: r.call?.ended_at ?? null,
    last_call_duration_seconds: r.call?.duration_seconds ?? null,
    last_call_recording_url: r.call?.recording_url ?? null,
  }));

  const body = withBom(toCsv(rows, COLUMNS));

  const stamp = new Date().toISOString().slice(0, 10);
  const safeName = (campaign.file_name ?? campaign.name)
    .replace(/[^\w.-]+/g, "_")
    .slice(0, 80);
  const filename = `skelo-campaign-${safeName}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
