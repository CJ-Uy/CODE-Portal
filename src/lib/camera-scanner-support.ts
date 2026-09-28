export function canUseCameraScanner(nav: Navigator | undefined = typeof navigator === "undefined" ? undefined : navigator) {
	return Boolean(nav?.mediaDevices?.getUserMedia);
}
