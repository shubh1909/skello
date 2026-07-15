import type { RecoveryTemplateLayout } from "@/types/shopify";

// The WhatsApp recovery message layouts that can coexist. Each maps to a Meta
// template body with a specific number/order of {{n}} body variables; the send
// pipeline fills them positionally from buildRecoveryVariables' named output.
// Adding a third template = one entry here — nothing else in the pipeline changes.
//
// Plain data + pure helpers (no server-only deps) so the settings form (client)
// and the dispatcher (server) can both import it.

export interface RecoveryTemplateLayoutMeta {
  label: string;
  description: string;
  // Positional order of the Meta template's {{1}}..{{n}} body variables. Every
  // key must exist in buildRecoveryVariables' output.
  variableOrder: readonly string[];
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
      "recovery_url",
    ],
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
  },
};

// Coerce a stored/settings value to a known layout, defaulting when absent or
// unrecognised.
export function resolveRecoveryTemplateLayout(
  value: string | null | undefined,
): RecoveryTemplateLayout {
  return value === "classic" || value === "coupon_link"
    ? value
    : DEFAULT_RECOVERY_TEMPLATE_LAYOUT;
}

// The positional variable order the send pipeline should use for this org.
export function recoveryTemplateVariableOrder(
  value: string | null | undefined,
): readonly string[] {
  return RECOVERY_TEMPLATE_LAYOUTS[resolveRecoveryTemplateLayout(value)]
    .variableOrder;
}
