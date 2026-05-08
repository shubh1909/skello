import { ShieldCheckIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { UserRowActions } from "@/components/admin/user-row-actions";
import { requireAdmin } from "@/lib/auth/admin";
import { listAllUsers } from "@/actions/admin/users";
import { formatRelative } from "@/lib/format";

export const metadata = { title: "Users · Admin · Skelo" };

export default async function AdminUsersPage() {
  const session = await requireAdmin();
  const result = await listAllUsers();
  if (!result.success) {
    return (
      <Card className="border-destructive/40 p-6 text-sm text-destructive">
        {result.error}
      </Card>
    );
  }
  const users = result.data;

  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-1.5">
        <h1 className="font-heading text-2xl font-semibold leading-tight tracking-tight md:text-3xl">
          Users
        </h1>
        <p className="text-sm leading-relaxed text-muted-foreground">
          Everyone who can sign in. Promote a user to admin to grant access to
          this console.
        </p>
      </header>

      <Card className="overflow-hidden p-0">
        {users.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center">
            <ShieldCheckIcon className="size-5 text-muted-foreground" />
            <p className="font-medium">No users yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border/60 bg-muted/30">
                <tr className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="px-3 py-3 font-medium">
                    Email
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Role
                  </th>
                  <th scope="col" className="px-3 py-3 font-medium">
                    Joined
                  </th>
                  <th scope="col" className="px-3 py-3 text-right font-medium">
                    Actions
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="align-middle transition-colors hover:bg-muted/40"
                  >
                    <td className="px-3 py-3">
                      <div className="flex flex-col">
                        <span className="truncate font-medium">
                          {u.email ?? "—"}
                        </span>
                        <span className="truncate font-mono text-[10px] text-muted-foreground">
                          {u.id}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      {u.is_admin ? (
                        <Badge>Admin</Badge>
                      ) : (
                        <Badge variant="outline">Member</Badge>
                      )}
                    </td>
                    <td className="px-3 py-3 text-xs text-muted-foreground">
                      {formatRelative(u.created_at)}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <UserRowActions
                        userId={u.id}
                        isAdmin={u.is_admin}
                        isSelf={u.id === session.userId}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
