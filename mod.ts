import { mirror } from "./mirror.ts";
import { extract } from "./extract.ts";
import { serve } from "./serve.ts";

const exports = {
  mirror,
  extract,
  serve,
};

const [command, ...args] = Deno.args;
exports[command as keyof typeof exports](args);

export default exports;
