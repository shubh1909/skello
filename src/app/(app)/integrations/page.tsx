import { Building2Icon, HeadphonesIcon, ShoppingCartIcon } from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { NavTabs } from "@/components/app/nav-tabs";
import {
  ChannelLogo,
  ChannelTile,
} from "@/components/app/integrations/channel-brand";
import { ChannelPanel } from "@/components/app/integrations/channel-panel";
import { IntakeEventLog } from "@/components/app/integrations/intake-event-log";
import { ShopifyStatusCard } from "@/components/app/shopify-status-card";
import { VoiceAgentStatusCard } from "@/components/app/voice-agent-status-card";
import { WhatsAppStatusCard } from "@/components/app/whatsapp-status-card";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listIntakeEvents, listIntakeSources } from "@/actions/lead-intake";
import { getBolnaIntegration } from "@/actions/bolna-integrations";
import { getShopifyStatus } from "@/actions/shopify";
import { getWhatsAppIntegration } from "@/actions/whatsapp-integrations";
import { appOrigin } from "@/lib/app-url";
import { requireSession } from "@/lib/auth/session";

export const metadata = { title: "Integrations · Skelo" };

/**
 * One tab per integration, rather than a stack of cards.
 *
 * These used to be four status cards buried under the workspace form on
 * /settings, which put "where do my leads come from" in the same place as
 * "change my email". Each connection now gets a page of its own — enough room
 * for setup instructions and a delivery log, which is what a webhook
 * integration needs to be diagnosable.
 *
 * Everything here is READ-ONLY. Provisioning an endpoint is Skelo-team work at
 * /admin/organisations/[id]/integrations, the same as voice agents and Shopify.
 */
type Tab = "google-ads" | "whatsapp" | "portal-99acres" | "voice" | "shopify";

const TABS: Tab[] = [
  "google-ads",
  "whatsapp",
  "portal-99acres",
  "voice",
  "shopify",
];

const TAB_LABEL: Record<Tab, string> = {
  "google-ads": "Google Ads",
  whatsapp: "WhatsApp",
  "portal-99acres": "99acres",
  voice: "Voice agent",
  shopify: "Shopify",
};

const TAB_ICON: Record<Tab, React.ReactNode> = {
  "google-ads": <ChannelLogo channel="google_ads" />,
  // The mark is white-on-green by design, so on a plain tab strip it needs the
  // brand colour applied to the glyph itself rather than to a tile behind it.
  whatsapp: <ChannelLogo channel="whatsapp" className="text-[#25D366]" />,
  "portal-99acres": <Building2Icon />,
  voice: <HeadphonesIcon />,
  shopify: <ShoppingCartIcon />,
};

interface PageProps {
  searchParams?: Promise<{ tab?: string }>;
}

export default async function IntegrationsPage({ searchParams }: PageProps) {
  const session = await requireSession();
  const sp = (await searchParams) ?? {};
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "google-ads";

  const [sourcesRes, appUrl] = await Promise.all([
    listIntakeSources(),
    appOrigin(),
  ]);
  const origin = appUrl.url;

  if (!sourcesRes.success) {
    return <ErrorCard>{sourcesRes.error}</ErrorCard>;
  }

  const googleSource =
    sourcesRes.data.find((s) => s.channel === "google_ads") ?? null;
  const whatsappSource =
    sourcesRes.data.find((s) => s.channel === "whatsapp") ?? null;
  const activeSource =
    tab === "google-ads" ? googleSource : tab === "whatsapp" ? whatsappSource : null;

  // Only the active tab's data is fetched. Each connection card hits a
  // different table, and loading all of them on every tab would make the page
  // slower with every integration we add.
  const eventsRes = activeSource
    ? await listIntakeEvents({ source_id: activeSource.id, limit: 25 })
    : null;

  const whatsappRes =
    tab === "whatsapp"
      ? await getWhatsAppIntegration(session.organisation.id)
      : null;
  const voiceRes =
    tab === "voice" ? await getBolnaIntegration(session.organisation.id) : null;
  const shopifyRes = tab === "shopify" ? await getShopifyStatus() : null;

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Integrations
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Where {session.organisation.name}&rsquo;s leads come from, and what is
          connected to Skelo. Each source writes into the same pipeline — fields
          you have never seen before show up automatically on the leads table and
          the lead sheet.
        </p>
      </header>

      {/* Logos in the tab strip, not just the panels: the whole point of brand
          marks here is being recognised before being read, and the strip is
          what someone scans first. */}
      <NavTabs
        aria-label="Integrations"
        items={TABS.map((t) => ({
          href: t === "google-ads" ? "/integrations" : `/integrations?tab=${t}`,
          label: TAB_LABEL[t],
          active: tab === t,
          icon: TAB_ICON[t],
        }))}
      />

      {tab === "google-ads" ? (
        <ChannelPanel
          source={googleSource}
          channel="google_ads"
          origin={origin}
          routeSegment="google-ads"
          keyLabel="Key"
          keyHint="Paste this into the form's “Key” field. It is the only thing proving a delivery came from your account, so treat it like a password."
          unprovisioned="Every submission on a Google Ads lead form can arrive here as a lead — including the answers to your own qualifying questions, which become fields you can put on the lead sheet. Ask your Skelo contact to switch it on."
          steps={[
            "Open the lead form asset in Google Ads and edit it.",
            "Under “Lead delivery option”, choose “Webhook integration”.",
            "Paste the URL and the key above, then press “Send test data”.",
            "A test delivery appears in the log below within a few seconds. It is recorded but deliberately does not create a lead.",
          ]}
        />
      ) : null}

      {tab === "whatsapp" ? (
        <>
          <ChannelPanel
            source={whatsappSource}
            channel="whatsapp"
            origin={origin}
            routeSegment="whatsapp"
            keyLabel="Verify token"
            keyHint="Meta asks for this once, when the webhook address is saved. It proves the endpoint is yours."
            unprovisioned="Leads from Click-to-WhatsApp ads — the ad they tapped, its headline, and the click id needed to attribute sales back to ad spend. It runs on the WhatsApp Cloud API directly rather than through a messaging provider, because the ad attribution does not survive a relay. Ask your Skelo contact to set it up."
            steps={[
              "In your Meta app, open WhatsApp → Configuration → Webhook, and press Edit.",
              "Paste the URL and the verify token above, then save.",
              "Subscribe to the “messages” field — nothing arrives without it.",
              "In WhatsApp Manager, switch on Ads Attribution. Without it Meta sends the message but omits the ad it came from.",
              "Tap one of your own Click-to-WhatsApp ads and send a message. It should appear in the log below.",
            ]}
          />
          {whatsappSource ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Who becomes a lead</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-1.5 text-sm leading-relaxed text-muted-foreground">
                <p>
                  Anyone who taps one of your ads, every time — responding to a
                  new campaign is new interest, even from someone you already
                  know. If they were marked won or lost, they move back to new.
                </p>
                <p>
                  Anyone messaging you for the first time, ad or not.
                </p>
                <p>
                  Everyone else&rsquo;s messages are ignored, so ordinary
                  conversation with existing customers doesn&rsquo;t fill your
                  pipeline. Those don&rsquo;t appear in the log below either.
                </p>
              </CardContent>
            </Card>
          ) : null}
          <WhatsAppStatusCard
            integration={whatsappRes?.success ? whatsappRes.data : null}
          />
        </>
      ) : null}

      {activeSource ? (
        eventsRes?.success ? (
          <IntakeEventLog
            events={eventsRes.data.items}
            total={eventsRes.data.total}
            emptyHint={
              tab === "google-ads"
                ? "No deliveries yet. Press “Send test data” on the lead form in Google Ads — the test lands here in a few seconds."
                : "No leads yet. Tap one of your own Click-to-WhatsApp ads and send a message to check the wiring."
            }
          />
        ) : (
          <ErrorCard>
            {eventsRes?.error ?? "Could not load the delivery log"}
          </ErrorCard>
        )
      ) : null}

      {tab === "portal-99acres" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <ChannelTile channel="portal_99acres" className="size-8" />
              <div>
                <CardTitle>99acres enquiries</CardTitle>
                <CardDescription>
                  Every enquiry on your 99acres listings arriving as a lead, with
                  the project, locality and budget attached as fields you can put
                  straight onto the lead sheet.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
            <p className="font-medium text-foreground">
              What we need from you to switch it on
            </p>
            <ul className="ml-4 grid list-disc gap-1.5">
              <li>A 99acres seller account with lead API access</li>
              <li>
                Your 99acres account manager to register the Skelo webhook
                address
              </li>
              <li>One sample enquiry, so the fields can be mapped to yours</li>
            </ul>
            <p className="mt-2 text-xs">
              Talk to your Skelo contact when you have these and we will connect
              it.
            </p>
          </CardContent>
        </Card>
      ) : null}

      {tab === "voice" ? (
        <>
          <VoiceAgentStatusCard
            integration={voiceRes?.success ? voiceRes.data : null}
          />
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Voice agents and lead fields are configured by your Skelo onboarding
            team. Reach out to support if you need a change.
          </p>
        </>
      ) : null}

      {tab === "shopify" ? (
        <ShopifyStatusCard status={shopifyRes?.success ? shopifyRes.data : null} />
      ) : null}
    </div>
  );
}
