#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
import {
  Client,
  DelimiterStream,
  endsWith,
  parseArgs,
  startsWith,
  YEncDecoderStream,
} from "./deps.ts";

import { File, NZB } from "./model.ts";
import { fetchNZB } from "./util.ts";

export function help() {
  return `NZB Get
  Fetches a file in an NZB.

INSTALL:
  deno install --allow-net --allow-env --allow-read -n nzb-get https://deno.land/x/nzb/get.ts

USAGE:
  nzb-get [...options] <input> <filename>

OPTIONS:
  --hostname, -h <hostname> The hostname of the NNTP server.
  --port, -P <port> The port of the NNTP server.
  --ssl, -S Whether to use SSL.
  --username, -u <username> Username to authenticate with the NNTP server.
  --password, -p <password> Password to authenticate with the NNTP server.
  --start, -s <start> The start of the range of the file to fetch.
  --end, -e <end> The end of the range of the file to fetch.`;
}

const encoder = new TextEncoder();
const CRLF = encoder.encode("\r\n");
const YBEGIN = encoder.encode("=ybegin");
const YPART = encoder.encode("=ypart");
const YEND = encoder.encode("=yend");

const parseOptions = {
  string: [
    "hostname",
    "username",
    "password",
  ],
  boolean: [
    "ssl",
  ],
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Number(Deno.env.get("NNTP_PORT")),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    ssl: Deno.env.get("NNTP_SSL") === "true",
    start: 0,
    end: 0,
  },
};

if (import.meta.main) {
  get(Deno.args, Deno.stdout.writable);
}

/**
 * Retrieves a file speficified by the given NZB and file name.
 *
 * All segments of the file are returned as a single stream, clipped to
 * the given range if any.
 * @param {unknown[]} args The argument list.
 * @param {WritableStream<Uint8Array>} [writable] The writable stream to write to.
 */
export async function get(
  args: unknown[] = Deno.args,
  output = Deno.stdout.writable,
) {
  const parsedArgs = parseArgs(args as string[], parseOptions);
  let {
    _: [input, filename],
    hostname,
    port,
    ssl,
    username,
    password,
    start = 0,
    end,
  } = parsedArgs;

  if (!input || !filename) {
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

  if (!file) {
    console.error(`File "${filename}" not found in NZB`);
    return;
  }

  start = Number(start);
  end = Number(end || (file.size - 1));

  const client = await Client.connect({
    hostname,
    port: Number(port),
    ssl: !!ssl,
  });

  if (username) {
    await client.authinfo(username, password);
  }

  const segments = [];
  let size = 0;
  // Collects only segments that will cover the requested range.
  // Note that the boundary of all the segments may be bigger than the range.
  // Instead of storing the segments, we just keep metadata about them, with
  // the additional start and end position relative to the segment.
  for (const segment of file.segments) {
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

  (async () => {
    for (const segment of segments) {
      const response = await client.body(segment.id);
      await response.body!
        // Splits into lines first
        .pipeThrough(new DelimiterStream(CRLF))
        // Removes yEnc header and trailer lines.
        .pipeThrough(skip([YBEGIN, YPART, YEND]))
        // Decodes the yEnc stream.
        .pipeThrough(new YEncDecoderStream())
        // Trims to data within range
        .pipeThrough(slice(segment.start, segment.end))
        // Sends result to output.
        .pipeTo(output, { preventClose: true });
    }
    // … and signal that we are finished afterwards.
    await output.close();
  })().catch((err) => {
    console.error(err);
  });
}

/**
 * Creates a TransformStream that skips chunks that match the given patterns.
 */
function skip(startWith: Uint8Array[] = [], endWith: Uint8Array[] = []) {
  return new TransformStream({
    transform(chunk, controller) {
      if (startWith.some((start) => startsWith(chunk, start))) {
        return;
      }
      if (endWith.some((end) => endsWith(chunk, end))) {
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Creates a TransformStream that returns chunks within a range.
 */
function slice(start = 0, end = Number.POSITIVE_INFINITY): TransformStream {
  return new TransformStream({
    transform(chunk, controller) {
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
    },
  });
}

function clamp(x: number, lower: number, upper: number) {
  return Math.min(upper, Math.max(lower, x));
}
