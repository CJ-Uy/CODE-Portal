/**
 * What to log for an error on a feedback page. Error text can carry query parameters or model output, and both can hold
 * comment text, so a log line gets the error type only.
 */
export function errorLabel(error: unknown): string {
	return error instanceof Error ? error.name : typeof error;
}
