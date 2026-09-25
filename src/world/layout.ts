/**
 * Static layout of the Kessler Basin region: locations, roads, canyon channels.
 * Coordinates are metres in world XZ (north = -Z, east = +X).
 */
export const WORLD_SIZE = 2048;
export const HALF_WORLD = WORLD_SIZE / 2;
export const PLAYABLE_RADIUS = 900; // beyond this the mountain ring takes over

export type LocationKind =
  | 'home'
  | 'settlement'
  | 'industrial'
  | 'military'
  | 'canyon'
  | 'desert'
  | 'wreck'
  | 'hidden'
  | 'quarry'
  | 'landmark';

export interface LocationDef {
  id: string;
  name: string;
  kind: LocationKind;
  x: number;
  z: number;
  radius: number;
  /** Flatten terrain to a pad of this radius (0 = no flattening). */
  flatten?: number;
  /** Target height offset added to local natural height when flattening. */
  flattenHeight?: number;
  hidden?: boolean;
  danger: number; // 0..5
  faction?: 'scrappers' | 'authority' | 'helix' | 'independents';
  desc: string;
}

export const LOCATIONS: LocationDef[] = [
  {
    id: 'home',
    name: 'Scrapyard Garage',
    kind: 'home',
    x: 60,
    z: 430,
    radius: 90,
    flatten: 95,
    danger: 0,
    desc: 'Your workshop. A tin shed, a welder and more ambition than sense.',
  },
  {
    id: 'rustwater',
    name: 'Rustwater',
    kind: 'settlement',
    x: 540,
    z: 250,
    radius: 110,
    flatten: 115,
    danger: 0,
    faction: 'independents',
    desc: 'Trading post built from shipping containers around the last working water pump in the basin.',
  },
  {
    id: 'dusthollow',
    name: 'Dust Hollow',
    kind: 'settlement',
    x: -700,
    z: 90,
    radius: 70,
    flatten: 75,
    danger: 1,
    faction: 'independents',
    desc: 'A scavenger camp at the edge of the dune sea. Cheap fuel, questionable parts.',
  },
  {
    id: 'foundry',
    name: 'Foundry Ruins',
    kind: 'industrial',
    x: 470,
    z: -300,
    radius: 170,
    flatten: 175,
    danger: 2,
    faction: 'scrappers',
    desc: 'Collapsed smelting works. The Scrappers strip it for parts and guard it like a treasure hoard.',
  },
  {
    id: 'pit',
    name: 'The Pit',
    kind: 'quarry',
    x: 720,
    z: -640,
    radius: 150,
    danger: 4,
    faction: 'scrappers',
    desc: 'An open-cast mine. Something enormous still works down there.',
  },
  {
    id: 'fort',
    name: 'Fort Kessler',
    kind: 'military',
    x: -90,
    z: -600,
    radius: 150,
    flatten: 155,
    danger: 3,
    faction: 'authority',
    desc: 'Pre-collapse military base, reoccupied by an Iron Authority garrison.',
  },
  {
    id: 'dunes',
    name: 'The Dune Sea',
    kind: 'desert',
    x: -560,
    z: -430,
    radius: 260,
    danger: 2,
    faction: 'scrappers',
    desc: 'Rolling sand. Wheels sink, legs slog, rotors choke on dust.',
  },
  {
    id: 'airliner',
    name: 'Airliner Wreck',
    kind: 'wreck',
    x: -640,
    z: -360,
    radius: 60,
    danger: 2,
    desc: 'A jumbo jet broken in three pieces, half-swallowed by the dunes.',
  },
  {
    id: 'canyons',
    name: 'Red Canyons',
    kind: 'canyon',
    x: -480,
    z: 560,
    radius: 300,
    danger: 2,
    faction: 'independents',
    desc: 'Twisting slot canyons carved through a red sandstone plateau.',
  },
  {
    id: 'gunship',
    name: 'Downed Gunship',
    kind: 'wreck',
    x: -600,
    z: 690,
    radius: 40,
    hidden: true,
    danger: 2,
    desc: 'An Iron Authority gunship lies smashed against a canyon wall.',
  },
  {
    id: 'helix',
    name: 'Helix Relay Station',
    kind: 'hidden',
    x: -250,
    z: 760,
    radius: 55,
    flatten: 60,
    flattenHeight: 0,
    hidden: true,
    danger: 3,
    faction: 'helix',
    desc: 'A spotless white installation that should not exist out here.',
  },
  {
    id: 'radiotower',
    name: 'Radio Hill',
    kind: 'landmark',
    x: 230,
    z: -20,
    radius: 40,
    danger: 1,
    desc: 'An old broadcast mast. Climb it and the whole basin opens up.',
  },
  {
    id: 'overpass',
    name: 'Broken Overpass',
    kind: 'landmark',
    x: -250,
    z: 190,
    radius: 60,
    danger: 1,
    faction: 'scrappers',
    desc: 'A collapsed highway interchange used as a Scrapper ambush point.',
  },
];

export function getLocation(id: string) {
  const l = LOCATIONS.find((l) => l.id === id);
  if (!l) throw new Error(`unknown location ${id}`);
  return l;
}

export interface RoadDef {
  id: string;
  kind: 'highway' | 'dirt';
  width: number;
  points: [number, number][];
}

export const ROADS: RoadDef[] = [
  {
    id: 'route9',
    kind: 'highway',
    width: 14,
    points: [
      [-1000, 110],
      [-860, 100],
      [-700, 120],
      [-520, 150],
      [-380, 185],
      [-250, 200],
      [-100, 230],
      [60, 255],
      [220, 262],
      [380, 262],
      [540, 262],
      [680, 230],
      [820, 160],
      [1000, 120],
    ],
  },
  {
    id: 'home_spur',
    kind: 'dirt',
    width: 8,
    points: [
      [120, 256],
      [110, 310],
      [90, 360],
      [70, 395],
    ],
  },
  {
    id: 'canyon_road',
    kind: 'dirt',
    width: 8,
    points: [
      [10, 440],
      [-80, 470],
      [-190, 505],
      [-290, 520],
    ],
  },
  {
    id: 'north_road',
    kind: 'dirt',
    width: 9,
    points: [
      [-60, 232],
      [-40, 120],
      [-30, 0],
      [-50, -150],
      [-70, -300],
      [-85, -450],
    ],
  },
  {
    id: 'foundry_road',
    kind: 'dirt',
    width: 9,
    points: [
      [560, 255],
      [560, 150],
      [530, 20],
      [500, -120],
      [480, -180],
    ],
  },
  {
    id: 'pit_road',
    kind: 'dirt',
    width: 9,
    points: [
      [580, -380],
      [610, -450],
      [630, -505],
    ],
  },
  {
    id: 'dune_track',
    kind: 'dirt',
    width: 7,
    points: [
      [-700, 60],
      [-690, -60],
      [-660, -200],
      [-640, -300],
    ],
  },
  {
    id: 'radio_track',
    kind: 'dirt',
    width: 6,
    points: [
      [-35, 60],
      [60, 40],
      [160, 10],
      [215, -10],
    ],
  },
];

/** Canyon channels carved through the red plateau. */
export const CANYONS: { width: number; points: [number, number][] }[] = [
  {
    width: 34,
    points: [
      [-290, 520],
      [-360, 540],
      [-420, 500],
      [-500, 470],
      [-580, 500],
      [-640, 560],
      [-620, 640],
      [-600, 690],
      [-540, 740],
      [-440, 770],
      [-330, 760],
      [-250, 760],
    ],
  },
  {
    width: 28,
    points: [
      [-420, 500],
      [-440, 580],
      [-480, 650],
      [-540, 740],
    ],
  },
  {
    width: 30,
    points: [
      [-640, 560],
      [-730, 540],
      [-800, 470],
      [-820, 380],
    ],
  },
  {
    width: 26,
    points: [
      [-360, 540],
      [-330, 620],
      [-300, 690],
      [-250, 760],
    ],
  },
];

export const PLATEAU = { x: -560, z: 620, radius: 300, height: 46 };
export const PIT_RAMP = { ax: 630, az: -505, bx: 735, bz: -625, width: 11 };
export const PIT = { x: 720, z: -640, radius: 150, depth: 42 };
export const DUNES = { x: -560, z: -430, radius: 330 };
