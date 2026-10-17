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
		summary: "Answer a short form about an event you attended. Your name isn't attached to your answers.",
		audience: "member",
		icon: "message-square",
		minutes: 2,
		requires: ["surveys"],
		steps: [
			{
				title: "Find the form",
				body: "When CRS sends a feedback form, you get a notification, and sometimes an email too. On Home, the Surveys card counts the forms waiting for you. Tap it to open the next one.",
				image: {
					src: "/guides/give-feedback/1.jpg",
					alt: "Home page with a Surveys card showing 1 pending response.",
					device: "phone",
					callouts: [
						{ x: 90.4, y: 3.9, label: "Notifications" },
						{ x: 88.1, y: 42.4, label: "Surveys card. Tap it to open the next form." },
					],
				},
			},
			{
				title: "Or open it from the event page",
				body: "An event you attended can show a Share feedback card once it has ended. Tap Open the form. CRS can also let attendees who didn't get an invite answer from here.",
				image: {
					src: "/guides/give-feedback/2.jpg",
					alt: "Ended event page with a Share feedback card and an Open the form button.",
					device: "phone",
					callouts: [
						{ x: 11.3, y: 50.3, label: "Share feedback card" },
						{ x: 22, y: 60.2, label: "Open the form" },
					],
				},
			},
			{
				title: "Answer the questions",
				body: "Tap a number from 1 to 5 for each rating question. Questions marked * need an answer.",
				image: {
					src: "/guides/give-feedback/3.jpg",
					alt: "Feedback form with 1 to 5 rating buttons under each question.",
					device: "phone",
					callouts: [
						{ x: 59.5, y: 31.4, label: "Your name isn't attached to your answers" },
						{ x: 23.5, y: 36.5, label: "* means the question needs an answer" },
						{ x: 59.5, y: 47.2, label: "Tap a number. Your pick turns dark." },
					],
				},
				tip: "Feedback is voluntary. Answering doesn't add or remove retention points.",
			},
			{
				title: "Send it",
				body: "Write as much or as little as you like in the open questions, then tap Send feedback. You can answer each form once, and only until it closes.",
				image: {
					src: "/guides/give-feedback/4.jpg",
					alt: "End of the feedback form with two written answers and a Send feedback button.",
					device: "phone",
					callouts: [
						{ x: 86, y: 47, label: "Questions without * are optional" },
						{ x: 36.2, y: 83.2, label: "Send feedback" },
					],
				},
			},
		],
	},
	{
		slug: "retention",
		title: "Track your retention points",
		summary: "See how many points you have this term, how many you still need, and where they came from.",
		audience: "member",
		icon: "award",
		minutes: 1,
		requires: ["retention"],
		steps: [
			{
				title: "Check your progress",
				body: "Tap Retention in the bottom bar. The ring shows how far you are toward this term's target, and the line under your points says how many you still need.",
				image: {
					src: "/guides/retention/1.jpg",
					alt: "Points page with a progress ring at 25 percent and 5 retention points.",
					device: "phone",
					callouts: [
						{ x: 68.5, y: 94.8, label: "Retention in the bottom bar" },
						{ x: 57.3, y: 40.9, label: "Pick a term, then tap View" },
						{ x: 39.7, y: 50.9, label: "Progress toward the term target" },
						{ x: 52.5, y: 76.4, label: "Points you still need" },
					],
				},
				tip: "The pace line estimates where you'll end the term and how many points a week would get you there.",
			},
			{
				title: "See where your points came from",
				body: "Scroll to Activity breakdown. Switch between Progress, Pie and Bar race to see your points by category.",
				image: {
					src: "/guides/retention/2.jpg",
					alt: "Activity breakdown with a bar showing 5 of 20 points and points per category.",
					device: "phone",
					callouts: [
						{ x: 16.1, y: 31.7, label: "Switch the chart" },
						{ x: 29.9, y: 40.8, label: "Earned so far, and what's left" },
						{ x: 32.5, y: 51.2, label: "Points from each category" },
					],
				},
				tip: "Points come from checking in at events and from records added by hand. Answering feedback forms doesn't change them.",
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
				body: "Open your event and scroll past Manage event to Feedback. Results show up once CRS has sent a form for your event and shared the results with organizers, and at least 3 people have answered.",
				image: {
					src: "/guides/organizer-feedback/1.jpg",
					alt: "The Feedback section of an event page, with the response count and the first rating question.",
					device: "phone",
					callouts: [
						{ x: 37, y: 12.3, label: "Feedback, below Manage event" },
						{ x: 80, y: 20, label: "How many answered, and how many of the invited replied" },
						{ x: 4.5, y: 27.5, label: "A note when too few replied to trust the numbers" },
						{ x: 78, y: 47, label: "Share who rated 4 or 5, the mean, and how many answered" },
					],
				},
				tip: "CRS decides what organizers see. If it says the feedback isn't shared, ask CRS.",
			},
			{
				title: "Read the answers",
				body: "Rating questions show how people scored the event. Open questions list every comment, with the most common words on top. Tap a word to see only the comments that use it. Answers are anonymous, so you won't see who wrote what.",
				image: {
					src: "/guides/organizer-feedback/2.jpg",
					alt: "Event feedback with written comments and a cloud of common words.",
					device: "phone",
					callouts: [
						{ x: 80, y: 37, label: "Comments as written, without names" },
						{ x: 27.5, y: 64.8, label: "Bigger words came up more. Tap one to filter." },
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
						{ x: 37, y: 12.3, label: "Debrief, below Feedback" },
						{ x: 59, y: 17.5, label: "Four questions: the plan, what happened, why, and what to change" },
						{ x: 12.5, y: 87.7, label: "Save debrief" },
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
				image: {
					src: "/guides/send-form/1.jpg",
					alt: "Admin Surveys page with the New form card and a list of existing forms.",
					device: "desktop",
					callouts: [
						{ x: 10.5, y: 42.4, label: "Surveys, under Content" },
						{ x: 52.5, y: 52.3, label: "Pick a template" },
						{ x: 81, y: 52.3, label: "Pick the event" },
						{ x: 24.7, y: 59.2, label: "Create draft" },
					],
				},
			},
			{
				title: "Edit the questions",
				body: "The draft copies the template's questions. Change the wording, move questions up or down, remove the ones you don't need, and choose which are required. Do it now: sending locks the questions.",
				image: {
					src: "/guides/send-form/2.jpg",
					alt: "Draft form editor with the form title and the first question's fields.",
					device: "desktop",
					callouts: [
						{ x: 62, y: 38.4, label: "Form title" },
						{ x: 83, y: 56.1, label: "Move up, move down, or remove" },
						{ x: 62, y: 66.6, label: "Question text" },
						{ x: 68.5, y: 87.6, label: "Required or optional" },
					],
				},
			},
			{
				title: "Keep tracked questions comparable",
				body: "Some rating questions carry a Tracked tag. Their answers are compared across events. If you change what a tracked question asks, tap Remove tag.",
				image: {
					src: "/guides/send-form/3.jpg",
					alt: "Question editor showing a rating question tagged Tracked: Return intent.",
					device: "desktop",
					callouts: [
						{ x: 41, y: 31, label: "Tracked tag, with Remove tag beside it" },
						{ x: 45, y: 76.3, label: "Answer type: Scale (1 to 5), Choice or Text" },
					],
				},
			},
			{
				title: "Choose who to invite",
				body: "Scroll to Send. The suggested option invites a random sample, big enough for averages you can trust. You can also invite everyone who attended, or a number you pick. Organizers and scanners are left out.",
				image: {
					src: "/guides/send-form/4.jpg",
					alt: "The Send panel with the Who to invite choices, the options and the closing time.",
					device: "desktop",
					callouts: [
						{ x: 52.5, y: 40.2, label: "Who can be invited" },
						{ x: 62.5, y: 48.2, label: "Suggested: a random sample" },
						{ x: 42.5, y: 57.4, label: "Or everyone, or a number you choose" },
					],
				},
			},
			{
				title: "Set the options and send",
				body: "Under Options, choose whether other attendees can answer from the event page, whether organizers see the results, whether to email invitees, and whether to remind people 24 hours before the form closes. Set the closing time, then review and tap Send now. Invitees get a notification right away.",
				image: {
					src: "/guides/send-form/4.jpg",
					alt: "The same Send panel, showing the options, the closing time and the Review and send button.",
					device: "desktop",
					callouts: [
						{ x: 50, y: 70.6, label: "Options: who else can answer, sharing, reminders" },
						{ x: 50, y: 84.4, label: "When the form closes" },
						{ x: 47.5, y: 91.9, label: "Review and send, or Preview first" },
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
				body: "Open the form from Admin, then Content, then Surveys. The response card shows how many answered, the reply rate of the invited group, and any walk-ins. When too few people reply, a note says to read the numbers as a rough signal.",
				image: {
					src: "/guides/read-results/1.jpg",
					alt: "Survey details with Manage this form, the sharing status and the response count.",
					device: "desktop",
					callouts: [
						{ x: 46, y: 51.9, label: "Change the closing time, send a reminder, or close the form" },
						{ x: 48.5, y: 64.1, label: "Whether organizers see the results" },
						{ x: 43.5, y: 73.3, label: "All responses, or only the invited sample" },
						{ x: 66.5, y: 82.2, label: "Responses, invited reply rate and walk-ins" },
					],
				},
			},
			{
				title: "Read ratings and comments",
				body: "Each rating question shows the share who rated 4 or 5, the mean, and how answers spread from 1 to 5. Open questions show common words and every comment. Tap a word or search to narrow the comments.",
				image: {
					src: "/guides/read-results/2.jpg",
					alt: "Results with a rating breakdown, a cloud of common words and a list of comments.",
					device: "desktop",
					callouts: [
						{ x: 43.5, y: 18.6, label: "Share who rated 4 or 5, the mean, and n, the number of answers" },
						{ x: 22, y: 48.4, label: "Common words. Tap one to filter." },
						{ x: 44, y: 67.7, label: "Search the comments" },
						{ x: 81.5, y: 79.8, label: "Hide a comment from organizers" },
					],
				},
				tip: "A hidden comment disappears from the organizers' view only. You still see it here.",
			},
			{
				title: "Use the summary with care",
				body: "Below the results, Summary of comments can draft themes from the comments once a form has at least 3 responses and some comments. It only runs when you tap Draft a summary. Each theme quotes the comments it came from.",
				tip: "The summary is machine-drafted. Read the comments themselves before you act on it.",
			},
		],
	},
];
