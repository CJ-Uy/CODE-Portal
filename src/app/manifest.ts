import type { MetadataRoute } from "next";

// Installable app shell. Chrome and Safari install from the manifest alone, so there is no service
// worker: caching signed-in portal pages offline would risk showing one member's data to the next.
export default function manifest(): MetadataRoute.Manifest {
	return {
		id: "/portal",
		name: "Ateneo CODE",
		short_name: "CODE",
		description: "The Ateneo CODE member portal.",
		start_url: "/portal",
		scope: "/",
		display: "standalone",
		background_color: "#f5f5f6",
		theme_color: "#06192f",
		icons: [
			{ src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
			{ src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
			{ src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
		],
	};
}
