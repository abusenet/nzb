import {
  basename,
  extname,
  prettyBytes,
  ProgressBar,
  readerFromStreamReader,
  render,
} from "./deps.ts";
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
    readerFromStreamReader(body.getReader()),
    input,
  );
}

export function templatized(
  template: string,
  assigns = {},
  filters = {},
): Promise<string> {
  filters = Object.assign({
    basename,
    prettyBytes,
    UTCString: (date: string | number | Date) => new Date(date).toUTCString(),
  }, filters);
  return render(template, assigns, filters);
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
        prettyBytes((completed / (elapsed)) * 1000),
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
