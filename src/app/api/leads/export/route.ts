import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { requireSession } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import type { Lead } from "@/types/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rangeSchema = z.enum([
  "today",
  "yesterday",
  "last_week",
  "last_month",
  "all",
]);

type Range = z.infer<typeof rangeSchema>;

const LEAD_COLUMNS =
  "id, created_at, updated_at, external_id, name, product, lead_intent, visit_date_time, customer_status, phone, wants_to_connect_on_watsapp, contacted_on_watsapp, source, status, notes, city, pincode";

// Rolling-window date boundaries. Returning `null` means "no date filter".
function rangeBounds(
  range: Range,
  now: number,
): { from: string | null; to: string | null } {
  const day = 24 * 60 * 60 * 1000;
  switch (range) {
    case "today":
      return { from: new Date(now - day).toISOString(), to: null };
    case "yesterday":
      return {
        from: new Date(now - 2 * day).toISOString(),
        to: new Date(now - day).toISOString(),
      };
    case "last_week":
      return { from: new Date(now - 7 * day).toISOString(), to: null };
    case "last_month":
      return { from: new Date(now - 30 * day).toISOString(), to: null };
    case "all":
      return { from: null, to: null };
  }
}

const CSV_COLUMNS: { key: keyof Lead; header: string }[] = [
  { key: "id", header: "ID" },
  { key: "created_at", header: "Created At" },
  { key: "name", header: "Name" },
  { key: "phone", header: "Phone" },
  { key: "product", header: "Product" },
  { key: "lead_intent", header: "Intent" },
  { key: "status", header: "Status" },
  { key: "source", header: "Source" },
  { key: "customer_status", header: "Customer Type" },
  { key: "city", header: "City" },
  { key: "pincode", header: "Pincode" },
  { key: "visit_date_time", header: "Visit" },
  { key: "contacted_on_watsapp", header: "WA Contacted" },
  { key: "wants_to_connect_on_watsapp", header: "Wants WA" },
  { key: "notes", header: "Notes" },
  { key: "external_id", header: "Capture ID" },
];

function csvEscape(value: unknown): string {
  if (value === null || value === undefined) return "";
  const s = typeof value === "boolean" ? (value ? "yes" : "no") : String(value);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function toCsv(leads: Lead[]): string {
  const header = CSV_COLUMNS.map((c) => csvEscape(c.header)).join(",");
  const rows = leads.map((lead) =>
    CSV_COLUMNS.map((c) => csvEscape(lead[c.key])).join(","),
  );
  return [header, ...rows].join("\r\n");
}

export async function GET(request: NextRequest) {
  const session = await requireSession();

  const rawRange = request.nextUrl.searchParams.get("range") ?? "all";
  const parsedRange = rangeSchema.safeParse(rawRange);
  if (!parsedRange.success) {
    return NextResponse.json(
      { error: "Invalid range. Use today, yesterday, last_week, last_month, or all." },
      { status: 400 },
    );
  }
  const range = parsedRange.data;

  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select(LEAD_COLUMNS)
    .eq("org_slug", session.organisation.slug)
    .order("created_at", { ascending: false })
    .limit(10_000);

  const { from, to } = rangeBounds(range, Date.now());
  if (from) query = query.gte("created_at", from);
  if (to) query = query.lt("created_at", to);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const leads = (data ?? []) as unknown as Lead[];
  const csv = toCsv(leads);
  // BOM so Excel opens UTF-8 correctly.
  const body = `﻿${csv}`;

  const stamp = new Date().toISOString().slice(0, 10);
  const filename = `skello-leads-${range}-${stamp}.csv`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
