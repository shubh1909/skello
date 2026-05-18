import { countLeadCallActivity } from "@/actions/lead-activity";
import { requireSession } from "@/lib/auth/session";
import { Topbar } from "@/components/app/topbar";
import { SidebarNav } from "@/components/app/sidebar-nav";
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

  return (
    <AppShellProvider>
      <AppShellGrid>
        <SidebarNav
          organisationName={session.organisation.name}
          organisationSlug={session.organisation.slug}
          uniqueLeadCount={uniqueLeadCount}
        />
        <div className="flex min-w-0 flex-col">
          <Topbar
            email={session.email}
            organisationId={session.organisation.id}
            leftSlot={<SidebarToggle />}
          />
          <main className="flex-1 overflow-y-auto bg-muted/30 px-6 py-8 md:px-8 lg:px-10">
            <div className="mx-auto w-full max-w-screen-2xl">{children}</div>
          </main>
        </div>
      </AppShellGrid>
    </AppShellProvider>
  );
}
