import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaBand({ title = "Have an organization you want to develop?", body = "Tell us your context. We will tailor an engagement to your organization.", cta = "Get in touch", href = "/contact" }: { title?: string; body?: string; cta?: string; href?: string }) {
	return (
		<section className="bg-[#D7DFE9]/45">
			<div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 sm:py-20 lg:px-8">
				<div className="relative isolate overflow-hidden rounded-xl bg-primary p-8 text-white sm:p-12 lg:p-16">
					<div className="max-w-2xl"><h2 className="text-balance font-heading text-3xl leading-tight sm:text-4xl">{title}</h2><p className="mt-4 max-w-xl text-base leading-7 text-white/70">{body}</p><Button asChild variant="secondary" className="mt-7"><Link href={href}>{cta}<ArrowRight /></Link></Button></div>
				</div>
			</div>
		</section>
	);
}
