#!/usr/bin/env node
// Throwaway diagnostic — why some call recordings won't play. READ ONLY.
//
// Established so far:
//   - every recording_url is https://api.bolna.ai/recordings/call/<id>
//   - that endpoint 307-redirects to a presigned S3 object; no auth needed
//
// So this follows the redirect on a spread of calls and reports the TERMINAL
// status and content-type — the thing a browser <audio> actually consumes —
// to find how often, and for which calls, it fails.
//
// Run from the project root:  node scripts/diagnose-recordings.mjs

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const SAMPLE = Number(process.argv[2] ?? 60);

const { data: rows } = await admin
  .from("calls")
  .select("id, recording_url, started_at, status, duration_seconds")
  .not("recording_url", "is", null)
  .order("started_at", { ascending: false })
  .limit(4000);

const all = rows ?? [];
// Spread the sample across the whole range rather than taking the newest N —
// an expiry or a retention window only shows up in the older rows.
const step = Math.max(1, Math.floor(all.length / SAMPLE));
const sample = all.filter((_, i) => i % step === 0).slice(0, SAMPLE);

console.log(`Probing ${sample.length} of ${all.length} recordings, oldest ${
  all.at(-1)?.started_at?.slice(0, 10)
} → newest ${all[0]?.started_at?.slice(0, 10)}\n`);

const probe = async (row) => {
  const ageDays = row.started_at
    ? Math.round((Date.now() - new Date(row.started_at).getTime()) / 86400000)
    : null;
  try {
    // Ranged GET with redirects followed: exactly what a media element does.
    const res = await fetch(row.recording_url, {
      method: "GET",
      headers: { Range: "bytes=0-2047" },
      redirect: "follow",
      signal: AbortSignal.timeout(25000),
    });
    const buf = res.ok || res.status === 206 ? await res.arrayBuffer() : null;
    return {
      ok: res.status === 200 || res.status === 206,
      http: res.status,
      type: res.headers.get("content-type"),
      acceptRanges: res.headers.get("accept-ranges"),
      totalBytes:
        res.headers.get("content-range")?.split("/")[1] ??
        res.headers.get("content-length"),
      firstBytes: buf ? Buffer.from(buf.slice(0, 4)).toString("hex") : null,
      ageDays,
      status: row.status,
      duration: row.duration_seconds,
      id: row.id,
    };
  } catch (err) {
    return { ok: false, http: `FAILED: ${err.message}`, ageDays, status: row.status, id: row.id };
  }
};

const results = [];
// Small concurrency so we don't hammer the provider.
for (let i = 0; i < sample.length; i += 5) {
  results.push(...(await Promise.all(sample.slice(i, i + 5).map(probe))));
  process.stdout.write(".");
}
console.log("\n");

const good = results.filter((r) => r.ok);
const bad = results.filter((r) => !r.ok);

console.log("=== Terminal outcome ===");
console.log({ probed: results.length, playable: good.length, failed: bad.length });

const byType = {};
for (const r of good) byType[`${r.type} | ranges:${r.acceptRanges}`] =
  (byType[`${r.type} | ranges:${r.acceptRanges}`] ?? 0) + 1;
console.log("\n=== Content types of the ones that DO resolve ===");
console.table(byType);

// The magic bytes say what the file really is, regardless of content-type.
const byMagic = {};
for (const r of good) {
  const sig = r.firstBytes ?? "";
  const label = sig.startsWith("fff") || sig.startsWith("4944")
    ? "MP3"
    : sig.startsWith("5249")
      ? "WAV (RIFF)"
      : sig.startsWith("4f676753")
        ? "OGG"
        : sig.startsWith("000000")
          ? "MP4/M4A"
          : `unknown (${sig})`;
  byMagic[label] = (byMagic[label] ?? 0) + 1;
}
console.log("=== What the bytes actually are ===");
console.table(byMagic);

console.log("\n=== Zero-byte / empty responses (a player with nothing to play) ===");
const empty = good.filter((r) => !r.totalBytes || Number(r.totalBytes) < 1000);
console.log({ count: empty.length });
for (const r of empty.slice(0, 8)) {
  console.log("  ", { id: r.id, bytes: r.totalBytes, duration: r.duration, status: r.status, ageDays: r.ageDays });
}

if (bad.length) {
  console.log("\n=== Failures ===");
  const byHttp = {};
  for (const r of bad) byHttp[r.http] = (byHttp[r.http] ?? 0) + 1;
  console.table(byHttp);
  console.log("  sample:", bad.slice(0, 8).map((r) => ({
    id: r.id, http: r.http, ageDays: r.ageDays, status: r.status, duration: r.duration,
  })));

  console.log("\n  failure rate by age bucket:");
  const buckets = {};
  for (const r of results) {
    const b = r.ageDays === null ? "?" : r.ageDays <= 1 ? "0-1d" : r.ageDays <= 7 ? "2-7d" : r.ageDays <= 30 ? "8-30d" : "30d+";
    buckets[b] ??= { probed: 0, failed: 0 };
    buckets[b].probed++;
    if (!r.ok) buckets[b].failed++;
  }
  console.table(buckets);
}
