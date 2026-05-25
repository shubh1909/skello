import { type NextRequest, NextResponse } from "next/server";

import { requireSession } from "@/lib/auth/session";
import { processRow } from "@/lib/bolna/calls-import";
import { importChunkInputSchema } from "@/lib/validations/bolna-csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Per-row streaming endpoint for the CSV importer. The client POSTs one chunk
// (≤ IMPORT_CHUNK_SIZE rows) and reads back NDJSON — one JSON object per line
// as each row finishes. This gives the progress bar a per-row tick instead
// of having to wait the full ~30 seconds for a 50-row chunk to complete.
//
// Wire format (each line is a single result):
//   {"id":"<rowId>","outcome":"imported","callId":"<id>","leadLinked":true}
//   {"id":"<rowId>","outcome":"updated","callId":"<id>","leadLinked":false}
//   {"id":"<rowId>","outcome":"error","error":"<reason>"}
//
// Pre-stream errors (auth, validation) use a normal JSON body + non-200
// status so the client can short-circuit before opening the stream reader.
//
// No revalidatePath here — the client calls router.refresh() exactly once
// after the final chunk, which avoids interleaving soft navigations with
// the streaming progress updates.
export async function POST(request: NextRequest) {
  const session = await requireSession();
  const sessionOrgId = session.organisation.id;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body" },
      { status: 400 },
    );
  }

  const parsed = importChunkInputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const rows = parsed.data.rows;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder();
      const write = (obj: unknown) => {
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      };

      for (const row of rows) {
        try {
          const result = await processRow(row, sessionOrgId);
          write(result);
        } catch (err) {
          write({
            id: row.id,
            outcome: "error",
            error:
              err instanceof Error
                ? err.message
                : "Unexpected error processing row",
          });
        }
      }
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      // Disable proxy buffering so Vercel/CDN hops flush each line.
      "X-Accel-Buffering": "no",
    },
  });
}
