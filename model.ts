import { Article } from "./deps.ts";
import { yEncParse } from "./util.ts";
import {
  Element,
  HTMLRewriter,
  TextChunk,
} from "npm:@worker-tools/html-rewriter@0.1.0-pre.17/base64";

export class File {
  poster!: string;
  /**
   * The last modified date of the file as the number of milliseconds
   * since the Unix epoch (January 1, 1970 at midnight). Files without
   * a known last modified date return the current date.
   */
  lastModified!: number;
  name!: string;
  size!: number;
  subject!: string;
  groups!: string[];
  segments!: Segment[];

  constructor(file: File) {
    Object.assign(this, file);
  }

  toString() {
    const { poster, lastModified, subject, groups, segments } = this;
    return [
      `  <file poster="${escapeXml(poster)}" date="${
        lastModified / 1000
      }" subject="${escapeXml(subject)}">`,

      `    <groups>`,
      `${
        groups.map((group) =>
          [
            `      <group>${group}</group>`,
          ].join("\n")
        ).join("\n")
      }`,
      `    </groups>`,

      `    <segments>`,
      `${
        segments.map(({ id, size, number }) =>
          [
            `      <segment bytes="${size}" number="${number}">${id}</segment>`,
          ].join("\n")
        ).join("\n")
      }`,
      `    </segments>`,

      `  </file>`,
    ].join("\n");
  }
}

export interface Segment {
  id: string;
  size: number;
  number: number;
}

/** Output type for most of the commands. */
export type Output = {
  readonly writable: WritableStream<Uint8Array>;
};

export class NZB implements Iterable<File> {
  #readable?: ReadableStream;
  readonly processingInstructions: Record<string, Record<string, string>> = {};
  readonly head: Record<string, string> = {};
  readonly files: File[] = [];
  #segments = 0;
  name?: string;
  size = 0;

  static async from(readable: ReadableStream, name?: string): Promise<NZB> {
    const nzb = new NZB(readable, name);
    await nzb.parse();
    return nzb;
  }

  constructor(readable?: ReadableStream, name?: string) {
    this.#readable = readable;
    this.name = name;
  }

  get segments(): number {
    return this.#segments;
  }

  pi(name: string, data: Record<string, string>) {
    this.processingInstructions[name] = data;
  }

  parse(readable = this.#readable) {
    if (!readable) {
      return;
    }

    let meta = { name: "", value: "" }, group = "";

    return new HTMLRewriter()
      .on("head", {
        text: ({ text, lastInTextNode }: TextChunk) => {
          meta.value += text;
          if (lastInTextNode) {
            meta.value = meta.value.trim();
            if (meta.name) {
              this.head[meta.name] = meta.value;
            }
          }
        },
      })
      .on("head > meta", {
        element: (element: Element) => {
          const name = element.getAttribute("type");
          meta = { name, value: "" };
        },
      })
      .on("file > groups > group", {
        element: (element: Element) => {
          const file: File = this.files.at(-1)!;
          group = "";

          element.onEndTag(() => {
            file.groups.push(group);
          });
        },
        text: ({ text, lastInTextNode }: TextChunk) => {
          group += text;
          if (lastInTextNode) {
            group = group.trim();
          }
        },
      })
      .on("file", {
        element: (element: Element) => {
          const subject = unescapeXml(element.getAttribute("subject"));
          const file: File = new File({
            poster: element.getAttribute("poster"),
            subject,
            name: "",
            // Stores the seconds specfified in `date` attribute as milliseconds.
            lastModified: Number(element.getAttribute("date")) * 1000,
            size: 0,
            groups: [],
            segments: [],
          });

          if (!subject.indexOf("yEnc")) return;
          const { name, size } = yEncParse(subject);
          file.name = name || "";
          file.size = Number(size);

          this.files.push(file);

          element.onEndTag(() => {
            if (!file.size) {
              file.size = file.segments.reduce(
                (sum, { size }) => sum + size,
                0,
              );
            }

            this.size += file.size;
          });
        },
      })
      .on("file > segments > segment", {
        element: (element: Element) => {
          const file = this.files.at(-1)!;
          file.segments.push({
            id: "",
            size: Number(element.getAttribute("bytes")),
            number: Number(element.getAttribute("number")),
          });

          this.#segments++;
        },
        text: ({ text, lastInTextNode }: TextChunk) => {
          const file = this.files.at(-1)!;
          const segment = file.segments.at(-1)!;
          segment.id += text;
          if (lastInTextNode) {
            segment.id = segment.id.trim();
          }
        },
      })
      .transform(new Response(readable))
      .arrayBuffer(); // Kickstarts the stream.
  }

  file(name: string) {
    return this.files.find((file) => file.name === name);
  }

  [Symbol.iterator](): Iterator<File> {
    return this.files.values();
  }

  articles() {
    return {
      [Symbol.iterator]: () => {
        const files = this.files, lastFile = files.length - 1;
        let currentFile = 0, currentSegment = 0;

        return {
          next(): IteratorResult<Article> {
            if (currentFile <= lastFile) {
              const { poster, lastModified, subject, groups, segments } =
                files[currentFile];
              const total = segments.length;
              if (currentSegment <= (total - 1)) {
                const { id, number, size } = segments[currentSegment++];
                const article = new Article({
                  headers: {
                    "from": poster,
                    "date": new Date(lastModified).toUTCString(),
                    // The file's subject is the subject of the first segment, so we
                    // replace it with the current number.
                    "subject": subject.replace(
                      `(1/${total})`,
                      `(${number}/${total})`,
                    ),
                    "newsgroups": groups.join(","),
                    "message-id": `<${id}>`,
                    "bytes": `${size}`,
                  },
                });
                article.number = number;
                return { done: false, value: article };
              } else {
                currentSegment = 0;
                currentFile++;
                return this.next();
              }
            } else {
              return { done: true, value: null };
            }
          },
        };
      },
    };
  }

  toString() {
    return [
      `<?xml version="1.0" encoding="utf-8"?>`,
      Object.entries(this.processingInstructions).map(([name, data]) =>
        `<?${name} ${
          Object.entries(data).map(([key, value]) => `${key}="${value}"`).join(
            " ",
          )
        }?>`
      ).join("\n"),
      `<!DOCTYPE nzb PUBLIC "-//newzBin//DTD NZB 1.1//EN" "http://www.newzbin.com/DTD/nzb/nzb-1.1.dtd">`,
      `<nzb xmlns="http://www.newzbin.com/DTD/2003/nzb">`,

      `  <head>`,
      `${
        Object.entries(this.head).map(([type, value]) =>
          [
            `    <meta type="${type}">${value}</meta>`,
          ].join("\n")
        ).join("\n")
      }`,
      `  </head>`,

      `${this.files.map((file) => `${file}`).join("\n")}`,

      `</nzb>`,
    ].join("\n");
  }
}

function escapeXml(unsafe: string): string {
  return unsafe.replace(/[<>&'"]/g, function (c) {
    switch (c) {
      case `<`:
        return `&lt;`;
      case `>`:
        return `&gt;`;
      case `&`:
        return `&amp;`;
      case `'`:
        return `&apos;`;
      case `"`:
        return `&quot;`;
      default:
        return c;
    }
  });
}

function unescapeXml(escaped: string): string {
  return escaped.replace(/&lt;|&gt;|&amp;|&apos;|&quot;/g, function (c) {
    switch (c) {
      case `&lt;`:
        return `<`;
      case `&gt;`:
        return `>`;
      case `&amp;`:
        return `&`;
      case `&apos;`:
        return `'`;
      case `&quot;`:
        return `"`;
      default:
        return c;
    }
  });
}
