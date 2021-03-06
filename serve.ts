#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
import {
  basename,
  compareEtag,
  ConnInfo,
  contentType,
  encode,
  extname,
  parseFlags,
  serve as serveHttp,
  Status,
  STATUS_TEXT,
} from "./deps.ts";

import { File, NZB } from "./model.ts";
import { extract } from "./extract.ts";
import { get } from "./get.ts";
import { fetchNZB, templatized } from "./util.ts";

const DEFAULT_TEMPLATE = "./index.html";

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
    address: "127.0.0.1:8000",
    template: DEFAULT_TEMPLATE,
  },
};

if (import.meta.main) {
  await serve();
}

export function help() {
  return `NZB Server
  Serves content of an NZB file.

INSTALL:
  deno install --allow-net --allow-env --allow-read -n nzb-serve https://deno.land/x/nzb/serve.ts

USAGE:
  nzb-serve [...options] <input>

OPTIONS:
  --address, -addr <address> IPaddress:Port or :Port to bind server to (default "127.0.0.1:8000")
  --template, -t <template> Path to HTML template to use (default "./index.html")
  --hostname, -h <hostname> Hostname of the NNTP server (default "localhost")
  --port, -P <port> Port of the NNTP server (default "8080")
  --ssl, -S <true|false> Whether to use SSL (default false)
  --username, -u <username> Username to authenticate with the NNTP server
  --password, -p <password> Password to authenticate with the NNTP server
  --verbose, -v <true|false> Whether to log requests (default false)`;
}

/**
 * Serves an input NZB as a folder listing.
 *
 * This is the main CLI entrypoint, which spawns a web server to serve
 * the input NZB as listing with `serveNZBIndex`, and routes file
 * requests to `serveFile`.
 */
export async function serve(args = Deno.args) {
  const {
    _: [input],
    address,
    template,
    verbose,
    ...flags
  } = parseFlags(args, parseOptions);

  if (!input) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const nzb = await fetchNZB(input as string);

  const [hostname, port] = address.split(":");

  await serveHttp(
    async (request: Request, conn: ConnInfo): Promise<Response> => {
      const { pathname, searchParams } = new URL(request.url);

      if (pathname === "/") {
        if (!searchParams.has("template")) {
          searchParams.set("template", template);
        }

        const response = await serveNZBIndex(request, conn, { nzb });

        if (verbose) {
          serverLog(request, response.status);
        }

        return response;
      }

      const file = nzb.file(pathname.substring(1));

      if (!file) {
        throw new Deno.errors.NotFound();
      }

      Object.entries(flags).forEach(([key, value]) => {
        searchParams.set(key, value);
      });

      const response = await serveFile(request, conn, { nzb, file });

      if (verbose) {
        serverLog(request, response.status);
      }

      return response;
    },
    { hostname, port: Number(port) },
  );
}

/**
 * Serves a request for NZB file as a folder listing
 *
 * The NZB path should be passed as a route paramter. Both uncompressed
 * or gzipped NZB files are supported. The provided NZB path is used to
 * construct an `NZB` object which is used to serve its content.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@0.147.0/http/server.ts";
 * import { router } from "https://crux.land/router@0.0.12";
 *
 * import { serveNZBIndex } from "./serve.ts";
 *
 * await serve(
 *   router({
 *     "/*.nzb{:gzip(.gz)}?{/}?": (request, conn, params) => {
 *       const { 0: pathname, gzip } = params;
 *       const nzb = `${pathname}.nzb${gzip}`;
 *       return serveNZBIndex(request, conn, {
 *         nzb: decodeURIComponent(nzb),
 *       });
 *     },
 *     },
 *   }),
 * );
 * ```
 *
 * The request can have an `action` query parameter which is used to
 * determine the action to take on the files. There must be form data
 * with a "files" field associated with the action. The "files" will be
 * applied with the requested action.
 *
 * Right now the only supported action is "extract".
 *
 * By default, the listing is rendered using the built-in `index.html`
 * template, which simply displays the NZB information and its files as
 * clickable links, which are then handled by `serveFile` handler.
 *
 * This template can be changed by setting `template` query parameter
 * to another URL. The template could be anything with placeholders for
 * `name` and `files`. See `index.html` for an example.
 *
 * Even though the base template is static HTML, there should not be
 * any stopping you from going full SPA (Single Page Application) with
 * it. You can even have a template the returns JSON instead, and serve
 * your own index page.
 */
export async function serveNZBIndex(
  request: Request,
  _conn: ConnInfo,
  { nzb }: Record<string, string | NZB>,
): Promise<Response> {
  if (typeof nzb === "string") {
    nzb = await fetchNZB(nzb);
  }

  const name = basename(nzb.name as string);
  const { pathname, searchParams } = new URL(request.url);
  const action = searchParams.get("action");

  const headers = new Headers();
  const status = 200;

  if (action === "extract") {
    const formData = await request.formData();
    const files = formData.getAll("files") as string[];

    headers.set("Content-Type", "application/x-nzb");
    headers.set(
      "Content-Disposition",
      `attachment; filename="partial-${name}"`,
    );

    const { readable, writable } = new TransformStream();
    extract([
      nzb.name as string,
      files.map(escapeRegExp).join("|"),
    ], {
      nzb,
      out: writable.getWriter(),
    });

    return new Response(readable, { status, headers });
  }

  headers.set("Content-Type", "text/html");
  // Set "Accept-Ranges" so that the client knows it can make range requests on future requests
  headers.set("Accept-Ranges", "bytes");
  headers.set("Date", new Date().toUTCString());

  const template = searchParams.get("template") || DEFAULT_TEMPLATE;
  const templateText = await fetch(new URL(template, import.meta.url).href)
    .then(
      (res) => res.text(),
    );

  const page = encoder.encode(
    await templatized(templateText, {
      base: pathname.replace(/\/$/, ""),
      name: name,
      files: nzb.files,
    }),
  );

  return new Response(page, { status, headers });
}

/**
 * Serves a request for a file inside an NZB.
 *
 * The NZB path and the file name should be passed as a route paramter.
 * Both uncompressed or gzipped construct an `NZB` object which is used
 * to retrieve the requested file's information.
 *
 * The file is then requested through NNTP and streamed back to the
 * client. It is up to the client to handle the response, whether to
 * play the media file, or to ask the user to save it to disk.
 *
 * Range request is supported.
 *
 * ```ts
 * import { serve } from "https://deno.land/std@0.147.0/http/server.ts";
 * import { router } from "https://crux.land/router@0.0.12";
 *
 * import { serveFile } from "./serve.ts";
 *
 * await serve(
 *   router({
 *     "/*.nzb{:gzip(.gz)}?/:file": (request, conn, params) => {
 *       const { 0: pathname, gzip, file } = params;
 *       const nzb = `${pathname}.nzb${gzip}`;
 *       return serveFile(request, conn, {
 *         nzb: decodeURIComponent(nzb),
 *         file: decodeURIComponent(file),
 *       });
 *     },
 *   }),
 * );
 * ```
 *
 * Internally, the handler normalizes the request and passes to `get`
 * to do the fetching and streaming. All NNTP information are retrieved
 * from environment variables, unless specified through querystring.
 *
 * See `get` for the list of parameters.
 */
export async function serveFile(
  request: Request,
  _conn: ConnInfo,
  { nzb, file }: Record<string, string | NZB | File>,
): Promise<Response> {
  if (typeof file === "string") {
    if (typeof nzb === "string") {
      nzb = await fetchNZB(nzb);
    }

    file = (nzb as NZB).file(file as string) as File;
  }

  file = file as File;

  const headers = new Headers();
  // Set "Accept-Ranges" so that the client knows it can make range requests on future requests
  headers.set("Accept-Ranges", "bytes");
  headers.set("Date", new Date().toUTCString());

  // Set mime-type using the file extension in filePath
  const contentTypeValue = contentType(extname(file.name));
  if (contentTypeValue) {
    headers.set("Content-Type", contentTypeValue);
  }

  let status = Status.OK;
  const responseInit: ResponseInit = { headers };
  // Custom getter for status code and text.
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
    headers.set("Last-Modified", lastModified.toUTCString());

    // Create a simple etag that is an md5 of the last modified date and filesize concatenated
    const simpleEtag = await createEtagHash(
      `${lastModified.toJSON()}${file.size}`,
      "fnv1a",
    );
    headers.set("ETag", simpleEtag);

    // If a `If-None-Match` header is present and the value matches the tag or
    // if a `If-Modified-Since` header is present and the value is bigger than
    // the access timestamp value, then return 304
    const ifNoneMatch = request.headers.get("If-None-Match");
    const ifModifiedSince = request.headers.get("If-Modified-Since");
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

  // Get and parse the "range" header
  const range = request.headers.get("Range") as string;
  const rangeRe = /bytes=(\d+)-(\d+)?/;
  const parsed = rangeRe.exec(range);

  // Use the parsed value if available, fallback to the start and end of the entire file
  const start = parsed && parsed[1] ? +parsed[1] : 0;
  const end = parsed && parsed[2] ? +parsed[2] : file.size - 1;

  // If there is a range, set the status to 206, and set the "Content-Range" header.
  if (range && parsed) {
    headers.set("Content-Range", `bytes ${start}-${end}/${file.size}`);
  }

  // Return 416 if `start` isn't less than or equal to `end`, or `start` or `end` are greater than the file's size
  const maxRange = file.size - 1;

  if (
    range &&
    (!parsed ||
      typeof start !== "number" ||
      start > end ||
      start > maxRange ||
      end > maxRange)
  ) {
    status = Status.RequestedRangeNotSatisfiable;
    return new Response(responseInit.statusText, responseInit);
  }

  // Set content length
  const contentLength = end - start + 1;
  headers.set("Content-Length", `${contentLength}`);

  if (request.method === "HEAD") {
    return new Response(null, responseInit);
  }

  // Uses a default transform stream that `get` can write to.
  const stream = new TransformStream();

  const { searchParams } = new URL(request.url);

  const argv = ["dummy", file.name];
  [
    "hostname",
    "port",
    "ssl",
    "username",
    "password",
  ].forEach((key) => {
    const value = searchParams.get(key);
    if (value) {
      argv.push(`--${key}`);
      argv.push(`${value}`);
    }
  });

  get(argv, {
    file,
    start,
    end,
    out: stream,
    ...searchParams,
  });

  if (range && parsed) {
    status = Status.PartialContent;
  }

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
