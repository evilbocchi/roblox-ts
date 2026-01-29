import luau from "@roblox-ts/luau-ast";
import ts from "typescript";

export type SourceMappedLuauNode = luau.Node & { source?: ts.Node };

export function setLuauSource<T extends luau.Node>(node: T, source: ts.Node | undefined) {
	if (source) {
		(node as SourceMappedLuauNode).source = source;
	}
	return node;
}

export function setLuauListSource(list: luau.List<luau.Statement>, source: ts.Node | undefined) {
	if (!source) return;
	luau.list.forEach(list, node => setLuauSource(node, source));
}

export function getLuauSource(node: luau.Node): ts.Node | undefined {
	return (node as SourceMappedLuauNode).source;
}
