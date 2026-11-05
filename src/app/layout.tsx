import type { Metadata, Viewport } from "next";
import { Source_Sans_3, Unna } from "next/font/google";
import "./globals.css";

const sourceSans = Source_Sans_3({
	variable: "--font-source-sans",
	subsets: ["latin"],
	weight: ["400", "600", "700"],
});

const unna = Unna({
	variable: "--font-unna",
	subsets: ["latin"],
	weight: ["400", "700"],
	style: ["normal", "italic"],
});

export const metadata: Metadata = {
	title: { default: "Ateneo CODE", template: "%s · Ateneo CODE" },
	description: "Ateneo CODE public site and member portal.",
	// Lets iPhone "Add to Home Screen" open the portal full screen, like an installed app.
	appleWebApp: { capable: true, title: "CODE", statusBarStyle: "default" },
};

export const viewport: Viewport = { themeColor: "#06192f" };

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body className={`${sourceSans.variable} ${unna.variable} antialiased`}>{children}</body>
		</html>
	);
}
