/* Copyright(C) 2024-2026, HJD (https://github.com/hjdhjd). All rights reserved.
 *
 * xmltv.ts: XMLTV serialization for observed guide programs.
 */
import { escapeXml } from "../utils/markup.ts";

export interface GuideProgram {

  title: string;
  startMs: number;
  endMs: number;
}

export interface XmltvChannel {

  id: string;
  name: string;
  number?: number;
  programs: GuideProgram[];
}

function cleanXmlText(value: string): string {

  // XML 1.0 permits these code points. Unicode mode preserves valid surrogate pairs while removing isolated surrogates.
  // eslint-disable-next-line no-control-regex
  return value.replace(/[^\u0009\u000A\u000D\u0020-\uD7FF\uE000-\uFFFD\u{10000}-\u{10FFFF}]/gu, "");
}

function formatTimestamp(milliseconds: number): string | undefined {

  const date = new Date(milliseconds);

  if(!Number.isFinite(date.getTime()) || (date.getUTCFullYear() < 0) || (date.getUTCFullYear() > 9999)) {

    return undefined;
  }

  return date.toISOString().slice(0, 19).replace(/[-:T]/g, "") + " +0000";
}

/** Serializes observed programs, omitting entries without a valid title and time range. */
export function renderXmltv(channels: XmltvChannel[]): string {

  const lines = [ "<?xml version=\"1.0\" encoding=\"UTF-8\"?>", "<tv generator-info-name=\"PrismCast\">" ];

  for(const channel of channels) {

    const id = escapeXml(cleanXmlText(channel.id));

    lines.push("  <channel id=\"" + id + "\">");
    lines.push("    <display-name>" + escapeXml(cleanXmlText(channel.name)) + "</display-name>");

    if((channel.number !== undefined) && Number.isFinite(channel.number)) {

      lines.push("    <display-name>" + String(channel.number) + "</display-name>");
    }

    lines.push("  </channel>");
  }

  for(const channel of channels) {

    const id = escapeXml(cleanXmlText(channel.id));

    for(const program of channel.programs) {

      const title = cleanXmlText(program.title).trim();
      const start = formatTimestamp(program.startMs);
      const stop = formatTimestamp(program.endMs);

      if(!title || !start || !stop || (program.endMs <= program.startMs) || (stop <= start)) {

        continue;
      }

      lines.push("  <programme channel=\"" + id + "\" start=\"" + start + "\" stop=\"" + stop + "\">");
      lines.push("    <title>" + escapeXml(title) + "</title>");
      lines.push("  </programme>");
    }
  }

  lines.push("</tv>", "");

  return lines.join("\n");
}
