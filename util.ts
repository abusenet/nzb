export function templatized(template: string, assigns = {}): string {
  const handler = new Function(
    "assigns",
    [
      "const tagged = ( " + Object.keys(assigns).join(", ") + " ) =>",
      "`" + template + "`",
      "return tagged(...Object.values(assigns))",
    ].join("\n"),
  );

  return handler(assigns);
}
