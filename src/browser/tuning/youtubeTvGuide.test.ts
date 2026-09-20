/* Copyright(C) 2024-2026, HJD (https://github.com/hjdhjd). All rights reserved. */
import { Window } from "happy-dom";
import assert from "node:assert/strict";
import { readYttvGuide } from "./youtubeTvGuide.ts";
import { test } from "node:test";

// Minimal reproduction of the live ytu-epg-row/airing shape observed on 2026-09-20. Program data is a controller getter, not an HTML attribute.
test("reads absolute program times from each stream's own row, including truncated visible titles", () => {

  const window = new Window();

  window.document.body.innerHTML = [
    "<ytu-epg-row>",
    "<ytu-endpoint class=\"tenx-thumb\" aria-label=\"watch NFL ST - FOX\"><a href=\"watch/first\"></a></ytu-endpoint>",
    "<ytu-epg-airing><div class=\"primary-text\">...</div></ytu-epg-airing>",
    "</ytu-epg-row>",
    "<ytu-epg-row>",
    "<ytu-endpoint class=\"tenx-thumb\" aria-label=\"watch NFL ST - FOX\"><a href=\"watch/second\"></a></ytu-endpoint>",
    "<ytu-epg-airing></ytu-epg-airing><ytu-epg-airing></ytu-epg-airing>",
    "</ytu-epg-row>",
    "<ytu-epg-row>",
    "<ytu-endpoint class=\"tenx-thumb\" aria-label=\"watch NFL ST - FOX\"><a href=\"browse/upcoming\"></a></ytu-endpoint>",
    "</ytu-epg-row>",
    "<ytu-epg-row>",
    "<ytu-endpoint class=\"tenx-thumb\" aria-label=\"watch NFL ST - CBS\"><a href=\"live\"></a></ytu-endpoint>",
    "<ytu-epg-airing></ytu-epg-airing>",
    "</ytu-epg-row>",
    "<ytu-epg-row>",
    "<ytu-endpoint class=\"tenx-thumb\" aria-label=\"watch Unavailable channel\"><a href=\"live\"></a></ytu-endpoint>",
    "</ytu-epg-row>"
  ].join("");

  const data = [
    { beginTimeMs: "1789923600000", endTimeMs: "1789934400000", title: { runs: [{ text: "Minnesota Vikings at Chicago Bears" }] } },
    { beginTimeMs: "1789935900000", endTimeMs: "1789946700000", title: { runs: [ { text: "Seattle Seahawks" }, { text: " at Arizona Cardinals" } ] } },
    { beginTimeMs: null, endTimeMs: "1789946700000", title: { runs: [{ text: "Missing time" }] } },
    { beginTimeMs: "1789934700000", endTimeMs: "1789945500000", title: { runs: [{ text: "Jacksonville Jaguars at Denver Broncos" }] } }
  ];

  for(const [ index, airing ] of window.document.querySelectorAll("ytu-epg-airing").entries()) {

    Object.defineProperty(airing, "polymerController", { value: Object.create({ get data(): unknown { return data[index]; } }) });
  }

  // Observed Broncos row: hidden-score thumbnail links to live, but the row's Join live destination is a watch endpoint.
  Object.defineProperty(window.document.querySelectorAll("ytu-epg-row")[3], "polymerController", {

    value: { data: { navigationEndpoint: { watchEndpoint: { videoId: "xHCA59axZ3M" } } } }
  });

  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");

  Object.defineProperty(globalThis, "document", { configurable: true, value: window.document });

  try {

    assert.deepEqual(readYttvGuide(), [
      { name: "NFL ST - FOX", programs: [
        { endMs: 1789934400000, startMs: 1789923600000, title: "Minnesota Vikings at Chicago Bears" }
      ], watchPath: "watch/first" },
      { name: "NFL ST - FOX", programs: [
        { endMs: 1789946700000, startMs: 1789935900000, title: "Seattle Seahawks at Arizona Cardinals" }
      ], watchPath: "watch/second" },
      { name: "NFL ST - CBS", programs: [
        { endMs: 1789945500000, startMs: 1789934700000, title: "Jacksonville Jaguars at Denver Broncos" }
      ], watchPath: "watch/xHCA59axZ3M" }
    ]);
  } finally {

    if(previous) {

      Object.defineProperty(globalThis, "document", previous);
    } else {

      Reflect.deleteProperty(globalThis, "document");
    }

    window.happyDOM.abort();
  }
});
