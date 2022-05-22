import { mirror } from "./nzb-mirror.ts";

const exports = {
  mirror,
};

const [command, ...args] = Deno.args;
exports[command as keyof typeof exports](args);

export default exports;
