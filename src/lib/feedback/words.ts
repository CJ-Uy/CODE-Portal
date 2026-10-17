// English plus Filipino/Taglish filler. Tokens under 3 chars are dropped anyway;
// the short ones stay listed so the set is a complete reference.
export const STOPWORDS: ReadonlySet<string> = new Set(
	(
		"a about above after again all also am an and any are as at be because been before being but by " +
		"can could did do does doing for from get got had has have he her here him his how i if in into is it its " +
		"just me more most my no not of on one only or other our out over really she should so some such than that " +
		"the their them then there these they this those through to too up us very was we were what when where " +
		"which while who why will with would you your " +
		// Contraction fragments: "didn't" splits into "didn" + "t".
		"aren couldn didn doesn don hasn haven isn shouldn wasn weren won wouldn " +
		"akin akong ako amin ang at ay baka bakit dahil din dito doon gaya hindi iba ito kami kanila kapag kasi " +
		"kaya ko lang lahat mga mo na naman nang nga niya niyo ng pa pala para pati pero po rin sa sila siya " +
		"sobra sobrang tayo yan yang yun yung talaga " +
		"dapat ganito ganun iyan kaso kung mag mas masyadong may medyo namin natin nila nito pag parang sana tapos wala"
	).split(/\s+/),
);

const NUMERIC = /^\p{N}+$/u;

export function tokens(text: string): Set<string> {
	const out = new Set<string>();
	for (const raw of text.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
		if (raw.length < 3 || NUMERIC.test(raw) || STOPWORDS.has(raw)) continue;
		out.add(raw);
	}
	return out;
}

/** `count` is the number of answers containing the term, so one long rant cannot dominate. */
export function topTerms(texts: string[], limit = 30): Array<{ term: string; count: number }> {
	const counts = new Map<string, number>();
	for (const text of texts) {
		for (const term of tokens(text)) counts.set(term, (counts.get(term) ?? 0) + 1);
	}
	return [...counts]
		.map(([term, count]) => ({ term, count }))
		.sort((a, b) => b.count - a.count || (a.term < b.term ? -1 : a.term > b.term ? 1 : 0))
		.slice(0, limit);
}
