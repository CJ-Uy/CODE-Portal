import { describe, expect, it } from "vitest";
import {
	defaultFormat,
	defaultPublicReadiness,
	defaultSource,
	ENGAGEMENT_TYPES,
	FORMAT_DETAILS,
	KIND_LABELS,
	LIBRARY_KINDS,
	normalizeDocType,
	normalizeEngagementType,
	SOURCE_LABELS,
	splitAuthors,
	splitTopics,
	SUBTYPES,
	TAG_GROUPS,
} from "./taxonomy";

describe("normalizeDocType", () => {
	it("normalizes sheet document types", () => {
		expect(normalizeDocType("Module: SLE")).toEqual({ subtype: "Module", formatDetail: "SLE", extraFormats: [] });
		expect(normalizeDocType("Module: Lecture, SLE")).toEqual({
			subtype: "Module",
			formatDetail: "Lecture",
			extraFormats: ["SLE"],
		});
		expect(normalizeDocType("IDF: Sample Training Seminar")).toEqual({
			subtype: "IDF",
			formatDetail: null,
			extraFormats: [],
		});
		expect(normalizeDocType("Lectivity")).toEqual({ subtype: "Module", formatDetail: "Lectivity", extraFormats: [] });
		expect(normalizeDocType("Topic Resource")).toEqual({
			subtype: "Topic Resource",
			formatDetail: null,
			extraFormats: [],
		});
		expect(normalizeDocType("Module: Lecture Workship").formatDetail).toBe("Lecture"); // typo maps by prefix
	});

	it("treats a bare Module as having no format", () => {
		expect(normalizeDocType("Module")).toEqual({ subtype: "Module", formatDetail: null, extraFormats: [] });
	});

	it("never gives an IDF a format, whatever follows", () => {
		expect(normalizeDocType("IDF")).toEqual({ subtype: "IDF", formatDetail: null, extraFormats: [] });
		expect(normalizeDocType("IDF: SLE")).toEqual({ subtype: "IDF", formatDetail: null, extraFormats: [] });
	});

	it("maps unrecognised and compound formats to Other", () => {
		expect(normalizeDocType("Module: Mystery").formatDetail).toBe("Other");
		expect(normalizeDocType("Module: SLExtivity").formatDetail).toBe("Other");
		expect(normalizeDocType("Module: LectavLE").formatDetail).toBe("Other");
	});

	it("matches case-insensitively and returns canonical casing", () => {
		expect(normalizeDocType("module: learning circle")).toEqual({
			subtype: "Module",
			formatDetail: "Learning Circle",
			extraFormats: [],
		});
		expect(normalizeDocType("idf: x").subtype).toBe("IDF");
		expect(normalizeDocType("topic resource").subtype).toBe("Topic Resource");
	});

	it("keeps only recognised, distinct extra formats", () => {
		expect(normalizeDocType("Module: SLE, FGD, Mystery, FGD, SLE")).toEqual({
			subtype: "Module",
			formatDetail: "SLE",
			extraFormats: ["FGD"],
		});
	});

	it("does not invent a subtype for empty or unrecognised bare text", () => {
		expect(normalizeDocType("")).toEqual({ subtype: null, formatDetail: null, extraFormats: [] });
		expect(normalizeDocType("Whatever")).toEqual({ subtype: null, formatDetail: null, extraFormats: [] });
	});
});

describe("normalizeEngagementType", () => {
	it("normalizes engagement types", () => {
		expect(normalizeEngagementType("C-team")).toBe("C-Team");
		expect(normalizeEngagementType("N/A")).toBeNull();
		expect(normalizeEngagementType(undefined)).toBeNull();
	});

	it("handles case, whitespace, null and the other types", () => {
		expect(normalizeEngagementType(" ste ")).toBe("STE");
		expect(normalizeEngagementType("LTE")).toBe("LTE");
		expect(normalizeEngagementType(null)).toBeNull();
		expect(normalizeEngagementType("")).toBeNull();
	});
});

describe("splitTopics", () => {
	it("keeps known comma phrases together when splitting topics", () => {
		expect(
			splitTopics("Processes, Systems, and Structures (PSS), Teamwork", ["Processes, Systems, and Structures (PSS)"]),
		).toEqual(["Processes, Systems, and Structures (PSS)", "Teamwork"]);
	});

	it("splits on commas, semicolons and newlines, trims and drops empties", () => {
		expect(splitTopics(" a ,b;; c\n\nd , ", [])).toEqual(["a", "b", "c", "d"]);
	});

	it("matches known phrases case-insensitively and returns the canonical form", () => {
		expect(splitTopics("teamwork, processes, systems, and structures (pss)", ["Processes, Systems, and Structures (PSS)"])).toEqual([
			"teamwork",
			"Processes, Systems, and Structures (PSS)",
		]);
	});

	it("de-duplicates case-insensitively and keeps the first appearance", () => {
		expect(splitTopics("Ideation, ideation; IDEATION\nFacilitation", [])).toEqual(["Ideation", "Facilitation"]);
	});

	it("protects a longer known phrase that contains a shorter one", () => {
		expect(splitTopics("A, B, C, D", ["A, B", "A, B, C"])).toEqual(["A, B, C", "D"]);
	});

	it("returns an empty list for blank input", () => {
		expect(splitTopics("  \n ", ["x"])).toEqual([]);
	});
});

describe("splitAuthors", () => {
	it("splits CODEr authors on commas but readings only on newlines", () => {
		expect(splitAuthors("Ana Reyes, Ben Cruz", "code_document")).toEqual(["Ana Reyes", "Ben Cruz"]);
		expect(splitAuthors("Doe, Jane\nRoe, Richard", "reading")).toEqual(["Doe, Jane", "Roe, Richard"]);
	});

	it("also splits CODEr authors on newlines and drops empties", () => {
		expect(splitAuthors("A One\nB Two,, C Three\r\n", "code_document")).toEqual(["A One", "B Two", "C Three"]);
		expect(splitAuthors("\nOnly, One\n\n", "reading")).toEqual(["Only, One"]);
	});
});

describe("taxonomy constants", () => {
	it("has 37 starting tags in 7 groups with no duplicates", () => {
		const all = TAG_GROUPS.flatMap((g) => g.tags);
		expect(TAG_GROUPS).toHaveLength(7);
		expect(all).toHaveLength(37);
		expect(new Set(all.map((t) => t.toLowerCase())).size).toBe(37);
	});

	it("lists the tag groups and tags verbatim, in order", () => {
		expect(TAG_GROUPS).toEqual([
			{
				group: "Direction & Strategy",
				tags: ["Vision & Mission (VMOS)", "Strategic Planning", "Goal Setting", "Alignment", "Advocacy"],
			},
			{
				group: "Structure & Systems",
				tags: [
					"Org Design",
					"Processes, Systems & Structures (PSS)",
					"Constitution & Internal Rules",
					"Roles & Responsibilities",
					"Systems Thinking",
				],
			},
			{
				group: "Diagnosis & Change",
				tags: [
					"Diagnosis",
					"Change Management",
					"Root Cause Analysis",
					"Monitoring & Evaluation",
					"Stakeholder Analysis",
				],
			},
			{
				group: "People & Culture",
				tags: [
					"Org Culture",
					"Member Engagement",
					"Motivation",
					"Teamwork & Collaboration",
					"Accountability",
					"Communication & Feedback",
					"Well-being & Burnout",
					"Diversity & Inclusion",
				],
			},
			{
				group: "Leadership",
				tags: ["Leadership", "Self-Awareness & Growth", "Transitions & Turnover"],
			},
			{
				group: "Methods",
				tags: [
					"Design Thinking / HCD",
					"Design Sprint",
					"Behavioral Design",
					"Facilitation",
					"Appreciative Inquiry",
					"Ideation",
					"Project Management",
					"Module Design",
					"Problem Solving",
				],
			},
			{
				group: "Member Writing",
				tags: ["Tech & Digital Tools", "Career & Skills"],
			},
		]);
	});

	it("labels every kind and source", () => {
		expect(Object.keys(KIND_LABELS).sort()).toEqual([...LIBRARY_KINDS].sort());
		expect(KIND_LABELS.code_document).toBe("Module/IDF");
		expect(KIND_LABELS.reading).toBe("Book/paper");
		expect(KIND_LABELS.case_study).toBe("Case study");
		expect(SOURCE_LABELS).toEqual({ code: "Made by CODE", member: "From members", outside: "From outside" });
	});

	it("exposes the subtype, format and engagement vocabularies", () => {
		expect(SUBTYPES.code_document).toEqual(["IDF", "Module", "Topic Resource"]);
		expect(SUBTYPES.reading).toEqual(["Book", "Academic Article", "Report", "Other"]);
		expect(FORMAT_DETAILS).toHaveLength(11);
		expect(ENGAGEMENT_TYPES).toEqual(["STE", "LTE", "C-Team"]);
	});

	it("derives defaults from the kind", () => {
		expect(LIBRARY_KINDS.map(defaultFormat)).toEqual(["file", "file", "page", "page", "page", "page", "file", "link"]);
		expect(LIBRARY_KINDS.map(defaultSource)).toEqual([
			"code",
			"code",
			"code",
			"code",
			"member",
			"code",
			"outside",
			"outside",
		]);
		expect(LIBRARY_KINDS.map(defaultPublicReadiness)).toEqual([
			null,
			null,
			null,
			null,
			null,
			null,
			"not_eligible",
			"not_eligible",
		]);
	});
});
