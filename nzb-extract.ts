import { globToRegExp, isGlob, parseFlags } from "./deps.ts";
import { File, NZB } from "./nzb.ts";

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

export async function extract(args = Deno.args) {
  const {
    _: [filename, pattern],
    out,
  } = parseFlags(args, parseOptions);

  if (!filename) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  let output: Deno.Writer;
  if (!out || out === "-") {
    output = Deno.stdout;
  } else {
    output = await Deno.open(out, {
      read: false,
      write: true,
      create: true,
      truncate: true,
    });
  }

  const nzb = await NZB.from(
    await Deno.open(filename as string),
  );

  let regex: RegExp;

  if (isGlob(pattern as string)) {
    regex = globToRegExp(pattern as string);
  } else {
    regex = new RegExp(pattern as string);
  }

  filter(nzb.files, regex);

  await output.write(new TextEncoder().encode(nzb.toString()));
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
