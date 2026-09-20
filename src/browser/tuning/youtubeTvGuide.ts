/* Copyright(C) 2024-2026, HJD (https://github.com/hjdhjd). All rights reserved. */
import type { GuideProgram } from "../../guide/xmltv.ts";

export interface YttvGuideChannel {

  name: string;
  programs?: GuideProgram[];
  watchPath: string;
}

/** Reads channel links and the program data backing YouTube TV's rendered guide cells. Runs inside the browser. */
export function readYttvGuide(): YttvGuideChannel[] {

  // These helpers must stay inside the evaluated function so Puppeteer can serialize it without module dependencies.
  function property(value: unknown, key: string): unknown {

    return (typeof value === "object") && (value !== null) ? Reflect.get(value, key) : undefined;
  }

  function timestamp(value: unknown): number {

    return ((typeof value === "string") && /^\d+$/.test(value)) || (typeof value === "number") ? Number(value) : NaN;
  }

  const results: YttvGuideChannel[] = [];

  for(const thumb of Array.from(document.querySelectorAll("ytu-endpoint.tenx-thumb[aria-label]"))) {

    const label = thumb.getAttribute("aria-label") ?? "";
    const row = thumb.closest("ytu-epg-row");

    let href = thumb.querySelector("a")?.getAttribute("href") ?? "";

    // Hidden-score previews can link to "live" even though the row exposes a playable Join live destination.
    if(href === "live") {

      const rowData = property(property(row, "polymerController"), "data");
      const videoId = property(property(property(rowData, "navigationEndpoint"), "watchEndpoint"), "videoId");

      if((typeof videoId === "string") && /^[A-Za-z0-9_-]{11}$/.test(videoId)) {

        href = "watch/" + videoId;
      }
    }

    if(!label.startsWith("watch ") || !href.startsWith("watch/")) {

      continue;
    }

    const programs: GuideProgram[] = [];

    for(const airing of Array.from(row?.querySelectorAll("ytu-epg-airing") ?? [])) {

      // The rendered clock omits dates and end times. The cell's backing data carries absolute epoch milliseconds.
      const controller = property(airing, "polymerController");
      const data = property(controller, "data");
      const startMs = timestamp(property(data, "beginTimeMs"));
      const endMs = timestamp(property(data, "endTimeMs"));
      const runs = property(property(data, "title"), "runs");
      const title = Array.isArray(runs) ? runs.map((run: unknown) => property(run, "text")).filter((text) => typeof text === "string").join("").trim() : "";

      if(title && Number.isFinite(startMs) && Number.isFinite(endMs) && (startMs > 0) && (endMs > startMs)) {

        programs.push({ endMs, startMs, title });
      }
    }

    results.push({ name: label.slice(6), programs, watchPath: href });
  }

  return results;
}
