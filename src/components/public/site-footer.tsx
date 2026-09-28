import Image from "next/image";
import Link from "next/link";
import { ORG } from "@/content/site";

export function SiteFooter() {
	return (
		<footer className="bg-primary text-white">
			<div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-[1.5fr_1fr_1fr] lg:px-8">
				<div>
					<Image src="/code-logo-full-white.png" alt="CODE" width={148} height={50} className="h-auto" />
					<p className="mt-4 max-w-sm text-sm leading-6 text-white/65">{ORG.full}</p>
				</div>
				<div className="text-sm"><p className="font-semibold text-white">Explore</p><ul className="mt-3 grid gap-2 text-white/65"><li><Link className="hover:text-white" href="/services">Services</Link></li><li><Link className="hover:text-white" href="/projects">Projects</Link></li><li><Link className="hover:text-white" href="/product">Product Center</Link></li><li><Link className="hover:text-white" href="/contact">Contact</Link></li></ul></div>
				<div className="text-sm"><p className="font-semibold text-white">Reach us</p><ul className="mt-3 grid gap-2 text-white/65"><li><a className="break-all hover:text-white" href={`mailto:${ORG.email}`}>{ORG.email}</a></li><li><a className="hover:text-white" href={ORG.fbUrl} target="_blank" rel="noreferrer">{ORG.fb}</a></li><li>{ORG.room}</li></ul></div>
			</div>
			<div className="border-t border-white/10"><div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-4 text-xs text-white/50 sm:flex-row sm:justify-between sm:px-6 lg:px-8"><p>© {new Date().getFullYear()} {ORG.name}. {ORG.campus}.</p><Link className="hover:text-white" href="/signin">Member sign in</Link></div></div>
		</footer>
	);
}
