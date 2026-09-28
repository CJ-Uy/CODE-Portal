import Image from "next/image";
import Link from "next/link";
import { KeyRound } from "lucide-react";

const NAV = [
	{ label: "Services", href: "/services" },
	{ label: "Projects", href: "/projects" },
	{ label: "Product Center", href: "/product" },
	{ label: "Contact", href: "/contact" },
];

export function SiteHeader() {
	return (
		<header className="sticky top-0 z-30 border-b border-border/70 bg-white/95 backdrop-blur">
			<div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
				<Link href="/" aria-label="CODE home" className="shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
					<Image src="/code-logo-full-navy.png" alt="CODE" width={132} height={45} priority className="h-auto w-[118px] sm:w-[132px]" />
				</Link>
				<nav className="hidden items-center gap-1 md:flex" aria-label="Primary navigation">
					{NAV.map((item) => <Link key={item.href} href={item.href} className="rounded-md px-3 py-2 text-sm font-semibold text-[#3D5266] transition-colors hover:bg-[#D7DFE9]/60 hover:text-primary">{item.label}</Link>)}
				</nav>
				<Link href="/signin" className="inline-flex items-center gap-2 rounded-md px-2 py-2 text-xs font-semibold text-[#717D89] transition-colors hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:px-3 sm:text-sm">
					<KeyRound className="size-4" />
					<span className="hidden sm:inline">Member sign in</span>
				</Link>
			</div>
			<nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-4 py-2 md:hidden" aria-label="Primary mobile navigation">
				{NAV.map((item) => <Link key={item.href} href={item.href} className="whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-semibold text-[#3D5266] hover:bg-[#D7DFE9]/60 hover:text-primary">{item.label}</Link>)}
			</nav>
		</header>
	);
}
