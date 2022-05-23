#!/usr/bin/env -S deno run --allow-net --allow-read
import {
  basename,
  parseFlags,
  prettyBytes,
  serve as serveHttp,
} from "./deps.ts";

import { File, NZB } from "./model.ts";
import { extract } from "./extract.ts";

const parseOptions = {
  string: [
    "hostname",
    "port",
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
    ...options
  } = parseFlags(args, parseOptions);

  if (!filename) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const name: string = basename(filename as string, ".nzb");

  const nzb = await NZB.from(
    await Deno.open(filename as string),
    name,
  );

  await serveHttp(async (request: Request): Promise<Response> => {
    const { searchParams } = new URL(request.url);
    const action = searchParams.get("action");

    if (action === "extract") {
      const formData = await request.formData();
      const files = formData.getAll("files") as string[];

      const headers = new Headers({
        "Content-Type": "application/x-nzb",
        "Content-Disposition": `attachment; filename="partial-${name}.nzb"`,
      });

      const stream = new TransformStream<Uint8Array, Uint8Array>();
      extract([
        filename as string,
        files.map(escapeRegExp).join("|"),
      ], {
        out: stream.writable.getWriter(),
      });

      return new Response(stream.readable, { status: 200, headers });
    }

    return serveNZB(request, nzb);
  }, options);
}

function serveNZB(_request: Request, nzb: NZB): Response {
  const headers = new Headers();
  headers.set("server", "deno");

  // Set "accept-ranges" so that the client knows it can make range requests on future requests
  headers.set("accept-ranges", "bytes");
  headers.set("date", new Date().toUTCString());

  headers.set("content-type", "text/html");

  const page = new TextEncoder().encode(
    dirViewerTemplate(nzb.name!, nzb.files),
  );

  return new Response(page, { status: 200, headers });
}

function dirViewerTemplate(dirname: string, files: File[]): string {
  const paths = dirname.split("/");

  return `
    <h1>Index of
      ${
    paths.map((path, index, array) => {
      if (path === "") return "";
      const link = array.slice(0, index + 1).join("/");
      return `<a href="${link}">${path}</a>`;
    })
      .join("/")
  }
    </h1>

    <table cellpadding="6">
      <thead>
        <tr>
          <td></td>
          <th>Name</th>
          <th>Size</th>
          <th>Poster</th>
          <th>Last Modified Date</th>
        </tr>
      </thead>
      <tbody>
      ${
    files.map((file) => `
        <tr>
          <td>
            <input type="checkbox" name="files" value="${file.name}" form="bulk" />
          </td>
          <td>
            ${file.name}
          </td>
          <td>
            ${prettyBytes(file.size)}
          </td>
          <td>
            ${file.poster}
          </td>
          <td>
            ${new Date(file.lastModified).toUTCString()}
          </td>
        </tr>
      `).join("")
  }
      </tbody>
      <tfoot>
        <tr>
          <td>
            <form id="bulk">
              <button type="submit" formmethod="POST" formaction="/?action=extract">Extract</button>
            </form>
          </td>
        </tr>
      </tfoot>
    </table>
    `;
}

function escapeRegExp(string: string) {
  return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); // $& means the whole matched string
}
