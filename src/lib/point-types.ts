/**
 * The Retention point type always exists and cannot be retired. It is an ordinary
 * point type in every other respect; retention progress is the sum of records carrying this id.
 */
export const RETENTION_POINT_TYPE_ID = "pt_retention";

/** Grace window applied when an event sets no explicit `graceMinutes`. */
export const DEFAULT_GRACE_MINUTES = 15;
