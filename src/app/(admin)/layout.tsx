import { requireAdmin } from "@/lib/auth/admin";
import { AdminSidebar } from "@/components/admin/admin-sidebar";

export const metadata = { title: "Admin · Skello" };

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await requireAdmin();

  return (
    <div className="grid min-h-screen w-full grid-cols-[260px_1fr] bg-background">
      <AdminSidebar email={session.email} />
      <main className="flex-1 overflow-y-auto bg-muted/30 px-6 py-8 md:px-8 lg:px-10">
        <div className="mx-auto w-full max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
