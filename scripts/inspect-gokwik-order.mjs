#!/usr/bin/env node
// Throwaway diagnostic — inspect a GoKwik order's real shape to find WHERE the
// buyer phone lives and which tokens it carries, so we can fix the recovery
// attribution miss (a connected-call attempt never marked converted).
//
// Reads the store's access token from the DB (never printed), resolves the order
// by name via GraphQL, then REST-fetches it (checkout_token / cart_token only
// exist in REST), and reports:
//   - the order's token / checkout_token / cart_token, compared to what we stored
//   - every field whose value contains the buyer's phone digits (the answer to
//     "does GoKwik use note_attributes instead of customer.phone?")
//   - GoKwik tells: source_name, app_id, tags
//
// Run from the project root:
//   node scripts/inspect-gokwik-order.mjs "#104618" 7990664995
// Args: [orderName=#104618] [phoneLast10=7990664995]
// Phone digits are never printed — only the JSON paths where they appear.

import { existsSync, readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

// Load .env.local if present, without clobbering already-set (prod) env.
if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split("\n")) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env / .env.local",
  );
  process.exit(1);
}

const ORDER_NAME = process.argv[2] ?? "#104618";
const PHONE_LAST10 = (process.argv[3] ?? "7990664995").replace(/\D/g, "").slice(-10);

const admin = createClient(SUPA_URL, SUPA_KEY, { auth: { persistSession: false } });

// 1) Find the org (and our stored tokens) from the abandoned attempt's phone.
const { data: attempts, error: aErr } = await admin
  .from("shopify_recovery_attempts")
  .select("organisation_id, checkout_token, cart_token, status, converted_at, created_at")
  .ilike("phone", `%${PHONE_LAST10}`)
  .order("created_at", { ascending: false });
if (aErr) {
  console.error("DB error reading attempts:", aErr.message);
  process.exit(1);
}
if (!attempts?.length) {
  console.error(`No recovery attempt found for phone ending ${PHONE_LAST10}`);
  process.exit(1);
}
const orgId = attempts[0].organisation_id;
const storedCheckoutTokens = new Set(attempts.map((a) => a.checkout_token).filter(Boolean));
const storedCartTokens = new Set(attempts.map((a) => a.cart_token).filter(Boolean));

console.log(`\nOur attempts for this phone (org ${orgId}):`);
for (const a of attempts) {
  console.log(
    `  · ${a.created_at}  status=${a.status}  converted=${a.converted_at ?? "null"}` +
      `  checkout=${a.checkout_token}  cart=${a.cart_token}`,
  );
}

// 2) The store's connection.
const { data: integ, error: iErr } = await admin
  .from("shopify_integrations")
  .select("shop_domain, access_token, api_version")
  .eq("organisation_id", orgId)
  .maybeSingle();
if (iErr || !integ?.access_token) {
  console.error("No Shopify integration/token for that org:", iErr?.message);
  process.exit(1);
}
const shop = integ.shop_domain;
const ver = integ.api_version || "2025-04";
const headers = {
  "X-Shopify-Access-Token": integ.access_token,
  "Content-Type": "application/json",
};

// 3) Resolve the order NAME → numeric id (REST can't filter by name; GraphQL can).
const gqlRes = await fetch(`https://${shop}/admin/api/${ver}/graphql.json`, {
  method: "POST",
  headers,
  body: JSON.stringify({
    query: `{ orders(first: 5, query: ${JSON.stringify(`name:${ORDER_NAME}`)}) {
      edges { node { id name createdAt } } } }`,
  }),
});
const gql = await gqlRes.json();
const edges = gql?.data?.orders?.edges ?? [];
if (!edges.length) {
  console.error(`\nOrder ${ORDER_NAME} not found on ${shop}.`, gql?.errors ?? "");
  process.exit(1);
}
const numericId = edges[0].node.id.split("/").pop();

// 4) Full order via REST (has token / checkout_token / cart_token / note_attributes).
const restRes = await fetch(
  `https://${shop}/admin/api/${ver}/orders/${numericId}.json`,
  { headers },
);
const { order } = await restRes.json();
if (!order) {
  console.error("REST fetch returned no order.");
  process.exit(1);
}

// 5) Recursively find every path whose value contains the phone digits.
function findDigitPaths(obj, target, path = "", hits = []) {
  if (obj == null) return hits;
  if (typeof obj === "string" || typeof obj === "number") {
    if (String(obj).replace(/\D/g, "").includes(target)) hits.push(path || "(root)");
    return hits;
  }
  if (Array.isArray(obj)) {
    obj.forEach((v, i) => findDigitPaths(v, target, `${path}[${i}]`, hits));
    return hits;
  }
  if (typeof obj === "object") {
    for (const k of Object.keys(obj)) {
      findDigitPaths(obj[k], target, path ? `${path}.${k}` : k, hits);
    }
    return hits;
  }
  return hits;
}

const tokenMark = (val, set, otherSet) =>
  val == null
    ? "(none)"
    : set.has(val)
      ? `${val}   ✅ MATCHES a stored token`
      : otherSet.has(val)
        ? `${val}   ✅ matches stored (other type)`
        : `${val}   ❌ not in our table`;

console.log(`\n================  ORDER ${order.name}  ================`);
console.log(`store            ${shop}  (api ${ver})`);
console.log(`created_at       ${order.created_at}`);
console.log(`financial_status ${order.financial_status}`);
console.log(`source_name      ${order.source_name}        ← GoKwik tell`);
console.log(`app_id           ${order.app_id}`);
console.log(`tags             ${order.tags || "(none)"}`);

console.log(`\n--- tokens (why our token match missed) ---`);
console.log(`order token      ${order.token ?? "(none)"}`);
console.log(`checkout_token   ${tokenMark(order.checkout_token, storedCheckoutTokens, storedCartTokens)}`);
console.log(`cart_token       ${tokenMark(order.cart_token, storedCartTokens, storedCheckoutTokens)}`);

console.log(`\n--- native phone fields we currently read (firstPhone) ---`);
const nativeFields = {
  "phone (top-level)": order.phone,
  "customer.phone": order.customer?.phone,
  "shipping_address.phone": order.shipping_address?.phone,
  "billing_address.phone": order.billing_address?.phone,
};
for (const [label, val] of Object.entries(nativeFields)) {
  console.log(`  ${label.padEnd(24)} ${val ? "present" : "— empty —"}`);
}

console.log(`\n--- WHERE the phone actually appears (digits ...${PHONE_LAST10.slice(-4)}) ---`);
const hits = findDigitPaths(order, PHONE_LAST10);
if (!hits.length) {
  console.log("  ⚠️  NOT FOUND anywhere in the order — phone not on this order at all.");
} else {
  for (const h of hits) console.log(`  • ${h}`);
  const nativePaths = new Set([
    "phone",
    "customer.phone",
    "shipping_address.phone",
    "billing_address.phone",
  ]);
  const onlyNonNative = hits.every((h) => !nativePaths.has(h));
  if (onlyNonNative) {
    console.log(
      "\n  → The phone is ONLY in non-native fields (e.g. note_attributes).",
    );
    console.log("    firstPhone() will never see it — the fix must read these.");
  }
}

console.log(`\n--- note_attributes (GoKwik commonly parks contact info here) ---`);
if (Array.isArray(order.note_attributes) && order.note_attributes.length) {
  for (const na of order.note_attributes) {
    const looksPhone = String(na.value ?? "").replace(/\D/g, "").length >= 10;
    console.log(`  ${na.name}: ${looksPhone ? "<phone-like, redacted>" : na.value}`);
  }
} else {
  console.log("  (none)");
}
console.log("");
