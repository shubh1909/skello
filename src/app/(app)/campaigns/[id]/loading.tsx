import {
  PageHeaderSkeleton,
  StatCardGridSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Loading state for the campaign detail page. Mirrors the default (Performance)
// tab layout — back link, header, the two tabs, headline stat cards, the
// funnel/outcomes chart pair, and a table — so the page shape is stable while
// getCampaign + getCampaignStats resolve. Also covers soft navigations between
// the Performance and Calls tabs (search-param changes that re-render here).
export default function CampaignDetailLoading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Back to campaigns */}
      <Skeleton className="h-8 w-40" />

      <PageHeaderSkeleton actionCount={1} />

      {/* Tabs nav (Performance | Calls) */}
      <nav className="flex items-center gap-1 border-b border-border/60">
        <Skeleton className="mb-2 h-7 w-28" />
        <Skeleton className="mb-2 h-7 w-20" />
      </nav>

      {/* Headline rates */}
      <StatCardGridSkeleton />

      {/* Funnel + outcomes */}
      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Card key={i} className="gap-4 p-5">
            <div className="flex items-center gap-2">
              <Skeleton className="size-4 rounded-sm" />
              <Skeleton className="h-4 w-28" />
            </div>
            <div className="space-y-3">
              {Array.from({ length: 4 }).map((_, r) => (
                <Skeleton key={r} className="h-2.5 w-full rounded-full" />
              ))}
            </div>
          </Card>
        ))}
      </section>

      <TableSkeleton rows={6} columns={5} />
    </div>
  );
}
