import {
  basename,
  parseFlags,
  prettyBytes,
  serve as serveHttp,
} from "./deps.ts";

import { NZB } from "./nzb.ts";

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

const encoder = new TextEncoder();

function serveNZB(request: Request, nzb: NZB): Response {
  const headers = new Headers();
  headers.set("server", "deno");

  // Set "accept-ranges" so that the client knows it can make range requests on future requests
  headers.set("accept-ranges", "bytes");
  headers.set("date", new Date().toUTCString());

  headers.set("content-type", "text/html");

  const page = encoder.encode(dirViewerTemplate(nzb));

  return new Response(page, { status: 200, headers });
}

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

  const nzb = await NZB.from(
    await Deno.open(filename as string),
    basename(filename as string, ".nzb"),
  );

  await serveHttp((request: Request) => {
    return serveNZB(request, nzb);
  }, options);
}

function dirViewerTemplate({ name, files }: NZB): string {
  return `
    <h1>Index of ${name}</h1>
    <table cellpadding="6">
      <thead>
        <tr>
          <th>Name</th>
          <th>Size</th>
          <th>Poster</th>
          <th>Last Modified Date</th>
        </tr>
      </thead>
      ${
    files.map((file) => `
        <tr>
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
    </table>
    `;
}
