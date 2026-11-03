/**
 * The top of a member page: the nav label as the h1, at most one short line under it, and the page's
 * own actions on the right. No eyebrow; the rail and the top bar already say where the member is.
 */
export function PageHeader({
	title,
	description,
	actions,
}: {
	title: string;
	description?: React.ReactNode;
	actions?: React.ReactNode;
}) {
	return (
		<header className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
			<div className="min-w-0">
				<h1 className="font-heading text-3xl leading-tight">{title}</h1>
				{description ? <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
		</header>
	);
}
