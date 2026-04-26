import { listLeads } from "@/actions/leads";
import { requireSession } from "@/lib/auth/session";
import { Topbar } from "@/components/app/topbar";
import { SidebarNav } from "@/components/app/sidebar-nav";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireSession();

  const leadsResult = await listLeads({
    org_slug: session.organisation.slug,
    limit: 1,
    offset: 0,
  });
  const leadCount = leadsResult.success ? leadsResult.data.total : 0;

  return (
    <div className="grid min-h-screen w-full grid-cols-[260px_1fr] bg-background">
      <SidebarNav
        organisationName={session.organisation.name}
        organisationSlug={session.organisation.slug}
        leadCount={leadCount}
      />
      <div className="flex min-w-0 flex-col">
        <Topbar
          email={session.email}
          organisationId={session.organisation.id}
        />
        <main className="flex-1 overflow-y-auto bg-muted/30 px-6 py-8 md:px-8 lg:px-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
