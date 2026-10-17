import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, LayoutDashboard } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Page not found" };

// Same navy shell as /signin, so a dead link still feels like CODE.
export default function NotFound() {
	return (
		<main className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-primary px-5 py-12 text-white">
			<div className="absolute inset-0 -z-20 bg-[radial-gradient(90%_70%_at_80%_10%,rgba(144,180,204,0.24),transparent_55%)]" />
			<div className="w-full max-w-sm text-center">
				<span className="mx-auto grid size-16 place-items-center rounded-full bg-white">
					<Image src="/code-falcon-transparent.png" alt="CODE" width={44} height={49} priority className="h-12 w-auto object-contain" />
				</span>
				<p className="mt-8 font-heading text-8xl leading-none text-[#90B4CC]">404</p>
				<h1 className="mt-4 font-heading text-4xl">This page flew off</h1>
				<p className="mt-3 text-sm leading-6 text-white/65">
					The link may be old, mistyped, or the page has moved. Pick a place to land instead.
				</p>
				<div className="mt-8 grid gap-3 sm:grid-cols-2">
					<Link href="/" className={buttonVariants({ variant: "secondary", className: "bg-white text-primary hover:bg-white/90" })}>
						<ArrowLeft aria-hidden />
						Back to home
					</Link>
					<Link
						href="/portal"
						className={buttonVariants({ variant: "outline", className: "border-white/25 bg-white/[0.04] text-white hover:bg-white/10 hover:text-white" })}
					>
						<LayoutDashboard aria-hidden />
						Go to portal
					</Link>
				</div>
			</div>
		</main>
	);
}
