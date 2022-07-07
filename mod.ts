import { extract } from "./extract.ts";
import { combine } from "./combine.ts";
import { mirror } from "./mirror.ts";
import { serve } from "./serve.ts";

const exports = {
  combine,
  extract,
  mirror,
  serve,
};

const [command, ...args] = Deno.args;
exports[command as keyof typeof exports](args);

export default exports;
