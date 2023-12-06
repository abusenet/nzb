#!/usr/bin/env -S deno run --allow-read --allow-env --allow-net
import { Client, parseFlags } from "./deps.ts";
import { fetchNZB } from "./util.ts";

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
  await check();
}

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

export async function check(args = Deno.args, defaults = {}) {
  const {
    _: [input],
    hostname,
    port,
    ssl,
    username,
    password,
    method,
    ...flags
  } = parseFlags(args, parseOptions);

  let { nzb, client } = Object.assign(defaults, flags);

  //#region Normalize params
  if (!input) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  if (!nzb) {
    nzb = await fetchNZB(input as string);
  }

  if (!client) {
    client = await Client.connect({
      hostname,
      port: Number(port),
      ssl: !!ssl,
    });

    if (username) {
      await client.authinfo(username, password);
    }
  }
  //#endregion

  for await (const article of nzb.articles()) {
    const response = await client.request(method, article.id);
    if (response.code === 430) {
      console.log(`Missing ${article.id}`);
    }
  }
}
