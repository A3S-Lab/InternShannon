import fs from "node:fs";
import path from "node:path";

export const RESOURCE_SENTINEL = ".gitkeep";

export function ensureResourceSentinel(resourceDir, fileSystem = fs) {
	fileSystem.mkdirSync(resourceDir, { recursive: true });
	const sentinelPath = path.join(resourceDir, RESOURCE_SENTINEL);
	if (!fileSystem.existsSync(sentinelPath)) {
		fileSystem.writeFileSync(sentinelPath, "\n");
	} else if (!fileSystem.lstatSync(sentinelPath).isFile()) {
		throw new Error(`Resource sentinel is not a file: ${sentinelPath}`);
	}
	return sentinelPath;
}

function payloadEntries(directory, fileSystem) {
	return fileSystem
		.readdirSync(directory)
		.filter((entry) => entry !== RESOURCE_SENTINEL)
		.sort();
}

function rollbackPayload({
	resourceDir,
	backupDir,
	movedCurrent,
	movedStaged,
	fileSystem,
}) {
	const rollbackErrors = [];
	for (const entry of [...movedStaged].reverse()) {
		try {
			fileSystem.rmSync(path.join(resourceDir, entry), {
				recursive: true,
				force: true,
			});
		} catch (error) {
			rollbackErrors.push(error);
		}
	}
	for (const entry of [...movedCurrent].reverse()) {
		try {
			fileSystem.renameSync(
				path.join(backupDir, entry),
				path.join(resourceDir, entry),
			);
		} catch (error) {
			rollbackErrors.push(error);
		}
	}
	return rollbackErrors;
}

export async function stageResourceDirectory({
	resourceDir,
	stagingRoot,
	populate,
	fileSystem = fs,
}) {
	if (typeof populate !== "function") {
		throw new Error("Resource staging requires a populate function");
	}
	ensureResourceSentinel(resourceDir, fileSystem);
	fileSystem.mkdirSync(stagingRoot, { recursive: true });
	const prefix = path.basename(resourceDir);
	let stagedDir;
	let backupDir;
	const movedCurrent = [];
	const movedStaged = [];
	let primaryError;
	let preserveRecoveryDirectories = false;
	let stagedResult;

	try {
		stagedDir = fileSystem.mkdtempSync(
			path.join(stagingRoot, `${prefix}.stage-`),
		);
		const result = await populate(stagedDir);
		if (fileSystem.existsSync(path.join(stagedDir, RESOURCE_SENTINEL))) {
			throw new Error(
				`Staged resource payload must not replace ${RESOURCE_SENTINEL}`,
			);
		}
		backupDir = fileSystem.mkdtempSync(
			path.join(stagingRoot, `${prefix}.backup-`),
		);

		try {
			for (const entry of payloadEntries(resourceDir, fileSystem)) {
				fileSystem.renameSync(
					path.join(resourceDir, entry),
					path.join(backupDir, entry),
				);
				movedCurrent.push(entry);
			}
			for (const entry of payloadEntries(stagedDir, fileSystem)) {
				fileSystem.renameSync(
					path.join(stagedDir, entry),
					path.join(resourceDir, entry),
				);
				movedStaged.push(entry);
			}
		} catch (error) {
			const rollbackErrors = rollbackPayload({
				resourceDir,
				backupDir,
				movedCurrent,
				movedStaged,
				fileSystem,
			});
			if (rollbackErrors.length > 0) {
				preserveRecoveryDirectories = true;
				throw new AggregateError(
					[error, ...rollbackErrors],
					[
						"Resource staging failed and rollback was incomplete.",
						`Recovery directories were preserved at ${stagedDir} and ${backupDir}.`,
					].join(" "),
					{ cause: error },
				);
			}
			throw error;
		}

		stagedResult = {
			resourceDir,
			sentinelPath: path.join(resourceDir, RESOURCE_SENTINEL),
			payload: payloadEntries(resourceDir, fileSystem),
			result,
		};
	} catch (error) {
		primaryError = error;
	}

	const cleanupErrors = [];
	if (!preserveRecoveryDirectories) {
		for (const directory of [stagedDir, backupDir].filter(Boolean)) {
			try {
				fileSystem.rmSync(directory, { recursive: true, force: true });
			} catch (error) {
				cleanupErrors.push(error);
			}
		}
	}
	try {
		ensureResourceSentinel(resourceDir, fileSystem);
	} catch (error) {
		cleanupErrors.push(error);
	}
	if (cleanupErrors.length > 0) {
		throw new AggregateError(
			primaryError ? [primaryError, ...cleanupErrors] : cleanupErrors,
			primaryError
				? "Resource staging failed and cleanup also failed"
				: "Resource staging cleanup failed",
			primaryError ? { cause: primaryError } : undefined,
		);
	}
	if (primaryError) {
		throw primaryError;
	}
	return stagedResult;
}

export async function cleanResourceDirectory({
	resourceDir,
	stagingRoot,
	fileSystem = fs,
}) {
	return stageResourceDirectory({
		resourceDir,
		stagingRoot,
		populate() {},
		fileSystem,
	});
}
