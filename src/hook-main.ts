#!/usr/bin/env node
/**
 * Entry point for the Claude Code `UserPromptSubmit` hook.
 *
 * Reads one JSON payload on stdin, writes at most one JSON object on stdout.
 * Exits 0 even on failure: a broken hook must never wedge the user's session.
 *
 * @module prompt-funnel/hook-main
 */

import { runHookMain } from './hook-run.js';

runHookMain();
