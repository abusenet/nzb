import { mirror } from "./nzb-mirror.ts";
import { serve } from "./nzb-serve.ts";

const exports = {
  mirror,
  serve,
};

const [command, ...args] = Deno.args;
exports[command as keyof typeof exports](args);

export default exports;
