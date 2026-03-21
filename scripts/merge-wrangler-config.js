#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'fs';

const [, , localPath, upstreamPath, outputPath] = process.argv;

if (!localPath || !upstreamPath || !outputPath) {
	console.error('Usage: node scripts/merge-wrangler-config.js <local> <upstream> <output>');
	process.exit(1);
}

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
merged = mergeVarsSection(merged, local, '[env.development.vars]', ['SW_VERSION']);

// Merge KV bindings, preserving existing IDs while adopting upstream structure.
merged = mergeTableArrayBlock(merged, local, '[[kv_namespaces]]', 'SECRETS_KV');
merged = mergeTableArrayBlock(merged, local, '[[env.development.kv_namespaces]]', 'SECRETS_KV');

writeFileSync(outputPath, merged, 'utf8');

function normalize(text) {
	return text.replace(/\r\n/g, '\n');
}

function preserveLineAssignment(targetText, sourceText, key) {
	const sourceLine = extractLineAssignment(sourceText, key);
	if (!sourceLine) {
		return targetText;
	}

	const targetPattern = new RegExp(`^${escapeRegex(key)}\\s*=.*$`, 'm');
	if (targetPattern.test(targetText)) {
		return targetText.replace(targetPattern, sourceLine);
	}

	return insertAfterLine(targetText, sourceLine, /^(workers_dev\s*=.*|compatibility_date\s*=.*)$/m);
}

function preserveSectionLineAssignment(targetText, sourceText, header, key) {
	const sourceSection = extractSectionBlock(sourceText, header);
	const targetSection = extractSectionBlock(targetText, header);

	if (!sourceSection || !targetSection) {
		return targetText;
	}

	const sourceLine = extractLineAssignment(sourceSection.body, key);
	if (!sourceLine) {
		return targetText;
	}

	const updatedBody = replaceOrAppendLine(targetSection.body, key, sourceLine);
	return replaceBlock(targetText, targetSection.fullText, buildSection(header, updatedBody));
}

function preserveArrayAssignment(targetText, sourceText, key, insertAfterKey = null) {
	const sourceBlock = extractArrayAssignment(sourceText, key);
	if (!sourceBlock) {
		return targetText;
	}

	const targetBlock = extractArrayAssignment(targetText, key);
	if (targetBlock) {
		return replaceBlock(targetText, targetBlock, sourceBlock);
	}

	if (insertAfterKey) {
		return insertAfterLine(targetText, sourceBlock, new RegExp(`^${escapeRegex(insertAfterKey)}\\s*=.*$`, 'm'));
	}

	return targetText + '\n' + sourceBlock + '\n';
}

function preserveSectionBlock(targetText, sourceText, header) {
	const sourceSection = extractSectionBlock(sourceText, header);
	const targetSection = extractSectionBlock(targetText, header);

	if (!sourceSection || !targetSection) {
		return targetText;
	}

	return replaceBlock(targetText, targetSection.fullText, sourceSection.fullText);
}

function mergeVarsSection(targetText, sourceText, header, protectedKeys = []) {
	const sourceSection = extractSectionBlock(sourceText, header);
	const targetSection = extractSectionBlock(targetText, header);

	if (!sourceSection || !targetSection) {
		return targetText;
	}

	const sourceVars = parseAssignments(sourceSection.body);
	const targetVars = parseAssignments(targetSection.body);

	for (const [key, value] of sourceVars.entries()) {
		if (protectedKeys.includes(key)) {
			continue;
		}
		targetVars.set(key, value);
	}

	const updatedBody = Array.from(targetVars.entries())
		.map(([key, value]) => `${key} = ${value}`)
		.join('\n');

	return replaceBlock(targetText, targetSection.fullText, buildSection(header, updatedBody));
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
		if (sourceAssignments.has(key)) {
			targetAssignments.set(key, sourceAssignments.get(key));
		}
	}

	for (const [key, value] of sourceAssignments.entries()) {
		if (!targetAssignments.has(key)) {
			targetAssignments.set(key, value);
		}
	}

	const orderedKeys = ['binding', 'id', 'preview_id'];
	const lines = [];

	for (const key of orderedKeys) {
		if (targetAssignments.has(key)) {
			lines.push(`${key} = ${targetAssignments.get(key)}`);
		}
	}

	for (const [key, value] of targetAssignments.entries()) {
		if (!orderedKeys.includes(key)) {
			lines.push(`${key} = ${value}`);
		}
	}

	return replaceBlock(targetText, targetBlock.fullText, [header, ...lines].join('\n'));
}

function extractLineAssignment(text, key) {
	const match = text.match(new RegExp(`^${escapeRegex(key)}\\s*=.*$`, 'm'));
	return match ? match[0] : null;
}

function replaceOrAppendLine(body, key, newLine) {
	const pattern = new RegExp(`^${escapeRegex(key)}\\s*=.*$`, 'm');
	if (pattern.test(body)) {
		return body.replace(pattern, newLine);
	}
	return body.trimEnd() + '\n' + newLine;
}

function parseAssignments(body) {
	const assignments = new Map();
	for (const line of body.split('\n')) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) {
			continue;
		}
		const [key, ...rest] = trimmed.split('=');
		assignments.set(key.trim(), rest.join('=').trim());
	}
	return assignments;
}

function extractSectionBlock(text, header) {
	return extractHeaderBlock(text, header, false);
}

function extractTableArrayBlock(text, header, bindingName) {
	return extractHeaderBlock(text, header, true, (body) => body.includes(`binding = "${bindingName}"`));
}

function extractHeaderBlock(text, header, isArray, predicate = null) {
	const lines = text.split('\n');
	for (let start = 0; start < lines.length; start++) {
		if (lines[start].trim() !== header) {
			continue;
		}

		let end = start + 1;
		while (end < lines.length && !startsNewTomlBlock(lines[end])) {
			end++;
		}

		const fullLines = lines.slice(start, end);
		const body = fullLines.slice(1).join('\n').trimEnd();
		if (predicate && !predicate(body)) {
			start = end - 1;
			continue;
		}

		return {
			header,
			body,
			fullText: fullLines.join('\n').trimEnd(),
			isArray,
		};
	}

	return null;
}

function extractArrayAssignment(text, key) {
	const lines = text.split('\n');
	for (let i = 0; i < lines.length; i++) {
		if (!lines[i].trim().startsWith(`${key} = [`)) {
			continue;
		}

		let bracketBalance = countChar(lines[i], '[') - countChar(lines[i], ']');
		let end = i + 1;
		while (end < lines.length && bracketBalance > 0) {
			bracketBalance += countChar(lines[end], '[') - countChar(lines[end], ']');
			end++;
		}
		return lines.slice(i, end).join('\n');
	}
	return null;
}

function countChar(text, char) {
	return [...text].filter((current) => current === char).length;
}

function buildSection(header, body) {
	return `${header}\n${body.trimEnd()}`;
}

function replaceBlock(text, existingBlock, replacementBlock) {
	return text.replace(existingBlock, replacementBlock);
}

function insertAfterLine(text, block, pattern) {
	const match = text.match(pattern);
	if (!match || match.index === undefined) {
		return text + '\n' + block + '\n';
	}

	const insertionPoint = match.index + match[0].length;
	return text.slice(0, insertionPoint) + '\n' + block + text.slice(insertionPoint);
}

function startsNewTomlBlock(line) {
	const trimmed = line.trim();
	return trimmed.startsWith('[') && trimmed.endsWith(']');
}

function escapeRegex(value) {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
