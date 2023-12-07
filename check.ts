#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import { Client, parseArgs } from "./deps.ts";
import { File, NZB } from "./model.ts";
import { fetchNZB } from "./util.ts";

export function help() {
  return `NZB Check
  Check files in an NZB for missing articles

INSTALL:
  deno install --allow-read --allow-env --allow-net -n nzb-check https://deno.land/x/nzb/check.ts

USAGE:
  nzb-check [...options] <input> [filename]

  OPTIONS:
    --hostname, -h <hostname> The hostname of the NNTP server.
    --port, -P <port> The port of the NNTP server.
    --ssl, -S Whether to use SSL.
    --username, -u <username> Username to authenticate with the NNTP server.
    --password, -p <password> Password to authenticate with the NNTP server.
    --method <method> The method to use to check articles. (one of "STAT", "HEAD", "BODY" or "ARTICLE", default "STAT")`;
}

const parseOptions = {
  string: [
    "hostname",
    "port",
    "username",
    "password",
    "method",
  ],
  boolean: [
    "ssl",
  ],
  alias: {
    "hostname": ["host", "h"],
    "port": "P",
    "ssl": "S",
    "username": ["user", "u"],
    "password": ["pass", "p"],
  },
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Deno.env.get("NNTP_PORT"),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    ssl: Deno.env.get("NNTP_SSL") === "true",
    method: "STAT",
  },
};

if (import.meta.main) {
  check(Deno.args);
}

export async function check(args: unknown[] = Deno.args) {
  const parsedArgs = parseArgs(args as string[], parseOptions);
  const {
    _: [input, filename],
    hostname,
    port,
    ssl,
    username,
    password,
    method = "STAT",
  } = parsedArgs;

  if (!input) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const nzb = typeof input === "string"
    ? await fetchNZB(input)
    : input as unknown as NZB;
  const file = typeof filename === "string"
    ? nzb.file(filename)
    : filename as unknown as File;

  const client = await Client.connect({
    hostname,
    port: Number(port),
    ssl: !!ssl,
  });

  if (username) {
    await client.authinfo(username, password);
  }

  const files = file ? [file] : nzb.files;

  for await (const file of files) {
    console.time(`Checking ${file.name}`);
    for await (const segment of file.segments) {
      console.time(`Checking article ${segment.id}`);
      const response = await client.request(method!, segment.id);
      if (response.status === 430) {
        console.log(`Article ${segment.id} of file ${file.name} is missing`);
      }
      console.timeEnd(`Checking article ${segment.id}`);
    }
    console.timeEnd(`Checking ${file.name}`);
  }
}
