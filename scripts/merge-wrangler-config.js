#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';
import process from 'node:process';
import { preserveWorkflowsForSync } from './sync-upstream-compat.js';

const [, , localPath, upstreamPath, outputPath] = process.argv;

if (!localPath || !upstreamPath || !outputPath) {
	console.error('Usage: node scripts/merge-wrangler-config.js <local> <upstream> <output>');
	process.exit(1);
}

// Existing workflows execute this downloaded entry point after rsync. Repair any
// skipped upstream files before reading wrangler.toml, then merge local settings.
preserveWorkflowsForSync({ localPath, upstreamPath, outputPath });

// Imported only now, after the skipped upstream files above have been repaired.
const { mergeMigrations, tableHeaderLines, tableHeaders, tomlAssignments } = await import('./merge-migrations.js');

const local = normalize(readFileSync(localPath, 'utf8'));
const upstream = normalize(readFileSync(upstreamPath, 'utf8'));

let merged = upstream;

// Preserve deployment-specific scalar settings from the user's repo.
merged = preserveLineAssignment(merged, local, 'name');
merged = preserveLineAssignment(merged, local, 'workers_dev');
merged = preserveLineAssignment(merged, local, 'preview_urls');
merged = preserveLineAssignment(merged, local, 'route');

// Preserve routes/custom domains if users manage them in wrangler.toml.
merged = preserveArrayAssignment(merged, local, 'routes', 'workers_dev');

// Preserve user-specific cron schedules.
merged = preserveSectionBlock(merged, local, '[triggers]');

// Merge vars so upstream comments/defaults stay, while local custom vars survive.
merged = mergeVarsSection(merged, local, '[vars]', ['SW_VERSION']);

// Preserve environment-specific names and vars.
merged = preserveSectionLineAssignment(merged, local, '[env.development]', 'name');
// 保留本地维护者在 dev 块内显式声明的 routes（典型用法：routes = [] 防止继承顶层自定义域名，
// 避免 deploy:dev 抢占生产域名）。注意：当前实现只支持单行赋值（含 routes = []）。
merged = preserveSectionLineAssignment(merged, local, '[env.development]', 'routes');
merged = mergeVarsSection(merged, local, '[env.development.vars]', ['SW_VERSION']);

// Merge KV bindings, preserving existing IDs while adopting upstream structure.
merged = mergeTableArrayBlock(merged, local, '[[kv_namespaces]]', 'SECRETS_KV');
merged = mergeTableArrayBlock(merged, local, '[[env.development.kv_namespaces]]', 'SECRETS_KV');

// Keep the deployment's migration history. Rolling back below 1.11.0 and
// upgrading again add migrations (docs/DEPLOYMENT.md); without them Wrangler
// replays every migration and the deploy fails.
merged = mergeMigrations(merged, local);

writeFileSync(outputPath, merged, 'utf8');

function normalize(text) {
	return text.replace(/\r\n/g, '\n');
}

// Top-level keys are read and written only above the first table header: the
// same key under [env.development] (for example its routes) belongs to that
// environment and must not reach the production Worker.
function splitTopLevel(text) {
	const lines = text.split('\n');
	const headers = tableHeaderLines(text);
	const end = lines.findIndex((_line, index) => headers.has(index));
	if (end === -1) {
		return { top: text, rest: '' };
	}
	const top = lines.slice(0, end).join('\n');
	return { top, rest: text.slice(top.length) };
}

function preserveLineAssignment(targetText, sourceText, key) {
	const source = findAssignment(splitTopLevel(sourceText).top, key);
	if (!source) {
		return targetText;
	}

	const { top, rest } = splitTopLevel(targetText);
	const target = findAssignment(top, key);
	if (target) {
		return replaceRange(top, target, source.text) + rest;
	}

	return insertAfterAssignment(top, source.text, ['workers_dev', 'compatibility_date']) + rest;
}

function preserveSectionLineAssignment(targetText, sourceText, header, key) {
	const sourceSection = extractSectionBlock(sourceText, header);
	const targetSection = extractSectionBlock(targetText, header);

	if (!sourceSection || !targetSection) {
		return targetText;
	}

	const source = findAssignment(sourceSection.body, key);
	if (!source || (key === 'routes' && source.text.includes('\n'))) {
		return targetText;
	}

	const target = findAssignment(targetSection.body, key);
	const updatedBody = target ? replaceRange(targetSection.body, target, source.text) : targetSection.body.trimEnd() + '\n' + source.text;
	return replaceRange(targetText, targetSection, buildSection(targetSection.header, updatedBody));
}

function preserveArrayAssignment(targetText, sourceText, key, insertAfterKey = null) {
	const source = findAssignment(splitTopLevel(sourceText).top, key);
	if (!source || !source.valueCode.trimStart().startsWith('[')) {
		return targetText;
	}

	const { top, rest } = splitTopLevel(targetText);
	const target = findAssignment(top, key);
	if (target) {
		return replaceRange(top, target, source.text) + rest;
	}

	if (insertAfterKey) {
		return insertAfterAssignment(top, source.text, [insertAfterKey]) + rest;
	}

	return top + '\n' + source.text + '\n' + rest;
}

function preserveSectionBlock(targetText, sourceText, header) {
	const sourceSection = extractSectionBlock(sourceText, header);
	const targetSection = extractSectionBlock(targetText, header);

	if (!sourceSection || !targetSection) {
		return targetText;
	}

	return replaceRange(targetText, targetSection, sourceSection.fullText);
}

function mergeVarsSection(targetText, sourceText, header, protectedKeys = []) {
	const sourceSection = extractSectionBlock(sourceText, header);
	const targetSection = extractSectionBlock(targetText, header);

	if (!sourceSection || !targetSection) {
		return targetText;
	}

	const sourceVars = parseAssignments(sourceSection.body);
	const targetVars = parseAssignments(targetSection.body);
	const protectedPaths = new Set(protectedKeys.map(assignmentKey));

	for (const [key, value] of sourceVars.entries()) {
		if (protectedPaths.has(key)) {
			continue;
		}
		targetVars.set(key, value);
	}

	const updatedBody = Array.from(targetVars.values())
		.map((entry) => entry.text)
		.join('\n');

	return replaceRange(targetText, targetSection, buildSection(targetSection.header, updatedBody));
}

function mergeTableArrayBlock(targetText, sourceText, header, bindingName) {
	const targetBlock = extractTableArrayBlock(targetText, header, bindingName);
	if (!targetBlock) {
		return targetText;
	}

	const sourceBlock = extractTableArrayBlock(sourceText, header, bindingName);
	if (!sourceBlock) {
		return targetText;
	}

	const targetAssignments = parseAssignments(targetBlock.body);
	const sourceAssignments = parseAssignments(sourceBlock.body);

	for (const key of ['id', 'preview_id']) {
		const path = assignmentKey(key);
		if (sourceAssignments.has(path)) {
			targetAssignments.set(path, sourceAssignments.get(path));
		}
	}

	for (const [key, value] of sourceAssignments.entries()) {
		if (!targetAssignments.has(key)) {
			targetAssignments.set(key, value);
		}
	}

	const orderedKeys = ['binding', 'id', 'preview_id'].map(assignmentKey);
	const lines = [];

	for (const key of orderedKeys) {
		if (targetAssignments.has(key)) {
			lines.push(targetAssignments.get(key).text);
		}
	}

	for (const [key, value] of targetAssignments.entries()) {
		if (!orderedKeys.includes(key)) {
			lines.push(value.text);
		}
	}

	return replaceRange(targetText, targetBlock, [targetBlock.header, ...lines].join('\n'));
}

function assignmentKey(key) {
	return JSON.stringify(Array.isArray(key) ? key : [key]);
}

function findAssignment(text, key) {
	return parseAssignments(text).get(assignmentKey(key));
}

function parseAssignments(body) {
	return new Map(tomlAssignments(body).map((entry) => [assignmentKey(entry.path), entry]));
}

function extractSectionBlock(text, header) {
	return extractHeaderBlock(text, header, false);
}

function extractTableArrayBlock(text, header, bindingName) {
	return extractHeaderBlock(text, header, true, (body) => {
		const value = findAssignment(body, 'binding')?.valueCode.trim();
		if (/^'[^']*'$/.test(value)) {
			return value.slice(1, -1) === bindingName;
		}
		try {
			return JSON.parse(value) === bindingName;
		} catch {
			return false;
		}
	});
}

function extractHeaderBlock(text, header, isArray, predicate = null) {
	const lines = text.split('\n');
	const headers = tableHeaders(text);
	const expected = tableHeaders(header).get(0);
	for (let start = 0; start < lines.length; start++) {
		const actual = headers.get(start);
		if (!actual || actual.array !== isArray || JSON.stringify(actual.path) !== JSON.stringify(expected.path)) {
			continue;
		}

		let end = start + 1;
		while (end < lines.length && !headers.has(end)) {
			end++;
		}

		const fullLines = lines.slice(start, end);
		const body = fullLines.slice(1).join('\n').trimEnd();
		if (predicate && !predicate(body)) {
			start = end - 1;
			continue;
		}

		const fullText = fullLines.join('\n').trimEnd();
		const startOffset = lines.slice(0, start).reduce((offset, line) => offset + line.length + 1, 0);
		return {
			header: lines[start],
			body,
			fullText,
			startOffset,
			endOffset: startOffset + fullText.length,
			isArray,
		};
	}

	return null;
}

function buildSection(header, body) {
	return `${header}\n${body.trimEnd()}`;
}

function replaceRange(text, block, replacement) {
	// Identical assignment/table text can appear inside a multi-line string.
	// Replace only the actual range found by the scanner.
	return text.slice(0, block.startOffset) + replacement + text.slice(block.endOffset);
}

function insertAfterAssignment(text, block, keys) {
	const anchor = tomlAssignments(text).find((entry) => entry.path.length === 1 && keys.includes(entry.path[0]));
	if (!anchor) {
		return text + '\n' + block + '\n';
	}

	const insertionPoint = anchor.endOffset;
	return text.slice(0, insertionPoint) + '\n' + block + text.slice(insertionPoint);
}
