/* Copyright(C) 2024-2026, HJD (https://github.com/hjdhjd). All rights reserved. */
import type { GuideProgram, XmltvChannel } from "../guide/xmltv.ts";
import { LOG, formatError } from "../utils/index.ts";
import { discoverYttvSchedule, yttvProvider } from "../browser/tuning/youtubeTv.ts";
import { getServiceTagForChannel, resolveServiceKey } from "../config/services.ts";
import type { Express } from "express";
import { buildChannelMap } from "../hdhr/channelMap.ts";
import { getAllChannels } from "../config/userChannels.ts";
import { renderXmltv } from "../guide/xmltv.ts";
import { withProviderGuidePage } from "../browser/precaching.ts";

interface GuideChannel extends Omit<XmltvChannel, "programs"> {

  selector: string;
}

type Schedule = ReadonlyMap<string, GuideProgram[]>;

/** Uses the same configured channel IDs and numbers as the playlist and HDHomeRun tuner. */
function getGuideChannels(): GuideChannel[] {

  const numbers = new Map(buildChannelMap().map((channel) => [ channel.key, channel.number ]));

  return Object.entries(getAllChannels()).flatMap(([ id, channel ]) => {

    if((getServiceTagForChannel(resolveServiceKey(id)) !== "yttv") || !channel.channelSelector) {

      return [];
    }

    return [{ id, name: channel.guideTitle ?? channel.name ?? id, number: numbers.get(id), selector: channel.channelSelector }];
  });
}

/** A managed, muted guide window is closed on success, failure, or the one-minute deadline. */
async function loadSchedule(selectors: readonly string[]): Promise<Schedule> {

  let schedule: Schedule | undefined;

  await withProviderGuidePage(yttvProvider, {

    afterWalk: async (page): Promise<void> => {

      schedule = await discoverYttvSchedule(page, selectors);
    },
    signal: AbortSignal.timeout(60000)
  });

  if(!schedule) {

    throw new Error("YouTube TV schedule discovery did not complete.");
  }

  return schedule;
}

/** Serves observed YouTube TV programs, refreshing at most every fifteen minutes unless explicitly requested. */
export function setupXmltvEndpoint(app: Express, load: typeof loadSchedule = loadSchedule,
  channels: () => GuideChannel[] = getGuideChannels): void {

  let cached: { key: string; loadedAt: number; schedule: Schedule } | undefined;
  let pending: { key: string; promise: Promise<Schedule> } | undefined;

  app.get("/xmltv.xml", async (req, res): Promise<void> => {

    const configured = channels();
    const selectors = configured.map((channel) => channel.selector.toLowerCase());
    const key = JSON.stringify(selectors.toSorted());

    if(configured.length === 0) {

      res.type("application/xml").send(renderXmltv([]));

      return;
    }

    try {

      if((cached?.key !== key) || ((Date.now() - cached.loadedAt) >= 900000) || (req.query["refresh"] === "true")) {

        // All callers share one browser walk. A changed channel selection waits for the prior walk before starting another.
        while(pending && (pending.key !== key)) {

          // eslint-disable-next-line no-await-in-loop -- Serialize guide walks even when selections change during an earlier wait.
          await pending.promise.catch(() => undefined);
        }

        if((pending?.key !== key)) {

          const promise = load(selectors).then((schedule) => {

            cached = { key, loadedAt: Date.now(), schedule };

            return schedule;
          }).finally(() => {

            if(pending?.promise === promise) {

              pending = undefined;
            }
          });

          pending = { key, promise };
        }

        await pending.promise;
      }
    } catch(error) {

      LOG.warn("YouTube TV schedule refresh failed: %s.", formatError(error));

      const previous = cached;

      if((previous?.key !== key) || !selectors.some((selector) => previous.schedule.get(selector)?.some((program) => program.endMs > Date.now()))) {

        res.status(503).json({ error: "YouTube TV guide unavailable. Check provider sign-in and retry." });

        return;
      }

      res.set("X-Prismcast-Guide-Stale", "true");
    }

    const schedule = cached?.schedule;

    res.set("Cache-Control", "no-cache").type("application/xml").send(renderXmltv(configured.map((channel) => ({

      ...channel,
      programs: schedule?.get(channel.selector.toLowerCase()) ?? []
    }))));
  });
}
