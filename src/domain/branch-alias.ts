import { isSafeAlias } from "./session-id.ts";

export function createBranchAlias(branchName: string): string | null {
	const slug = branchName.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
	if (!slug) return null;
	const alias = `branch-${slug}`;
	return isSafeAlias(alias) ? alias : null;
}

export function createSequentialBranchAlias(
	branchName: string,
	usedAliases: string[],
	currentAlias?: string,
): string | null {
	const baseAlias = createBranchAlias(branchName);
	if (!baseAlias) return null;
	if (currentAlias?.startsWith(`${baseAlias}-`)) return currentAlias;

	const used = new Set(usedAliases);
	for (let index = 1; ; index++) {
		const alias = `${baseAlias}-${index}`;
		if (!used.has(alias)) return alias;
	}
}
