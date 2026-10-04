import type { SceneDoc } from '../model/scene';
import { bundledItem } from './catalog';
import { m2mUrl } from './mesh2motion';
import { polyPageUrl } from './polyLibrary';

export interface CreditLine {
  title: string;
  author: string;
  licence: string;
  url: string;
}

/** Unique attributions for every downloaded or bundled model used in a scene (CC0 included for completeness). */
export function sceneCredits(doc: Readonly<SceneDoc>): CreditLine[] {
  const seen = new Map<string, CreditLine>();
  for (const o of doc.objects) {
    const a = o.asset;
    if (a.source === 'poly') {
      seen.set(a.file, { title: a.title, author: a.creator, licence: a.licence, url: polyPageUrl(a.id) });
    } else if (a.source === 'm2m') {
      seen.set(`m2m:${a.id}`, { title: a.title, author: a.creator, licence: a.licence, url: m2mUrl(a.id) });
    } else if (a.source === 'bundled') {
      const c = bundledItem(a.id)?.credit;
      if (c) seen.set(a.id, c);
    }
  }
  return [...seen.values()].sort((x, y) => x.title.localeCompare(y.title));
}
