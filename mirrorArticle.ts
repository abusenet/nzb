import { Article, Client, parseArgs, retry } from "./deps.ts";

export function help() {
  return `NZB Mirror Article
  Mirrors an article to another.`;
}

const parseOptions = {
  string: [
    "hostname",
    "username",
    "password",
  ],
  boolean: [
    "ssl",
    "join-group",
    "progress",
  ],
  default: {
    hostname: Deno.env.get("NNTP_HOSTNAME"),
    port: Number(Deno.env.get("NNTP_PORT")),
    ssl: Deno.env.get("NNTP_SSL") === "true",
    username: Deno.env.get("NNTP_USER"),
    password: Deno.env.get("NNTP_PASS"),
    "connect-retries": 1,
    "reconnect-delay": 15 * 1000,
    "request-retries": 5,
    "post-retry-delay": 0,
    "join-group": false,
    progress: false,
  },
};

export async function mirrorArticle(
  args: unknown[] = Deno.args,
  dst: Article = new Article(),
) {
  const parsedArgs = parseArgs(args as string[], parseOptions);
  const {
    _: [input],
    ...options
  } = parsedArgs;

  if (!input) {
    console.error("Missing input");
    console.error(help());
    return;
  }

  const src = typeof input === "string"
    ? new Article(input)
    : input as unknown as Article;

  const originalMessageId = src.headers.get("message-id")!;
  const messageId = dst.headers.get("message-id") ||
    `<${crypto.randomUUID()}@nntp>`;

  const client = await setup(options);

  // Some providers require choosing group before accessing article.
  if (options["join-group"]) {
    await client.group(src.headers.get("newsgroups")!.split(",")[0]);
  }

  let response = await client.article(originalMessageId);
  const { status, headers } = response;

  if (status === 430) return null;

  // Reads the body to completion so we can reuse the connection,
  // then converts it to a new ReadableStream.
  const body = (await response.blob()).stream();

  setDefaults(dst.headers, {
    date: new Date().toUTCString(),
    from: headers.get("from")!,
    "message-id": messageId,
    newsgroups: headers.get("newsgroups")!,
    subject: headers.get("subject")!,
  });

  dst.body = body;

  response = await retry(
    async () => {
      const response = await client.post(dst);
      return response;
    },
    {
      multiplier: 1,
      jitter: 0,
      minTimeout: Number(options["post-retry-delay"] || 0),
      maxAttempts: Number(options["request-retries"] || 5),
    },
  );

  client.close();

  if (response.status === 240) {
    return dst;
  }

  console.error(`${response.status} ${response.statusText}`);

  return null;
}

async function setup(options: Record<string, unknown> = {}) {
  const { hostname, port, ssl, username, password } = options;

  return await retry(
    async () => {
      const client = await Client.connect({
        hostname: `${hostname}`,
        port: Number(port),
        ssl: !!ssl,
        logLevel: "WARNING",
      });

      if (username) {
        await client.authinfo(`${username}`, `${password}`);
      }

      return client;
    },
    {
      multiplier: 1,
      jitter: 0,
      maxAttempts: Number(options["connect-retries"] || 1),
      minTimeout: Number(options["reconnect-delay"] || 15 * 1000),
    },
  );
}

function setDefaults(headers: Headers, defaults: Record<string, string> = {}) {
  Object.entries(defaults)
    .filter(([_k, v]) => v)
    .forEach(([k, v]) => {
      const header = headers.get(k);
      if (!header || header === "undefined") {
        headers.set(k, v);
      }
    });
}
