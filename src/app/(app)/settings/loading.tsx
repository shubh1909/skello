import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";

function FormCardSkeleton({ rows = 2 }: { rows?: number }) {
  return (
    <Card>
      <CardHeader>
        <Skeleton className="h-5 w-32" />
      </CardHeader>
      <CardContent className="grid gap-4">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="grid gap-1.5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export default function SettingsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <header className="space-y-2">
        <Skeleton className="h-8 w-32 md:h-9" />
        <Skeleton className="h-4 w-72" />
      </header>
      <FormCardSkeleton rows={2} />
      <Separator />
      <FormCardSkeleton rows={3} />
      <Separator />
      <FormCardSkeleton rows={2} />
    </div>
  );
}
