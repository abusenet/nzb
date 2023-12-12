#!/usr/bin/env -S deno run --allow-net --allow-env --allow-read
import {
  basename,
  contentType,
  encodeHex,
  extname,
  ifNoneMatch,
  parseArgs,
  STATUS_CODE,
  STATUS_TEXT,
} from "./deps.ts";

import { NZB } from "./model.ts";
import { extract } from "./extract.ts";
import { get } from "./get.ts";
import { fetchNZB } from "./util.ts";

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

const DEFAULT_TEMPLATE = "./index.xsl";

const encoder = new TextEncoder();

const parseOptions = {
  string: [
    "address",
    "template",
    "hostname",
    "username",
    "password",
  ],
  boolean: [
    "ssl",
    "verbose",
  ],
  default: {
    address: "127.0.0.1:8000",
    template: DEFAULT_TEMPLATE,
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Number(Deno.env.get("NNTP_PORT")),
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    ssl: Deno.env.get("NNTP_SSL") === "true",
    verbose: false,
  },
};

if (import.meta.main) {
  serve(Deno.args, Deno.serve);
}

/**
 * Serves an input NZB.
 *
 * This is a handler to be passed to a web server like `Deno.serve` to
 * serve the input NZB as listing with `serveNZBIndex`, and routes file
 * requests to `serveFile`.
 */
function serve(args = Deno.args, server = Deno.serve) {
  const parsedArgs = parseArgs(args as string[], parseOptions);
  const {
    _: [input = ""],
    address,
    template,
    verbose,
  } = parsedArgs;

  if (!input) {
    console.error("Missing input");
    console.error(help());
    return;
  }
  const [hostname, port] = address.split(":");

  server({ hostname, port: Number(port) }, async (request) => {
    const url = new URL(request.url);
    const { searchParams } = url;

    if (!searchParams.get("template")) {
      searchParams.set("template", template);
    }

    if (!searchParams.get("url")) {
      searchParams.set("url", input as string);
    }

    // Reconstruct the URL with the new search params
    request = new Request(url, request);
    const response = await router(request);
    if (verbose) {
      serverLog(request, response.status);
    }

    return response;
  });
}

/**
 * Serves content of NZB file
 *
 * The NZB URL must be passed as search paramter `url`. Both uncompressed
 * or gzipped NZB files are supported. The provided NZB URL is used to
 * construct an `NZB` object which is used to serve its content.
 *
 * ```ts
 * import { router } from "./serve.ts";
 *
 * await Deno.serve((request) => {
 *   const url = new URL(request.url);
 *   const { searchParams } = url;
 *
 *   // Defaults to a specific NZB
 *   if (!searchParams.get("url")) {
 *     searchParams.set("url", "https://sabnzbd.org/tests/test_download_100MB.nzb");
 *   }
 *
 *   // Reconstruct the URL with the new search params
 *   request = new Request(url, request);
 *   return router(request);
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
 * By default, the listing is rendered using the built-in `index.xsl`
 * template, which simply displays the NZB information and its files as
 * clickable links, which can be downloaded or streamed.
 *
 * This template can be changed by setting `template` query parameter
 * to another URL. The template could do anything using NZB content as
 * XML data. See `index.xsl` for an example.
 *
 * Even though the base template is static HTML, there should not be
 * any stopping you from going full SPA (Single Page Application) with
 * it. You can even have a template the returns JSON instead, and serve
 * your own index page.
 */
function router(request: Request) {
  const url = new URL(request.url);
  const { pathname, searchParams } = url;

  if (pathname === "/favicon.ico") {
    return new Response(null);
  }

  // Template request from the NZB.
  if (pathname === "/index.xsl") {
    return fetch(
      new URL(searchParams.get("template")!, import.meta.url).href,
    );
  }

  if (pathname === "/") {
    return index(request);
  }

  return file(request);
}

const exports = {
  fetch: router,
};

export {
  // For Cloudflare Workers.
  exports as default,
  router as fetch,
  serve,
};

/**
 * List files in an NZB.
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function index(request: Request) {
  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response(null, { status: STATUS_CODE.BadRequest });
  }

  let nzb = await fetchNZB(url);

  const name = basename(nzb.name as string);
  const query = searchParams.get("q");
  const action = searchParams.get("action");

  if (query) {
    const files = nzb.files;
    nzb = new NZB();
    files.forEach((file) => {
      if (file.name.match(query as string)) {
        (nzb as NZB).files.push(file);
      }
    });
  }

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
    extract([nzb as unknown, files.map(escapeRegExp).join("|")], writable);

    return new Response(readable, { status, headers });
  }

  headers.set("Content-Type", "text/xml");
  // Set "Accept-Ranges" so that the client knows it can make range requests on future requests
  headers.set("Accept-Ranges", "bytes");
  headers.set("Date", new Date().toUTCString());

  nzb.pi("xml-stylesheet", { type: "text/xsl", href: "index.xsl" });

  return new Response(nzb.toString(), { status, headers });
}

/**
 * Serves a request for a file inside an NZB.
 *
 * The file is requested through NNTP and streamed back to the
 * client. It is up to the client to handle the response, whether to
 * play the media file, or to ask the user to save it to disk.
 *
 * Range request is supported.
 *
 * Internally, the handler normalizes the request and passes to `get`
 * to do the fetching and streaming. All NNTP information are retrieved
 * from environment variables, unless specified through querystring.
 *
 * See `get` for the list of parameters.
 *
 * @param {Request} request
 * @returns {Promise<Response>}
 */
async function file(request: Request) {
  const { pathname, searchParams } = new URL(request.url);
  const url = searchParams.get("url");

  if (!url) {
    return new Response(null, { status: STATUS_CODE.BadRequest });
  }

  const nzb = await fetchNZB(url);
  const file = nzb.file(decodeURI(pathname.substring(1)));

  if (!file) {
    return new Response(null, { status: STATUS_CODE.NotFound });
  }

  const headers = new Headers();
  // Set "Accept-Ranges" so that the client knows it can make range requests on future requests
  headers.set("Accept-Ranges", "bytes");
  headers.set("Date", new Date().toUTCString());

  // Set mime-type using the file extension in filePath
  const contentTypeValue = contentType(extname(file.name));
  if (contentTypeValue) {
    headers.set("Content-Type", contentTypeValue);
  }

  if (extname(file.name) === ".mkv") {
    // Chrome needs this changed to play MKV.
    headers.set("Content-Type", "video/webm");
  }

  let status: number = STATUS_CODE.OK;
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
        return (STATUS_TEXT as Record<number, string>)[status];
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
    const ifNoneMatchValue = request.headers.get("If-None-Match");
    const ifModifiedSince = request.headers.get("If-Modified-Since");
    if (
      (ifNoneMatchValue && ifNoneMatch(ifNoneMatchValue, simpleEtag)) ||
      (ifNoneMatchValue === null &&
        ifModifiedSince &&
        file.lastModified < new Date(ifModifiedSince).getTime() + 1000)
    ) {
      status = STATUS_CODE.NotModified;
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
    status = STATUS_CODE.RangeNotSatisfiable;
    return new Response(responseInit.statusText, responseInit);
  }

  // Set content length
  const contentLength = end - start + 1;
  headers.set("Content-Length", `${contentLength}`);

  if (request.method === "HEAD") {
    return new Response(null, responseInit);
  }

  searchParams.set("start", `${start}`);
  searchParams.set("end", `${end}`);

  const argv: unknown[] = [nzb, file];
  [
    "hostname",
    "port",
    "ssl",
    "username",
    "password",
    "start",
    "end",
  ].forEach((key) => {
    const value = searchParams.get(key);
    if (value) {
      argv.push(`--${key}`);
      argv.push(`${value}`);
    }
  });
  // Uses a default transform stream that `get` can write to.
  const { readable, writable } = new TransformStream();
  get(argv, writable);

  if (range && parsed) {
    status = STATUS_CODE.PartialContent;
  }

  return new Response(readable, responseInit);
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
  return encodeHex(new Uint8Array(hashBuffer));
}
