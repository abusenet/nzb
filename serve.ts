#!/usr/bin/env -S deno run --allow-net --allow-read
import {
  basename,
  contentType,
  encode,
  extname,
  parseFlags,
  prettyBytes,
  serve as serveHttp,
  Status,
  STATUS_TEXT,
} from "./deps.ts";

import { File, NZB } from "./model.ts";
import { extract } from "./extract.ts";
import { get } from "./get.ts";
import { templatized } from "./util.ts";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const parseOptions = {
  string: [
    "address",
    "template",
    "hostname",
    "port",
    "username",
    "password",
  ],
  boolean: [
    "ssl",
    "verbose",
  ],
  alias: {
    "address": "addr",
    "hostname": ["host", "h"],
    "port": "P",
    "ssl": "S",
    "verbose": "v",
  },
  default: {
    address: "0.0.0.0:8000",
    template: "./index.html",
  },
};

if (import.meta.main) {
  await serve();
}

export function help() {
  return `Usage: nzb-serve [...flags] <input>`;
}

/**
 * Serves an input NZB as a folder listing
 */
export async function serve(args = Deno.args) {
  const {
    _: [filename],
    address,
    template,
    verbose,
    ...flags
  } = parseFlags(args, parseOptions);

  if (!filename) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const nzb = await NZB.from(
    await Deno.open(filename as string),
    filename as string,
  );

  const [hostname, port] = address.split(":");

  await serveHttp(async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);

    if (pathname === "/") {
      const response = await serveDirIndex(request, nzb, {
        template,
      });

      if (verbose) {
        serverLog(request, response.status);
      }

      return response;
    }

    const file = nzb.file(pathname.substring(1));

    if (!file) {
      throw new Deno.errors.NotFound();
    }

    const response = await serveFile(request, file!, flags);

    if (verbose) {
      serverLog(request, response.status);
    }

    return response;
  }, { hostname, port: Number(port) });
}

async function serveDirIndex(
  request: Request,
  nzb: NZB,
  options: { template: string },
): Promise<Response> {
  const name = basename(nzb.name as string, ".nzb");
  const { searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  const headers = new Headers();
  const status = 200;

  if (action === "extract") {
    const formData = await request.formData();
    const files = formData.getAll("files") as string[];

    headers.set("Content-Type", "application/x-nzb");
    headers.set(
      "Content-Disposition",
      `attachment; filename="partial-${name}.nzb"`,
    );

    const { readable, writable } = new TransformStream();
    extract([
      nzb.name as string,
      files.map(escapeRegExp).join("|"),
    ], {
      out: writable.getWriter(),
    });

    return new Response(readable, { status, headers });
  }

  headers.set("Content-type", "text/html");
  // Set "accept-ranges" so that the client knows it can make range requests on future requests
  headers.set("Accept-Ranges", "bytes");
  headers.set("Date", new Date().toUTCString());

  const templateText = await fetch(new URL(options.template, import.meta.url))
    .then(
      (res) => res.text(),
    );

  const page = encoder.encode(
    templatized(templateText, {
      name: name,
      files: nzb.files,
      prettyBytes,
    }),
  );

  return new Response(page, { status, headers });
}

async function serveFile(
  request: Request,
  file: File,
  options: Record<string, string | number | boolean> = {},
): Promise<Response> {
  const headers = new Headers();
  headers.set("date", new Date().toUTCString());

  // Set mime-type using the file extension in filePath
  const contentTypeValue = contentType(extname(file.name));
  if (contentTypeValue) {
    headers.set("content-type", contentTypeValue);
  }

  let status = Status.OK;
  const responseInit: ResponseInit = { headers };
  Object.defineProperties(responseInit, {
    status: {
      get() {
        return status;
      },
    },
    statusText: {
      get() {
        return STATUS_TEXT[status];
      },
    },
  });

  // Set date header if access timestamp is available
  // if (file.atime instanceof Date) {
  //   const date = new Date(file.atime);
  //   headers.set("date", date.toUTCString());
  // }

  // Set last modified header
  if (file.lastModified) {
    const lastModified = new Date(file.lastModified);
    headers.set("last-modified", lastModified.toUTCString());

    // Create a simple etag that is an md5 of the last modified date and filesize concatenated
    const simpleEtag = await createEtagHash(
      `${lastModified.toJSON()}${file.size}`,
      "fnv1a",
    );
    headers.set("etag", simpleEtag);

    // If a `if-none-match` header is present and the value matches the tag or
    // if a `if-modified-since` header is present and the value is bigger than
    // the access timestamp value, then return 304
    const ifNoneMatch = request.headers.get("if-none-match");
    const ifModifiedSince = request.headers.get("if-modified-since");
    if (
      (ifNoneMatch && compareEtag(ifNoneMatch, simpleEtag)) ||
      (ifNoneMatch === null &&
        ifModifiedSince &&
        file.lastModified < new Date(ifModifiedSince).getTime() + 1000)
    ) {
      status = Status.NotModified;
      return new Response(null, responseInit);
    }
  }

  headers.set("content-length", `${file.size}`);

  if (request.method === "HEAD") {
    return new Response(null, responseInit);
  }

  // Uses a default transform stream that `get` can write to.
  const stream = new TransformStream();

  const argv = ["dummy", file.name];
  [
    "hostname",
    "port",
    "ssl",
    "username",
    "password",
  ].forEach((key) => {
    const value = options[key];
    if (value) {
      argv.push(`--${key}`);
      argv.push(`${value}`);
    }
  });

  get(argv, {
    file,
    out: stream,
    ...options,
  });

  return new Response(stream.readable, responseInit);
}

function serverLog(req: Request, status: number): void {
  const d = new Date().toISOString();
  const dateFmt = `[${d.slice(0, 10)} ${d.slice(11, 19)}]`;
  const normalizedUrl = new URL(req.url).pathname;
  const s = `${dateFmt} [${req.method}] ${normalizedUrl} ${status}`;
  // using console.debug instead of console.log so chrome inspect users can hide request logs
  console.debug(s);
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

// The fnv-1a hash function.
function fnv1a(buf: string): string {
  let hash = 2166136261; // 32-bit FNV offset basis
  for (let i = 0; i < buf.length; i++) {
    hash ^= buf.charCodeAt(i);
    // Equivalent to `hash *= 16777619` without using BigInt
    // 32-bit FNV prime
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) +
      (hash << 24);
  }
  // 32-bit hex string
  return (hash >>> 0).toString(16);
}

/** Algorithm used to determine etag */
export type EtagAlgorithm =
  | "fnv1a"
  | "sha-1"
  | "sha-256"
  | "sha-384"
  | "sha-512";

// Generates a hash for the provided string
async function createEtagHash(
  message: string,
  algorithm: EtagAlgorithm = "fnv1a",
): Promise<string> {
  if (algorithm === "fnv1a") {
    return fnv1a(message);
  }
  const msgUint8 = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest(algorithm, msgUint8);
  return decoder.decode(encode(new Uint8Array(hashBuffer)));
}

function compareEtag(a: string, b: string): boolean {
  if (a === b) {
    return true;
  }
  if (a.startsWith("W/") && !b.startsWith("W/")) {
    return a.slice(2) === b;
  }
  if (!a.startsWith("W/") && b.startsWith("W/")) {
    return a === b.slice(2);
  }
  return false;
}
