import { PathTranslator } from "@roblox-ts/path-translator";
import fs from "fs-extra";
import { LogService } from "Shared/classes/LogService";
import { DTS_EXT } from "Shared/constants";

function isOutputFileOrphaned(pathTranslator: PathTranslator, filePath: string) {
	if (filePath.endsWith(DTS_EXT) && !pathTranslator.declaration) {
		return true;
	}

	const inputPaths = filePath.endsWith(".map")
		? pathTranslator.getInputPaths(filePath.slice(0, -".map".length))
		: pathTranslator.getInputPaths(filePath);

	for (const path of inputPaths) {
		if (fs.pathExistsSync(path)) {
			return false;
		}
	}

	if (pathTranslator.buildInfoOutputPath === filePath) {
		return false;
	}

	return true;
}

export function tryRemoveOutput(pathTranslator: PathTranslator, outPath: string) {
	if (isOutputFileOrphaned(pathTranslator, outPath)) {
		fs.removeSync(outPath);
		LogService.writeLineIfVerbose(`remove ${outPath}`);
	}
}
