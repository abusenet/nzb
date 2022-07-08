#!/usr/bin/env -S deno run --allow-read --allow-write
import { parseFlags } from "./deps.ts";

import { NZB, Output } from "./model.ts";

const parseOptions = {
  string: [
    "out",
  ],
  alias: {
    "out": "o",
  },
};

if (import.meta.main) {
  await combine();
}

export function help() {
  return `NZB Combine
  Combines multiple NZB sources into a target NZB.

INSTALL:
  deno install --allow-read --allow-write -n nzb-combine https://deno.land/x/nzb/combine.ts

USAGE:
  nzb-combine [...options] <target> ...sources

OPTIONS:
  -o, --out <out> Output file (default stdout)`;
}

export async function combine(args = Deno.args, defaults = {}) {
  const {
    _: [target, ...sources],
    ...flags
  } = parseFlags(args, parseOptions);

  const { out } = Object.assign(defaults, flags);

  if (!target) {
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

  // The first NZB file is used as the result.
  const result = await NZB.from(
    await Deno.open(target as string),
    target as string,
  );

  for await (const filename of sources) {
    const nzb = await NZB.from(
      await Deno.open(filename as string),
      filename as string,
    );

    // Appends source's files into the target's files.
    result.files.push(...nzb.files);
  }

  await output.write(new TextEncoder().encode(result.toString()));
  output.close();
}
