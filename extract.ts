#!/usr/bin/env -S deno run --allow-read
import { globToRegExp, isGlob, parseArgs } from "./deps.ts";
import { File, NZB } from "./model.ts";
import { fetchNZB } from "./util.ts";

export function help() {
  return `NZB Extract
  Extract files in an NZB into a new NZB using glob/regex.

INSTALL:
  deno install --allow-read -n nzb-extract https://deno.land/x/nzb/extract.ts

USAGE:
  nzb-extract [...options] <input> <glob|regex>

  OPTIONS:`;
}

const parseOptions = {};

if (import.meta.main) {
  await extract(Deno.args, Deno.stdout.writable);
}

/**
 * Extracts files from input NZB based on Glob or RegExp.
 *
 * If `out` flag is specified with a path to a file, writes resulting
 * to that file; otherwise, to `stdout`.
 *
 * A second parameter can be used to provide non-string arguments,
 * such as `out` with a `Writer`.
 */
export async function extract(
  args: unknown[] = Deno.args,
  output = Deno.stdout.writable,
) {
  const {
    _: [input, pattern],
  } = parseArgs(args as string[], parseOptions);

  if (!input) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const nzb = typeof input === "string"
    ? await fetchNZB(input)
    : input as unknown as NZB;

  let regex: RegExp;

  if (isGlob(pattern as string)) {
    regex = globToRegExp(pattern as string);
  } else {
    regex = new RegExp(pattern as string);
  }

  // Filters out files that do not matchthe regex.
  filter(nzb.files, regex);

  const writer = output.getWriter();
  await writer.write(new TextEncoder().encode(nzb.toString()));
  writer.close();
}

/** Filter an array based on a regex inline. */
function filter(files: File[], regex: RegExp) {
  let length = files.length;
  while (length--) {
    if (!regex.test(files[length].name)) {
      files.splice(length, 1);
    }
  }

  return files;
}
