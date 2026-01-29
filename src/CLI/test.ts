/// <reference types="jest" />

import fs from "fs-extra";
import path from "path";
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
	fs.writeFileSync(
		sourceFilePath,
		[
			"const value = 5;",
			"function add(x: number, y: number) {",
			"\treturn x + y;",
			"}",
			"export const result = add(value, 2);",
		].join("\n"),
	);

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

	it("should write .map and sourceMappingURL", done => {
		const sourceFile = program.getProgram().getSourceFile(sourceFilePath);
		assert(sourceFile, `Missing source file ${sourceFilePath}`);
		const emitResult = compileFiles(program.getProgram(), data, pathTranslator, [sourceFile]);
		if (emitResult.diagnostics.length > 0) {
			done(new Error("\n" + formatDiagnostics(emitResult.diagnostics)));
			return;
		}

		const outPath = pathTranslator.getOutputPath(sourceFilePath);
		const mapPath = `${outPath}.map`;
		const luaText = fs.readFileSync(outPath, "utf8");
		const mapText = fs.readFileSync(mapPath, "utf8");

		expect(luaText).toContain("--# sourceMappingURL=");
		const mapJson = JSON.parse(mapText) as { sources?: Array<string>; sourcesContent?: Array<string | null> };
		expect(mapJson.sources?.[0]).toBe("sourcemap.ts");
		expect(mapJson.sourcesContent?.[0]).toContain("export const result");
		done();
	});
});
