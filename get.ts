#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
import {
  Client,
  DelimiterStream,
  parseFlags,
  YEncDecoderStream,
} from "./deps.ts";

import { NZB, Output } from "./model.ts";

const encoder = new TextEncoder();
const YBEGIN = encoder.encode("=ybegin");
const YPART = encoder.encode("=ypart");
const YEND = encoder.encode("=yend");

const parseOptions = {
  string: [
    "hostname",
    "port",
    "username",
    "password",
  ],
  boolean: [
    "ssl",
  ],
  alias: {
    "hostname": ["host", "h"],
    "port": "P",
    "ssl": "S",
    "username": ["user", "u"],
    "password": ["passw", "p"],
  },
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Deno.env.get("NNTP_PORT"),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
  },
};

if (import.meta.main) {
  await get();
}

export function help() {
  return `Usage: nzb-get [...flags] <input> <filename>`;
}

export async function get(args = Deno.args, defaults = {}) {
  const {
    _: [input, filename],
    hostname,
    port,
    ssl,
    username,
    password,
    ...flags
  } = parseFlags(args, parseOptions);

  let { out, nzb, file, client } = Object.assign(
    defaults,
    flags,
  );

  //#region Normalize params
  if (!input || !filename) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  /**
   * A `file` can be passed directly from API call; otherwise,
   * retrieves it from the NZB, which can also be passed directly.
   */
  if (!file) {
    if (!nzb) {
      nzb = await NZB.from(
        await Deno.open(input as string),
        input as string,
      );
    }

    file = nzb.file(filename);
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
  //#endregion

  // Stream each segment
  (async () => {
    for (const segment of file.segments) {
      const response = await client.body(segment.id);
      await response.body!
        // Splits into lines first
        .pipeThrough(new DelimiterStream(encoder.encode("\r\n")))
        // Removes yEnc header and trailer lines.
        .pipeThrough(
          new TransformStream({
            transform(line, controller) {
              if (
                startsWith(line, YBEGIN) || startsWith(line, YPART) ||
                startsWith(line, YEND)
              ) {
                return;
              }
              controller.enqueue(line);
            },
          }),
        )
        // Decodes the yEnc stream.
        .pipeThrough(new YEncDecoderStream())
        // Sends result to output.
        .pipeTo(output.writable, { preventClose: true });
    }
    // … and signal that we are finished afterwards.
    await output.writable.close();
  })().catch((err) => {
    if (err.message.includes("connection closed before message completed")) {
      client.close();
      // Ignores this error
    } else {
      console.error(err);
    }
  });
}

/**
 * Determines whether a string begins with the characters of a specified string
 * @param line The line to check
 * @param substr The characters to be searched for at the start of this string.
 * @returns `true` if the given characters are found at the beginning of the string; otherwise, `false`.
 */
function startsWith(line: Uint8Array, substr: Uint8Array): boolean {
  let length = substr.length;
  while (length--) {
    if (line[length] !== substr[length]) {
      return false;
    }
  }

  return true;
}
