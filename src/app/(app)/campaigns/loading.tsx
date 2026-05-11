import {
  InfiniteScrollFooterSkeleton,
  PageHeaderSkeleton,
  StatCardGridSkeleton,
  TableSkeleton,
} from "@/components/app/skeletons";

export default function CampaignsLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton actionCount={1} />
      <StatCardGridSkeleton />
      <TableSkeleton rows={8} columns={8} />
      <InfiniteScrollFooterSkeleton />
    </div>
  );
}
