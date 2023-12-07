#!/usr/bin/env -S deno run --allow-read
import { parseArgs } from "./deps.ts";

import { fetchNZB } from "./util.ts";

export function help() {
  return `NZB Combine
  Combines multiple NZB sources into a target NZB.

INSTALL:
  deno install --allow-read -n nzb-combine https://deno.land/x/nzb/combine.ts

USAGE:
  nzb-combine [...options] <target> ...sources

OPTIONS:`;
}

const parseOptions = {};

if (import.meta.main) {
  await combine(Deno.args, Deno.stdout.writable);
}

/**
 * Combines multiple NZB sources into a target NZB.
 * @param {string[]} args Argument list.
 * @param {WritableStream} [writable] Writable stream to output to.
 * @returns
 */
export async function combine(
  args = Deno.args,
  output = Deno.stdout.writable,
) {
  const {
    _: [target, ...sources],
  } = parseArgs(args, parseOptions);

  if (!target) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  // The first NZB file is used as the result.
  const result = await fetchNZB(target as string);
  for await (const filename of sources) {
    const nzb = await fetchNZB(filename as string);
    // Appends source's files into the target's files.
    result.files.push(...nzb.files);
  }

  const writer = output.getWriter();
  await writer.write(new TextEncoder().encode(result.toString()));
  writer.close();
}
