import type { RecoveryTemplateLayout } from "@/types/shopify";

// The WhatsApp recovery message layouts that can coexist. Each maps to a Meta
// template body with a specific number/order of {{n}} body variables; the send
// pipeline fills them positionally from buildRecoveryVariables' named output.
// Adding a layout = one entry here — nothing else in the pipeline changes.
//
// Plain data + pure helpers (no server-only deps) so the settings form (client)
// and the dispatcher (server) can both import it. The offer arithmetic lives
// here too, for the same reason: the settings preview must do the maths the
// dispatcher does, or it shows operators a message shoppers never receive.
//
// ⚠️ ALL layouts send the short link (`discount_link`), which only resolves
// once THAT CLIENT's Shopify App Proxy is configured — there is no runtime
// fallback to the long URL when it isn't (see buildMessageLink). Verify with
// "Check app proxy" on the admin Shopify screen before a client goes live, or
// their shoppers get 404s. See docs/cart-recovery.md § The short recovery link.

export interface RecoveryTemplateLayoutMeta {
  label: string;
  description: string;
  // Positional order of the Meta template's {{1}}..{{n}} body variables. Every
  // key must exist in buildRecoveryVariables' output.
  variableOrder: readonly string[];
  // The reference copy this layout was designed against, with {{n}} markers in
  // variableOrder positions.
  //
  // ⚠️ This is NOT what gets sent. The real body lives on Meta's side under the
  // org's approved template name; we only ever transmit the positional
  // parameters. Editing this string changes the settings preview and nothing
  // else — a merchant whose approved template is worded differently sees copy
  // here that doesn't match what their shoppers get. It exists so an operator
  // can (a) sanity-check which variable lands where and (b) hand the exact body
  // to Meta when submitting a NEW template for approval.
  previewBody: string;
}

export const DEFAULT_RECOVERY_TEMPLATE_LAYOUT: RecoveryTemplateLayout =
  "coupon_link";

export const RECOVERY_TEMPLATE_LAYOUTS: Record<
  RecoveryTemplateLayout,
  RecoveryTemplateLayoutMeta
> = {
  classic: {
    label: "Classic",
    description:
      "Cart summary, discount code, and a link back to the saved cart (6 variables).",
    variableOrder: [
      "customer_name",
      "top_product",
      "cart_total",
      "discounted_cart_total",
      "discount_code",
      // Was `recovery_url` (Shopify's raw abandoned-checkout URL). Now the same
      // short link coupon_link sends: {{6}} is still a URL, so the approved Meta
      // template needs NO change and no re-approval — the variable count and
      // shape are identical. What the shopper gets instead is a link on the
      // store's own domain that pre-applies the coupon and, crucially, routes
      // through us so `clicked_at` records. On `recovery_url` a classic org
      // could never register a single click.
      "discount_link",
    ],
    previewBody: [
      "Hi {{1}}, you left {{2}} in your cart.",
      "",
      "Cart total: ₹{{3}}",
      "Your price today: ₹{{4}}",
      "",
      "Use code {{5}} at checkout.",
      "",
      "Complete your order 👉 {{6}}",
    ].join("\n"),
  },
  coupon_link: {
    label: "Coupon link",
    description:
      "Short message with one checkout link that pre-applies the coupon (4 variables).",
    variableOrder: [
      "customer_name",
      "top_product",
      "store_name",
      "discount_link",
    ],
    previewBody: [
      "Hi {{1}}, your {{2}} is still waiting at {{3}}.",
      "",
      "Tap below — your discount is already applied at checkout 👉 {{4}}",
    ].join("\n"),
  },
  // Festive tiered layout: the offer is a VOLUME ladder, not a single coupon, so
  // there is no `discount_code` / `discounted_cart_total` to quote — the saving
  // depends on how many items the shopper ends up adding, which we can't know at
  // send time. The three tiers are therefore static body copy on Meta's side,
  // not variables: baking them into the approved template keeps the parameter
  // count at 4 and means a tier change is a template revision (which it has to
  // be anyway — Meta owns the body).
  //
  // Same 4-parameter count as coupon_link but a DIFFERENT variable meaning
  // ({{3}} is the cart total here, the store name there). Meta only validates
  // count, so pointing this layout at a coupon_link template sends silently
  // wrong copy instead of erroring. The template NAME must match the layout.
  rakhi_offer: {
    label: "Rakhi offer (tiered)",
    description:
      "Cart reminder with the Buy 1/2/3 Rakhi discount ladder and a checkout link (4 variables). No coupon code — the tiers are fixed in the approved template body.",
    variableOrder: [
      "customer_name",
      "top_product",
      "cart_total",
      "discount_link",
    ],
    previewBody: [
      "Hi {{1}} 👋",
      "",
      "You left {{2}} in your cart — ₹{{3}} worth of goodies still waiting for you.",
      "",
      "🎁 Our special Rakhi offer is live:",
      "Buy 1 – Get 15% Off",
      "Buy 2 – Get 25% Off",
      "Buy 3 – Get 35% Off",
      "",
      "Add one more to your cart and save even more.",
      "",
      "Complete your order here 👉 {{4}}",
    ].join("\n"),
  },
};

// Every layout key, as a non-empty tuple so Zod schemas and the DB check
// constraint can be derived from this one list instead of restating it.
export const RECOVERY_TEMPLATE_LAYOUT_VALUES = Object.keys(
  RECOVERY_TEMPLATE_LAYOUTS,
) as [RecoveryTemplateLayout, ...RecoveryTemplateLayout[]];

// Coerce a stored/settings value to a known layout, defaulting when absent or
// unrecognised.
export function resolveRecoveryTemplateLayout(
  value: string | null | undefined,
): RecoveryTemplateLayout {
  return RECOVERY_TEMPLATE_LAYOUT_VALUES.includes(
    value as RecoveryTemplateLayout,
  )
    ? (value as RecoveryTemplateLayout)
    : DEFAULT_RECOVERY_TEMPLATE_LAYOUT;
}

// The positional variable order the send pipeline should use for this org.
export function recoveryTemplateVariableOrder(
  value: string | null | undefined,
): readonly string[] {
  return RECOVERY_TEMPLATE_LAYOUTS[resolveRecoveryTemplateLayout(value)]
    .variableOrder;
}

// --- Offer arithmetic (shared by the dispatcher and the settings preview) -----

// Money → speakable string: 2dp, trailing ".00" trimmed (5000, not 5000.00).
// Used for the percentage label; currency amounts use wholeAmount (below).
export function money(n: number): string {
  const rounded = Math.round(n * 100) / 100;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

// Currency amount → whole units, no paise. The voice agent quotes "5000 rupees",
// never "4999.50", and the WhatsApp copy matches. Rounds to the nearest rupee.
export function wholeAmount(n: number): string {
  return String(Math.round(n));
}

// cart_total is the original (pre-offer) value; the discount is derived from the
// snapshotted offer. Returns nulls when there's no usable offer/total.
export function applyRecoveryOffer(
  cartTotal: number | null,
  value: number | null,
  kind: string | null,
): {
  discountAmount: number | null;
  discountedTotal: number | null;
  percentLabel: string;
} {
  if (cartTotal == null || value == null || value <= 0) {
    return { discountAmount: null, discountedTotal: null, percentLabel: "" };
  }
  if (kind === "percentage") {
    const amount = Math.min((cartTotal * value) / 100, cartTotal);
    return {
      discountAmount: amount,
      discountedTotal: cartTotal - amount,
      percentLabel: `${money(value)}%`,
    };
  }
  if (kind === "fixed_amount") {
    const amount = Math.min(value, cartTotal);
    return {
      discountAmount: amount,
      discountedTotal: cartTotal - amount,
      percentLabel: "",
    };
  }
  return { discountAmount: null, discountedTotal: null, percentLabel: "" };
}

// --- Settings preview --------------------------------------------------------

// The sample cart the preview pretends to have abandoned. Deliberately a real
// shape (whole-rupee total, a store-domain short link) so the preview reads the
// way a live message does — and deliberately obvious placeholders, so nobody
// mistakes it for a real shopper.
const PREVIEW_CART_TOTAL = 2499;

export const SAMPLE_RECOVERY_VARIABLES: Readonly<Record<string, string>> = {
  customer_name: "Asha",
  top_product: "Silver Rakhi Set",
  cart_summary: "Silver Rakhi Set along with others",
  item_count: "2",
  currency: "INR",
  cart_total: wholeAmount(PREVIEW_CART_TOTAL),
  discount_name: "your offer",
  discount_code: "YOURCODE",
  discount_code_spoken: "your code",
  discount_percentage: "",
  discount_amount: "",
  discounted_cart_total: wholeAmount(PREVIEW_CART_TOTAL),
  recovery_url: "https://yourstore.com/checkouts/…/recover",
  store_name: "yourstore.com",
  discount_link: "https://yourstore.com/apps/skelo/r/aB3xK9pQ12zY",
};

// Variables that are BLANK unless an offer is configured. `discount_link` is
// deliberately absent: with no offer it still resolves to the plain checkout
// link, so a layout that only orders the link needs no offer at all.
export const OFFER_DEPENDENT_VARIABLES: readonly string[] = [
  "discount_name",
  "discount_code",
  "discount_code_spoken",
  "discount_percentage",
  "discount_amount",
  "discounted_cart_total",
];

// Does this layout read anything that goes blank without a configured offer?
export function layoutRequiresOffer(value: string | null | undefined): boolean {
  return recoveryTemplateVariableOrder(value).some((k) =>
    OFFER_DEPENDENT_VARIABLES.includes(k),
  );
}

// The org's live offer, as the settings form holds it mid-edit (before save).
export interface RecoveryPreviewOffer {
  offerType?: string | null;
  offerLabel?: string | null;
  offerCode?: string | null;
  discountValue?: number | null;
  discountKind?: string | null;
}

export interface RecoveryTemplatePreviewParam {
  // 1-based, matching Meta's {{n}}.
  position: number;
  key: string;
  value: string;
}

export interface RecoveryTemplatePreview {
  layout: RecoveryTemplateLayout;
  meta: RecoveryTemplateLayoutMeta;
  body: string;
  params: RecoveryTemplatePreviewParam[];
}

// Fill the sample variables with whatever the operator has actually configured,
// so the preview shows THEIR coupon and THEIR discounted total against a sample
// cart — the offer half is real, the cart half is placeholder.
function previewVariables(
  offer: RecoveryPreviewOffer,
): Record<string, string> {
  const vars = { ...SAMPLE_RECOVERY_VARIABLES };
  if (!offer.offerType || offer.offerType === "none") return vars;

  const code = offer.offerCode?.trim();
  if (code) vars.discount_code = code;
  const label = offer.offerLabel?.trim();
  if (label) vars.discount_name = label;

  const { discountAmount, discountedTotal, percentLabel } = applyRecoveryOffer(
    PREVIEW_CART_TOTAL,
    offer.discountValue ?? null,
    offer.discountKind ?? null,
  );
  if (discountAmount != null) vars.discount_amount = wholeAmount(discountAmount);
  if (discountedTotal != null) {
    vars.discounted_cart_total = wholeAmount(discountedTotal);
  }
  if (percentLabel) vars.discount_percentage = percentLabel;

  return vars;
}

// Render a layout's reference body with its positional parameters substituted.
// Pure — the settings form calls this on every keystroke.
export function buildRecoveryTemplatePreview(
  layout: string | null | undefined,
  offer: RecoveryPreviewOffer = {},
): RecoveryTemplatePreview {
  const resolved = resolveRecoveryTemplateLayout(layout);
  const meta = RECOVERY_TEMPLATE_LAYOUTS[resolved];
  const vars = previewVariables(offer);

  const params = meta.variableOrder.map((key, i) => ({
    position: i + 1,
    key,
    // Mirrors the send path's blank handling (sanitizeTemplateParam turns an
    // empty param into "-"), so an operator sees the same "-" Meta would show
    // rather than a silently collapsed line.
    value: vars[key]?.trim() ? vars[key] : "-",
  }));

  const body = params.reduce(
    (acc, p) => acc.split(`{{${p.position}}}`).join(p.value),
    meta.previewBody,
  );

  return { layout: resolved, meta, body, params };
}
