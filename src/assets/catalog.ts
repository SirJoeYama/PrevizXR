import type { AssetRef, Fit, LightType, PrimitiveId, SceneObjectKind } from '../model/scene';
import { m2mCatalogItems } from './mesh2motion';

export type Category = 'actors' | 'animals' | 'props' | 'basic' | 'furniture' | 'street' | 'vehicles' | 'nature' | 'buildings' | 'lights';

export const CATEGORIES: Array<{ id: Category; label: string }> = [
  { id: 'actors', label: 'Actors' },
  { id: 'animals', label: 'Animals' },
  { id: 'props', label: 'Props' },
  { id: 'basic', label: 'Blockout' },
  { id: 'furniture', label: 'Furniture' },
  { id: 'street', label: 'Street' },
  { id: 'vehicles', label: 'Vehicles' },
  { id: 'nature', label: 'Nature' },
  { id: 'buildings', label: 'Buildings' },
  { id: 'lights', label: 'Lights' },
];

export interface Credit {
  title: string;
  author: string;
  licence: string;
  url: string;
}

export interface CatalogItem {
  key: string;
  title: string;
  kind: SceneObjectKind;
  category: Category;
  asset: AssetRef;
  /** Thumbnail URL (absolute, or relative to the site base). */
  thumb?: string;
  fit?: Fit;
  credit?: Credit;
}

const base = import.meta.env.BASE_URL;
export const bundledUrl = (path: string) => `${base}assets/${path}`;

const h = (size: number): Fit => ({ axis: 'height', size });
const len = (size: number): Fit => ({ axis: 'length', size });

/** Quaternius humanoids (CC0): HumanArmature rig with Idle, Walk, Run and Sitting clips. */
const ACTORS: Array<[key: string, title: string, polyId: string, height: number]> = [
  ['man', 'Man', 'fjHyMd5Wxw', 1.78],
  ['man-in-suit', 'Man in suit', 'mQnGoME1ez', 1.8],
  ['woman', 'Woman', 'AQsd9ngvKU', 1.68],
  ['woman-casual', 'Woman (casual)', 'jpKRgGDxhk', 1.68],
];

/** Curated Poly by Google models (CC-BY 3.0) bundled with the app, with real-world sizes. */
const POLY: Array<[key: string, title: string, polyId: string, category: Category, fit: Fit]> = [
  ['chair', 'Chair', 'e9-mepLIq0X', 'furniture', h(0.9)],
  ['table', 'Table', 'fnTN9aw1q25', 'furniture', h(0.75)],
  ['couch', 'Couch', '4QKlmmd0v2b', 'furniture', h(0.85)],
  ['bed', 'Bed', '5_1VV3ExWC9', 'furniture', len(2.1)],
  ['desk', 'Desk', 'dptlMEX4tF_', 'furniture', h(0.76)],
  ['bookcase', 'Bookcase', '0zkVPX0T5k8', 'furniture', h(1.9)],
  ['credenza', 'Credenza', 'dvn5SGMpjPm', 'furniture', h(0.8)],
  ['door', 'Door', 'aQp17eqOPFn', 'furniture', h(2.1)],
  ['window', 'Window', 'fbKXRIgShgd', 'furniture', h(1.2)],
  ['lamp', 'Lamp', '3fBR37WefHM', 'furniture', h(1.6)],
  ['monitor', 'Monitor', 'fN_jLmrWXxq', 'furniture', len(0.6)],
  ['piano', 'Piano', '1YoE664mJTd', 'furniture', h(1.3)],
  ['stool', 'Stool', 'cLydFlVg-wI', 'furniture', h(0.65)],
  ['fireplace', 'Fireplace', 'fueH4_5W9Ug', 'furniture', h(1.1)],
  ['house-plant', 'House plant', '1SyGonHVM0L', 'furniture', h(0.9)],
  ['staircase', 'Staircase', '0pEtBW3giNY', 'furniture', h(2.8)],
  ['street-lamp', 'Street lamp', '8hhAxfVhxyf', 'street', h(4.5)],
  ['traffic-light', 'Traffic light', '57rxXzowK8w', 'street', h(4)],
  ['fire-hydrant', 'Fire hydrant', 'eNPaSEPrst8', 'street', h(0.75)],
  ['bench', 'Bench', '6HQPOMqyQTv', 'street', len(1.6)],
  ['trash-can', 'Trash can', '0yT-YR5yO4L', 'street', h(1)],
  ['mailbox', 'Mailbox', '5S86YsVBun8', 'street', h(1.2)],
  ['stop-sign', 'Stop sign', '3ClNhQ5dOGt', 'street', h(2.4)],
  ['telephone-pole', 'Telephone pole', '7YIloiV4cAt', 'street', h(9)],
  ['fence', 'Fence', 'atIKFMlZf9-', 'street', h(1)],
  ['dumpster', 'Dumpster', '3F0yCeWeTZP', 'street', h(1.3)],
  ['car', 'Car', 'eRu2kPYOCa7', 'vehicles', len(4.5)],
  ['police-car', 'Police car', '0-j0ksmXXtz', 'vehicles', len(4.8)],
  ['taxi', 'Taxi', '40_vZove67z', 'vehicles', len(4.6)],
  ['bus', 'Bus', '4CPpvEmrMoF', 'vehicles', len(11)],
  ['truck', 'Truck', 'edJLxRGWFzS', 'vehicles', len(7)],
  ['van', 'Van', 'akcsFuPMt3b', 'vehicles', len(5)],
  ['motorcycle', 'Motorcycle', 'dse64pqMKAR', 'vehicles', len(2.1)],
  ['bicycle', 'Bicycle', 'b6USSQA731J', 'vehicles', len(1.75)],
  ['tree', 'Tree', 'eOL74SKw9NG', 'nature', h(6)],
  ['pine-tree', 'Pine tree', '7rTNpk6j01O', 'nature', h(8)],
  ['palm-tree', 'Palm tree', '8GLEwWnkwkG', 'nature', h(7)],
  ['boulder', 'Boulder', '3jql0qtape-', 'nature', h(1.2)],
  ['dog', 'Dog', '4ioK8LxVtuP', 'nature', len(0.9)],
  ['horse', 'Horse', 'c3lXOu8gooq', 'nature', h(1.6)],
  ['house', 'House', '75V_MLvKMqM', 'buildings', h(7)],
  ['apartment-building', 'Apartment building', '01lqee-dZAr', 'buildings', h(20)],
];

const PRIMITIVES: Array<[PrimitiveId, string]> = [
  ['box', 'Box'],
  ['cylinder', 'Cylinder'],
  ['wall', 'Wall'],
  ['door', 'Door frame'],
  ['chair', 'Chair block'],
  ['table', 'Table block'],
  ['car', 'Car block'],
];

const LIGHTS: Array<[LightType, string]> = [
  ['point', 'Point light'],
  ['spot', 'Spot light'],
];

export const BUNDLED: CatalogItem[] = [
  ...ACTORS.map(([key, title, polyId, height]): CatalogItem => ({
    key,
    title,
    kind: 'actor',
    category: 'actors',
    asset: { source: 'bundled', id: key },
    thumb: bundledUrl(`thumbs/${key}.webp`),
    fit: h(height),
    credit: { title, author: 'Quaternius', licence: 'CC0 1.0', url: `https://poly.pizza/m/${polyId}` },
  })),
  ...PRIMITIVES.map(([id, title]): CatalogItem => ({
    key: `primitive-${id}`,
    title,
    kind: 'prop',
    category: 'basic',
    asset: { source: 'primitive', id },
  })),
  ...POLY.map(([key, title, polyId, category, fit]): CatalogItem => ({
    key,
    title,
    kind: 'prop',
    category,
    asset: { source: 'bundled', id: key },
    thumb: bundledUrl(`thumbs/${key}.webp`),
    fit,
    credit: { title, author: 'Poly by Google', licence: 'CC-BY 3.0', url: `https://poly.pizza/m/${polyId}` },
  })),
  ...LIGHTS.map(([id, title]): CatalogItem => ({
    key: `light-${id}`,
    title,
    kind: 'light',
    category: 'lights',
    asset: { source: 'light', id },
  })),
];

/** Everything the Add panel and VR menu offer: bundled models plus the Mesh2Motion library (loaded on demand). */
export const ADD_ITEMS: CatalogItem[] = [...BUNDLED, ...m2mCatalogItems()];

const byKey = new Map(BUNDLED.map((item) => [item.key, item]));

/** Catalog entry for a bundled asset id ("chair", "man", …). */
export function bundledItem(id: string): CatalogItem | undefined {
  return byKey.get(id);
}

export function bundledModelUrl(id: string): string {
  const item = byKey.get(id);
  if (!item) throw new Error(`Unknown bundled asset "${id}"`);
  return bundledUrl(item.kind === 'actor' ? `actors/${id}.glb` : `poly/${id}.glb`);
}

/** Fit for a downloaded library model: reuse a bundled model's size when the title matches, else 1 m. */
export function guessFit(title: string): Fit {
  const t = title.toLowerCase();
  const match = POLY.find(([, name]) => name.toLowerCase() === t);
  return match ? match[4] : { axis: 'max', size: 1 };
}
