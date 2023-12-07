#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read --allow-write
import { check } from "./check.ts";
import { combine } from "./combine.ts";
import { extract } from "./extract.ts";
import { get } from "./get.ts";
import { mirror } from "./mirror.ts";
import { search } from "./search.ts";
import { serve } from "./serve.ts";

export function help() {
  return `NZB Toolkit
  Various tools for handling NZB files

INSTALL:
  deno install --allow-net --allow-env --allow-read --allow-write -n nzb https://deno.land/x/nzb/mod.ts

USAGE:
  nzb <command> <input> [...options]

COMMANDS:
  check [--method] [...options] <input>
  combine [...options] <target> ...sources
  extract [...options] <input> <glob|regex>
  get [...options] <input> <filename>
  mirror [...options] <input>
  search [...options] <input>
  serve [...options] <input>

OPTIONS:
  --address, -addr <address> IPaddress:Port or :Port to bind server to (default "127.0.0.1:8000")
  --template, -t <template> Path to HTML template to use (default "./index.html")
  --hostname, -h <hostname> The hostname of the NNTP server.
  --port, -P <port> The port of the NNTP server.
  --ssl, -S Whether to use SSL.
  --username, -u <username> The username to authenticate with.
  --password, -p <password> The password to authenticate with.
  --connections, -n <connections> The number of connections to use.
  --connect-retries, -r <connect-retries> The number of retries to connect.
  --reconnect-delay, -d <reconnect-delay> The delay between reconnects.
  --request-retries, -R <request-retries> The number of retries to request.
  --post-retry-delay, -D <post-retry-delay> The delay between retries.
  --comment, -t <comment> The comment to use.
  --comment2, -T <comment2> The second comment to use.
  --subject, -s <subject> The subject to use.
  --from, -f <from> The from address to use.
  --groups, -g <groups> The groups to post to.
  --date, -D <date> The date to use.
  --message-id, -m <message-id> The message-id to use.
  --out, -o <out> The output file.
  --progress, -p Whether to show progress.`;
}

const exports = {
  check,
  combine,
  extract,
  get,
  mirror,
  search,
  serve,
};

if (import.meta.main) {
  const [command, ...args] = Deno.args;

  if (!command || command === "help") {
    console.error(help());
  } else {
    exports[command as keyof typeof exports](args);
  }
}

export default exports;
