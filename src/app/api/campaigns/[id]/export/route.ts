import { NextResponse, type NextRequest } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { type CsvColumn, toCsv, withBom } from "@/lib/csv";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-call export: one row per dial (every attempt), matching the campaign
// detail page's Calls tab. Recording URLs are deliberately omitted — Bolna
// serves them via signed links that need no Skelo login and live for hours,
// so a CSV with the link inside leaks the audio wherever the file is
// forwarded. Operators play recordings from the UI, where org membership is
// enforced. Matches /api/leads/export and /api/calls/export.
interface ExportRow {
  phone: string | null;
  name: string | null;
  attempt: number | null;
  status: string;
  direction: string;
  started_at: string | null;
  answered_at: string | null;
  ended_at: string | null;
  duration_seconds: number | null;
  error_message: string | null;
}

const COLUMNS: CsvColumn<ExportRow>[] = [
  { header: "Phone", value: (r) => r.phone },
  { header: "Name", value: (r) => r.name },
  { header: "Attempt", value: (r) => r.attempt },
  { header: "Outcome", value: (r) => r.status },
  { header: "Direction", value: (r) => r.direction },
  { header: "Started At", value: (r) => r.started_at },
  { header: "Answered At", value: (r) => r.answered_at },
  { header: "Ended At", value: (r) => r.ended_at },
  { header: "Duration (s)", value: (r) => r.duration_seconds },
  { header: "Error", value: (r) => r.error_message },
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
    // Admin client bypasses RLS; a soft-deleted campaign must 404 here too.
    .is("deleted_at", null)
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

  // Resolve the campaign's contacts, then every call placed for them.
  const { data: contacts, error: contactsErr } = await admin
    .from("campaign_contacts")
    .select("id")
    .eq("campaign_id", campaign.id)
    .returns<{ id: string }[]>();
  if (contactsErr) {
    return NextResponse.json({ error: contactsErr.message }, { status: 500 });
  }
  const contactIds = (contacts ?? []).map((c) => c.id);

  let rows: ExportRow[] = [];
  if (contactIds.length > 0) {
    const { data, error } = await admin
      .from("calls")
      .select(
        "to_phone, status, direction, started_at, answered_at, ended_at, duration_seconds, error_message, contact:campaign_contacts!campaign_contact_id(name, attempt)",
      )
      .in("campaign_contact_id", contactIds)
      .order("started_at", { ascending: false })
      .returns<
        Array<{
          to_phone: string | null;
          status: string;
          direction: string;
          started_at: string | null;
          answered_at: string | null;
          ended_at: string | null;
          duration_seconds: number | null;
          error_message: string | null;
          contact: { name: string | null; attempt: number } | null;
        }>
      >();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    rows = (data ?? []).map((r) => ({
      phone: r.to_phone,
      name: r.contact?.name ?? null,
      attempt: r.contact?.attempt ?? null,
      status: r.status,
      direction: r.direction,
      started_at: r.started_at,
      answered_at: r.answered_at,
      ended_at: r.ended_at,
      duration_seconds: r.duration_seconds,
      error_message: r.error_message,
    }));
  }

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
