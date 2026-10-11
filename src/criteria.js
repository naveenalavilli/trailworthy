// Accessibility criteria for outdoor recreation trails.
//
// Thresholds come from the Architectural Barriers Act Accessibility Standard
// (ABAAS) chapter on Outdoor Developed Areas and the Forest Service Trail
// Accessibility Guidelines (FSTAG). Citations are kept next to each number so a
// finished report can be handed to a parks department without re-researching it.
//
// Each criterion carries two sets of example phrasings. `barrier` describes the
// condition being wrong, `ok` describes it being fine. Both are embedded: the
// union decides which criterion a note belongs to, and the side that wins
// decides whether the note is a problem. That second judgment is what lets a
// note with no number in it ("there is no curb ramp") still be filed as a
// barrier instead of quietly landing in the compliant pile.
//
// `defaultSeverity` is how bad this barrier is when it is present but was not
// measured. A missing curb ramp is blocking whether or not anyone brought a
// tape measure; a thin trailhead sign is not.
//
// `measureCues` are words that sit next to the number this criterion cares
// about, used to pick the right one when a note contains more than one.

export const CRITERIA = [
  {
    id: 'tread-width',
    label: 'Clear tread width',
    cite: 'ABAAS F247.2 / FSTAG 7.3',
    unit: 'in',
    limit: 36,
    compare: 'min',
    defaultSeverity: 'major',
    measureCues: ['wide', 'width', 'narrow', 'across'],
    rule: 'Clear tread width must be at least 36 in.',
    barrier: [
      'the trail is too narrow here',
      'tread narrows between the rocks',
      'only wide enough for one person',
      'brush has closed the trail in to about two feet'
    ],
    ok: [
      'the trail widens out here',
      'plenty of clear width along this stretch',
      'the path width is a comfortable four feet'
    ]
  },
  {
    id: 'running-slope',
    label: 'Running slope',
    cite: 'ABAAS F247.3 / FSTAG 7.4',
    unit: '%',
    limit: 8.33,
    compare: 'max',
    defaultSeverity: 'major',
    measureCues: ['grade', 'climb', 'running', 'uphill', 'downhill', 'steep', 'incline'],
    rule: 'Running slope may not exceed 1:12 (8.33%), and no more than 5% for the full segment length.',
    barrier: [
      'this section is a steep climb',
      'long steep uphill stretch',
      'steep descent on this part of the trail',
      'the grade going up here is punishing'
    ],
    ok: [
      'the slope levels off here',
      'this stretch is flat and easy going',
      'gentle grade through this section'
    ]
  },
  {
    id: 'cross-slope',
    label: 'Cross slope',
    cite: 'ABAAS F247.4 / FSTAG 7.5',
    unit: '%',
    limit: 5,
    compare: 'max',
    defaultSeverity: 'major',
    measureCues: ['cross', 'side', 'camber', 'sideways', 'tilt', 'lean'],
    rule: 'Cross slope may not exceed 1:20 (5%); 1:48 (2%) where the surface is paved.',
    barrier: [
      'the trail tilts sideways here',
      'water has cut a side slope across the tread',
      'the path leans toward the creek',
      'off camber section, hard to keep a wheel straight'
    ],
    ok: [
      'the tread sits flat side to side',
      'no noticeable cross slope through here'
    ]
  },
  {
    id: 'surface',
    label: 'Surface firm and stable',
    cite: 'ABAAS F247.5 / FSTAG 7.6',
    unit: null,
    defaultSeverity: 'major',
    rule: 'Trail surface must be firm and stable.',
    barrier: [
      'loose gravel underfoot',
      'deep sand on this stretch',
      'soft mud that holds water',
      'exposed roots make the footing uneven',
      'standing water across the tread',
      'the surface is rutted and broken up'
    ],
    ok: [
      'surface is packed crushed granite and firm',
      'smooth asphalt the whole way',
      'the tread is hard packed and stable'
    ]
  },
  {
    id: 'tread-obstacle',
    label: 'Tread obstacles',
    cite: 'ABAAS F247.6 / FSTAG 7.7',
    unit: 'in',
    limit: 2,
    compare: 'max',
    defaultSeverity: 'major',
    measureCues: ['high', 'tall', 'step', 'lip', 'sticks up', 'root', 'rock', 'ledge', 'log'],
    rule: 'Tread obstacles may not exceed 2 in high (3 in where running and cross slope are 1:20 or less).',
    barrier: [
      'a root crosses the trail and sticks up',
      'rock ledge step up in the middle of the tread',
      'downed log across the path',
      'curb lip where the pavement meets the dirt',
      'washed out step in the trail'
    ],
    ok: [
      'the tread is clear of obstacles here',
      'nothing sticking up through this section'
    ]
  },
  {
    id: 'passing-space',
    label: 'Passing space',
    cite: 'ABAAS F247.7 / FSTAG 7.8',
    unit: 'ft',
    limit: 1000,
    compare: 'max',
    defaultSeverity: 'minor',
    measureCues: ['pass', 'pullout', 'pull over', 'every', 'apart', 'stretch'],
    rule: 'A 60 in minimum passing space is required at least every 1000 ft.',
    barrier: [
      'no place for two people to pass each other',
      'long stretch with nowhere to pull over',
      'nobody could get past someone coming the other way'
    ],
    ok: [
      'there is a wide pullout here',
      'wide spot where two wheelchairs could pass'
    ]
  },
  {
    id: 'resting-interval',
    label: 'Resting intervals',
    cite: 'ABAAS F247.8 / FSTAG 7.9',
    unit: null,
    defaultSeverity: 'major',
    rule: 'A resting interval is required adjacent to any segment steeper than 1:20 (5%).',
    barrier: [
      'no bench anywhere on this climb',
      'nowhere flat to stop and rest',
      'nothing to sit on for the whole uphill'
    ],
    ok: [
      'there is a bench at the top',
      'level landing partway up the climb'
    ]
  },
  {
    id: 'protruding-object',
    label: 'Protruding objects',
    cite: 'ABAAS F247.9',
    unit: 'in',
    limit: 80,
    compare: 'min',
    defaultSeverity: 'major',
    measureCues: ['clearance', 'overhead', 'headroom', 'branch', 'limb', 'above', 'duck'],
    rule: 'Vertical clearance must be at least 80 in above the tread.',
    barrier: [
      'low branch hanging over the trail',
      'have to duck under this limb',
      'overgrown brush pushing into the path',
      'head clearance is low at the bridge'
    ],
    ok: [
      'clearance overhead is good here',
      'branches are cut well back from the tread'
    ]
  },
  {
    id: 'gate-opening',
    label: 'Gates and openings',
    cite: 'ABAAS F247.10',
    unit: 'in',
    limit: 32,
    compare: 'min',
    defaultSeverity: 'blocking',
    measureCues: ['gap', 'opening', 'gate', 'bollard', 'wide', 'between', 'apart'],
    rule: 'Openings in gates and barriers must be at least 32 in clear.',
    barrier: [
      'narrow gap in the fence at the entrance',
      'turnstile at the trailhead',
      'bollards set close together',
      'the gate latch is high and stiff'
    ],
    ok: [
      'the gate opening is wide and easy to swing',
      'bollards are set well apart'
    ]
  },
  {
    id: 'trailhead-signage',
    label: 'Trailhead information signage',
    cite: 'ABAAS F247.11 / FSTAG 7.10',
    unit: null,
    defaultSeverity: 'minor',
    rule: 'Trailhead signage must report length, surface type, typical and minimum tread width, and typical and maximum running and cross slope.',
    barrier: [
      'the sign at the trailhead says nothing about accessibility',
      'no information about trail surface posted',
      'the map does not give the grade',
      'there is no trailhead sign at all'
    ],
    ok: [
      'the sign lists distance, surface type and grade',
      'trailhead board covers width and slope'
    ]
  },
  {
    id: 'parking-approach',
    label: 'Parking and approach route',
    cite: 'ABAAS F208 / F247.2',
    unit: null,
    defaultSeverity: 'blocking',
    rule: 'An accessible route must connect accessible parking to the trailhead.',
    barrier: [
      'the accessible parking space is gravel',
      'no curb ramp from the lot to the trail',
      'you have to cross grass to reach the trailhead',
      'there is no accessible parking at all'
    ],
    ok: [
      'van accessible stall is marked and paved',
      'a paved route runs from the lot to the trailhead'
    ]
  }
];

export const SEVERITY_CUES = {
  blocking: [
    'impassable', 'cannot get through', 'completely blocked', 'no way around',
    'dead end', 'had to turn around', 'washed out entirely'
  ],
  major: [
    'dangerous', 'very steep', 'deep', 'badly', 'severe', 'crumbling',
    'drop off', 'unsafe', 'would not attempt'
  ],
  minor: [
    'slightly', 'a little', 'minor', 'mostly fine', 'manageable', 'barely noticeable'
  ]
};

/** Every phrasing for a criterion, tagged with which side it argues for. */
export function prototypesFor(criterion) {
  return [
    ...criterion.barrier.map((text) => ({ text, polarity: 'barrier' })),
    ...criterion.ok.map((text) => ({ text, polarity: 'ok' }))
  ];
}
