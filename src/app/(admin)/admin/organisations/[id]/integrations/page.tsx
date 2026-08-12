import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeftIcon,
  BadgeCheckIcon,
  Building2Icon,
  ExternalLinkIcon,
  HeadphonesIcon,
  KeyRoundIcon,
  MegaphoneIcon,
  PhoneIcon,
  ShoppingCartIcon,
  TriangleAlertIcon,
  WebhookIcon,
} from "lucide-react";

import { ErrorCard } from "@/components/app/error-card";
import { NavTabs } from "@/components/app/nav-tabs";
import { SectionLabel } from "@/components/app/section-label";
import {
  ChannelLogo,
  ChannelTile,
} from "@/components/app/integrations/channel-brand";
import { VoiceAgentsManager } from "@/components/app/voice-agents-manager";
import { CodAgentForm } from "@/components/admin/cod-agent-form";
import { IntakeSourcesManager } from "@/components/admin/intake-sources-manager";
import { ShopifyConnectForm } from "@/components/admin/shopify-connect-form";
import { VoiceAgentForm } from "@/components/admin/voice-agent-form";
import { WhatsAppForm } from "@/components/admin/whatsapp-form";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getCodAgentAdmin } from "@/actions/admin/cod-confirmation";
import { getOrganisationAdmin } from "@/actions/admin/organisations";
import { getShopifyIntegrationStatus } from "@/actions/admin/shopify";
import { getVoiceAgentAdmin } from "@/actions/admin/voice-agent";
import { getWhatsAppAdmin } from "@/actions/admin/whatsapp";
import { listIntakeSourcesForOrg } from "@/actions/lead-intake";
import { listVoiceAgents } from "@/actions/voice-agents";
import { appOrigin } from "@/lib/app-url";
import { requireAdmin } from "@/lib/auth/admin";
import { formatDateTime, formatRelative } from "@/lib/format";

export const metadata = { title: "Integrations · Admin · Skelo" };

/**
 * Every connection this workspace has, one tab each.
 *
 * Voice agent and Shopify used to be their own routes under Workspace
 * configuration, and the WhatsApp BSP form sat on the org overview — so
 * "what is this org connected to?" meant visiting four places. The tab order
 * and names mirror the customer's own `/integrations` exactly, so a support
 * conversation can name a tab and both sides are looking at the same thing.
 *
 * The old routes redirect here rather than being deleted, so existing links and
 * bookmarks keep working.
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
  shopify: "Cart recovery",
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

/** The client-side prerequisites for WhatsApp. Every one is a setting we can't reach. */
const WHATSAPP_CHECKLIST: Array<{
  icon: React.ReactNode;
  title: string;
  detail: string;
}> = [
  {
    icon: <BadgeCheckIcon />,
    title: "Verified Meta Business account",
    detail:
      "Business verification must be complete before WhatsApp will send anything.",
  },
  {
    icon: <KeyRoundIcon />,
    title: "A Meta app with WhatsApp added",
    detail: "The app secret comes from its settings — paste it above.",
  },
  {
    icon: <PhoneIcon />,
    title: "A number not already on another provider",
    detail:
      "A number delivers webhooks to exactly one app, so a number on KwikEngage cannot also reach us. Check this before promising anyone CTWA.",
  },
  {
    icon: <KeyRoundIcon />,
    title: "A System User permanent token",
    detail: "Not the 24-hour temporary token the dashboard hands out by default.",
  },
  {
    icon: <MegaphoneIcon />,
    title: "Ads Attribution switched on",
    detail:
      "In WhatsApp Manager. Without it Meta omits the referral block entirely — leads still arrive, but every one looks organic and the click id is lost for good. Nothing in the payload says why.",
  },
  {
    icon: <WebhookIcon />,
    title: "Webhook configured, subscribed to messages",
    detail:
      "Paste the URL and verify token into the app's webhook settings, then tick the messages field. Nothing arrives without that subscription.",
  },
];

interface PageProps {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ tab?: string }>;
}

export default async function AdminOrganisationIntegrationsPage({
  params,
  searchParams,
}: PageProps) {
  await requireAdmin();
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const tab: Tab = TABS.find((t) => t === sp.tab) ?? "google-ads";

  const [orgRes, sourcesRes, origin] = await Promise.all([
    getOrganisationAdmin(id),
    listIntakeSourcesForOrg({ organisation_id: id }),
    appOrigin(),
  ]);

  if (!orgRes.success) {
    if (orgRes.error === "Organisation not found") notFound();
    return <ErrorCard>{orgRes.error}</ErrorCard>;
  }
  if (!sourcesRes.success) {
    return <ErrorCard>{sourcesRes.error}</ErrorCard>;
  }

  const org = orgRes.data;
  const sourceFor = (channel: "google_ads" | "whatsapp") =>
    sourcesRes.data.find((s) => s.channel === channel) ?? null;

  // Only the open tab's data is fetched. Each one hits a different set of
  // tables, and loading all five on every tab would make the page slower with
  // every integration added.
  const whatsappBsp = tab === "whatsapp" ? await getWhatsAppAdmin(id) : null;
  const [voiceIntegration, voiceAgents] =
    tab === "voice"
      ? await Promise.all([getVoiceAgentAdmin(id), listVoiceAgents(id)])
      : [null, null];
  const [shopifyStatus, codAgent] =
    tab === "shopify"
      ? await Promise.all([
          getShopifyIntegrationStatus({ organisation_id: id }),
          getCodAgentAdmin(id),
        ])
      : [null, null];

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2"
          render={<Link href={`/admin/organisations/${org.id}`} />}
        >
          <ArrowLeftIcon /> Back to {org.name}
        </Button>
      </div>

      <header className="space-y-2">
        <SectionLabel as="p">{org.name}</SectionLabel>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
            Integrations
          </h1>
          <span className="flex -space-x-2">
            <ChannelTile
              channel="google_ads"
              className="size-7 rounded-lg ring-2 ring-background"
            />
            <ChannelTile
              channel="whatsapp"
              className="size-7 rounded-lg ring-2 ring-background"
            />
          </span>
        </div>
        <p className="max-w-2xl text-sm leading-relaxed text-muted-foreground">
          Everything this workspace is connected to. Lead sources are provisioned
          here rather than by the customer — WhatsApp needs their own Meta app
          secret and access token, and those should not sit behind a form every
          org owner can reach. They see the same tabs read-only at{" "}
          <span className="font-mono text-xs">/integrations</span>, with the
          delivery log.
        </p>
      </header>

      <NavTabs
        aria-label="Integrations"
        items={TABS.map((t) => ({
          href: tabHref(org.id, t),
          label: TAB_LABEL[t],
          active: tab === t,
          icon: TAB_ICON[t],
        }))}
      />

      {/* The addresses below are called from GOOGLE'S and META'S servers. A
          localhost URL looks entirely valid and silently receives nothing
          forever, so it is worth interrupting for. */}
      {(tab === "google-ads" || tab === "whatsapp") && !origin.reachable ? (
        <Alert variant="warning">
          <TriangleAlertIcon />
          <AlertTitle>
            These webhook addresses are not reachable from the internet
          </AlertTitle>
          <AlertDescription>
            <p>
              The URL below points at{" "}
              <span className="font-mono text-xs">
                {origin.url || "an unknown host"}
              </span>
              , which only resolves on this machine. Google and Meta call these
              addresses from their own servers, so anything pasted from here in
              development will never receive a delivery.
            </p>
            <p>
              Set{" "}
              <span className="font-mono text-xs">
                NEXT_PUBLIC_APP_URL=https://app.skelo.team
              </span>{" "}
              in the environment to control what is shown. To test the flow
              locally, point it at a tunnel address instead.
            </p>
          </AlertDescription>
        </Alert>
      ) : null}

      {tab === "google-ads" ? (
        <IntakeSourcesManager
          organisationId={org.id}
          origin={origin.url}
          channel="google_ads"
          source={sourceFor("google_ads")}
        />
      ) : null}

      {tab === "whatsapp" ? (
        <>
          <IntakeSourcesManager
            organisationId={org.id}
            origin={origin.url}
            channel="whatsapp"
            source={sourceFor("whatsapp")}
          />

          {sourceFor("whatsapp") ? (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <ChannelTile channel="whatsapp" className="size-8" />
                  <div>
                    <CardTitle className="text-base">
                      Before WhatsApp will deliver anything
                    </CardTitle>
                    <p className="text-sm text-muted-foreground">
                      Collect these from the client. Every one is a setting on
                      their side — none of it can be done from here.
                    </p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 sm:grid-cols-2">
                {WHATSAPP_CHECKLIST.map((item) => (
                  <div
                    key={item.title}
                    className="flex gap-2.5 rounded-lg border border-border/60 bg-muted/20 p-3"
                  >
                    <span className="mt-0.5 text-muted-foreground [&_svg]:size-4">
                      {item.icon}
                    </span>
                    <div className="min-w-0">
                      <p className="text-sm font-medium">{item.title}</p>
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {item.detail}
                      </p>
                    </div>
                  </div>
                ))}
                <p className="text-xs leading-relaxed text-muted-foreground sm:col-span-2">
                  Meta&rsquo;s setup lives under WhatsApp → Configuration in the
                  app dashboard.{" "}
                  <a
                    href="https://developers.facebook.com/docs/whatsapp/cloud-api/get-started"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-primary underline-offset-4 hover:underline"
                  >
                    Cloud API getting started
                    <ExternalLinkIcon className="size-3" />
                  </a>
                </p>
              </CardContent>
            </Card>
          ) : null}

          {/* The outbound channel, and a genuinely separate thing from lead
              capture above: this is the BSP that SENDS cart-recovery and COD
              templates. Same tab because it is the same product to anyone
              looking for it. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                Outbound messaging (cart recovery, COD)
              </CardTitle>
              <p className="text-sm text-muted-foreground">
                The provider that sends template messages. Independent of lead
                capture above — an org can have one without the other, and a
                number already connected to this provider cannot also deliver
                Click-to-WhatsApp leads to us.
              </p>
            </CardHeader>
            <CardContent>
              <WhatsAppForm
                organisationId={org.id}
                integration={whatsappBsp?.success ? whatsappBsp.data : null}
              />
              {whatsappBsp?.success && whatsappBsp.data ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Connected {formatDateTime(whatsappBsp.data.created_at)}, last
                  updated {formatRelative(whatsappBsp.data.updated_at)}.
                </p>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {tab === "portal-99acres" ? (
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2.5">
              <ChannelTile channel="portal_99acres" className="size-8" />
              <div>
                <CardTitle className="text-base">99acres enquiries</CardTitle>
                <p className="text-sm text-muted-foreground">
                  Not built yet.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="grid gap-2 text-sm leading-relaxed text-muted-foreground">
            <p>
              99acres publishes no developer documentation. Every CRM integrates
              it the same way: 99acres posts each enquiry to a URL their account
              manager registers, with field names that vary per seller account.
            </p>
            <p className="font-medium text-foreground">
              What unblocks the build
            </p>
            <ul className="ml-4 grid list-disc gap-1.5">
              <li>The client&rsquo;s seller account with lead API access</li>
              <li>Their 99acres RM to register our webhook address</li>
              <li>
                <strong>One sample payload from a live enquiry</strong> — the
                hard blocker. The first real enquiry is the spec.
              </li>
            </ul>
          </CardContent>
        </Card>
      ) : null}

      {tab === "voice" ? (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Provider connection</CardTitle>
              <p className="text-sm text-muted-foreground">
                The API credentials and default agent for this workspace. The
                owner sees a read-only status card — all config lives here.
              </p>
            </CardHeader>
            <CardContent>
              <VoiceAgentForm
                organisationId={org.id}
                integration={
                  voiceIntegration?.success ? voiceIntegration.data : null
                }
              />
              {voiceIntegration?.success && voiceIntegration.data ? (
                <p className="mt-3 text-[11px] text-muted-foreground">
                  Connected {formatDateTime(voiceIntegration.data.created_at)},
                  last updated {formatRelative(voiceIntegration.data.updated_at)}.
                </p>
              ) : null}
            </CardContent>
          </Card>

          {voiceAgents?.success ? (
            <div className="grid gap-3">
              <div>
                <h2 className="font-heading text-base font-semibold">Agents</h2>
                <p className="text-sm text-muted-foreground">
                  The agents that route inbound calls into this workspace. One
                  agent belongs to one workspace; the provider verifies ownership
                  before linking.
                </p>
              </div>
              <VoiceAgentsManager
                organisationId={org.id}
                agents={voiceAgents.data}
                defaultAgentId={
                  voiceIntegration?.success
                    ? (voiceIntegration.data?.agent_id ?? null)
                    : null
                }
                integrationReady={Boolean(
                  voiceIntegration?.success && voiceIntegration.data?.enabled,
                )}
              />
            </div>
          ) : voiceAgents ? (
            <ErrorCard>{voiceAgents.error}</ErrorCard>
          ) : null}
        </>
      ) : null}

      {tab === "shopify" ? (
        <>
          <ShopifyConnectForm
            organisationId={org.id}
            status={shopifyStatus?.success ? shopifyStatus.data : null}
          />
          <Card>
            <CardHeader>
              <CardTitle className="text-base">COD Confirmation</CardTitle>
              <p className="text-sm text-muted-foreground">
                The voice agent that calls Cash-on-Delivery customers to
                reconfirm their order. The workspace owner controls timing and
                the on/off switch under Campaigns → COD Confirmation; the agent
                is set here.
              </p>
            </CardHeader>
            <CardContent>
              {codAgent?.success ? (
                <CodAgentForm organisationId={org.id} data={codAgent.data} />
              ) : (
                <p className="text-sm text-destructive">
                  {codAgent?.error ?? "Could not load the COD agent"}
                </p>
              )}
            </CardContent>
          </Card>
        </>
      ) : null}
    </div>
  );
}

function tabHref(orgId: string, tab: Tab): string {
  const base = `/admin/organisations/${orgId}/integrations`;
  return tab === "google-ads" ? base : `${base}?tab=${tab}`;
}
