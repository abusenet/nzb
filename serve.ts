#!/usr/bin/env -S deno run --allow-net --allow-read
import {
  basename,
  parseFlags,
  prettyBytes,
  serve as serveHttp,
} from "./deps.ts";

import { NZB } from "./model.ts";
import { extract } from "./extract.ts";

const parseOptions = {
  string: [
    "hostname",
    "port",
    "template",
  ],
  alias: {
    "hostname": ["host", "h"],
    "port": "P",
  },
  default: {
    hostname: "0.0.0.0",
    port: 8000,
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
    hostname,
    port,
    template = "./index.html",
  } = parseFlags(args, parseOptions);

  if (!filename) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const nzb = await NZB.from(
    await Deno.open(filename as string),
    basename(filename as string, ".nzb"),
  );

  await serveHttp(async (request: Request): Promise<Response> => {
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
        `attachment; filename="partial-${nzb.name}.nzb"`,
      );

      const stream = new TransformStream<Uint8Array, Uint8Array>();
      extract([
        filename as string,
        files.map(escapeRegExp).join("|"),
      ], {
        out: stream.writable.getWriter(),
      });

      return new Response(stream.readable, { status, headers });
    }

    headers.set("Content-type", "text/html");
    // Set "accept-ranges" so that the client knows it can make range requests on future requests
    headers.set("Accept-Ranges", "bytes");
    headers.set("Date", new Date().toUTCString());

    const templateText = await fetch(new URL(template, import.meta.url)).then(
      (res) => res.text(),
    );

    const page = new TextEncoder().encode(
      templatized(templateText, {
        name: nzb.name!,
        files: nzb.files,
        prettyBytes,
      }),
    );

    return new Response(page, { status, headers });
  }, { hostname, port });
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}

function templatized(template: string, assigns = {}) {
  const handler = new Function(
    "assigns",
    [
      "const tagged = ( " + Object.keys(assigns).join(", ") + " ) =>",
      "`" + template + "`",
      "return tagged(...Object.values(assigns))",
    ].join("\n"),
  );

  return handler(assigns);
}
