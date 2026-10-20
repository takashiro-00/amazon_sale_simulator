export type NameTag = "NORMAL" | "MANAGE" | "ALERT";
const TAGS = /\[\s*(?:MANAGE|ALERT)\s*\]/gi;
export function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}
export function stripTags(name: string): string {
  return name.replace(TAGS, " ").trim().replace(/\s+/g, " ");
}
export function currentTag(name: string): NameTag {
  return /\[\s*ALERT\s*\]/i.test(name)
    ? "ALERT"
    : /\[\s*MANAGE\s*\]/i.test(name)
      ? "MANAGE"
      : "NORMAL";
}
export function severity(tag: NameTag): number {
  return tag === "ALERT" ? 2 : tag === "MANAGE" ? 1 : 0;
}
export function canOverwrite(current: NameTag, next: NameTag): boolean {
  return !(current === "ALERT" && next === "MANAGE");
}
export function escalateTag(name: string, tag: NameTag): string {
  const cur = currentTag(name),
    next = canOverwrite(cur, tag) ? tag : cur,
    clean = stripTags(name);
  return next === "NORMAL" ? clean : `[${next}]${clean ? " " + clean : ""}`;
}

export function removeTag(name: string): string { return stripTags(name); }
export function applyTag(name: string, tag: NameTag): string {
  return tag === "NORMAL" ? removeTag(name) : escalateTag(name, tag);
}
