#!/usr/bin/env node
import { createRequire } from "node:module";
import { existsSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadCorpus } from "./dedup.mjs";
import { instancePath } from "./paths.mjs";

const DEFAULT_FILE = instancePath("data", "learning.js");
const TEMPLATE_FILE = fileURLToPath(new URL("../web/wall-learning-template.js", import.meta.url));
const nonEmpty = value => typeof value === "string" && value.trim().length > 0;

export function loadLearning(file = DEFAULT_FILE) {
  const require = createRequire(import.meta.url);
  const previousWindow = globalThis.window;
  try {
    const templateResolved = require.resolve(TEMPLATE_FILE);
    const resolved = require.resolve(file);
    delete require.cache[templateResolved];
    delete require.cache[resolved];
    globalThis.window = { WallLearningTemplate: require(templateResolved) };
    require(resolved);
    return globalThis.window.WALL_LEARNING;
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
}

export function validateLearning(data) {
  const errors = [];
  const sourceById = new Map(loadCorpus().map(({ item }) => [item.id, item]));
  if (!data || !Array.isArray(data.tracks))
    return ["tracks must be an array (empty is fine until a track is defined)"];

  const trackIds = new Set();
  for (const [trackIndex, track] of data.tracks.entries()) {
    const ref = `track ${trackIndex}`;
    if (!nonEmpty(track.id)) errors.push(`${ref}: id must be a non-empty string`);
    else if (trackIds.has(track.id)) errors.push(`${ref}: duplicate id "${track.id}"`);
    else trackIds.add(track.id);
    if (!nonEmpty(track.title)) errors.push(`${ref}: title must be a non-empty string`);
    if (!nonEmpty(track.category)) errors.push(`${ref}: category must be a non-empty string`);
    if (!nonEmpty(track.unitLabel)) errors.push(`${ref}: unitLabel must be a non-empty string`);
    if (!Array.isArray(track.scheduleDays) || !track.scheduleDays.length ||
        !track.scheduleDays.every((day, index, days) => Number.isFinite(day) && day > 0 && (!index || day > days[index - 1])))
      errors.push(`${ref}: scheduleDays must be positive and strictly increasing`);
    if (!Number.isFinite(track.retryDays) || track.retryDays <= 0) errors.push(`${ref}: retryDays must be positive`);
    if (!Number.isInteger(track.interleaveEvery) || track.interleaveEvery < 1)
      errors.push(`${ref}: interleaveEvery must be a positive integer`);
    if (!Array.isArray(track.concepts) || !track.concepts.length) {
      errors.push(`${ref}: concepts must be a non-empty array`);
      continue;
    }

    const conceptIds = new Set();
    for (const [conceptIndex, concept] of track.concepts.entries()) {
      const cref = `${ref}, concept ${conceptIndex}`;
      if (!nonEmpty(concept.id)) errors.push(`${cref}: id must be a non-empty string`);
      else if (conceptIds.has(concept.id)) errors.push(`${cref}: duplicate id "${concept.id}"`);
      else conceptIds.add(concept.id);
      if (!Number.isInteger(concept.rung) || concept.rung < 1) errors.push(`${cref}: rung must be a positive integer`);
      if (!nonEmpty(concept.title)) errors.push(`${cref}: title must be a non-empty string`);
      if (!Array.isArray(concept.sourceIds) || !concept.sourceIds.length || !concept.sourceIds.every(nonEmpty))
        errors.push(`${cref}: sourceIds must be a non-empty string array`);
      else for (const id of concept.sourceIds)
        if (!sourceById.has(id)) errors.push(`${cref}: source card "${id}" does not exist in the live/archive corpus`);
      if (!nonEmpty(concept.sourceUrl) || !/^https?:\/\//i.test(concept.sourceUrl))
        errors.push(`${cref}: sourceUrl must be an absolute http(s) URL`);
      else if (Array.isArray(concept.sourceIds) && !concept.sourceIds.some(id => sourceById.get(id)?.url === concept.sourceUrl))
        errors.push(`${cref}: sourceUrl must match one of the source cards`);
      if (!Array.isArray(concept.questions) || concept.questions.length < 2) {
        errors.push(`${cref}: questions must contain at least two variants`);
        continue;
      }
      for (const [questionIndex, question] of concept.questions.entries()) {
        const qref = `${cref}, question ${questionIndex}`;
        if (!nonEmpty(question.prompt)) errors.push(`${qref}: prompt must be a non-empty string`);
        if (!Array.isArray(question.choices) || question.choices.length < 2 || !question.choices.every(nonEmpty))
          errors.push(`${qref}: choices must contain at least two non-empty strings`);
        if (!Number.isInteger(question.answer) || question.answer < 0 || question.answer >= (question.choices?.length || 0))
          errors.push(`${qref}: answer must index one of the choices`);
        if (!nonEmpty(question.explanation)) errors.push(`${qref}: explanation must be a non-empty string`);
      }
    }
  }
  return errors;
}

export function reportLearning(data, label = "data/learning.js") {
  const errors = validateLearning(data);
  console.log(`Validating ${label} — ${Array.isArray(data?.tracks) ? data.tracks.length : "?"} track(s)\n`);
  for (const error of errors) console.log(`  ✗ ${error}`);
  if (errors.length) console.log("");
  console.log(`${errors.length} error${errors.length === 1 ? "" : "s"}${errors.length ? "" : " — schema OK"}`);
  return errors.length === 0;
}

const isMain = process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) process.exit(reportLearning(loadLearning()) ? 0 : 1);
