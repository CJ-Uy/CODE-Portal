type SelectablePointType = {
	id: string;
	key: string;
	active: boolean;
	position: number;
	retentionPeriod?: string | null;
};

/** The requested type when it exists, else the first retention part, else the first type. */
export function selectLeaderboardPointTypeId(
	requested: string | undefined,
	types: SelectablePointType[],
): string | null {
	if (requested && types.some((type) => type.id === requested)) return requested;
	const parts = types.filter((type) => type.retentionPeriod).sort((a, b) => a.position - b.position);
	return parts[0]?.id ?? types[0]?.id ?? null;
}
