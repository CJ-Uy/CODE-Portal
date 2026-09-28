// Public marketing site content, ported from design/data.jsx.
// ponytail: code-sourced for now. The public-pages spec calls for moving this
// into DB tables + an admin CMS later; pages read from here so that swap is a
// source-of-truth change, not a rewrite. Keep shapes stable when migrating.

export const ORG = {
	name: "Ateneo CODE",
	full: "Ateneo Consultants for Organization Development and Empowerment",
	tagline: "Consultants for Organization Development and Empowerment",
	ay: "A.Y. 2024–2025",
	email: "ateneocodeosg@gmail.com",
	fb: "fb.com/AteneoCODE",
	fbUrl: "https://fb.com/AteneoCODE",
	room: "Room 216, MVP Center for Student Leadership",
	campus: "Ateneo de Manila University",
	blurb:
		"A youth-led, non-profit organization conducting contextualized Organization Development (OD) services to empower youth organizations to better serve the nation.",
};

export const VISION =
	"We, the Ateneo Consultants for Organization Development and Empowerment, imbued with Ignatian Values, envision a society of developed individuals by forming sustainable environments conducive for people to flourish. Through the practice of Organization Development, we aim to form the Youth and Youth-Oriented Organizations who will initiate positive change within the community.";

export const MISSION =
	"Our mission is to empower the youth to continually develop their organizations and engage in nation-building. This is achieved through the promotion of Organization Development (OD) and the implementation of contextualized OD services by our trained consultants.";

export const WHAT_IS_OD =
	"Organization Development is a process of planned change in an organization's culture — focused on increasing the organization's effectiveness and health through planned interventions that help organizations adapt to change, with the help of consultants. It is the tool CODE uses to pursue its advocacy of planned change and youth empowerment, building consultant capability through constant research and practice.";

export const SERVICES_INTRO =
	"CODE caters to clients with services tailor-fit to their specific needs instead of generalized programs. We do heavy research so that each engagement is unique and exceptional.";

export const HERO_STATS = [
	{ value: "8+", label: "years of XChange" },
	{ value: "160+", label: "partner organizations" },
	{ value: "30+", label: "universities & non-profits" },
];

export type Competency = { n: string; title: string; body: string };
export const COMPETENCIES: Competency[] = [
	{ n: "01", title: "Consultant Development", body: "Opportunities for members to grow, develop, and be rooted in CODE's vision as consultants competent in OD." },
	{ n: "02", title: "Application of OD", body: "Consultants apply OD concepts in both client interventions and internal efforts." },
	{ n: "03", title: "Organization Health", body: "Promoting an environment that is sustainable and conducive for organizations and communities to flourish." },
];

export type Service = { id: string; tag: string; title: string; summary: string; meta: string; points: string[] };
export const SERVICES: Service[] = [
	{
		id: "short",
		tag: "Short-Term",
		title: "Short-Term Engagements",
		summary:
			"Train, develop, and strengthen the knowledge, skills, and attitudes of a client org's members through modules tailored to their context.",
		meta: "Usually 2–3 sessions · focused on behavioral change",
		points: ["Leadership training", "Specialized skills training", "Team-building"],
	},
	{
		id: "long",
		tag: "Long-Term",
		title: "Long-Term Engagements",
		summary: "Tackle the structural aspects of the organization through guided discussions and insight, building lasting foundations.",
		meta: "Structural · multi-month partnership",
		points: [
			"Vision & Mission",
			"Organizational Diagnosis",
			"Constitution",
			"Code of Internal Procedures",
			"Processes, Systems & Structures",
			"Member Development & Retention",
		],
	},
	{
		id: "teams",
		tag: "Advisory",
		title: "Consultancy Teams",
		summary:
			"Focus on organization-wide issues in a more advisory, facilitative role — helping the client reach a concrete plan of action by the end.",
		meta: "Newer service · smaller, more flexible team",
		points: ["Organization-wide scope", "Facilitative & advisory", "Ends in a plan of action"],
	},
];

export type Project = {
	id: string;
	short: string;
	name: string;
	kicker: string;
	theme: string;
	summary: string;
	goals: string[];
	stat: { k: string; v: string }[];
};
export const PROJECTS: Project[] = [
	{
		id: "youth-huddle",
		short: "YH",
		name: "Youth Huddle",
		kicker: "CODE's youngest flagship",
		theme: "Past theme — “Reconnecting Roots”",
		summary: "A lecture and workshop program on OD geared toward youth leaders from senior high to college nationwide.",
		goals: [
			"Engage the youth sector in OD through relevant, applicable concepts.",
			"Give young people across the Philippines a chance to learn leadership, personal growth, and OD through collaboration.",
			"Curate a meaningful experience for Filipino student leaders while filling accessibility gaps in CODE.",
		],
		stat: [
			{ k: "Empathy", v: "at its core" },
			{ k: "SHS–College", v: "nationwide reach" },
		],
	},
	{
		id: "xchange",
		short: "XC",
		name: "XChange",
		kicker: "Now in its 8th year",
		theme: "Past theme — “Realizing Realities. Practicing Participation. Developing Communities.”",
		summary:
			"An annual OD seminar for youth organization leaders who want to be servant leaders for the nation — via plenary talks, OD workshops and modules, and inter-org collaboration.",
		goals: [
			"Convene youth leaders through plenary talks and OD workshops.",
			"Foster inter-org collaboration across the youth sector.",
			"Frame a critical, collaborative process to determine our collective futures.",
		],
		stat: [
			{ k: "160+", v: "partner organizations" },
			{ k: "30+", v: "universities & non-profits" },
		],
	},
];

export type ContactRep = { role: string; scope: string; email: string };
export const CONTACTS: ContactRep[] = [
	{ role: "Client Relations Head", scope: "For groups within the Loyola Schools", email: "clientrelations.code@student.ateneo.edu" },
	{ role: "External Relations Head", scope: "For groups outside the Loyola Schools", email: "externalrelations.code@student.ateneo.edu" },
	{ role: "Secretary-General", scope: "General point of contact", email: "ateneocodeosg@gmail.com" },
];

export type ArticleComponent = { name: string; def: string; ex: string };
export type ArticleSection = { h: string; figure: string; body: string };
export type Article = {
	id: string;
	title: string;
	cat: string;
	read: string;
	author: string;
	date: string;
	dek: string;
	abstract: string;
	sections: ArticleSection[];
	components: { title: string; items: ArticleComponent[] };
	questions: string[];
	refs: string[];
};

export const ARTICLES: Article[] = [
	{
		id: "organization-identity",
		title: "Organization Identity",
		cat: "Foundations",
		read: "7 min read",
		author: "CODE Consultants",
		date: "Feb 2025",
		dek: "How organization identities are formed — and why a shared sense of “who we are” anchors everything an org does.",
		abstract:
			"Every organization carries an identity: a shared, enduring sense of who it is, what it values, and why it exists. This piece unpacks how those identities form over time, how they are reinforced through culture and ritual, and how consultants can help an org articulate an identity its members actually recognize.",
		sections: [
			{
				h: "What we mean by identity",
				figure: "Diagram — the identity formation loop",
				body: "Organization identity is the set of beliefs members hold about the central, distinctive, and enduring character of their organization. It answers “who are we?” before it answers “what do we do?” — and it is built, not declared.",
			},
			{
				h: "How identities form",
				figure: "Figure — founding story → shared practice → narrative",
				body: "Identity accumulates: from a founding story, through repeated shared practice, into a narrative members tell about themselves. Each cycle either reinforces or quietly revises who the org believes it is.",
			},
		],
		components: {
			title: "The Three Anchors of Identity",
			items: [
				{ name: "Central character", def: "The values and purpose members treat as core.", ex: "“We exist to empower the youth.”" },
				{ name: "Distinctiveness", def: "What makes the org recognizably different.", ex: "Contextualized OD, not generic programs." },
				{ name: "Endurance", def: "The continuity members perceive across time and turnover.", ex: "A vision that outlasts any single batch." },
			],
		},
		questions: [
			"What story does your organization tell about why it was founded?",
			"Which practices most reliably remind members of who you are?",
			"Where does the identity members feel diverge from the one you publish?",
		],
		refs: [
			"Albert, S., & Whetten, D. A. (1985). Organizational identity. Research in Organizational Behavior.",
			"Gioia, D. A., et al. (2013). Organizational identity formation and change. Academy of Management Annals.",
		],
	},
	{
		id: "human-centered-design",
		title: "Human-Centered Design",
		cat: "Methods",
		read: "9 min read",
		author: "CODE Consultants",
		date: "Jan 2025",
		dek: "An empathy-, feedback-, and creativity-driven process for designing interventions that actually fit the people they serve.",
		abstract:
			"Human-Centered Design (HCD) puts the people an organization serves at the center of every decision. It is empathy-led, feedback-driven, and relentlessly iterative — making it a natural companion to OD work, where the “users” are members, volunteers, and the communities an org hopes to develop.",
		sections: [
			{
				h: "Empathy first",
				figure: "Diagram — empathize, define, ideate, prototype, test",
				body: "HCD begins by understanding people in their context — their needs, frustrations, and aspirations — before proposing any solution. The goal is to design with people, not merely for them.",
			},
			{
				h: "Feedback as fuel",
				figure: "Figure — the iterative feedback loop",
				body: "Prototypes are made to be tested early and often. Each round of feedback sharpens the intervention, so the final design reflects lived reality rather than a planning-room guess.",
			},
		],
		components: {
			title: "The Four Components",
			items: [
				{ name: "Empathy", def: "Deeply understanding the people you design for.", ex: "Interviews, shadowing, listening sessions." },
				{ name: "Definition", def: "Framing the real problem worth solving.", ex: "A sharp, human problem statement." },
				{ name: "Ideation", def: "Generating many possible directions.", ex: "Divergent brainstorming, then converge." },
				{ name: "Iteration", def: "Prototyping and refining through feedback.", ex: "Test, learn, revise, repeat." },
			],
		},
		questions: [
			"Whose needs are at the center of your current intervention?",
			"When did you last test an idea with real members before committing?",
			"What feedback have you been avoiding — and why?",
		],
		refs: ["Brown, T. (2009). Change by Design. Harper Business.", "IDEO.org (2015). The Field Guide to Human-Centered Design."],
	},
	{
		id: "planned-change",
		title: "The Anatomy of Planned Change",
		cat: "Foundations",
		read: "6 min read",
		author: "CODE Consultants",
		date: "Dec 2024",
		dek: "Why intentional, well-sequenced change outlasts the reactive kind — and how OD makes change deliberate.",
		abstract:
			"Change happens to every organization; planned change is what happens on purpose. This piece outlines how OD sequences diagnosis, intervention, and reinforcement so that change takes root rather than snapping back the moment attention moves elsewhere.",
		sections: [
			{
				h: "Diagnosis before action",
				figure: "Diagram — the planned-change sequence",
				body: "Planned change starts with honest diagnosis: what is actually happening, and why. Skipping this step is the most common reason interventions fail to hold.",
			},
		],
		components: {
			title: "Three Phases",
			items: [
				{ name: "Diagnose", def: "Surface the real dynamics at play.", ex: "Surveys, interviews, data review." },
				{ name: "Intervene", def: "Act on the leverage points found.", ex: "A targeted module or restructure." },
				{ name: "Reinforce", def: "Embed the change so it endures.", ex: "New rituals, systems, and norms." },
			],
		},
		questions: [
			"What change is your org attempting right now — by design or by accident?",
			"What would honest diagnosis reveal that you already suspect?",
		],
		refs: ["Cummings, T. & Worley, C. (2014). Organization Development and Change.", "Lewin, K. (1947). Frontiers in Group Dynamics."],
	},
];

export const ARTICLE_CATS = ["All", "Foundations", "Methods"];

export function getArticle(slug: string): Article | undefined {
	return ARTICLES.find((article) => article.id === slug);
}
