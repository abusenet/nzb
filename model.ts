import { Article, ElementInfo, SAXParser } from "./deps.ts";

export interface File {
  poster: string;
  /**
   * The last modified date of the file as the number of milliseconds
   * since the Unix epoch (January 1, 1970 at midnight). Files without
   * a known last modified date return the current date.
   */
  lastModified: number;
  name: string;
  size: number;
  subject: string;
  groups: string[];
  segments: Segment[];
}

export interface Segment {
  id: string;
  size: number;
  number: number;
}

/** Output type for most of the commands. */
export type Output = Deno.Writer & Deno.Closer & {
  readonly writable: WritableStream<Uint8Array>;
};

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
  name?: string;
  size = 0;

  static async from(reader: Deno.Reader, name?: string): Promise<NZB> {
    const nzb = new NZB(reader, name);
    await nzb.parse();
    return nzb;
  }

  constructor(reader?: Deno.Reader, name?: string) {
    this.#reader = reader;
    this.name = name;
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
          size: Number(
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
          subject: "",
          name: "",
          lastModified: Date.now(),
          size: 0,
          groups: [],
          segments: [],
        };

        element.attributes.forEach(({ qName, value }) => {
          if (qName === "poster") file.poster = qName;
          // Stores the seconds specfified in `date` attribute as milliseconds.
          if (qName === "date") file.lastModified = Number(value) * 1000;

          if (qName === "subject") {
            file.subject = value;

            if (!value.indexOf("yEnc")) return;
            const { name, size } = yEncParse(value);
            file.name = name || "";
            file.size = Number(size);
          }
          // @ts-ignore string key
          file[qName as keyof File] = value;
        });

        this.files.push(file);
      }
    });

    parser.on("end_element", (element: ElementInfo) => {
      if (element.qName === "file") {
        // Checks if the File has a size (calculated from yEnc subject).
        // If not, sums the bytes of all its segments.
        const file: File = this.files.at(-1)!;
        if (!file.size) {
          file.size = file.segments.reduce((sum, { size }) => sum + size, 0);
        }

        this.size += file.size;
      }
    });

    // Starts parsing.
    return parser.parse(reader);
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
        this.files.map(({ poster, lastModified, subject, groups, segments }) =>
          [
            `  <file poster="${escape(poster)}" date="${
              lastModified / 100
            }" subject="${escape(subject)}">`,

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
          ].join("\n")
        ).join("\n")
      }`,

      `</nzb>`,
    ].join("\n");
  }
}

const SUBJECT_REGEX =
  /"(?<name>[^"]+)"[^\d]+(?<size1>[\d]+)?\s?yEnc(?: \((?<partnum>[\d]+)\/(?<numparts>[\d]+)\))?(?:[^\d]+(?<size2>[\d]+)?)?/;

/**
 * Parses a subject line of a yEnc article to file name and size.
 *
 * Standard single-part yEncoded binaries require no special conventions for
 * the subject line.  It is recommended, however, that yEncoded binaries be
 * specifically identified as such, until the yEncode encoding format becomes
 * more widely implemented.
 *
 * The suggested format for subject lines for single-part binaries is:
 *
 * [Comment1] "filename" 12345 yEnc bytes [Comment2]
 *
 * [Comment1] and [Comment2] are optional.  The filename should always be
 * enclosed in quotes; this allows for easy detection, even when the filename
 * includes spaces or other special characters.  The word "yEnc" should be
 * placed in between the file size and the word "bytes".
 * > (1.2) see additional experience information
 * > Placing the word "yEnc" between filename+bytes or bytes+comment2
 * > is acceptable.
 *
 * Multi-part archives should always be identified as such.  As with
 * single-part binaries, they should also be identified as yEncoded until
 * yEncoding becomes more mainstream.
 *
 * The (strongly) recommended format for subject lines for multi-part binaries
 * is:
 *
 * [Comment1] "filename" yEnc (partnum/numparts) [size] [Comment2]
 *
 * Again, [Comment1] and [Comment2] are optional.  The [size] value is also
 * optional here.  The filename must be included, in quotes.  The keyword
 * "yEnc" is mandatory, and must appear between the filename and the size (or
 * Comment2, if size is omitted).  Future revisions of the draft may specify
 * additional information may be inserted between the "yEnc" keyword and the
 * opening parenthesis of the part number.
 * > (1.2) see additional experience information
 * > Placing the word "yEnc" between (#/#)+size or size+comment2
 * > is acceptable.
 *
 * ## Examples
 *
 * ```ts
 * yEncParse(`reftestnzb 100MB f4d76efc6789 [01/16] - "SomeTestfile-100MB.part1.rar" yEnc (1/22) 15728640`);
 * { name: "SomeTestfile-100MB.part1.rar", size: 15728640 }
 * ```
 */
function yEncParse(subject: string) {
  const { groups } = subject.match(SUBJECT_REGEX) || {};
  if (groups) {
    const { name, size1, partnum, numparts, size2 } = groups;
    return {
      name,
      size: size1 || size2,
      partnum,
      numparts,
    };
  }

  return {};
}
