#!/usr/bin/env -S deno run --allow-env --allow-net --allow-write
import { Client, DelimiterStream, parseFlags } from "./deps.ts";
import { File, NZB, Output, Segment } from "./model.ts";
import { yEncParse } from "./util.ts";

const encoder = new TextEncoder();
const CRLF = encoder.encode("\r\n");

const parseOptions = {
  string: [
    "hostname",
    "port",
    "username",
    "password",
    "group",
    "range",
    "meta",
    "out",
  ],
  boolean: [
    "ssl",
  ],
  collect: [
    "meta",
  ],
  alias: {
    "hostname": ["host", "h"],
    "port": "P",
    "username": ["user", "u"],
    "password": ["pass", "p"],
    "meta": ["M"],
    "out": "o",
  },
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Deno.env.get("NNTP_PORT"),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    ssl: Deno.env.get("NNTP_SSL") === "true",
  },
};

if (import.meta.main) {
  await search();
}

export function help() {
  return `NZB Search
  Search files and stores results into an NZB file.

INSTALL:
  deno install --allow-env --allow-net --allow-write -n nzb-search https://deno.land/x/nzb/search.ts

USAGE:
  nzb-search [...options] <query>

  OPTIONS:
    --group <group> Group name to search from
    --range <start>-[end] Range of article numbers to search within.
    --meta <name>=<value> Meta data to add in the resulting NZB, such as password.
    -o, --out <out> Output file (default stdout)

PERMISSIONS:
  --allow-env: to read environment variables for NTTP providers.
  --allow-net: to connect to NNTP provider.
  --allow-write: to write NZB file to disk.`;
}

/**
 * Searches files matching query and stores into a NZB file.
 *
 * If `out` flag is specified with a path to a file, writes resulting
 * to that file; otherwise, to `stdout`.
 *
 * A second parameter can be used to provide non-string arguments,
 * such as `out` with a `Writer`.
 */
export async function search(args = Deno.args, defaults = {}) {
  let {
    _: [query],
    hostname,
    port,
    ssl,
    username,
    password,
    group,
    range,
    meta,
    ...flags
  } = parseFlags(args, parseOptions);

  const options = Object.assign(defaults, flags);
  const { out } = options;
  let client = options.client as unknown as Client;

  if (!query) {
    console.error("Missing query");
    console.error(help());
    return;
  }

  let output: Output = out as string;
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

  if (!client) {
    client = await Client.connect({
      hostname: hostname as string,
      port: Number(port),
      ssl: !!ssl,
      logLevel: "WARNING",
    });

    if (username) {
      await client.authinfo(username as string, password as string);
    }
  }

  let response;
  response = await client.capabilities();
  const capabilities = await response.text();

  // Selects group as active
  response = await client.group(group as string);
  if (response.status !== 211) {
    console.error("Invalid group");
    return;
  }

  const [_total, first, last] = response.statusText.split(" ");
  if (!range) {
    range = `${first}-${last}`;
  }

  // Uses second-form of OVER/XOVER command to retrieve all headers
  if (capabilities.includes("XOVER")) { // legacy server.
    response = await client.request("XOVER", range as string);
  } else {
    response = await client.over(range as string);
  }

  if (response.status !== 224) {
    console.error("No articles found");
    return;
  }

  // Starts with an emtpy NZB file.
  const nzb = new NZB();
  // Sets meta data in the head.
  (meta as string[]).forEach((element: string) => {
    const [key, value] = element.split("=");
    nzb.head[key] = value;
  });

  const files = nzb.files;
  let lastArticleNumber: string;

  // TODO: parallelize
  response.body!
    // `OVER` command returns a stream of articles in each lines.
    .pipeThrough(new DelimiterStream(CRLF))
    .pipeThrough(new TextDecoderStream())
    .pipeThrough(
      new TransformStream({
        start() {
          Deno.addSignalListener("SIGINT", () => {
            console.log("stopped at", lastArticleNumber);
            Deno.exit(0);
          });
        },
        transform(articleOverview: string) {
          // Each lines contains 8 mandatory fields, separated by TAB.
          const [
            articleNumber,
            subject,
            poster,
            date,
            id,
            _references,
            bytes,
            _lines,
          ] = articleOverview.split("\t");

          if (subject.includes(query as string)) {
            const { name, size, partnum, numparts } = yEncParse(subject);
            let file = files.find((file) => file.name === name);
            if (!file) {
              file = {
                poster,
                subject,
                groups: [group!],
                lastModified: new Date(date).getTime(),
                name,
                size,
                segments: new Array(Number(numparts)),
              } as File;
              files.push(file);
            }

            const number = Number(partnum);

            const segment: Segment = {
              id: id.replace("<", "").replace(">", ""),
              number,
              size: Number(bytes),
            };

            file.segments[number - 1] = segment;
          }

          // Keeps this reference so we can resume in case of interuption.
          lastArticleNumber = articleNumber;
        },
        flush(controller) {
          controller.enqueue(nzb.toString());
        },
      }),
    )
    .pipeThrough(new TextEncoderStream())
    // Sends result to output.
    .pipeTo(output.writable, { preventClose: true });
}
