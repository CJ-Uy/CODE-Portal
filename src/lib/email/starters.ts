import type { EmailBlock } from "./types";

const heading = (text: string, level: 1 | 2 = 1): EmailBlock => ({ id: "h", type: "heading", props: { text, level } });
const text = (text: string): EmailBlock => ({ id: "t", type: "text", props: { text } });
const button = (label: string, href: string): EmailBlock => ({ id: "b", type: "button", props: { label, href } });
const divider: EmailBlock = { id: "d", type: "divider", props: {} };

/** Built-in starters work immediately, without seeding or modifying saved templates. */
export function emailStarters(baseUrl: string) {
	const portal = `${baseUrl}/portal`;
	return [
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
			blocks: [heading("A little more CODE."), text("Hi {{first_name}},\n\nHere are three places to start when you drop into the workspace."), heading("Something to read", 2), text("Find a useful resource in the library. Save it for later or share a thought in the comments."), button("Visit the library", `${portal}/library`), divider, heading("Something to join", 2), text("Check the calendar and find your next chance to learn with others."), button("See the calendar", `${portal}/calendar`), divider, heading("Someone to connect with", 2), text("Explore the Ments Tree to see how CODE’s generations are connected. Add your informal Pments to recognize the people who’ve helped you along the way."), button("Explore the Ments Tree", `${portal}/ments`), text("Until next time,\nCODE")],
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
			id: "ments", name: "Meet your Ments Tree", description: "Help members discover their connections and report Pments.",
			subject: "Where do you fit in the Ments Tree, {{first_name}}?", preheader: "Explore CODE’s connections, one generation at a time.",
			blocks: [heading("Every connection has a story."), text("Hi {{first_name}},\n\nExplore the Ments Tree to see the people and generations that connect CODE. Follow a branch, find a familiar name, or zoom out to see the whole picture."), button("Find your connections", `${portal}/ments`), divider, heading("Recognize your Pments", 2), text("Some people guide us informally. Add your Pments on the tree page to recognize those connections alongside official Ments."), text("See you in the tree,\nCODE")],
		},
	].map((starter) => ({ ...starter, blocks: starter.blocks.map((block, i) => ({ ...block, id: `${starter.id}_${i}` })) }));
}
