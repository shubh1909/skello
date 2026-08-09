import { requireAdmin } from "@/lib/auth/admin";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export const metadata = { title: "Admin · Skelo" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    // The sidebar is `hidden md:flex`, so a fixed `260px 1fr` left a dead
    // 260px gutter and a squeezed main column on every phone. The admin
    // console is desktop-only by design and has no drawer — but it should at
    // least use the full width when the nav isn't there.
    <div className="grid min-h-screen w-full grid-cols-[1fr] bg-background md:grid-cols-[260px_1fr]">
      <AdminSidebar email={session.email} />
      <main className="min-w-0 flex-1 overflow-y-auto bg-muted/30 px-4 py-6 md:px-8 md:py-8 lg:px-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
