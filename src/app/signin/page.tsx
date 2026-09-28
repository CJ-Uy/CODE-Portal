import Image from "next/image";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { signIn } from "@/auth";
import { Button } from "@/components/ui/button";
import { getGoogleAuthorizationParams } from "@/server/auth/access";

export default async function SignInPage({
	searchParams,
}: {
	searchParams: Promise<{ error?: string; email?: string }>;
}) {
	const { error, email } = await searchParams;
	const notMember = error === "NotMember" && email;

	return <main className="relative isolate grid min-h-screen place-items-center overflow-hidden bg-primary px-5 py-12 text-white"><div className="absolute inset-0 -z-20 bg-[radial-gradient(90%_70%_at_80%_10%,rgba(144,180,204,0.24),transparent_55%)]" /><div className="w-full max-w-sm"><span className="mx-auto grid size-16 place-items-center rounded-full bg-white"><Image src="/code-falcon-transparent.png" alt="CODE" width={44} height={49} priority className="h-12 w-auto object-contain" /></span><section className="mt-7 rounded-xl border border-white/15 bg-white/[0.04] p-7 backdrop-blur sm:p-8"><p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#90B4CC]">Member access</p><h1 className="mt-3 font-heading text-4xl">{notMember ? "You don’t have member access yet" : "Welcome back"}</h1><p className="mt-3 text-sm leading-6 text-white/65">{notMember ? <><strong className="font-semibold text-white">{email}</strong> is not registered as a CODE member. Ask a CODE admin to add this email to the current member list, then try again.</> : "Sign in with your approved Google account to enter the member portal."}</p><form className="mt-7" action={async () => { "use server"; await signIn("google", { redirectTo: "/portal" }, getGoogleAuthorizationParams(error)); }}><Button variant="secondary" className="w-full bg-white text-primary hover:bg-white/90" type="submit"><GoogleIcon />{notMember ? "Try another Google account" : "Continue with Google"}</Button></form></section><Link href="/" className="mt-6 flex items-center justify-center gap-2 text-sm font-semibold text-[#90B4CC] hover:text-white"><ArrowLeft className="size-4" />Back to the public site</Link></div></main>;
}

function GoogleIcon() {
	return <svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.4 5.4 2.5 13.3l7.8 6c1.9-5.6 7.1-9.8 13.7-9.8z"/><path fill="#4285F4" d="M46.5 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.7c-.5 3-2.2 5.5-4.7 7.2l7.3 5.7c4.3-3.9 6.8-9.7 6.8-17.4z"/><path fill="#FBBC05" d="M10.3 28.3c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.8-6C.9 16.2 0 20 0 24s.9 7.8 2.5 11l7.8-6.7z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.7 2.3-8.6 2.3-6.6 0-12.2-4.2-14.1-9.9l-7.8 6C6.4 42.6 14.6 48 24 48z"/></svg>;
}
