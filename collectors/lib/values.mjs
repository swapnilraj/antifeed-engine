// CLI flag lookup shared by every script that takes --flag value / --flag=value
// pairs (wall.mjs, instagram-web, the reel enricher, shape).
export function flagValue(args, flag) {
  const inline = args.find(arg => arg.startsWith(`${flag}=`));
  if (inline) return inline.slice(flag.length + 1);
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

export function isoDay(value) {
  const date = new Date(value);
  return isNaN(date) ? "" : date.toISOString().slice(0, 10);
}

export function isoDayOrThrow(value) {
  return new Date(value).toISOString().slice(0, 10);
}

export function domain(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}
