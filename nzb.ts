import { Article, ElementInfo, SAXParser } from "./deps.ts";

export interface File {
  poster: string;
  date: string;
  subject: string;
  groups: string[];
  segments: Segment[];
}

export interface Segment {
  id: string;
  bytes: number;
  number: number;
}

function escape(html: string): string {
  return html.replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export class NZB implements Iterable<File> {
  #reader?: Deno.Reader;
  readonly head: Record<string, string> = {};
  readonly files: File[] = [];
  #segments = 0;

  static async from(reader: Deno.Reader): Promise<NZB> {
    const nzb = new NZB(reader);
    await nzb.parse();
    return nzb;
  }

  constructor(reader?: Deno.Reader) {
    this.#reader = reader;
  }

  get segments(): number {
    return this.#segments;
  }

  parse(reader: Deno.Reader | undefined = this.#reader) {
    if (!reader) {
      return;
    }

    const parser = new SAXParser();
    parser.on("text", (text: string, { qName, attributes }: ElementInfo) => {
      if (qName === "meta") {
        const type = attributes.find((attr) => attr.qName === "type")!.value;
        this.head[type] = text;
      }

      if (qName === "group") {
        const file: File = this.files.at(-1)!;
        file.groups.push(text);
      }

      if (qName === "segment") {
        const file: File = this.files.at(-1)!;
        file.segments.push({
          id: text,
          bytes: Number(
            attributes.find((attr) => attr.qName === "bytes")!.value,
          ),
          number: Number(
            attributes.find((attr) => attr.qName === "number")!.value,
          ),
        });

        this.#segments++;
      }
    });

    parser.on("start_element", (element: ElementInfo) => {
      if (element.qName === "file") {
        const file: File = {
          poster: "",
          date: "",
          subject: "",
          groups: [],
          segments: [],
        };

        element.attributes.forEach(({ qName, value }) => {
          // @ts-ignore string key
          file[qName as keyof File] = value;
        });

        this.files.push(file);
      }
    });

    // Starts parsing.
    return parser.parse(reader);
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
              const { poster, date, subject, groups, segments } =
                files[currentFile];
              const total = segments.length;
              if (currentSegment <= (total - 1)) {
                const { id, number, bytes } = segments[currentSegment++];
                const article = new Article({
                  headers: {
                    "from": poster,
                    "date": new Date(Number(date) * 1000).toUTCString(),
                    // The file's subject is the subject of the first segment, so we
                    // replace it with the current number.
                    "subject": subject.replace(
                      `(1/${total})`,
                      `(${number}/${total})`,
                    ),
                    "newsgroups": groups.join(","),
                    "message-id": `<${id}>`,
                    "bytes": `${bytes}`,
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

      `${
        this.files.map(({ poster, date, subject, groups, segments }) =>
          [
            `  <file poster="${escape(poster)}" date="${date}" subject="${
              escape(subject)
            }">`,

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
              segments.map(({ id, bytes, number }) =>
                [
                  `      <segment bytes="${bytes}" number="${number}">${id}</segment>`,
                ].join("\n")
              ).join("\n")
            }`,
            `    </segments>`,

            `  </file>`,
          ].join("\n")
        ).join("\n")
      }`,

      `</nzb>`,
    ].join("\n");
  }
}
