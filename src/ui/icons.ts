/** Minimal stroke icons (24×24 grid, currentColor), drawn for PrevizXR. */

const PATHS = {
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'm15 14 5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  play: 'M7 4.5v15l12-7.5z',
  stop: 'M6.5 6.5h11v11h-11z',
  record: 'M12 6.5a5.5 5.5 0 1 0 0 11 5.5 5.5 0 0 0 0-11z',
  render: 'M4 6h16v12H4zM9 9.5v5l4.5-2.5z',
  vr: 'M3 8.5A2.5 2.5 0 0 1 5.5 6h13A2.5 2.5 0 0 1 21 8.5v6a2.5 2.5 0 0 1-2.5 2.5h-3.2l-1.8-2.6a1.8 1.8 0 0 0-3 0L8.7 17H5.5A2.5 2.5 0 0 1 3 14.5zM8 11.5h.01M16 11.5h.01',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.3-2.5 3.8M12 17h.01',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 13.5l1.6 1.2-2 3.4-1.9-.7a7 7 0 0 1-1.6.9L15.2 20h-4l-.3-1.7a7 7 0 0 1-1.6-.9l-1.9.7-2-3.4 1.6-1.2a7 7 0 0 1 0-1.9L5.4 10.4l2-3.4 1.9.7a7 7 0 0 1 1.6-.9L11.2 5h4l.3 1.8a7 7 0 0 1 1.6.9l1.9-.7 2 3.4-1.6 1.2a7 7 0 0 1 0 1.9z',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  move: 'M12 3v18M3 12h18M12 3l-3 3M12 3l3 3M12 21l-3-3M12 21l3-3M3 12l3-3M3 12l3 3M21 12l-3-3M21 12l-3 3',
  rotate: 'M20 12a8 8 0 1 1-2.3-5.7M20 4v5h-5',
  scale: 'M4 20V10M4 20h10M4 20 20 4M14 4h6v6',
  floor: 'M12 3v11M8 10l4 4 4-4M4 19h16',
  focus: 'M4 9V5h4M20 9V5h-4M4 15v4h4M20 15v4h-4M12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  camera: 'M3 7.5h12v9H3zM15 10.5l6-3v9l-6-3',
  monitor: 'M3 5h18v11H3zM8 20h8M12 16v4',
  panelLeft: 'M3 4h18v16H3zM9 4v16',
  panelRight: 'M3 4h18v16H3zM15 4v16',
  close: 'M6 6l12 12M18 6 6 18',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  eyeOff: 'M3 3l18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.4 5.4A9.7 9.7 0 0 1 12 5c5 0 9 5 9 7a10 10 0 0 1-2.4 3.3M6.1 6.1C4 7.6 3 10.2 3 12c0 2 4 7 9 7a9.4 9.4 0 0 0 4.2-1',
  person: 'M12 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 21v-5a6 6 0 0 1 12 0v5',
  cube: 'M12 2 3 7v10l9 5 9-5V7zM3 7l9 5 9-5M12 12v10',
  bulb: 'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9V16h7v-2.1A6 6 0 0 0 12 3z',
  image: 'M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15.5 9.5h.01',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4',
  plus: 'M12 5v14M5 12h14',
  path: 'M5 19c3-10 11-4 14-14M5 19h.01M19 5h.01',
} as const;

export type IconName = keyof typeof PATHS;

const NS = 'http://www.w3.org/2000/svg';

export function icon(name: IconName, size = 18): SVGSVGElement {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', name === 'play' || name === 'stop' || name === 'record' ? 'currentColor' : 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', PATHS[name]);
  svg.append(path);
  return svg;
}
