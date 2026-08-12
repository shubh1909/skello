import { Building2Icon } from "lucide-react";

import { cn } from "@/lib/utils";
import type { LeadIntakeChannel } from "@/types/lead-intake";

/**
 * Provider identity for the integration cards.
 *
 * ⚠️ **These are the only literal hex colours in the app.** Everything else
 * renders from the oklch tokens in globals.css, and `warning`/`info` there are
 * deliberately desaturated teal-greys rather than amber and blue. Brand colour
 * is the documented exception: an integrations page is one of the few screens
 * where the point is to look like somebody else's product, so a partner is
 * recognised before it is read. They are confined to the logo tile — never
 * borders, text, or status, which stay on the design system so colour keeps
 * meaning one thing everywhere else.
 */

export interface ChannelBrand {
  label: string;
  /** One line, under the name. What the channel actually captures. */
  tagline: string;
  /** Tailwind classes for the logo tile's fill. */
  tile: string;
}

export const CHANNEL_BRAND: Record<LeadIntakeChannel, ChannelBrand> = {
  google_ads: {
    label: "Google Ads",
    tagline: "Lead form submissions",
    // Google's mark is four-colour on white, so the tile is a neutral surface
    // with a ring rather than a colour fill — a coloured backing would clash
    // with the logo itself.
    tile: "bg-white ring-1 ring-black/10 dark:ring-white/15",
  },
  whatsapp: {
    label: "WhatsApp",
    tagline: "Click-to-WhatsApp ads",
    tile: "bg-[#25D366]",
  },
  portal_99acres: {
    label: "99acres",
    tagline: "Property portal enquiries",
    tile: "bg-[#00519B]",
  },
};

/**
 * The provider's logo, drawn inline.
 *
 * Inline SVG rather than an image file: these render inside a strict CSP with no
 * external hosts, and an icon that arrives one paint late is worse than one that
 * ships with the markup. lucide carries no brand marks — it removed them — so
 * there is nothing to import.
 */
export function ChannelLogo({
  channel,
  className,
}: {
  channel: LeadIntakeChannel;
  className?: string;
}) {
  if (channel === "google_ads") {
    return (
      <svg viewBox="0 0 48 48" aria-hidden className={cn("size-5", className)}>
        <path
          fill="#EA4335"
          d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
        />
        <path
          fill="#4285F4"
          d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
        />
        <path
          fill="#FBBC05"
          d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.28-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.55 10.78l7.98-6.19z"
        />
        <path
          fill="#34A853"
          d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
        />
      </svg>
    );
  }

  if (channel === "whatsapp") {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
        className={cn("size-5 text-white", className)}
      >
        <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.487-8.413" />
      </svg>
    );
  }

  return <Building2Icon className={cn("size-5 text-white", className)} />;
}

/** The logo on its brand tile — the recognisable unit, used everywhere. */
export function ChannelTile({
  channel,
  className,
}: {
  channel: LeadIntakeChannel;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "grid size-10 shrink-0 place-items-center rounded-xl shadow-xs",
        CHANNEL_BRAND[channel].tile,
        className,
      )}
    >
      <ChannelLogo channel={channel} />
    </span>
  );
}
