import type { BasicClip, Fit } from '../model/scene';
import type { CatalogItem, Credit } from './catalog';
import { M2M_CLIPS, M2M_COMMIT, M2M_PROPS } from './mesh2motionData';

/**
 * The Mesh2Motion library (https://github.com/Mesh2Motion, art CC0 unless noted): rigged characters that share
 * a skeleton per family, each family's animation files, and props. Nothing is bundled: files load from jsDelivr
 * at a pinned commit. Clip names come from the generated mesh2motionData.ts (npm run catalog:m2m).
 */

export const M2M_CDN = `https://cdn.jsdelivr.net/gh/Mesh2Motion/mesh2motion-app@${M2M_COMMIT}/static/`;
const REPO_URL = 'https://github.com/Mesh2Motion/mesh2motion-app';

export type M2MFamilyId = 'human' | 'fox' | 'bird' | 'kaiju' | 'fish' | 'horse' | 'dragon' | 'spider' | 'snake';

export interface M2MFamily {
  id: M2MFamilyId;
  /** Animation files (in static/animations/); the first holds the basic clips and loads with the model. */
  animations: string[];
  /** Labels for the animation files in clip pickers. */
  groups: string[];
  /** Which library clip plays for each basic clip (missing: walk falls back to idle, run to walk, sit to idle). */
  roles: Partial<Record<BasicClip, string>>;
  /** Bone whose position track is scaled for taller or shorter variations of the same rig. */
  pelvisBone?: string;
}

export const M2M_FAMILIES: Record<M2MFamilyId, M2MFamily> = {
  human: {
    id: 'human',
    animations: ['human-base-animations.glb', 'human-addon-animations.glb', 'human-mocap-animations.glb'],
    groups: ['Base', 'Add-on', 'Mocap'],
    roles: { idle: 'Idle_A', walk: 'Walk', run: 'Jog', sit: 'Sitting_Idle' },
    pelvisBone: 'pelvis',
  },
  fox: { id: 'fox', animations: ['fox-animations.glb'], groups: ['Quadruped'], roles: { idle: 'Idle', walk: 'Walk', run: 'Run', sit: 'Sit' } },
  bird: { id: 'bird', animations: ['bird-animations.glb'], groups: ['Bird'], roles: { idle: 'Idle', walk: 'Walk', run: 'Flap' } },
  kaiju: { id: 'kaiju', animations: ['kaiju-animations.glb'], groups: ['Kaiju'], roles: { idle: 'Idle', walk: 'Walk' } },
  fish: { id: 'fish', animations: ['shark-animations.glb'], groups: ['Fish'], roles: { idle: 'Idle', walk: 'Swim Horizontal' } },
  horse: { id: 'horse', animations: ['horse-animations.glb'], groups: ['Horse'], roles: { idle: 'Idle', walk: 'Walk', run: 'Run', sit: 'Sleep' } },
  dragon: { id: 'dragon', animations: ['dragon-animations.glb'], groups: ['Dragon'], roles: { idle: 'Idle', walk: 'Walk', run: 'Fly Flap' } },
  spider: { id: 'spider', animations: ['spider-animations.glb'], groups: ['Spider'], roles: { idle: 'Idle', walk: 'Walk' } },
  snake: { id: 'snake', animations: ['snake-animations.glb'], groups: ['Snake'], roles: { idle: 'Idle', walk: 'Side winding' } },
};

export interface M2MCharacter {
  /** Catalog key, stored in scene files as the asset id (e.g. 'human/male'). */
  key: string;
  title: string;
  family: M2MFamilyId;
  /** Model file in static/, or null to use the mesh inside the family's first animation file. */
  file: string | null;
  creator: string;
  licence: string;
  url: string;
  fit: Fit;
  /** Multiplier on the pelvis position keyframes so feet stay on the ground (from Mesh2Motion's own data). */
  pelvisScale: number;
  preview?: string;
}

type Spec = [variant: string, title: string, creator: string, licence: string, height: number, pelvisScale?: number];

const CREATOR_URLS: Record<string, string> = {
  Quaternius: 'https://quaternius.com',
  'Kenney.nl': 'https://kenney.nl',
  'Blender Studio': 'https://studio.blender.org',
  'David Revoy': 'https://www.davidrevoy.com',
};

/** Human variations rigged to the shared Mesh2Motion human skeleton (Sophia is left out: CC-BY-SA). */
const HUMANS: Spec[] = [
  ['male', 'Male', 'Quaternius', 'CC0', 1.8],
  ['female', 'Female', 'Quaternius', 'CC0', 1.7],
  ['zombie', 'Zombie', 'Kenney.nl', 'CC0', 1.8],
  ['female_8', 'Female #8', 'elbolilloduro', 'CC0', 1.68],
  ['female_9', 'Female #9', 'elbolilloduro', 'CC0', 1.68, 1.02],
  ['female_31', 'Female #31', 'elbolilloduro', 'CC0', 1.66, 0.92],
  ['male_5', 'Male #5', 'elbolilloduro', 'CC0', 1.8],
  ['male_6', 'Male #6', 'elbolilloduro', 'CC0', 1.8],
  ['male_10', 'Male #10', 'elbolilloduro', 'CC0', 1.8],
  ['male_15', 'Male #15', 'elbolilloduro', 'CC0', 1.8],
  ['male_32', 'Male #32', 'elbolilloduro', 'CC0', 1.78, 0.96],
  ['doctor_m', 'Doctor', 'elbolilloduro', 'CC0', 1.8],
  ['swat_male', 'SWAT', 'elbolilloduro', 'CC0', 1.85],
  ['police_male', 'Police (male)', 'elbolilloduro', 'CC0', 1.82],
  ['police_female', 'Police (female)', 'elbolilloduro', 'CC0', 1.7],
  ['hazmat_female', 'Hazmat (female)', 'elbolilloduro', 'CC0', 1.72],
  ['hazmat_suit_male', 'Hazmat (male)', 'elbolilloduro', 'CC0', 1.85, 1.05],
  ['killer_4', 'Killer #4', 'elbolilloduro', 'CC0', 1.85, 1.02],
  ['killer_5', 'Killer #5', 'elbolilloduro', 'CC0', 1.85, 1.05],
  ['killer_6', 'Killer #6', 'elbolilloduro', 'CC0', 1.85, 1.05],
  ['killer_7', 'Killer #7', 'elbolilloduro', 'CC0', 1.85],
  ['monster', 'Monster', 'elbolilloduro', 'CC0', 2.2, 1.37],
  ['monster_3', 'Monster #3', 'elbolilloduro', 'CC0', 2.0, 1.05],
  ['monster_4', 'Monster #4', 'elbolilloduro', 'CC0', 2.4, 1.55],
  ['monster_5', 'Monster #5', 'elbolilloduro', 'CC0', 2.1, 1.12],
  ['jay', 'Jay', 'Blender Studio', 'CC-BY 4.0', 1.8],
  ['sintel', 'Sintel', 'Blender Studio', 'CC-BY 4.0', 1.6],
  ['bunny', 'Big Buck Bunny', 'Blender Studio', 'CC-BY 4.0', 1.4],
];

const len = (size: number): Fit => ({ axis: 'length', size });
const max = (size: number): Fit => ({ axis: 'max', size });

/** Animals: [key, title, family, model file (null = mesh in the animation file), creator, licence, fit, preview]. */
const ANIMALS: Array<[string, string, M2MFamilyId, string | null, string, string, Fit, string | undefined]> = [
  ['fox/fox', 'Fox', 'fox', 'models-variation/fox/fox.glb', 'Mesh2Motion', 'CC0', len(1), 'models-variation/fox/preview/fox.png'],
  ['fox/dog', 'Dog', 'fox', 'models-variation/fox/dog.glb', 'Mesh2Motion', 'CC0', len(1.1), 'models-variation/fox/preview/dog.png'],
  ['fox/cat', 'Carrot the cat', 'fox', 'models-variation/fox/cat.glb', 'David Revoy', 'CC-BY 4.0', len(0.8), 'models-variation/fox/preview/cat.png'],
  ['fox/panda', 'Panda', 'fox', 'models-variation/fox/panda.glb', 'Mesh2Motion', 'CC0', len(1.6), 'models-variation/fox/preview/panda.png'],
  ['bird/seagull', 'Seagull', 'bird', 'models-variation/bird/seagull.glb', 'Mesh2Motion', 'CC0', max(1.3), 'models-variation/bird/preview/seagull.png'],
  ['bird/eagle', 'Bald eagle', 'bird', 'models-variation/bird/eagle.glb', 'Mesh2Motion', 'CC0', max(2), 'models-variation/bird/preview/eagle.png'],
  ['kaiju/lizard', 'Lizard', 'kaiju', 'models-variation/kaiju/lizard.glb', 'Mesh2Motion', 'CC0', len(2.5), 'models-variation/kaiju/preview/lizard.png'],
  ['kaiju/t-rex', 'T-Rex', 'kaiju', 'models-variation/kaiju/t-rex.glb', 'Mesh2Motion', 'CC0', len(12), 'models-variation/kaiju/preview/t-rex.png'],
  ['fish/shark', 'Shark', 'fish', 'models-variation/fish/shark.glb', 'Mesh2Motion', 'CC0', len(4), 'models-variation/fish/preview/shark.png'],
  ['fish/whale', 'Whale', 'fish', 'models-variation/fish/whale.glb', 'Mesh2Motion', 'CC0', len(14), 'models-variation/fish/preview/whale.png'],
  ['horse/horse', 'Horse', 'horse', null, 'Mesh2Motion', 'CC0', len(2.4), undefined],
  ['dragon/dragon', 'Dragon', 'dragon', null, 'Mesh2Motion', 'CC0', max(8), undefined],
  ['spider/spider', 'Giant spider', 'spider', null, 'Mesh2Motion', 'CC0', max(1.2), undefined],
  ['snake/snake', 'Snake', 'snake', null, 'Mesh2Motion', 'CC0', len(2.5), undefined],
];

export const M2M_CHARACTERS: M2MCharacter[] = [
  ...HUMANS.map(([variant, title, creator, licence, height, pelvisScale]): M2MCharacter => ({
    key: `human/${variant}`,
    title,
    family: 'human',
    file: `models-variation/human/${variant}.glb`,
    creator,
    licence,
    url: CREATOR_URLS[creator] ?? REPO_URL,
    fit: { axis: 'height', size: height },
    pelvisScale: pelvisScale ?? 1,
    preview: `models-variation/human/preview/${variant}.png`,
  })),
  ...ANIMALS.map(([key, title, family, file, creator, licence, fit, preview]): M2MCharacter => ({
    key,
    title,
    family,
    file,
    creator,
    licence,
    url: CREATOR_URLS[creator] ?? REPO_URL,
    fit,
    pelvisScale: 1,
    preview,
  })),
];

export interface M2MProp {
  key: string;
  title: string;
  file: string;
  fit: Fit;
  preview?: string;
}

/** Weapons, tools, shields and bows at their authored size (metres). */
export const M2M_PROP_LIST: M2MProp[] = M2M_PROPS.map(([name, size, hasPreview]) => ({
  key: `prop/${name}`,
  title: propTitle(name),
  file: `props/${name}.glb`,
  fit: max(size),
  preview: hasPreview ? `props/preview/${name}.png` : undefined,
}));

const characters = new Map(M2M_CHARACTERS.map((c) => [c.key, c]));
const props = new Map(M2M_PROP_LIST.map((p) => [p.key, p]));

export function m2mCharacter(key: string): M2MCharacter | undefined {
  return characters.get(key);
}

export function m2mProp(key: string): M2MProp | undefined {
  return props.get(key);
}

export function m2mFamilyOf(key: string): M2MFamily | undefined {
  const c = characters.get(key);
  return c ? M2M_FAMILIES[c.family] : undefined;
}

/** Animation file of a family that holds `clip`, or undefined. */
export function m2mClipFile(family: M2MFamily, clip: string): string | undefined {
  return family.animations.find((f) => M2M_CLIPS[f]?.includes(clip));
}

/** A family's clips grouped by animation file, for pickers. */
export function m2mClipGroups(family: M2MFamily): Array<{ label: string; clips: readonly string[] }> {
  return family.animations.map((f, i) => ({ label: family.groups[i] ?? f, clips: M2M_CLIPS[f] ?? [] }));
}

/** The library clip behind a basic clip (with the documented fallbacks), or the clip itself. */
export function m2mResolveClip(family: M2MFamily, clip: string): string {
  const r = family.roles;
  switch (clip) {
    case 'idle':
      return r.idle ?? clip;
    case 'walk':
      return r.walk ?? r.idle ?? clip;
    case 'run':
      return r.run ?? r.walk ?? r.idle ?? clip;
    case 'sit':
      return r.sit ?? r.idle ?? clip;
    default:
      return clip;
  }
}

/**
 * Clips that play once and hold their last pose (deaths, attacks, transitions); everything else loops.
 * Heuristic on the clip name, since the files don't say.
 */
export function isOneShotClip(name: string): boolean {
  if (/idle|walk|run|jog|sprint|swim|fly|flap|glide|crawl|trot|sneak|strafe|wind|levitat|climb|jacks|pushup|dance|shiver|sleep|talk|meditat|coiled|carry|formal|stealth|reel/i.test(name)) return false;
  return /death|dead|enter|exit|start|land|hit|attack|throw|shoot|reload|jump|roll|dodge|punch|jab|kick|bite|rise|lay|pick|push|interact|open|harvest|plant|chop|consume|bow|greeting|salute|victory|turn|backflip|power|blast|yes|nod|reject|insult|fall|fetch|roar|rear|head_but|cast|catch|drive|slide|scratch|yell|eating|howl|bark|tail|block|combo|spell|melee|oneshot|cheer|help|angry|confused|defend/i.test(name);
}

/** Catalog items for the Add panel and VR menu. */
export function m2mCatalogItems(): CatalogItem[] {
  const credit = (c: Pick<M2MCharacter, 'title' | 'creator' | 'licence' | 'url'>): Credit => ({ title: c.title, author: c.creator, licence: c.licence, url: c.url });
  return [
    ...M2M_CHARACTERS.map(
      (c): CatalogItem => ({
        key: `m2m-${c.key}`,
        title: c.title,
        kind: 'actor',
        category: c.family === 'human' ? 'actors' : 'animals',
        asset: { source: 'm2m', id: c.key, title: c.title, creator: c.creator, licence: c.licence },
        thumb: c.preview ? M2M_CDN + c.preview : undefined,
        credit: credit(c),
      }),
    ),
    ...M2M_PROP_LIST.map(
      (p): CatalogItem => ({
        key: `m2m-${p.key}`,
        title: p.title,
        kind: 'prop',
        category: 'props',
        asset: { source: 'm2m', id: p.key, title: p.title, creator: 'Mesh2Motion', licence: 'CC0' },
        thumb: p.preview ? M2M_CDN + p.preview : undefined,
        credit: { title: p.title, author: 'Mesh2Motion', licence: 'CC0', url: REPO_URL },
      }),
    ),
  ];
}

/** 'bow_A_withString' → 'Bow A with string'; all-caps names (AK, SMG) stay as they are. */
export function propTitle(name: string): string {
  const words = name
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((w, i) => (/^[A-Z0-9]+$/.test(w) ? w : i === 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase()));
  return words.join(' ');
}

/** Readable clip name: 'Sitting_Idle' → 'Sitting idle'; basic clips are capitalized. */
export function clipLabel(name: string): string {
  const s = name.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : name;
}

/** Credit link for a Mesh2Motion asset id. */
export function m2mUrl(key: string): string {
  return characters.get(key)?.url ?? REPO_URL;
}
