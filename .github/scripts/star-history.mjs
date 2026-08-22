#!/usr/bin/env node

import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const DAY = 24 * 60 * 60 * 1000;
const TARGET_Y_SEGMENTS = 6;

function normalizePoints(points) {
	return [...new Map(points.map((item) => [item.date, item])).values()].sort((left, right) => left.date.localeCompare(right.date));
}

function mergePoint(points, point) {
	return normalizePoints([...points, point]);
}

function isIsoDate(value) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
	const time = Date.parse(`${value}T00:00:00Z`);
	return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function pointsFromStargazers(stargazers) {
	const starsPerDay = new Map();

	for (const stargazer of stargazers) {
		const date = stargazer.starred_at?.slice(0, 10);
		if (!isIsoDate(date)) {
			throw new Error('GitHub returned a stargazer without starred_at');
		}
		starsPerDay.set(date, (starsPerDay.get(date) ?? 0) + 1);
	}

	let stars = 0;
	return [...starsPerDay.entries()]
		.sort(([left], [right]) => left.localeCompare(right))
		.map(([date, count]) => ({ date, stars: (stars += count) }));
}

function yAxisScale(value) {
	if (!Number.isFinite(value) || value < 0) {
		throw new Error('Star count must be a non-negative number');
	}
	if (value === 0) return { maximum: 5, step: 1 };

	const roughStep = Math.max(value / TARGET_Y_SEGMENTS, 1);
	const magnitude = 10 ** Math.floor(Math.log10(roughStep));
	const normalized = roughStep / magnitude;
	const factor = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
	const step = factor * magnitude;
	let maximum = Math.ceil(value / step) * step;

	if (maximum === value) maximum += step;
	return { maximum, step };
}

function xAxisTicks(minimumTime, maximumTime) {
	if (maximumTime <= minimumTime) return [];

	const minimumDate = new Date(minimumTime);
	const maximumDate = new Date(maximumTime);
	const minimumMonth = minimumDate.getUTCFullYear() * 12 + minimumDate.getUTCMonth();
	const maximumMonth = maximumDate.getUTCFullYear() * 12 + maximumDate.getUTCMonth();
	const monthSpan = Math.max(maximumMonth - minimumMonth, 1);
	const intervals = [1, 2, 3, 6, 12, 24, 36, 60, 120];
	const interval = intervals.find((candidate) => monthSpan / candidate <= 6) ?? 120;
	const ticks = [];

	for (let month = Math.ceil(minimumMonth / interval) * interval; month <= maximumMonth; month += interval) {
		const time = Date.UTC(Math.floor(month / 12), month % 12, 1);
		if (time > minimumTime && time < maximumTime) ticks.push(time);
	}

	return ticks;
}

function formatUtcMonth(time) {
	const date = new Date(time);
	const year = date.getUTCFullYear();
	const month = String(date.getUTCMonth() + 1).padStart(2, '0');
	return `${year}-${month}`;
}

function escapeXml(value) {
	return String(value).replace(
		/[&<>"']/g,
		(character) =>
			({
				'&': '&amp;',
				'<': '&lt;',
				'>': '&gt;',
				'"': '&quot;',
				"'": '&apos;',
			})[character],
	);
}

function renderSvg(history) {
	const width = 960;
	const height = 520;
	const left = 76;
	const right = 32;
	const top = 92;
	const bottom = 64;
	const plotWidth = width - left - right;
	const plotHeight = height - top - bottom;
	const times = history.points.map(({ date }) => Date.parse(`${date}T00:00:00Z`));
	const minimumTime = Math.min(...times);
	const maximumTime = Math.max(...times);
	const timeSpan = Math.max(maximumTime - minimumTime, DAY);
	const latest = history.points.at(-1);
	const { maximum: maximumStars, step: yStep } = yAxisScale(Math.max(...history.points.map(({ stars }) => stars)));
	const x = (time) => (history.points.length === 1 ? left + plotWidth / 2 : left + ((time - minimumTime) / timeSpan) * plotWidth);
	const y = (stars) => top + plotHeight - (stars / maximumStars) * plotHeight;
	const coordinates = history.points.map((point, index) => ({
		x: x(times[index]),
		y: y(point.stars),
	}));

	let line = `M ${coordinates[0].x.toFixed(1)} ${coordinates[0].y.toFixed(1)}`;
	for (const point of coordinates.slice(1)) {
		line += ` H ${point.x.toFixed(1)} V ${point.y.toFixed(1)}`;
	}
	const area = `${line} V ${height - bottom} H ${coordinates[0].x.toFixed(1)} Z`;
	const number = new Intl.NumberFormat('en', {
		notation: 'compact',
		maximumFractionDigits: 1,
	});
	const yGrid = Array.from({ length: Math.floor(maximumStars / yStep) + 1 }, (_, index) => {
		const stars = index * yStep;
		const position = y(stars);
		return `<path class="grid" d="M ${left} ${position.toFixed(1)} H ${width - right}"/><text class="label" x="${left - 12}" y="${(position + 4).toFixed(1)}" text-anchor="end">${number.format(stars)}</text>`;
	}).join('');
	const xGrid = xAxisTicks(minimumTime, maximumTime)
		.map((time) => {
			const position = x(time);
			return `<path class="grid vertical" d="M ${position.toFixed(1)} ${top} V ${height - bottom}"/><text class="label" x="${position.toFixed(1)}" y="${height - bottom + 28}" text-anchor="middle">${formatUtcMonth(time)}</text>`;
		})
		.join('');

	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-labelledby="title description">
  <title id="title">${escapeXml(history.repository)} Star History</title>
  <desc id="description">GitHub stars over time, last updated ${history.updated}</desc>
  <style>
    .background { fill: #ffffff; }
    .grid { fill: none; stroke: #d8dee4; stroke-width: 1; }
    .vertical { stroke-dasharray: 3 5; opacity: .65; }
    .label, .subtitle { fill: #57606a; font: 13px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .heading, .value { fill: #24292f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .heading { font-size: 20px; font-weight: 600; }
    .value { font-size: 24px; font-weight: 600; }
    .area { fill: #0969da; opacity: .12; }
    .line { fill: none; stroke: #0969da; stroke-linecap: round; stroke-linejoin: round; stroke-width: 3; }
    .point { fill: #0969da; stroke: #ffffff; stroke-width: 2; }
    @media (prefers-color-scheme: dark) {
      .background { fill: #0d1117; }
      .grid { stroke: #30363d; }
      .label, .subtitle { fill: #8b949e; }
      .heading, .value { fill: #f0f6fc; }
      .area { fill: #58a6ff; }
      .line { stroke: #58a6ff; }
      .point { fill: #58a6ff; stroke: #0d1117; }
    }
  </style>
  <rect class="background" width="${width}" height="${height}" rx="8"/>
  <text class="heading" x="${left}" y="38">${escapeXml(history.repository)} Star History</text>
  <text class="subtitle" x="${left}" y="62">GitHub stars over time &#183; updated ${history.updated}</text>
  <text class="value" x="${width - right}" y="40" text-anchor="end">${number.format(latest.stars)} stars</text>
  ${yGrid}
  ${xGrid}
  <path class="area" d="${area}"/>
  <path class="line" d="${line}"/>
  <circle class="point" cx="${coordinates.at(-1).x.toFixed(1)}" cy="${coordinates.at(-1).y.toFixed(1)}" r="5"/>
</svg>
`;
}

async function github(pathname, token, accept = 'application/vnd.github+json') {
	const headers = {
		Accept: accept,
		'User-Agent': '2fa-star-history',
		'X-GitHub-Api-Version': '2022-11-28',
	};
	if (token) headers.Authorization = `Bearer ${token}`;

	const response = await fetch(`https://api.github.com${pathname}`, { headers });
	if (!response.ok) {
		const remaining = response.headers.get('x-ratelimit-remaining');
		const detail = (await response.text()).slice(0, 300);
		throw new Error(`GitHub API ${response.status} (remaining: ${remaining ?? 'unknown'}): ${detail}`);
	}
	return response.json();
}

async function fetchStargazers(repository, token) {
	const stargazers = [];

	for (let page = 1; ; page += 1) {
		const batch = await github(`/repos/${repository}/stargazers?per_page=100&page=${page}`, token, 'application/vnd.github.star+json');
		if (!Array.isArray(batch)) throw new Error('GitHub returned invalid stargazer data');
		stargazers.push(...batch);
		if (batch.length < 100) return stargazers;
	}
}

async function readHistory(file, repository) {
	try {
		const history = JSON.parse(await readFile(file, 'utf8'));
		if (history.repository !== repository || !Array.isArray(history.points)) {
			throw new Error(`${file} does not contain history for ${repository}`);
		}

		for (const point of history.points) {
			if (!isIsoDate(point.date) || !Number.isInteger(point.stars) || point.stars < 0) {
				throw new Error(`${file} contains an invalid data point`);
			}
		}

		return { repository, points: normalizePoints(history.points) };
	} catch (error) {
		if (error.code === 'ENOENT') return { repository, points: [] };
		throw error;
	}
}

function selfTest() {
	assert.deepEqual(
		mergePoint([{ date: '2026-07-17', stars: 10 }], {
			date: '2026-07-17',
			stars: 11,
		}),
		[{ date: '2026-07-17', stars: 11 }],
	);
	assert.deepEqual(
		pointsFromStargazers([
			{ starred_at: '2026-07-17T01:00:00Z' },
			{ starred_at: '2026-07-18T01:00:00Z' },
			{ starred_at: '2026-07-18T02:00:00Z' },
		]),
		[
			{ date: '2026-07-17', stars: 1 },
			{ date: '2026-07-18', stars: 3 },
		],
	);
	assert.deepEqual(yAxisScale(437), { maximum: 500, step: 100 });
	assert.deepEqual(yAxisScale(500), { maximum: 600, step: 100 });
	assert.equal(isIsoDate('2024-02-29'), true);
	assert.equal(isIsoDate('2026-99-99'), false);
	assert.deepEqual(xAxisTicks(Date.UTC(2024, 0, 13), Date.UTC(2026, 7, 27)).map(formatUtcMonth), [
		'2024-07',
		'2025-01',
		'2025-07',
		'2026-01',
		'2026-07',
	]);

	const svg = renderSvg({
		repository: 'owner/repo',
		updated: '2026-08-27',
		points: [
			{ date: '2024-01-13', stars: 1 },
			{ date: '2026-08-27', stars: 437 },
		],
	});
	assert.match(svg, /owner\/repo Star History/);
	assert.match(svg, />437 stars</);
	assert.match(svg, /@media \(prefers-color-scheme: dark\)/);
	console.log('star history self-test passed');
}

async function main() {
	const [command = 'snapshot', outputDirectory = '.'] = process.argv.slice(2);
	if (command === 'self-test') return selfTest();
	if (!new Set(['snapshot', 'bootstrap']).has(command)) {
		throw new Error('usage: star-history.mjs [snapshot|bootstrap|self-test] [output-directory]');
	}

	const repository = process.env.GITHUB_REPOSITORY;
	if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
		throw new Error('GITHUB_REPOSITORY must be in owner/repository form');
	}
	const token = process.env.STAR_HISTORY_TOKEN ?? process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;
	if (command === 'bootstrap' && !token) {
		throw new Error('bootstrap requires STAR_HISTORY_TOKEN, GITHUB_TOKEN, or GH_TOKEN');
	}
	const file = path.join(outputDirectory, 'history.json');
	const history = await readHistory(file, repository);
	let points = command === 'bootstrap' ? pointsFromStargazers(await fetchStargazers(repository, token)) : history.points;
	const repositoryData = await github(`/repos/${repository}`, token);
	if (!Number.isInteger(repositoryData.stargazers_count)) {
		throw new Error('GitHub returned an invalid stargazer count');
	}

	const today = new Date().toISOString().slice(0, 10);
	points = mergePoint(points, { date: today, stars: repositoryData.stargazers_count });
	const updated = { repository, updated: today, points };

	await mkdir(outputDirectory, { recursive: true });
	await Promise.all([
		writeFile(file, `${JSON.stringify(updated, null, 2)}\n`),
		writeFile(path.join(outputDirectory, 'star-history.svg'), renderSvg(updated)),
	]);
	console.log(`${command}: wrote ${points.length} points for ${repository}`);
}

main().catch((error) => {
	console.error(error.message);
	process.exitCode = 1;
});
