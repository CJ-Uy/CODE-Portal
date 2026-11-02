import { z } from "zod";
import { LINK_KIND_ICONS } from "@/lib/link-kinds";
import type { NavPinInput } from "@/db/repositories/navPins";

const pinSchema = z.object({
	label: z.string().trim().min(1, "Give the pin a label.").max(80),
	url: z.string().trim().max(2000).url().refine((value) => /^https?:\/\//i.test(value), "Links must start with http:// or https://."),
	icon: z.string().refine((value) => Object.values(LINK_KIND_ICONS).some((icon) => icon === value), "Choose a link type."),
	position: z.coerce.number().int().min(0).max(999),
});

export function parsePinInput(formData: FormData): NavPinInput {
	return pinSchema.parse(Object.fromEntries(["label", "url", "icon", "position"].map((key) => [key, formData.get(key)])));
}

export function parsePinId(formData: FormData): string {
	return z.string().trim().min(1).max(64).parse(formData.get("id"));
}
