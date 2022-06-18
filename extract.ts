#!/usr/bin/env -S deno run --allow-read --allow-write
import { globToRegExp, isGlob, parseFlags } from "./deps.ts";
import { File, NZB, Output } from "./model.ts";

const parseOptions = {
  string: [
    "out",
  ],
  alias: {
    "out": "o",
  },
};

if (import.meta.main) {
  await extract();
}

export function help() {
  return `Usage: nzb-extract [...flags] <input> <glob|regex>`;
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
export async function extract(args = Deno.args, defaults = {}) {
  const {
    _: [filename, pattern],
    ...flags
  } = parseFlags(args, parseOptions);

  let { out, nzb } = Object.assign(defaults, flags);

  if (!filename) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  let output: Output = out;
  if (!out || out === "-") {
    output = Deno.stdout;
  } else if (typeof out === "string") {
    output = await Deno.open(out, {
      read: false,
      write: true,
      create: true,
      truncate: true,
    });
  }

  if (!nzb) {
    nzb = await NZB.from(
      await Deno.open(filename as string),
    );
  }

  let regex: RegExp;

  if (isGlob(pattern as string)) {
    regex = globToRegExp(pattern as string);
  } else {
    regex = new RegExp(pattern as string);
  }

  // Filters out files that do not matchthe regex.
  filter(nzb.files, regex);

  await output.write(new TextEncoder().encode(nzb.toString()));
  output.close();
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
