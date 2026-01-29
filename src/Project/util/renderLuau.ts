import { RenderState, renderAST, renderStatements, solveTempIds } from "@roblox-ts/luau-ast";
import path from "path";
import { SourceMapGenerator } from "source-map";
import { getLuauSource } from "TSTransformer/util/setLuauSource";
import ts from "typescript";

interface RenderLuauResult {
	source: string;
	sourceMapText?: string;
	mapPath?: string;
}

class SourceMapRenderState extends RenderState {
	private lineNumber = 0;
	private readonly sourcesContentAdded = new Set<string>();

	constructor(
		private readonly generator: SourceMapGenerator,
		private readonly getSourcePath: (sourceFile: ts.SourceFile) => string,
		private readonly includeSources: boolean,
	) {
		super();
	}

	public override line(text: string, endNode?: import("@roblox-ts/luau-ast").default.Statement) {
		if (endNode) {
			const sourceNode = getLuauSource(endNode);
			if (sourceNode) {
				const sourceFile = sourceNode.getSourceFile();
				const sourcePath = this.getSourcePath(sourceFile);
				const { line, character } = ts.getLineAndCharacterOfPosition(
					sourceFile,
					sourceNode.getStart(sourceFile, false),
				);
				this.generator.addMapping({
					source: sourcePath,
					original: { line: line + 1, column: character },
					generated: { line: this.lineNumber + 1, column: 0 },
				});
				if (this.includeSources && !this.sourcesContentAdded.has(sourcePath)) {
					this.generator.setSourceContent(sourcePath, sourceFile.getFullText());
					this.sourcesContentAdded.add(sourcePath);
				}
			}
		}

		const result = super.line(text, endNode);
		this.lineNumber++;
		return result;
	}
}

function toPosixPath(fsPath: string) {
	return ts.normalizePath(fsPath);
}

function resolvePath(projectPath: string, maybePath: string) {
	return path.isAbsolute(maybePath) ? maybePath : path.resolve(projectPath, maybePath);
}

function getMapPath(outDir: string, outPath: string, mapRoot: string | undefined) {
	if (mapRoot) {
		const resolvedMapRoot = path.isAbsolute(mapRoot) ? mapRoot : path.resolve(outDir, mapRoot);
		return path.join(resolvedMapRoot, `${path.basename(outPath)}.map`);
	}
	return path.join(path.dirname(outPath), `${path.basename(outPath)}.map`);
}

export function renderLuau(
	ast: import("@roblox-ts/luau-ast").default.List<import("@roblox-ts/luau-ast").default.Statement>,
	sourceFile: ts.SourceFile,
	compilerOptions: ts.CompilerOptions,
	outPath: string,
	projectPath: string,
): RenderLuauResult {
	const shouldEmitSourceMap = compilerOptions.inlineSourceMap || compilerOptions.sourceMap;
	if (!shouldEmitSourceMap) {
		return { source: renderAST(ast) };
	}

	const outDir = compilerOptions.outDir ?? path.dirname(outPath);
	const rootDir = compilerOptions.rootDir ? resolvePath(projectPath, compilerOptions.rootDir) : projectPath;
	const mapPath = compilerOptions.inlineSourceMap ? undefined : getMapPath(outDir, outPath, compilerOptions.mapRoot);
	const generator = new SourceMapGenerator({
		file: path.basename(outPath),
		sourceRoot: compilerOptions.sourceRoot,
	});

	const sourcePathCache = new Map<string, string>();
	const getSourcePath = (file: ts.SourceFile) => {
		return sourcePathCache.get(file.fileName) ??
			(() => {
				const relPath = toPosixPath(path.relative(rootDir, file.fileName));
				sourcePathCache.set(file.fileName, relPath);
				return relPath;
			})();
	};

	const state = new SourceMapRenderState(generator, getSourcePath, compilerOptions.inlineSources === true);
	solveTempIds(state, ast);
	const source = renderStatements(state, ast);
	const sourceMapText = generator.toString();

	if (compilerOptions.inlineSourceMap) {
		const encodedMap = Buffer.from(sourceMapText, "utf8").toString("base64");
		const dataUrl = `data:application/json;base64,${encodedMap}`;
		const suffix = `--# sourceMappingURL=${dataUrl}`;
		return {
			source: source.endsWith("\n") ? `${source}${suffix}\n` : `${source}\n${suffix}\n`,
			sourceMapText,
		};
	}

	const mapUrl = mapPath ? toPosixPath(path.relative(path.dirname(outPath), mapPath)) : "";
	const suffix = `--# sourceMappingURL=${mapUrl}`;
	return {
		source: source.endsWith("\n") ? `${source}${suffix}\n` : `${source}\n${suffix}\n`,
		sourceMapText,
		mapPath,
	};
}
