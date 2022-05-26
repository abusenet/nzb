import { extract } from "./extract.ts";
import { merge } from "./extract.ts";
import { mirror } from "./mirror.ts";
import { serve } from "./serve.ts";

const exports = {
  extract,
  merge,
  mirror,
  serve,
};

const [command, ...args] = Deno.args;
exports[command as keyof typeof exports](args);

export default exports;
