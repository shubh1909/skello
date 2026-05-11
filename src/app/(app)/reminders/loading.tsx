import {
  FilterTabsSkeleton,
  InfiniteScrollFooterSkeleton,
  ListSkeleton,
  PageHeaderSkeleton,
} from "@/components/app/skeletons";

export default function RemindersLoading() {
  return (
    <div className="flex flex-col gap-6">
      <PageHeaderSkeleton actionCount={1} />
      <FilterTabsSkeleton count={3} />
      <ListSkeleton rows={6} />
      <InfiniteScrollFooterSkeleton />
    </div>
  );
}
