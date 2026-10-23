// Static how-to guides for /portal/guides. Plain data, no React, so the Workers test pool can import it.

export const GUIDE_AUDIENCES = ["member", "organizer", "admin"] as const;
export type GuideAudience = (typeof GUIDE_AUDIENCES)[number];

export const AUDIENCE_LABEL: Record<GuideAudience, string> = {
	member: "Members",
	organizer: "Organizers",
	admin: "CRS admins",
};

/** Mapped to lucide icons in src/components/guides/guide-meta.ts. */
export type GuideIcon = "qr-code" | "calendar-check" | "message-square" | "award" | "calendar-plus" | "scan" | "clipboard" | "send" | "chart";

/** A numbered pin on a screenshot. x and y are percentages of the image, measured to the pin's centre. */
export type GuideCallout = { x: number; y: number; label: string };

export type GuideImage = {
	src: string;
	alt: string;
	/** phone shots are 750x1624, desktop shots 2560x1600. */
	device: "phone" | "desktop";
	callouts: GuideCallout[];
};

export type GuideStep = { title: string; body: string; image?: GuideImage; tip?: string };

export type Guide = {
	slug: string;
	title: string;
	summary: string;
	audience: GuideAudience;
	icon: GuideIcon;
	minutes: number;
	/** Hidden unless every listed release flag is on. */
	requires?: ("surveys" | "retention")[];
	steps: GuideStep[];
};

export const GUIDES: Guide[] = [
	{
		slug: "check-in",
		title: "Check in to an event",
		summary: "Show your QR code at the event so an organizer can mark you present.",
		audience: "member",
		icon: "qr-code",
		minutes: 1,
		steps: [
			{
				title: "Open the event",
				body: "Tap Calendar in the bottom bar, then tap the event you're at. Switch to List if you'd rather see upcoming events in order.",
				image: {
					src: "/guides/check-in/1.jpg",
					alt: "Calendar page for October 2026, with events shown on their dates.",
					device: "phone",
					callouts: [
						{ x: 31.4, y: 94.8, label: "Calendar in the bottom bar" },
						{ x: 35, y: 22, label: "List shows upcoming events in order" },
						{ x: 80.6, y: 63.7, label: "Tap an event to open it" },
					],
				},
			},
			{
				title: "Show your code",
				body: "Scroll to Check in. Keep Your code selected and let an organizer scan it. That marks you present and records any points the event gives. If the scan doesn't work, they can search for your name instead.",
				image: {
					src: "/guides/check-in/2.jpg",
					alt: "Event page with the Check in card showing a member's QR code.",
					device: "phone",
					callouts: [
						{ x: 15.5, y: 45.1, label: "Your code is the one organizers scan" },
						{ x: 84.5, y: 45.1, label: "Event QR shares the event page. It doesn't check you in." },
						{ x: 11.3, y: 81.7, label: "Check-in opens 30 minutes before the event starts" },
					],
				},
				tip: "Your code never changes. On your phone, the + button at the bottom opens Quick actions, which shows it too.",
			},
		],
	},
	{
		slug: "sign-up",
		title: "Sign up for an event",
		summary: "Let the organizers know you're coming, and change your mind later if you need to.",
		audience: "member",
		icon: "calendar-check",
		minutes: 1,
		steps: [
			{
				title: "Tap Sign up",
				body: "Open the event from Calendar or from Upcoming events on Home. Below the event details is the Signup card. If the organizers added signup questions, you'll answer them here too.",
				image: {
					src: "/guides/sign-up/1.jpg",
					alt: "Event page with a Signup card and a Sign up button.",
					device: "phone",
					callouts: [
						{ x: 14.8, y: 56.2, label: "Sign up" },
						{ x: 67.7, y: 46.5, label: "Your status. It says Not going until you sign up." },
						{ x: 8.5, y: 34.5, label: "How many people are going" },
					],
				},
			},
			{
				title: "Change or cancel",
				body: "Once you're in, your status changes to Going. To change your answers to the signup questions, edit them and tap Update signup. Plans changed? Tap Cancel signup.",
				image: {
					src: "/guides/sign-up/2.jpg",
					alt: "Signup card showing Going, with Update signup and Cancel signup buttons.",
					device: "phone",
					callouts: [
						{ x: 72.8, y: 46.5, label: "Your status now says Going" },
						{ x: 14.8, y: 60.6, label: "Update signup saves changed answers" },
						{ x: 54.8, y: 60.6, label: "Cancel signup if you can't make it" },
					],
				},
				tip: "Signing up isn't the same as checking in. You still need to check in at the event to be marked present.",
			},
		],
	},
	{
		slug: "give-feedback",
		title: "Give feedback after an event",
		summary: "Answer a short form about an event you attended. CRS sees your name with your answers. Organizers don't.",
		audience: "member",
		icon: "message-square",
		minutes: 2,
		requires: ["surveys"],
		steps: [
			{
				title: "Find the form",
				body: "When CRS sends a feedback form, you get a notification, and sometimes an email too. On Home, the Feedback forms card counts the forms waiting for you. Tap it to open the next one.",
				image: {
					src: "/guides/give-feedback/1.jpg",
					alt: "Home page with a Feedback forms card showing 1 form waiting.",
					device: "phone",
					callouts: [
						{ x: 90.4, y: 3.9, label: "Notifications" },
						{ x: 88.0, y: 34.4, label: "Feedback forms card. Tap it to open the next form." },
					],
				},
			},
			{
				title: "Or open it from the event page",
				body: "An event you attended shows a How was this event? card while its form is open, with the closing date. Tap Give feedback. Every attendee can answer from here, invited or not.",
				image: {
					src: "/guides/give-feedback/2.jpg",
					alt: "Ended event page with a How was this event? card and a Give feedback button.",
					device: "phone",
					callouts: [
						{ x: 11.5, y: 67.3, label: "How was this event? card" },
						{ x: 62.0, y: 77.2, label: "Give feedback" },
					],
				},
			},
			{
				title: "Answer the questions",
				body: "The top of the form says how many questions there are, about how long it takes, and when it closes. Tap a number from 1 to 5 for each rating question. Questions marked * need an answer.",
				image: {
					src: "/guides/give-feedback/3.jpg",
					alt: "Feedback form with its length and closing date, the points answering gives you, a note on who sees your name, and 1 to 5 rating buttons.",
					device: "phone",
					callouts: [
						{ x: 71.5, y: 23.1, label: "How long it takes and when it closes" },
						{ x: 55.4, y: 29.3, label: "The rest of the event's points, for answering" },
						{ x: 53.2, y: 43.5, label: "CRS sees your name with your answers. Organizers don't." },
						{ x: 50.0, y: 64.2, label: "Tap a number. Your pick turns dark." },
					],
				},
				tip: "Feedback is voluntary, and the points come whatever you answer. An event's form gives you the other 25% of the event's points. A form with no event may give points for answering instead.",
			},
			{
				title: "Send it",
				body: "Write as much or as little as you like in the open questions, then tap Send feedback. You can answer each form once, and only until it closes.",
				image: {
					src: "/guides/give-feedback/4.jpg",
					alt: "End of the feedback form with two written answers and a Send feedback button.",
					device: "phone",
					callouts: [
						{ x: 88.0, y: 60.0, label: "Questions without * are optional" },
						{ x: 37.4, y: 83.3, label: "Send feedback" },
					],
				},
			},
		],
	},
	{
		slug: "retention",
		title: "Track your retention",
		summary: "See which of the 12 retention requirements you have met, what is due next, and which points do not count.",
		audience: "member",
		icon: "award",
		minutes: 2,
		requires: ["retention"],
		steps: [
			{
				title: "See where you stand",
				body: "Tap Retention in the bottom bar. The top line says whether you are on track and how many of the 12 requirements you have met. Each block in the strip is one requirement: the first four are once a school year, the rest are once each semester. The key under it explains the fills.",
				image: {
					src: "/guides/retention/1.jpg",
					alt: "Retention page saying On track, 3 of 12 requirements met, with a strip of 12 blocks, a key, and the next deadline.",
					device: "phone",
					callouts: [
						{ x: 68.7, y: 96.1, label: "Retention in the bottom bar" },
						{ x: 39.1, y: 33.7, label: "On track, and how many are met" },
						{ x: 50.0, y: 39.2, label: "One block per requirement" },
						{ x: 20.9, y: 48.0, label: "What is due next, and by when" },
					],
				},
				tip: "You are retained when all 12 blocks are full by the end of the school year.",
			},
			{
				title: "Get the rest of your points from feedback forms",
				body: "An event with a feedback form gives 75% of its points when you check in. You get the other 25% when you answer its form. Forms still waiting on you are listed near the top. Tap Answer before the form closes.",
				image: {
					src: "/guides/retention/2.jpg",
					alt: "Panel saying 0.5 points are waiting on feedback forms, with an Answer button for HR Mixer and a form that opens after Team Bonding Night.",
					device: "phone",
					callouts: [
						{ x: 50.0, y: 14.5, label: "Points waiting on your answers" },
						{ x: 20.6, y: 36.7, label: "Answer the form" },
						{ x: 50.0, y: 46.4, label: "This form opens after the event" },
					],
				},
				tip: "If a form closes before you answer, its 25% is gone.",
			},
			{
				title: "Read the requirement boxes",
				body: "Each box needs 1 point. A navy box is met. Semester parts need a point in each semester, so a 1st-semester box cannot be filled from the 2nd. Points past 1 are extra and do not count. A Next link shows an upcoming event that gives that kind of point.",
				image: {
					src: "/guides/retention/3.jpg",
					alt: "Semester boxes: a met General Membership Activity box with 1 extra point not counted, boxes at 0.75 of 1 waiting on a form, and 2nd-semester boxes that open Jan 11.",
					device: "phone",
					callouts: [
						{ x: 23.5, y: 28.3, label: "Extra points do not count" },
						{ x: 73.5, y: 22.3, label: "The 2nd semester opens Jan 11" },
						{ x: 24.6, y: 36.7, label: "An upcoming event for this part" },
						{ x: 26.6, y: 50.2, label: "Answer the form to fill the rest" },
					],
				},
				tip: "Open How retention works under the boxes for the full rules.",
			},
			{
				title: "See what does not count",
				body: "Points from other activities, like Feedback or Frontliner, are listed under Not counted toward retention. Milestones count every point of a type, extras included. Activity history lists every record, and you can filter it by point type.",
				image: {
					src: "/guides/retention/4.jpg",
					alt: "Not counted toward retention list with Frontliner and Feedback points, then milestone tracks for General Membership Activity and Human Resources Event.",
					device: "phone",
					callouts: [
						{ x: 50.0, y: 11.8, label: "Points that do not count toward retention" },
						{ x: 50.0, y: 53.1, label: "Milestones for a point type" },
					],
				},
				tip: "Every record in Activity history says which point type it went to.",
			},
		],
	},
	{
		slug: "create-event",
		title: "Create an event",
		summary: "Put your own event on the calendar. Anyone can host.",
		audience: "member",
		icon: "calendar-plus",
		minutes: 2,
		steps: [
			{
				title: "Open Quick actions",
				body: "On your phone, tap the + button at the bottom of the screen. On a computer, go to Calendar and use the Create event button at the top.",
				image: {
					src: "/guides/create-event/1.jpg",
					alt: "Home page with the + button in the middle of the bottom bar.",
					device: "phone",
					callouts: [
						{ x: 56.1, y: 89.8, label: "The + button opens Quick actions" },
						{ x: 70.5, y: 25.6, label: "Calendar also has a Create event button" },
					],
				},
			},
			{
				title: "Tap Create event",
				body: "Quick actions has Create event next to New short link. Your check-in code is on the same sheet.",
				image: {
					src: "/guides/create-event/2.jpg",
					alt: "Quick actions sheet with a check-in QR code and Create event and New short link buttons.",
					device: "phone",
					callouts: [
						{ x: 14.4, y: 84.5, label: "Create event" },
						{ x: 13.5, y: 33.6, label: "Your check-in code" },
					],
				},
			},
			{
				title: "Fill in the details",
				body: "Give it a title, pick a type and a place, then choose the date and time. Your event goes on the calendar as soon as you tap Create event.",
				image: {
					src: "/guides/create-event/3.jpg",
					alt: "Create event form with Title, Type and Place fields and a date picker.",
					device: "phone",
					callouts: [
						{ x: 88, y: 18.6, label: "Title" },
						{ x: 86, y: 28.5, label: "Type sets how it looks on the calendar" },
						{ x: 30, y: 63.8, label: "Pick the date" },
						{ x: 56.2, y: 95.6, label: "Create event" },
					],
				},
				tip: "You own the events you create. Open the event and use Manage event to take attendance or change the details.",
			},
		],
	},
	{
		slug: "take-attendance",
		title: "Take attendance at your event",
		summary: "Scan codes, search names or paste a list to mark people present.",
		audience: "organizer",
		icon: "scan",
		minutes: 3,
		steps: [
			{
				title: "Open Manage event",
				body: "Open your event and scroll to Manage event. Only the event's team sees it. On Check-ins, you can scan codes, search for someone by name, or paste a list of emails.",
				image: {
					src: "/guides/take-attendance/1.jpg",
					alt: "Manage event card on the Check-ins tab, with Scan attendance, member search and a box for pasting emails.",
					device: "phone",
					callouts: [
						{ x: 14.4, y: 33.5, label: "Check-ins tab" },
						{ x: 34.7, y: 53.2, label: "Scan attendance opens the camera" },
						{ x: 13.2, y: 62.7, label: "Search for a member by name" },
						{ x: 50, y: 79.3, label: "Paste a column of emails to check in many at once" },
					],
				},
				tip: "Check-in opens 30 minutes before the event starts.",
			},
			{
				title: "Scan member codes",
				body: "Tap Scan attendance and allow camera access. Point the camera at a member's QR code. Each good scan marks that person present and adds to the count.",
				image: {
					src: "/guides/take-attendance/2.jpg",
					alt: "Full-screen scanner with a square frame and a Scanned 0 counter.",
					device: "phone",
					callouts: [
						{ x: 50, y: 50, label: "Fit the member's code inside the frame" },
						{ x: 30.5, y: 3.4, label: "How many you've scanned" },
						{ x: 91.6, y: 8.7, label: "Recent scans" },
						{ x: 8.5, y: 8.7, label: "Close the scanner" },
					],
				},
				tip: "Scanned the wrong person? Tap Undo on the result right after the scan.",
			},
			{
				title: "Add your team",
				body: "On People, add members to your team. A Scanner can check people in. An Admin can also manage the event. Inviting a member only sends them a notice; the event stays public.",
				image: {
					src: "/guides/take-attendance/3.jpg",
					alt: "People tab with Team, Invited and Signed up sections.",
					device: "phone",
					callouts: [
						{ x: 43.1, y: 24.4, label: "People tab" },
						{ x: 85.5, y: 45, label: "Pick Scanner or Admin first" },
						{ x: 16.6, y: 49.9, label: "Search for the member to add" },
						{ x: 13.2, y: 67.4, label: "Invite a member. This only sends a notice." },
					],
				},
				tip: "Handing the event to someone else? Transfer ownership is at the bottom of People. It can't be undone.",
			},
		],
	},
	{
		slug: "organizer-feedback",
		title: "Read your event's feedback and write a debrief",
		summary: "See what attendees said about your event, then write down your team's side.",
		audience: "organizer",
		icon: "clipboard",
		minutes: 2,
		requires: ["surveys"],
		steps: [
			{
				title: "Find Feedback on your event page",
				body: "Open your event. Once it has ended, Feedback sits right under the event details. Results show up once CRS has sent a form for your event and shared the results with organizers, and at least 3 people have answered.",
				image: {
					src: "/guides/organizer-feedback/1.jpg",
					alt: "The Feedback section of an event page, with the response count and the first rating question.",
					device: "phone",
					callouts: [
						{ x: 92.5, y: 1.9, label: "Feedback, right under the event details" },
						{ x: 29.9, y: 9.7, label: "How many answered, and how many of the invited replied" },
						{ x: 18.4, y: 17.1, label: "A note when too few replied to trust the numbers" },
						{ x: 40.9, y: 36.9, label: "Share who rated 4 or 5, the mean, and how many answered" },
					],
				},
				tip: "CRS decides what organizers see. If it says the feedback isn't shared, ask CRS.",
			},
			{
				title: "Read the answers",
				body: "Rating questions show how people scored the event. Open questions list every comment, with the most common words on top. Tap a word to see only the comments that use it. You see the answers without names, so you won't see who wrote what.",
				image: {
					src: "/guides/organizer-feedback/2.jpg",
					alt: "Event feedback with written comments and a cloud of common words.",
					device: "phone",
					callouts: [
						{ x: 83.5, y: 61.4, label: "Comments as written, without names" },
						{ x: 17.9, y: 12.6, label: "Bigger words came up more. Tap one to filter." },
					],
				},
				tip: "CRS can hide a comment from organizers, so you may see fewer comments than responses.",
			},
			{
				title: "Write the debrief",
				body: "Below Feedback is the Debrief. It asks what you set out to do, what actually happened, why there was a difference, and what you'll do differently next time. Tap Save debrief. Team members with the Admin role can edit it too.",
				image: {
					src: "/guides/organizer-feedback/3.jpg",
					alt: "The Debrief form with four questions and a Save debrief button.",
					device: "phone",
					callouts: [
						{ x: 86.9, y: 4.9, label: "Debrief, below Feedback" },
						{ x: 86.9, y: 10.0, label: "Four questions: the plan, what happened, why, and what to change" },
						{ x: 27.0, y: 80.2, label: "Save debrief" },
					],
				},
				tip: "Organizers and scanners don't get the feedback form. The debrief is where your team's view goes.",
			},
		],
	},
	{
		slug: "send-form",
		title: "Send a feedback form",
		summary: "Turn a template into a feedback form and send it to an event's attendees.",
		audience: "admin",
		icon: "send",
		minutes: 3,
		requires: ["surveys"],
		steps: [
			{
				title: "Start from a template",
				body: "Go to Admin, then Content, then Surveys. Under New form, pick a template and the event, then tap Create draft. Nothing is sent yet.",
				tip: "Making the event yourself? Tick Attach a feedback form in Create event, and the draft waits for you on the event's admin page.",
				image: {
					src: "/guides/send-form/1.jpg",
					alt: "Admin Surveys page with the New form card and a list of existing forms.",
					device: "desktop",
					callouts: [
						{ x: 10.4, y: 52.9, label: "Surveys, under Content" },
						{ x: 40.8, y: 52.4, label: "Pick a template" },
						{ x: 77.9, y: 52.4, label: "Pick the event" },
						{ x: 27.7, y: 59.4, label: "Create draft" },
					],
				},
			},
			{
				title: "Edit the questions",
				body: "The draft copies the template's questions, each folded to one line. Tap a question to open it, then change the wording, move it, remove it, or choose whether it's required. Save the draft when you're done. Do it now: sending locks the questions.",
				image: {
					src: "/guides/send-form/2.jpg",
					alt: "Draft form editor with the first question opened and the next ones folded.",
					device: "desktop",
					callouts: [
						{ x: 54.1, y: 42.3, label: "Tap a question to open or fold it" },
						{ x: 91.2, y: 41.4, label: "Move up, move down, or remove" },
						{ x: 59.4, y: 55.9, label: "Question text" },
						{ x: 60.6, y: 76.9, label: "Required or optional" },
					],
				},
			},
			{
				title: "Keep tracked questions comparable",
				body: "Some rating questions carry a Tracked tag. Their answers are compared across events. If you change what a tracked question asks, open it and tap Remove tag.",
				image: {
					src: "/guides/send-form/3.jpg",
					alt: "Question editor showing a rating question tagged Tracked: Return intent.",
					device: "desktop",
					callouts: [
						{ x: 39.8, y: 34.0, label: "Tracked tag: compared across events" },
						{ x: 40.8, y: 67.0, label: "Answer type: Scale (1 to 5), Choice or Text" },
						{ x: 46.9, y: 84.0, label: "Remove tag if you change what it asks" },
					],
				},
			},
			{
				title: "Choose who to invite",
				body: "Below the questions is 2. Send. The suggested option invites a random sample, big enough for averages you can trust. You can also invite everyone who attended, or a number you pick. Organizers and scanners are left out.",
				image: {
					src: "/guides/send-form/4.jpg",
					alt: "The Send panel with the Who to invite choices, the options and the closing time.",
					device: "desktop",
					callouts: [
						{ x: 94.9, y: 29.8, label: "Who can be invited" },
						{ x: 59.0, y: 37.8, label: "Suggested: a random sample" },
						{ x: 30.4, y: 41.8, label: "Or everyone, or a number you choose" },
					],
				},
			},
			{
				title: "Set the options and send",
				body: "Under Options, choose whether organizers see the results, whether to email invitees, and whether to remind people 24 hours before the form closes. An event's form is open to every attendee, and answering gives them the other 25% of the event's points. A form with no event can give Points for answering instead: set how many and of which type, or 0 for none. Set the closing time, then review and tap Send now. Invitees get a notification right away.",
				image: {
					src: "/guides/send-form/4.jpg",
					alt: "The Send panel for an event's form, showing the options, the note on the 25% for answering, the closing time and the Review and send button.",
					device: "desktop",
					callouts: [
						{ x: 24.7, y: 59.7, label: "Options: sharing and reminders" },
						{ x: 59.4, y: 71.7, label: "Answering gives the other 25%" },
						{ x: 35.4, y: 82.4, label: "When the form closes" },
						{ x: 28.9, y: 89.9, label: "Review and send, or Preview first" },
					],
				},
				tip: "Sending can't be undone. Use Preview first to see the form the way members will.",
			},
		],
	},
	{
		slug: "read-results",
		title: "Read feedback results",
		summary: "Read the ratings and comments for a form, and use the summary with care.",
		audience: "admin",
		icon: "chart",
		minutes: 2,
		requires: ["surveys"],
		steps: [
			{
				title: "Check who answered",
				body: "Open the form from Admin, then Content, then Surveys. The response card shows how many answered, the reply rate of the invited group, and any walk-ins. Open Who responded to see each person and when they answered. When too few people reply, a note says to read the numbers as a rough signal. Download responses saves every answer, with names, as a spreadsheet you can keep in Drive.",
				image: {
					src: "/guides/read-results/1.jpg",
					alt: "Survey details with the response count, a Download responses button, and Manage this form beside the results.",
					device: "desktop",
					callouts: [
						{ x: 28.8, y: 36.9, label: "Responses, invited reply rate and walk-ins" },
						{ x: 70.9, y: 50.6, label: "Who answered, and when" },
						{ x: 60.3, y: 28.4, label: "Download every response as a spreadsheet" },
						{ x: 94.9, y: 30.6, label: "Closing time, reminder, close now, and sharing with organizers" },
					],
				},
			},
			{
				title: "Read ratings and comments",
				body: "Each rating question shows the share who rated 4 or 5, the mean, and how answers spread from 1 to 5. Open questions show common words and every comment, with the name of the person who wrote it. Tap a word or search to narrow the comments.",
				image: {
					src: "/guides/read-results/2.jpg",
					alt: "Results with a rating breakdown, a cloud of common words and a list of comments.",
					device: "desktop",
					callouts: [
						{ x: 32.0, y: 10.6, label: "Share who rated 4 or 5, the mean, and n, the number of answers" },
						{ x: 25.2, y: 38.4, label: "Common words. Tap one to filter." },
						{ x: 35.4, y: 60.3, label: "Search the comments" },
						{ x: 65.5, y: 72.4, label: "Hide a comment from organizers" },
					],
				},
				tip: "Organizers see the comments without names. A hidden comment disappears from their view only. You still see it here.",
			},
			{
				title: "Use the summary with care",
				body: "Below the results, Summary of comments can draft themes from the comments once a form has at least 3 responses and some comments. It only runs when you tap Draft a summary. Each theme quotes the comments it came from.",
				tip: "The summary is machine-drafted. Read the comments themselves before you act on it.",
			},
		],
	},
];
