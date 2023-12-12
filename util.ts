import { extname, prettyBytes, ProgressBar } from "./deps.ts";
import { NZB } from "./model.ts";

/**
 * Fetches a NZB file from the given URL.
 */
export async function fetchNZB(input: string) {
  const url = new URL(input, import.meta.url).href;
  const file: Response = await fetch(url);
  let body = file.body!;
  if (extname(url) === ".gz") {
    body = body.pipeThrough(new DecompressionStream("gzip"));
  }

  return NZB.from(
    body,
    input,
  );
}

/**
 * Pretifies number of seconds into "dd:hh:mm:ss".
 */
export function prettySeconds(seconds: number): string {
  let result = new Date(1000 * seconds).toISOString().substring(11, 19);
  // Prefixes with number of days if any.
  result = parseInt(`${seconds / 86400}`) + `:${result}`;
  // result = result.replace(/00/g, "0");
  result = result.replace(
    /(\d+:)?(\d+:)?(\d+:)?(\d+)?/,
    (_, days, hours, minutes, seconds) => {
      let result = seconds + "s";
      if (minutes) result = minutes.replace(":", "m:") + result;
      if (hours) result = hours.replace(":", "h:") + result;
      if (days) result = days.replace(":", "d:") + result;
      return result;
    },
  );
  result = result.replace(/^[0(d|h|m|s):]+/, "");
  result = result.replace(/00/g, "0");

  return result;
}

const SUBJECT_REGEX =
  /"(?<name>[^"]+)"(?: yEnc)?(?: \((?<partnum>[\d]+)\/(?<numparts>[\d]+)\))?(?: yEnc)?[^\d]?(?<size>[\d]+)?/;

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
 * { name: "SomeTestfile-100MB.part1.rar", size: 15728640, partnum: 1, numparts: 22 }
 * ```
 *
 * @param {string} subject The subject line of the article.
 * @returns {object} An object with the parsed values.
 */
export function yEncParse(
  subject: string,
): { name?: string; size?: number; partnum?: number; numparts?: number } {
  const { groups = {} } = subject.match(SUBJECT_REGEX) || {};
  return groups;
}

/**
 * Custom Progress with prettified values.
 */
export class Progress extends ProgressBar {
  #start;

  constructor(options = {}) {
    super(options);
    this.#start = Date.now();
  }

  render(completed: number, options: Record<string, string | number> = {}) {
    const total = (options.total ?? this.total ?? 100) as number;
    const elapsed = Date.now() - this.#start;

    const display = this.display;
    // Overrides the progress bar display to pretify numbers.
    this.display = display
      .replace(":completed", prettyBytes(Math.min(completed, total)))
      .replace(":total", prettyBytes(total))
      // Ensures percentages is not over 100%.
      .replace(
        ":percent",
        Math.min((completed / total) * 100, 100).toFixed(2) + "%",
      )
      // Displays rate.
      .replace(
        ":rate",
        prettyBytes((completed / elapsed) * 1000),
      )
      // Pretifies elapsed time
      .replace(
        ":time",
        prettySeconds(elapsed / 1000),
      )
      // Pretifies ETA time.
      .replace(
        ":eta",
        completed == 0
          ? "-"
          : (completed >= total
            ? "0s"
            : prettySeconds((total / completed - 1) * elapsed / 1000)),
      );

    super.render(completed, options);
    this.display = display;
  }
}
