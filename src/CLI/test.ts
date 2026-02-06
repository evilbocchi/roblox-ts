/// <reference types="jest" />

import fs from "fs-extra";
import path from "path";
import { cleanup } from "Project/functions/cleanup";
import { compileFiles } from "Project/functions/compileFiles";
import { copyFiles } from "Project/functions/copyFiles";
import { copyInclude } from "Project/functions/copyInclude";
import { createPathTranslator } from "Project/functions/createPathTranslator";
import { createProjectData } from "Project/functions/createProjectData";
import { createProjectProgram } from "Project/functions/createProjectProgram";
import { getChangedSourceFiles } from "Project/functions/getChangedSourceFiles";
import { DEFAULT_PROJECT_OPTIONS, PACKAGE_ROOT, ProjectType, TS_EXT, TSX_EXT } from "Shared/constants";
import { DiagnosticFactory, errors, getDiagnosticId } from "Shared/diagnostics";
import { assert } from "Shared/util/assert";
import { formatDiagnostics } from "Shared/util/formatDiagnostics";
import { getRootDirs } from "Shared/util/getRootDirs";
import { isPathDescendantOf } from "Shared/util/isPathDescendantOf";
import { SourceMapConsumer } from "source-map";

const DIAGNOSTIC_TEST_NAME_REGEX = /^(\w+)(?:\.\d+)?$/;

describe("should compile tests project", () => {
	const data = createProjectData(
		path.join(PACKAGE_ROOT, "tests", "tsconfig.json"),
		Object.assign({}, DEFAULT_PROJECT_OPTIONS, {
			project: "",
			allowCommentDirectives: true,
			optimizedLoops: true,
		}),
	);
	const program = createProjectProgram(data);
	const pathTranslator = createPathTranslator(program, data);

	// clean outDir between test runs
	fs.removeSync(program.getCompilerOptions().outDir!);

	it("should copy include files", () => copyInclude(data));

	it("should copy non-compiled files", () =>
		copyFiles(data, pathTranslator, new Set(getRootDirs(program.getCompilerOptions()))));

	const diagnosticsFolder = path.join(PACKAGE_ROOT, "tests", "src", "diagnostics");

	for (const sourceFile of getChangedSourceFiles(program)) {
		const fileName = path.relative(process.cwd(), sourceFile.fileName);
		if (isPathDescendantOf(path.normalize(sourceFile.fileName), diagnosticsFolder)) {
			let fileBaseName = path.basename(sourceFile.fileName);
			const ext = path.extname(fileBaseName);
			if (ext === TS_EXT || ext === TSX_EXT) {
				fileBaseName = path.basename(sourceFile.fileName, ext);
			}
			const diagnosticName = fileBaseName.match(DIAGNOSTIC_TEST_NAME_REGEX)?.[1] as keyof typeof errors;
			assert(diagnosticName && errors[diagnosticName], `Diagnostic test for unknown diagnostic ${fileBaseName}`);
			const expectedId = (errors[diagnosticName] as DiagnosticFactory).id;
			it(`should compile ${fileName} and report diagnostic ${diagnosticName}`, done => {
				process.env.ROBLOX_TS_EXPECTED_DIAGNOSTIC_ID = String(expectedId);
				const emitResult = compileFiles(program.getProgram(), data, pathTranslator, [sourceFile]);
				delete process.env.ROBLOX_TS_EXPECTED_DIAGNOSTIC_ID;
				if (
					emitResult.diagnostics.length > 0 &&
					emitResult.diagnostics.every(d => getDiagnosticId(d) === expectedId)
				) {
					done();
				} else if (emitResult.diagnostics.length === 0) {
					done(new Error(`Expected diagnostic ${diagnosticName} to be reported.`));
				} else {
					done(new Error("Unexpected diagnostics:\n" + formatDiagnostics(emitResult.diagnostics)));
				}
			});
		} else {
			it(`should compile ${fileName}`, done => {
				const emitResult = compileFiles(program.getProgram(), data, pathTranslator, [sourceFile]);
				if (emitResult.diagnostics.length > 0) {
					done(new Error("\n" + formatDiagnostics(emitResult.diagnostics)));
				} else {
					done();
				}
			});
		}
	}
});

describe("should emit Luau sourcemaps", () => {
	const tempRoot = fs.mkdtempSync(path.join(PACKAGE_ROOT, "tests", ".temp-sourcemap-"));
	const srcRoot = path.join(tempRoot, "src");
	const outRoot = path.join(tempRoot, "out");
	const includeRoot = path.join(PACKAGE_ROOT, "tests", "include");
	const rojoPath = path.join(PACKAGE_ROOT, "tests", "default.project.json");
	const nodeModulesRoot = path.join(tempRoot, "node_modules");
	const tsConfigPath = path.join(tempRoot, "tsconfig.json");
	const sourceFilePath = path.join(srcRoot, "sourcemap.ts");

	fs.ensureDirSync(srcRoot);
	if (!fs.pathExistsSync(nodeModulesRoot)) {
		const testsNodeModules = path.join(PACKAGE_ROOT, "tests", "node_modules");
		if (fs.pathExistsSync(testsNodeModules)) {
			fs.symlinkSync(testsNodeModules, nodeModulesRoot, "junction");
		}
	}

	// More complex TS file to test edge cases
	const tsCode = [
		"const value = 5;", // Line 1
		"function add(x: number, y: number) {", // Line 2
		"\treturn x + y;", // Line 3
		"}", // Line 4
		"export const result = add(value, 2);", // Line 5
		"",
		"if (value > 0) {", // Line 7
		"\tprint('positive');", // Line 8
		"} else {", // Line 9
		"\tprint('negative');", // Line 10
		"}", // Line 11
		"",
		"const obj = {", // Line 13
		"\ta: 1,", // Line 14
		"\tb: 2,", // Line 15
		"};", // Line 16
		"",
		"for (let i = 0; i < 3; i++) {", // Line 18
		"\tprint(i);", // Line 19
		"}", // Line 20
	].join("\n");

	fs.writeFileSync(sourceFilePath, tsCode);

	fs.writeFileSync(
		tsConfigPath,
		JSON.stringify(
			{
				compilerOptions: {
					allowSyntheticDefaultImports: true,
					downlevelIteration: true,
					jsx: "react",
					jsxFactory: "Roact.jsx",
					module: "commonjs",
					moduleResolution: "Node",
					noLib: true,
					resolveJsonModule: true,
					forceConsistentCasingInFileNames: true,
					moduleDetection: "force",
					strict: true,
					target: "ESNext",
					typeRoots: ["node_modules/@rbxts"],
					experimentalDecorators: true,
					rootDir: "src",
					outDir: "out",
					sourceMap: true,
					inlineSources: true,
				},
			},
			undefined,
			"\t",
		),
	);

	const data = createProjectData(
		tsConfigPath,
		Object.assign({}, DEFAULT_PROJECT_OPTIONS, {
			project: "",
			allowCommentDirectives: true,
			optimizedLoops: true,
			includePath: includeRoot,
			rojo: rojoPath,
			type: ProjectType.Model,
		}),
	);
	const program = createProjectProgram(data);
	const pathTranslator = createPathTranslator(program, data);

	// clean outDir between test runs
	fs.removeSync(outRoot);

	let luaText: string;
	let mapText: string;

	it("should compile successfully", done => {
		const sourceFile = program.getProgram().getSourceFile(sourceFilePath);
		assert(sourceFile, `Missing source file ${sourceFilePath}`);
		const emitResult = compileFiles(program.getProgram(), data, pathTranslator, [sourceFile]);
		if (emitResult.diagnostics.length > 0) {
			done(new Error("\n" + formatDiagnostics(emitResult.diagnostics)));
			return;
		}

		const outPath = pathTranslator.getOutputPath(sourceFilePath);
		const mapPath = `${outPath}.map`;
		luaText = fs.readFileSync(outPath, "utf8");
		mapText = fs.readFileSync(mapPath, "utf8");
		done();
	});

	it("should have correct basic sourcemap structure", () => {
		expect(luaText).toContain("--# sourceMappingURL=");
		const mapJson = JSON.parse(mapText) as { sources?: Array<string>; sourcesContent?: Array<string | null> };
		expect(mapJson.sources?.[0]).toBe("sourcemap.ts");
		expect(mapJson.sourcesContent?.[0]).toContain("export const result");
	});

	it("should map lines correctly", async () => {
		await SourceMapConsumer.with(mapText, null, consumer => {
			const luaLines = luaText.split("\n");
			const mappings: Array<{ generatedLine: number; originalLine: number }> = [];
			consumer.eachMapping(m => {
				mappings.push({ generatedLine: m.generatedLine, originalLine: m.originalLine });
			});

			function checkMapping(searchString: string, expectedTsLine: number) {
				const lineIndex = luaLines.findIndex(l => l.includes(searchString));
				if (lineIndex === -1) {
					throw new Error(`Could not find "${searchString}" in Lua output`);
				}
				const luaLine = lineIndex + 1;

				const found = mappings.some(m => m.generatedLine === luaLine && m.originalLine === expectedTsLine);

				if (!found) {
					const mappingsOnLine = mappings
						.filter(m => m.generatedLine === luaLine)
						.map(m => `TS line ${m.originalLine}`);
					const msg = `Failed to find mapping for "${searchString}" (Lua line ${luaLine}: "${luaLines[lineIndex].trim()}") to TS line ${expectedTsLine}. Mappings on line: ${mappingsOnLine.join(", ") || "none"}`;
					throw new Error(msg);
				}
			}

			// Essential anchors that should always be mapped correctly
			checkMapping("local value = 5", 1);
			checkMapping("local result = add(value, 2)", 5);

			// Inner statements
			checkMapping('print("positive")', 8);
			checkMapping('print("negative")', 10);

			// Object literal property (associated with the object's start line in current implementation)
			checkMapping("b = 2", 13);

			// Loop header (associated with its body start line in current implementation)
			checkMapping("for i = 0, 2 do", 19);
		});
	});

	it("should not delete .map files during cleanup", () => {
		const outPath = pathTranslator.getOutputPath(sourceFilePath);
		const mapPath = `${outPath}.map`;
		expect(fs.pathExistsSync(mapPath)).toBe(true);

		cleanup(pathTranslator);

		expect(fs.pathExistsSync(mapPath)).toBe(true);
	});
});
