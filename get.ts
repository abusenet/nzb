#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
import {
  Client,
  DelimiterStream,
  parseFlags,
  YEncDecoderStream,
} from "./deps.ts";

import { File, NZB, Output } from "./model.ts";

const encoder = new TextEncoder();
const CRLF = encoder.encode("\r\n");
const YBEGIN = encoder.encode("=ybegin");
const YPART = encoder.encode("=ypart");
const YEND = encoder.encode("=yend");

const parseOptions = {
  string: [
    "hostname",
    "port",
    "username",
    "password",
    "start",
    "end",
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

  let { out, nzb, file, start = 0, end, client } = Object.assign(
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

    file = (nzb as NZB).file(filename as string);
  }

  start = Number(start);
  end = Number(end || (file.size - 1));

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

  const segments = [];
  let size = 0;
  // Collects only segments that will cover the requested range.
  // Note that the boundary of all the segments may be bigger than the range.
  // Instead of storing the segments, we just keep metadata about them, with
  // the additional start and end position relative to the segment.
  for (const segment of (file as File).segments) {
    size += segment.size;
    if (size < start) {
      continue;
    }

    const piece = {
      id: segment.id,
      start: 0,
      end: segment.size - 1,
    };

    // Handles the first segment within the range.
    if (!segments.length) {
      piece.start = start - (size - segment.size);
    }

    segments.push(piece);

    // Handles the last segment within the range.
    if (size >= end) {
      piece.end = segment.size - (size - end);
      break;
    }
  }

  // Stream each segment
  (async () => {
    for (const segment of segments) {
      const response = await client.body(segment.id);
      await response.body!
        // Splits into lines first
        .pipeThrough(new DelimiterStream(CRLF))
        // Removes yEnc header and trailer lines.
        .pipeThrough(transform((line, controller) => {
          if (
            startsWith(line, YBEGIN) || startsWith(line, YPART) ||
            startsWith(line, YEND)
          ) {
            return;
          }
          controller.enqueue(line);
        }))
        // Decodes the yEnc stream.
        .pipeThrough(new YEncDecoderStream())
        // Trims to data within range
        .pipeThrough(slice(segment.start, segment.end))
        // Sends result to output.
        .pipeTo(output.writable, { preventClose: true });
    }
    // … and signal that we are finished afterwards.
    await output.writable.close();
  })().catch((err) => {
    console.error(err);
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

/** Helper for creating a simple TransformStream. */
function transform(
  transform: TransformStreamDefaultControllerTransformCallback<
    Uint8Array,
    Uint8Array
  >,
): TransformStream<Uint8Array, Uint8Array> {
  return new TransformStream({
    transform,
  });
}

/**
 * Creates a TransformStream that returns chunks within a range.
 */
function slice(start = 0, end = Number.POSITIVE_INFINITY): TransformStream {
  return transform((chunk, controller) => {
    const byteLength = chunk.byteLength;
    const subchunk = chunk.subarray(
      clamp(0, start, byteLength),
      clamp(0, end + 1, byteLength),
    );
    start -= byteLength;
    end -= byteLength;
    if (subchunk.byteLength > 0) {
      controller.enqueue(subchunk);
    }
  });
}

function clamp(x: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, x));
}
