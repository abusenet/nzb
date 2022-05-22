import { mirror } from "./nzb-mirror.ts";
import { extract } from "./nzb-extract.ts";
import { serve } from "./nzb-serve.ts";

const exports = {
  mirror,
  extract,
  serve,
};

const [command, ...args] = Deno.args;
exports[command as keyof typeof exports](args);

export default exports;
