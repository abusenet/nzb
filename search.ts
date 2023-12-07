#!/usr/bin/env -S deno run --allow-env --allow-net
import { Client, DelimiterStream, parseArgs } from "./deps.ts";
import { File, NZB, Segment } from "./model.ts";
import { yEncParse } from "./util.ts";

export function help() {
  return `NZB Search
  Search files and stores results into an NZB file.

INSTALL:
  deno install --allow-env --allow-net -n nzb-search https://deno.land/x/nzb/search.ts

USAGE:
  nzb-search [...options] <query>

  OPTIONS:
    --group <group> Group name to search from
    --range <start>-[end] Range of article numbers to search within.
    --meta <name>=<value> Meta data to add in the resulting NZB, such as password.

PERMISSIONS:
  --allow-env: to read environment variables for NTTP providers.
  --allow-net: to connect to NNTP provider.`;
}

const encoder = new TextEncoder();
const CRLF = encoder.encode("\r\n");

const parseOptions = {
  string: [
    "hostname",
    "username",
    "password",
    "group",
    "range",
  ],
  boolean: [
    "ssl",
  ],
  collect: ["meta"],
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Number(Deno.env.get("NNTP_PORT")),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    ssl: Deno.env.get("NNTP_SSL") === "true",
    group: "",
    range: "",
  },
};

if (import.meta.main) {
  search(Deno.args, Deno.stdout.writable);
}

/**
 * Searches files matching query and stores into a NZB file.
 */
export async function search(
  args: unknown[] = Deno.args,
  output = Deno.stdout.writable,
) {
  const parsedArgs = parseArgs(args as string[], parseOptions);
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
  } = parsedArgs;

  if (!query) {
    console.error("Missing query");
    console.error(help());
    return;
  }

  const client = await Client.connect({
    hostname: `${hostname}`,
    port: Number(port),
    ssl: !!ssl,
    logLevel: "WARNING",
  });

  if (username) {
    await client.authinfo(`${username}`, `${password}`);
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
  return response.body!
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
    .pipeTo(output, { preventClose: true });
}
