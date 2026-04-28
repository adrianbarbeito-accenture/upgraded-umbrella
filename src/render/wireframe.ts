import type { WidgetNode } from "../types.ts";

const PHONE_W = 360;
const PHONE_H = 720;
const PADDING = 16;
const APPBAR_H = 56;
const NAVBAR_H = 56;

/**
 * Render a coarse SVG wireframe from a parsed Scaffold widget tree. Output is
 * a self-contained <svg> string that Mintlify renders inline inside MDX.
 *
 * The goal is "is this what I expect this screen to look like, structurally?"
 * — not pixel-accurate replication. AppBar at top, body content stacked,
 * optional bottom nav.
 */
export function renderWireframeSvg(tree: WidgetNode | null, screenName: string): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${PHONE_W} ${PHONE_H}" role="img" aria-label="${escapeAttr(
      screenName,
    )} wireframe" style="max-width:360px;border:1px solid #ddd;border-radius:24px;background:#fafafa">`,
  );

  if (!tree) {
    parts.push(
      `<text x="${PHONE_W / 2}" y="${
        PHONE_H / 2
      }" text-anchor="middle" font-family="sans-serif" font-size="14" fill="#888">No widget tree extracted</text>`,
    );
    parts.push("</svg>");
    return parts.join("");
  }

  let cursorY = PADDING;

  const appBar = tree.children.find((c) => c.type === "AppBar");
  if (appBar) {
    parts.push(rect(PADDING, cursorY, PHONE_W - 2 * PADDING, APPBAR_H, "#e5e7eb"));
    parts.push(text(PHONE_W / 2, cursorY + APPBAR_H / 2 + 4, appBar.text ?? screenName, "middle", 14, true));
    cursorY += APPBAR_H + 12;
  }

  const bodyY = cursorY;
  const bottomReserve = tree.children.some((c) => c.type === "BottomNavigationBar")
    ? NAVBAR_H + PADDING
    : 0;
  const bodyH = PHONE_H - bodyY - PADDING - bottomReserve;

  parts.push(rect(PADDING, bodyY, PHONE_W - 2 * PADDING, bodyH, "#ffffff", "#cbd5e1"));

  const body = tree.children.find((c) => c.type !== "AppBar" && c.type !== "BottomNavigationBar");
  if (body) {
    let blockY = bodyY + 12;
    const blockX = PADDING + 12;
    const blockW = PHONE_W - 2 * PADDING - 24;
    const blockH = 44;
    const gap = 10;

    const bodyChildren = body.children.length ? body.children : [{ type: body.type, children: [] }];
    const visible = bodyChildren.slice(0, Math.max(1, Math.floor((bodyH - 24) / (blockH + gap))));

    for (const child of visible) {
      parts.push(rect(blockX, blockY, blockW, blockH, "#f1f5f9", "#cbd5e1"));
      const label = child.text ? `${child.type}: "${truncate(child.text, 28)}"` : child.type;
      parts.push(text(blockX + 8, blockY + blockH / 2 + 4, label, "start", 12, false));
      blockY += blockH + gap;
    }
  }

  if (bottomReserve > 0) {
    const navY = PHONE_H - PADDING - NAVBAR_H;
    parts.push(rect(PADDING, navY, PHONE_W - 2 * PADDING, NAVBAR_H, "#e5e7eb"));
    parts.push(text(PHONE_W / 2, navY + NAVBAR_H / 2 + 4, "BottomNavigationBar", "middle", 12, false));
  }

  parts.push("</svg>");
  return parts.join("");
}

function rect(x: number, y: number, w: number, h: number, fill: string, stroke = "transparent"): string {
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${fill}" stroke="${stroke}"/>`;
}

function text(
  x: number,
  y: number,
  content: string,
  anchor: "start" | "middle" | "end",
  size: number,
  bold: boolean,
): string {
  const weight = bold ? "600" : "400";
  return `<text x="${x}" y="${y}" text-anchor="${anchor}" font-family="ui-sans-serif,system-ui,sans-serif" font-size="${size}" font-weight="${weight}" fill="#111">${escapeText(content)}</text>`;
}

function escapeAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function truncate(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}
