"use client";

import { useEffect } from "react";

/**
 * Some iOS versions save the page that was open when "Add to Home Screen" was tapped, not the manifest's
 * start_url. If the app was added from this page, opening it should land in the portal, not the instructions.
 */
export function StandaloneRedirect() {
	useEffect(() => {
		const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
		if (standalone) window.location.replace("/portal");
	}, []);
	return null;
}
