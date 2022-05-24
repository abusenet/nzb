#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
import {
  Article,
  basename,
  parseFlags,
  pooledMap,
  prettyBytes,
  ProgressBar,
} from "./deps.ts";

import { NZB } from "./model.ts";
import { mirrorArticle } from "./mirrorArticle.ts";
import { templatized } from "./util.ts";

const parseOptions = {
  string: [
    "hostname",
    "port",
    "username",
    "password",
    "connections",
    "connect-retries",
    "reconnect-delay",
    "request-retries",
    "post-retry-delay",

    "comment",
    "comment2",
    "subject",

    "from",
    "groups",
    "date",
    "message-id", // Format of generated Message-ID. Default to `${uuid}@nntp`

    "out",
  ],
  alias: {
    "hostname": ["host", "h"],
    "port": "P",
    "username": ["user", "u"],
    "password": ["passw", "p"],
    "connections": "n",

    "comment": "t",
    "subject": "s",
    "from": "f",
    "groups": "g",

    "out": "o",
  },
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Deno.env.get("NNTP_PORT"),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    connections: Number(Deno.env.get("NNTP_CONNECTIONS") || 3),
    from: Deno.env.get("NNTP_POSTER") || "poster@example.com",
  },
};

if (import.meta.main) {
  await mirror();
}

export function help() {
  return `Usage: nzb-mirror [...flags] <input>`;
}

export async function mirror(args = Deno.args) {
  const options = parseFlags(args, parseOptions);
  let {
    _: [filename],
    connections,
    comment = "",
    comment2 = "",
    subject = "",
    from,
    groups,
    date,
    ["message-id"]: messageId,
    out,
  } = options;

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

  // `date` can have the special value 'now' to refer script's start time.
  if (date === "now") {
    date = new Date().toUTCString();
  }

  const nzb = await NZB.from(await Deno.open(filename as string));

  const total = nzb.segments;
  const progress = new ProgressBar({
    title: `Mirroring using ${connections} connections`,
    total,
    complete: "=",
    incomplete: "-",
    display: "[:bar] :completed/:total articles (:percent) - :time",
  });

  const encoder = new TextEncoder();

  function writeln(lines: string | string[], ending = "\n"): Promise<number> {
    if (!Array.isArray(lines)) {
      lines = [lines];
    }
    // Filters out undefined lines.
    lines = lines.filter((x) => x);
    return output.write(encoder.encode(lines.join(ending) + ending));
  }

  /** Writes head lines first if any. */
  const headlines = Object.entries(nzb.head).map(([type, value]) =>
    [
      `    <meta type="${type}">${value}</meta>`,
    ].join("\n")
  );

  await writeln([
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">`,
    `<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">`,
  ]);

  if (headlines.length) {
    await writeln([
      `  <head>`,
      `${headlines.join("\n")}`,
      `  </head>`,
    ]);
  }

  const files = nzb.files;
  let filenum = 0;
  const results = pooledMap(connections, nzb.articles(), async (article) => {
    const {
      name: filename,
      size: filesize,
      lastModified,
      segments,
    } = files.at(filenum)!;
    const { headers, number } = article;
    let newSubject = headers.get("subject")!;
    const bytes = headers.get("bytes")!;
    let newMessageId = "";

    if (subject || messageId) {
      const params: Record<string, string | number> = {
        /** Current file number in collection */
        filenum,
        /** Current file number in collection, pre-padded with 0's */
        "0filenum": `${filenum}`.padStart(`${files.length}`.length, "0"),
        /** Number of files in collection */
        files: files.length,
        /** File's name */
        filename,
        /** File's name without extension */
        fnamebase: basename(filename),
        /** File's size in bytes */
        filesize,
        /** File's size in KiB, rounded to 2dp */
        fileksize: (filesize / 1000).toFixed(2),
        /** File's size in MiB, rounded to 2dp */
        filemsize: (filesize / 1000 / 1000).toFixed(2),
        /** File's size in GiB, rounded to 2dp */
        filegsize: (filesize / 1000 / 1000 / 1000).toFixed(2),
        /** File's size in TiB, rounded to 2dp */
        filetsize: (filesize / 1000 / 1000 / 1000 / 1000).toFixed(2),
        /** Friendly formatted file size, e.g. '4.85 MiB' or '35.1 GiB' */
        fileasize: prettyBytes(filesize),
        /** Article part number */
        part: number as number,
        /** Article part number, pre-padded with 0's to be as long as {parts} */
        "0part": `${number}`.padStart(`${segments.length}`.length, "0"),
        /** Number of articles for the file */
        parts: segments.length,
        /** Article chunk size */
        size: bytes,
        /** Value from `--comment` */
        comment,
        /** Value from `--comment2` */
        comment2,
        /** Unix timestamp of post */
        timestamp: lastModified / 1000,
      };

      const assigns = { rand };
      const replacer = (_match: string, name: string) => `${params[name]}`;

      if (subject) {
        newSubject = templatized(subject, assigns).replace(
          /{(.*?)}/g,
          replacer,
        );
      }

      if (messageId) {
        newMessageId = templatized(messageId, assigns).replace(
          /{(.*?)}/g,
          replacer,
        );

        if (!/^<.*>$/.test(newMessageId)) {
          newMessageId = `<${newMessageId}>`;
        }
      }
    }

    const result = await mirrorArticle(
      article,
      new Article({
        headers: {
          /** Uses the new `date` if any. */
          date,
          /** Uses the `from` flag if any. */
          from,
          /** Bytes header remains the same. */
          bytes,
          /** Uses the `groups` flag if any. */
          newsgroups: groups,
          /** Transforms subject from template specified in `subject` flag if any. */
          subject: newSubject,
          /** Transforms message-id from template specified in `message-d` flag if any. */
          "message-id": newMessageId,
        },
      }),
      options,
    );

    result!.number = number;

    if (number === segments.length) {
      filenum++;
    }

    return result;
  });

  let index = 0;
  for await (const article of results) {
    const { number, headers } = article!;
    const date = headers.get("date")!;
    const from = headers.get("from")!;
    const newsgroups = headers.get("newsgroups")!;
    const subject = headers.get("subject")!;
    const id = headers.get("message-id")!;
    const bytes = headers.get("bytes")!;

    // Wraps with a `<file>` node if it's the first article (with number 1).
    if (number === 1) {
      // However, if this is not the very first article in the NZB, we need to close previous file.
      if (index) {
        await writeln([
          `    </segments>`,
          `  </file>`,
        ]);
      }

      await writeln([
        `  <file poster="${escape(from)}" date="${
          (+new Date(date)) / 1000
        }" subject="${escape(subject)}">`,
        `    <groups>`,
        `${
          newsgroups.split(",").map((group) =>
            [
              `      <group>${group}</group>`,
            ].join("\n")
          ).join("\n")
        }`,
        `    </groups>`,

        `    <segments>`,
      ]);
    }

    await writeln(
      `      <segment bytes="${bytes}" number="${number}">${
        id.replace(/<([^>]+)>/, "$1")
      }</segment>`,
    );

    progress.render(index++);
  }

  await writeln([
    `    </segments>`,
    `  </file>`,
    `</nzb>`,
  ]);
}

function escape(html: string): string {
  return html.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Generates a random string of N length.
 */
function rand(n: number): string {
  const array = new Uint8Array((n || 40) / 2);
  crypto.getRandomValues(array);
  return Array.from(array, dec2hex).join("");
}

/**
 * Converts decimal to hex string.
 */
function dec2hex(dec: number): string {
  return dec.toString(16).padStart(2, "0");
}
