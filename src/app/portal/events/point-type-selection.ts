type SelectablePointType = {
	id: string;
	key: string;
	active: boolean;
	position: number;
};

export function selectLeaderboardPointTypeId(
	requested: string | undefined,
	types: SelectablePointType[],
): string | null {
	if (requested && types.some((type) => type.id === requested)) return requested;
	return types.find((type) => type.key === "retention")?.id ?? types[0]?.id ?? null;
}
