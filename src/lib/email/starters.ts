import { baseHtmlTemplate } from "./base-html";
import type { EmailBlock } from "./types";

const heading = (text: string, level: 1 | 2 = 1): EmailBlock => ({ id: "h", type: "heading", props: { text, level } });
const text = (text: string): EmailBlock => ({ id: "t", type: "text", props: { text } });
const button = (label: string, href: string): EmailBlock => ({ id: "b", type: "button", props: { label, href } });
const image = (src: string, alt: string, href?: string): EmailBlock => ({ id: "i", type: "image", props: { src, alt, ...(href ? { href } : {}) } });
const divider: EmailBlock = { id: "d", type: "divider", props: {} };
const htmlBody = (html: string): EmailBlock => ({ id: "html", type: "html", props: { html } });

/** Built-in starters work immediately, without seeding or modifying saved templates. */
export function emailStarters(baseUrl: string) {
	const portal = `${baseUrl}/portal`;
	return [
		{
			id: "feature-announcement", name: "CODE Portal feature announcement", description: "Introduce a major portal feature. CODE Mail is the editable example.",
			// Ateneo's Gmail sent the earlier copy ("Sign in to CODE Portal", "Open CODE Mail", "personal inbox") to Spam,
			// so this copy avoids sign-in, inbox and account-setting wording. Test it on a student address after changing it.
			subject: "New in CODE Portal: past updates in one place", preheader: "Every CODE update we send you is now saved in the portal.",
			blocks: [heading("Every CODE update, saved for you."), text("Hi {{firstname}},\n\nCODE Portal now keeps a copy of each update we send you. Missed an announcement, or need an event detail again? You’ll find it on the Mail page, right next to the calendar."), button("See past updates", `${portal}/mail`), divider, heading("What’s new", 2), text("**Everything in one place.** Announcements, event news and reminders from CODE, listed by date.\n\n**Easy to find again.** Look back at an update without digging through old messages.\n\n**You choose the extras.** Turn optional categories on or off from the Mail page. Important CODE notices always come through."), divider, text("Have an idea for the portal? Reply and tell us.\n\nSee you around,\nCODE")],
		},
		{
			id: "app-install", name: "CODE Portal is now an app", description: "Launch email for the installable portal: a hero, picture steps for iPhone and Android, and the new calendar features.",
			// Same Gmail caution as above: no sign-in, inbox or account wording. Images are served from the portal's own /email folder.
			subject: "CODE Portal is now an app", preheader: "Put it on your home screen in under a minute. Plus: a roomier calendar.",
			blocks: [
				image(`${baseUrl}/email/app-launch/hero.jpg`, "Add CODE Portal as an app on your phone: the navy CODE icon on a home screen.", `${portal}/guides/install`),
				heading("One tap, and you’re in."),
				text("Hi {{firstname}},\n\nNo more digging through tabs and bookmarks. CODE Portal now lives on your home screen, right next to your other apps. It opens full screen and keeps the calendar and your check-in code close at hand.\n\n**It updates itself.** No need to delete and add it again when updates arrive. There’s no app store either, and it takes about a minute."),
				button("Add it to your phone", `${portal}/guides/install`),
				divider,
				heading("On iPhone or iPad", 2),
				text("Open the portal in **Safari**, then follow the taps."),
				image(`${baseUrl}/email/app-launch/ios-1.jpg`, "Step 1: in Safari, tap the three-dot button at the bottom right.", `${portal}/guides/install?os=ios`),
				image(`${baseUrl}/email/app-launch/ios-2.jpg`, "Step 2: tap Share at the top of the menu.", `${portal}/guides/install?os=ios`),
				image(`${baseUrl}/email/app-launch/ios-3.jpg`, "Step 3: tap View More at the end of the share sheet's bottom row.", `${portal}/guides/install?os=ios`),
				image(`${baseUrl}/email/app-launch/ios-4.jpg`, "Step 4: scroll down and tap Add to Home Screen.", `${portal}/guides/install?os=ios`),
				image(`${baseUrl}/email/app-launch/ios-5.jpg`, "Step 5: keep Open as Web App on and tap Add.", `${portal}/guides/install?os=ios`),
				heading("On Android", 2),
				text("Open the portal in **Chrome**, then follow the taps."),
				image(`${baseUrl}/email/app-launch/android-1.jpg`, "Step 1: in Chrome, tap the three-dot menu at the top right.", `${portal}/guides/install?os=android`),
				image(`${baseUrl}/email/app-launch/android-2.jpg`, "Step 2: tap Install app.", `${portal}/guides/install?os=android`),
				image(`${baseUrl}/email/app-launch/android-3.jpg`, "Step 3: tap Install.", `${portal}/guides/install?os=android`),
				text("That’s it. Look for the navy falcon on your home screen.\n\nOpened this in Gmail or Messenger? Open the portal in Safari or Chrome first, because in-app browsers can’t add apps."),
				divider,
				heading("Also new: a roomier calendar", 2),
				text("**Day and Week views.** See a day or a whole week laid out by the hour, right next to Month.\n\n**Busy days, sorted.** When a date is packed, tap “+ more” to see its full list.\n\n**Find any event.** In List view, search by name or place, filter by type, or show only events you’re going to, attended, or are hosting."),
				button("Open the calendar", `${portal}/calendar`),
				divider,
				text("Spot something off, or have an idea? Reply and tell us.\n\nSee you around,\nCODE"),
			],
		},
		{
			id: "welcome", name: "Welcome to CODE", description: "A warm introduction to the member workspace.",
			subject: "Welcome to CODE, {{firstname}}", preheader: "Your people, resources and next opportunities are here.",
			blocks: [heading("You’re part of CODE."), text("Hi {{firstname}},\n\nWelcome! We’re glad you’re here. Your member workspace brings together the people, resources and activities that make up CODE."), button("Explore your workspace", portal), divider, heading("A good place to begin", 2), text("**Find your people.** Explore the Ments Tree and the connections across CODE.\n\n**Keep learning.** Browse the library for resources you can return to.\n\n**Join in.** Check the calendar for what’s next."), text("See you around,\nCODE")],
		},
		{
			id: "event-invite", name: "Event invitation", description: "Invite members to explore the calendar and join in.",
			subject: "Find your next CODE gathering", preheader: "Take a look at the calendar and make room to join us.",
			blocks: [heading("Make time for CODE."), text("Hi {{first_name}},\n\nA conversation, a new idea, a familiar face. Take a look at the CODE calendar and find a gathering you’d like to be part of."), button("Browse the calendar", `${portal}/calendar`), divider, heading("Before you join", 2), text("Open the event page for the time, location and registration details. If you have a question, reply to this email."), text("We’d love to see you there,\nCODE")],
		},
		{
			id: "event-reminder", name: "Event reminder", description: "A short reminder for an event audience. Add an Event block for its details.",
			subject: "A quick reminder from CODE, {{first_name}}", preheader: "Check the event page for the details before you head over.",
			blocks: [heading("See you soon."), text("Hi {{first_name}},\n\nHere’s a quick reminder to check the event details before you join us. The calendar has the latest time, location and event information."), button("Check the event details", `${portal}/calendar`), divider, text("Need a hand? Reply to this email and we’ll help.\n\nCODE")],
		},
		{
			id: "event-thanks", name: "After the event", description: "Thank attendees and keep the connection going.",
			subject: "Thanks for being there, {{firstname}}", preheader: "Keep the conversation going in CODE.",
			blocks: [heading("Better with you there."), text("Hi {{firstname}},\n\nThank you for spending time with CODE. Your presence, questions and ideas help make these gatherings worthwhile."), heading("Keep it going", 2), text("Revisit the library, reach out to someone you met, or find the next activity on the calendar. We hope you’ll bring what you learned into your next conversation."), button("Back to CODE", portal), divider, text("Have a thought to share? Reply to this email.\n\nThank you,\nCODE")],
		},
		{
			id: "newsletter", name: "The CODE roundup", description: "Three focused sections for resources, events and the community.",
			subject: "Your CODE roundup, {{first_name}}", preheader: "Something to read, something to join, someone to connect with.",
			blocks: [heading("A little more CODE."), text("Hi {{first_name}},\n\nHere are three places to start when you drop into the workspace."), heading("Something to read", 2), text("Find a useful resource in the library. Save it for later or share a thought in the comments."), button("Visit the library", `${portal}/library`), divider, heading("Something to join", 2), text("Check the calendar and find your next chance to learn with others."), button("See the calendar", `${portal}/calendar`), divider, heading("Someone to connect with", 2), text("Explore the Ments Tree to see how CODE’s generations are connected, and find your own place in it."), button("Explore the Ments Tree", `${portal}/ments`), text("Until next time,\nCODE")],
		},
		{
			id: "feedback", name: "Ask for feedback", description: "Invite a reply with specific, easy-to-answer questions.",
			subject: "What did you think, {{first_name}}?", preheader: "A few thoughts from you can help us plan what comes next.",
			blocks: [heading("We’d like to hear from you."), text("Hi {{first_name}},\n\nWhat worked well? What could be better? What would you like to see next?\n\nReply with a few thoughts. A short answer is welcome, and a specific example is especially helpful."), divider, text("Thank you for helping shape CODE.\n\nCODE")],
		},
		{
			id: "resources", name: "Resource spotlight", description: "Bring members back to the library with one clear action.",
			subject: "Make a little room to learn, {{firstname}}", preheader: "Find a resource worth keeping in the CODE library.",
			blocks: [heading("A resource for your next idea."), text("Hi {{firstname}},\n\nLooking for a place to start? The CODE library brings our resources together so you can browse, save favorites and return when you need them."), button("Find your next read", `${portal}/library`), divider, heading("Make it yours", 2), text("Filter for what interests you, save something to revisit, and leave a comment when a resource sparks a thought."), text("Happy reading,\nCODE")],
		},
		{
			id: "ments", name: "Meet your Ments Tree", description: "Help members discover their connections in the tree.",
			subject: "Where do you fit in the Ments Tree, {{first_name}}?", preheader: "Explore CODE’s connections, one generation at a time.",
			blocks: [heading("Every connection has a story."), text("Hi {{first_name}},\n\nExplore the Ments Tree to see the people and generations that connect CODE. Follow a branch, find a familiar name, or zoom out to see the whole picture."), button("Find your connections", `${portal}/ments`), text("See you in the tree,\nCODE")],
		},
		{
			id: "html", name: "Your own HTML design", description: "A table-based layout with dark mode. Swap in what your AI tool or designer writes.",
			subject: "An update from CODE, {{first_name}}", preheader: "",
			blocks: [htmlBody(baseHtmlTemplate(baseUrl))],
		},
	].map((starter) => ({ ...starter, blocks: starter.blocks.map((block, i) => ({ ...block, id: `${starter.id}_${i}` })) }));
}
