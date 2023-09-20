import { Article, Client, parseFlags, retry } from "./deps.ts";

export async function mirrorArticle(
  src: string | Article = Deno.args[0],
  dst: Article = new Article(),
  options = parseFlags(Deno.args),
): Promise<Article | null> {
  if (typeof src === "string") {
    src = new Article(src);
  }

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

  await client.close();

  if (response.status === 240) {
    return dst;
  }

  console.error(`${response.status} ${response.statusText}`);

  return null;
}

async function setup(options: Record<string, string> = {}) {
  const { hostname, port, ssl, username, password } = options;

  return await retry(
    async () => {
      const client = await Client.connect({
        hostname,
        port: Number(port),
        ssl: !!ssl,
        logLevel: "WARNING",
      });

      if (username) {
        await client.authinfo(username, password);
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
