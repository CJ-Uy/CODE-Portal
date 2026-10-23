import { asc, eq, sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "@/db/schema";
import { members, mentsPeople } from "@/db/schema";
import { mentsContract, mentsInputSchema, type MentsInput, type MentsPerson, type MentsAdminPerson } from "@/db/contract/ments";
import { createId } from "@/lib/ids";
import { mentorLine, parseMentsPaste } from "@/lib/ments";
import { can, type Actor } from "@/server/auth/permissions";
import type { AuditRepository } from "./audit";

export type MentsRepository = {
	list(actor: Actor): Promise<MentsPerson[]>;
	manage(actor: Actor): Promise<MentsAdminPerson[]>;
	save(actor: Actor, input: MentsInput): Promise<MentsPerson>;
	remove(actor: Actor, id: string): Promise<void>;
	import(actor: Actor, raw: string): Promise<{ added: number; linked: number }>;
};

function requireAdmin(actor: Actor) {
	if (!can(actor, "member:manage")) throw new Error("Not authorized to manage the ments tree.");
}

export function createMentsRepository(db: DrizzleD1Database<typeof schema>, audit: AuditRepository): MentsRepository {
	const list = async (actor: Actor) => {
		if (!actor.memberId) throw new Error("Authentication required.");
		return db.select().from(mentsPeople).orderBy(asc(mentsPeople.name), asc(mentsPeople.id));
	};
	const record = (actor: Actor, action: string, id: string, detail: string) => audit.record(actor, {
		action, targetType: "ments_person", targetId: id, category: "member", detail,
	});
	return {
		list,
		async manage(actor) {
			requireAdmin(actor);
			return db.select({ ...mentsPeopleColumns, memberEmail: members.email }).from(mentsPeople)
				.leftJoin(members, eq(mentsPeople.memberId, members.id)).orderBy(asc(mentsPeople.name));
		},
		async save(actor, rawInput) {
			requireAdmin(actor);
			const input = mentsInputSchema.parse(rawInput);
			const id = input.id ?? createId("mnt");
			const people = await list(actor);
			if (input.id && !people.some((person) => person.id === id)) throw new Error("Person not found.");
			if (input.mentorId && !people.some((person) => person.id === input.mentorId)) throw new Error("Ments not found.");
			if (input.mentorId === id || mentorLine(people, input.mentorId ?? "").some((person) => person.id === id)) {
				throw new Error("That ments assignment would create a loop.");
			}
			let memberId: string | null = null;
			if (input.memberEmail) {
				const [member] = await db.select({ id: members.id }).from(members).where(eq(members.email, input.memberEmail)).limit(1);
				if (!member) throw new Error("That email has no portal account. Leave it blank for a past mentor.");
				memberId = member.id;
				if (people.some((person) => person.memberId === memberId && person.id !== id)) throw new Error("That portal account is already linked to another person.");
			}
			const value = { id, name: input.name, cohort: input.cohort || null, mentorId: input.mentorId, memberId };
			const [person] = input.id
				? await db.update(mentsPeople).set(value).where(eq(mentsPeople.id, id)).returning()
				: await db.insert(mentsPeople).values(value).returning();
			await record(actor, input.id ? "ments:update" : "ments:create", id, input.name);
			return person;
		},
		async remove(actor, rawId) {
			requireAdmin(actor);
			const { id } = mentsContract.remove.input.parse({ id: rawId });
			const people = await list(actor);
			const person = people.find((person) => person.id === id);
			if (!person) throw new Error("Person not found.");
			if (people.some((person) => person.mentorId === id)) throw new Error("Reassign this person's mentees before removing them.");
			await db.delete(mentsPeople).where(eq(mentsPeople.id, id));
			await record(actor, "ments:remove", id, person.name);
		},
		async import(actor, raw) {
			requireAdmin(actor);
			mentsContract.import.input.parse({ raw });
			const rows = parseMentsPaste(raw);
			if (!rows.length) throw new Error("Paste at least one relationship.");
			const people = await list(actor);
			const byName = new Map<string, MentsPerson>();
			const duplicateNames = new Set<string>();
			const key = (name: string) => name.trim().toLocaleLowerCase("en");
			for (const person of people) {
				if (byName.has(key(person.name))) duplicateNames.add(key(person.name));
				byName.set(key(person.name), { ...person });
			}
			const changed = new Map<string, MentsPerson>();
			let added = 0;
			let linked = 0;
			const getPerson = (name: string) => {
				if (duplicateNames.has(key(name))) throw new Error(`More than one person is named ${name}. Edit their relationships individually.`);
				let person = byName.get(key(name));
				if (!person) {
					person = { id: createId("mnt"), name, cohort: null, memberId: null, mentorId: null };
					byName.set(key(name), person);
					changed.set(person.id, person);
					added++;
				}
				return person;
			};
			for (const row of rows) {
				const person = getPerson(row.name);
				if (!row.mentor) continue;
				const mentor = getPerson(row.mentor);
				if (person.mentorId && person.mentorId !== mentor.id) throw new Error(`${person.name} already has a different ments. Edit that person to change it.`);
				if (!person.mentorId) {
					person.mentorId = mentor.id;
					changed.set(person.id, person);
					linked++;
				}
			}
			const proposed = [...byName.values()];
			for (const person of changed.values()) {
				if (person.mentorId === person.id || mentorLine(proposed, person.mentorId ?? "").some((ancestor) => ancestor.id === person.id)) {
					throw new Error(`The relationships for ${person.name} would create a loop. Nothing was imported.`);
				}
			}
			if (changed.size) {
				// One JSON parameter stays within D1's 100-parameter limit and keeps the import atomic.
				await db.run(sql`INSERT INTO ments_people (id, name, cohort, member_id, mentor_id)
					SELECT json_extract(value, '$.id'), json_extract(value, '$.name'),
						json_extract(value, '$.cohort'), json_extract(value, '$.memberId'), json_extract(value, '$.mentorId')
					FROM json_each(${JSON.stringify([...changed.values()])}) WHERE true
					ON CONFLICT(id) DO UPDATE SET mentor_id = coalesce(ments_people.mentor_id, excluded.mentor_id)`);
				await record(actor, "ments:import", "tree", `${added} people added, ${linked} relationships linked`);
			}
			return { added, linked };
		},
	};
}

const mentsPeopleColumns = {
	id: mentsPeople.id, name: mentsPeople.name, cohort: mentsPeople.cohort,
	memberId: mentsPeople.memberId, mentorId: mentsPeople.mentorId,
};
