import Image from "next/image";
import type { GuideImage } from "@/lib/guides/content";
import { cn } from "@/lib/utils";

// Intrinsic sizes of the 2x captures (375x812 phone, 1280x800 desktop).
const SIZE = { phone: { width: 750, height: 1624 }, desktop: { width: 2560, height: 1600 } } as const;

const NUMBER = "grid shrink-0 place-items-center rounded-full bg-primary font-semibold tabular-nums text-primary-foreground";
// White ring keeps the pin readable on the dark header and scanner shots; the soft halo marks it as a target.
const PIN_RING = "shadow-[0_0_0_2px_#fff,0_0_0_5px_rgb(73_134_172/0.35),0_2px_6px_rgb(6_25_47/0.35)]";

/**
 * A screenshot in a phone or browser frame, with numbered pins and a matching legend. The pins only repeat the legend,
 * so they are hidden from assistive tech and the legend carries the content.
 */
export function AnnotatedShot({ image }: { image: GuideImage }) {
	const phone = image.device === "phone";

	const shot = (
		<div className="relative">
			<Image
				src={image.src}
				alt={image.alt}
				{...SIZE[image.device]}
				sizes={phone ? "280px" : "(min-width: 768px) 720px, calc(100vw - 5rem)"}
				className={cn("block h-auto w-full", phone && "rounded-[1.75rem]")}
			/>
			{image.callouts.map((callout, index) => (
				<span
					key={index}
					aria-hidden="true"
					className={cn(NUMBER, PIN_RING, "absolute size-5 -translate-x-1/2 -translate-y-1/2 text-[11px]")}
					style={{ left: `${callout.x}%`, top: `${callout.y}%` }}
				>
					{index + 1}
				</span>
			))}
		</div>
	);

	return (
		<figure className={cn("grid min-w-0 gap-5", phone && "sm:grid-cols-[300px_minmax(0,1fr)] sm:items-center sm:gap-8")}>
			{phone ? (
				<div className="mx-auto w-full max-w-[300px] rounded-[2.5rem] bg-neutral-900 p-3 shadow-xl shadow-primary/15 ring-1 ring-black/5">{shot}</div>
			) : (
				<div className="min-w-0 overflow-hidden rounded-xl border border-border bg-card shadow-sm">
					<div aria-hidden="true" className="flex items-center gap-3 border-b border-border bg-secondary/60 px-3 py-2">
						<span className="flex w-10 shrink-0 gap-1.5">
							<span className="size-2.5 rounded-full bg-muted-foreground/35" />
							<span className="size-2.5 rounded-full bg-muted-foreground/35" />
							<span className="size-2.5 rounded-full bg-muted-foreground/35" />
						</span>
						<span className="mx-auto min-w-0 truncate rounded-full bg-background px-3 py-0.5 text-center text-[11px] text-muted-foreground sm:px-6">
							ateneocode.org/portal
						</span>
						<span className="w-10 shrink-0" />
					</div>
					{shot}
				</div>
			)}
			{image.callouts.length > 0 ? (
				<figcaption className="min-w-0">
					<ol className={cn("grid min-w-0 gap-3 text-sm", !phone && "sm:grid-cols-2 sm:gap-x-6")}>
						{image.callouts.map((callout, index) => (
							<li key={index} className="flex min-w-0 items-start gap-2.5">
								<span className={cn(NUMBER, "size-5 text-[11px]")}>{index + 1}</span>
								<span className="min-w-0 leading-5 [overflow-wrap:anywhere]">{callout.label}</span>
							</li>
						))}
					</ol>
				</figcaption>
			) : null}
		</figure>
	);
}
