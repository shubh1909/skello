import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  PageHeaderSkeleton,
  StatCardGridSkeleton,
} from "@/components/app/skeletons";

export default function DashboardLoading() {
  return (
    <div className="flex flex-col gap-8">
      <PageHeaderSkeleton actionCount={1} />
      <StatCardGridSkeleton count={4} />
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <ChartCardSkeleton />
        <ChartCardSkeleton />
      </div>
    </div>
  );
}

function ChartCardSkeleton() {
  return (
    <Card className="gap-4 p-6">
      <div className="flex items-center gap-2">
        <Skeleton className="size-5 rounded-md" />
        <div className="space-y-1.5">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-3 w-56" />
        </div>
      </div>
      <Skeleton className="mt-2 h-44 w-full" />
    </Card>
  );
}
