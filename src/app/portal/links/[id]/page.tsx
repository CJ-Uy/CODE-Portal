import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { getRepositories } from "@/db";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ClicksOverTime, BucketBars, formatBucket } from "@/components/links/charts";
import { LinkQrCustomizer } from "@/components/links/link-qr-customizer";
import { shortLinkUrl } from "@/components/links/urls";
import { requireActor } from "@/server/auth/actor";
import { getAppConfig } from "@/server/env";
import type { QrStyle } from "@/db/repositories/links";

export const dynamic = "force-dynamic";

function readQrStyle(value: string | null): QrStyle | undefined {
	if (!value) return undefined;
	try {
		return JSON.parse(value) as QrStyle;
	} catch {
		return undefined;
	}
}

export default async function LinkAnalyticsPage({ params }: { params: Promise<{ id: string }> }) {
	const actor = await requireActor();
	const { id } = await params;
	const repositories = await getRepositories();
	const stats = await repositories.links.getStats(actor, id).catch(() => null);
	if (!stats) notFound();

	const config = getAppConfig();
	const origin = config.APP_BASE_URL ?? "https://code.local";
	const url = shortLinkUrl(origin, stats.link.slug);
	const topReferrer = [...stats.referrers].sort((a, b) => b.count - a.count)[0]?.bucket ?? "None";
	const topDevice = [...stats.devices].sort((a, b) => b.count - a.count)[0]?.bucket ?? "None";
	const tiles = [
		{ label: "Filtered clicks", value: stats.filteredClicks },
		{ label: "Lifetime clicks", value: stats.lifetimeClicks },
		{ label: "Top source", value: topReferrer === "None" ? topReferrer : formatBucket(topReferrer) },
		{ label: "Top device", value: topDevice === "None" ? topDevice : formatBucket(topDevice) },
	];

	return (
		<div className="grid gap-5">
			<div>
				<Link href="/portal/links" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
					<ArrowLeft className="size-4" />
					Back to links
				</Link>
				<div className="mt-2 flex flex-wrap items-end justify-between gap-3">
					<div>
						<h1 className="font-heading text-3xl">{stats.link.title}</h1>
						<a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-accent hover:underline">
							/{stats.link.slug}
							<ExternalLink className="size-3.5" />
						</a>
					</div>
				</div>
			</div>

			<dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
				{tiles.map((tile) => (
					<div key={tile.label} className="rounded-xl border border-border bg-card p-4">
						<dt className="text-xs text-muted-foreground">{tile.label}</dt>
						<dd className="mt-1 truncate font-heading text-2xl text-foreground">{tile.value}</dd>
					</div>
				))}
			</dl>

			<div className="grid gap-5 lg:grid-cols-[1fr_320px]">
				<div className="grid gap-5">
					<Card>
						<CardHeader>
							<CardTitle>Clicks over time</CardTitle>
							<CardDescription>{stats.query.from} to {stats.query.to}, grouped by {stats.query.granularity} in {stats.query.timezone}.</CardDescription>
						</CardHeader>
						<CardContent>
							<ClicksOverTime data={stats.series} />
						</CardContent>
					</Card>
					<div className="grid gap-5 sm:grid-cols-2">
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Traffic source</CardTitle>
							</CardHeader>
							<CardContent>
								<BucketBars label="Traffic source" data={stats.referrers.map((row) => ({ ...row, bucket: formatBucket(row.bucket) }))} />
							</CardContent>
						</Card>
						<Card>
							<CardHeader>
								<CardTitle className="text-base">Devices</CardTitle>
							</CardHeader>
							<CardContent>
								<BucketBars label="Devices" data={stats.devices} />
							</CardContent>
						</Card>
					</div>
				</div>

				<Card>
					<CardHeader>
						<CardTitle>QR code</CardTitle>
						<CardDescription>Download a customized QR for this short link.</CardDescription>
					</CardHeader>
					<CardContent>
						<LinkQrCustomizer url={url} style={readQrStyle(stats.link.qrStyle)} editable={false} />
					</CardContent>
				</Card>
			</div>
		</div>
	);
}
