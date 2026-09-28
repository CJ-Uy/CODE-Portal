import { ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function PlaceholderBlock({ label, className }: { label: string; className?: string }) {
	return <div className={cn("flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-[#90B4CC] bg-[#D7DFE9]/45 p-6 text-center text-[#3D5266]", className)}><ImageIcon className="size-6 text-[#0C315C]" /><span className="max-w-xs text-xs font-semibold">{label}</span></div>;
}
