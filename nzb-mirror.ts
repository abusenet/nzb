import { Article, parseFlags, pooledMap, ProgressBar } from "./deps.ts";

import { NZB } from "./nzb.ts";
import { mirror as mirrorArticle } from "./mirror.ts";

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
    from,
    groups,
    date,
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

  const results = pooledMap(connections, nzb.articles(), async (article) => {
    const result = await mirrorArticle(
      article,
      new Article({
        headers: {
          date,
          from,
          bytes: article.headers.get("bytes")!,
          newsgroups: groups,
          subject: article.headers.get("subject")!,
        },
      }),
      options,
    );

    result!.number = article.number;

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
