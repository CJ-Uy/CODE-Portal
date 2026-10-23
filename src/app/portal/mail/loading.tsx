import { RouteFallback } from "@/components/portal/route-fallback";
import { LoadingScreen, PageHeaderSkeleton, PageLoading, RowsSkeleton, Skeleton } from "@/components/ui/skeleton";

/** Mirrors the mail inbox: header with preferences link, then one divided list. */
function InboxLoading() {
	return (
		<LoadingScreen label="Loading mail" className="gap-5">
			<div className="flex flex-wrap items-end justify-between gap-3">
				<PageHeaderSkeleton />
				<Skeleton className="h-9 w-32 rounded-lg" />
			</div>
			<RowsSkeleton rows={6} className="rounded-xl" />
		</LoadingScreen>
	);
}

/** The inbox's shape on the inbox; a plain page for a message or preferences. */
export default function MailLoading() {
	return <RouteFallback path="/portal/mail" match={<InboxLoading />} other={<PageLoading />} />;
}
