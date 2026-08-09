import { countLeadCallActivity } from "@/actions/lead-activity";
import { requireSession } from "@/lib/auth/session";
import { Topbar } from "@/components/app/topbar";
import { SidebarNav } from "@/components/app/sidebar-nav";
import { MobileNav } from "@/components/app/mobile-nav";
import {
  AppShellGrid,
  AppShellProvider,
  SidebarToggle,
} from "@/components/app/app-shell";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const uniqueResult = await countLeadCallActivity({
    org_slug: session.organisation.slug,
    include_zero_calls: true,
  });
  const uniqueLeadCount = uniqueResult.success ? uniqueResult.data : 0;

  const nav = {
    organisationName: session.organisation.name,
    organisationSlug: session.organisation.slug,
    uniqueLeadCount,
  };

  return (
    <AppShellProvider>
      <AppShellGrid>
        <SidebarNav {...nav} />
        <div className="flex min-w-0 flex-col">
          <Topbar
            email={session.email}
            organisationId={session.organisation.id}
            orgSlug={session.organisation.slug}
            leftSlot={
              <>
                {/* Below md the aside is gone entirely; the drawer is the only
                    navigation there. */}
                <MobileNav {...nav} />
                <SidebarToggle />
              </>
            }
          />
          <main className="flex-1 overflow-y-auto bg-muted/30 px-4 py-6 md:px-8 md:py-8 lg:px-10">
            <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
          </main>
        </div>
      </AppShellGrid>
    </AppShellProvider>
  );
}
