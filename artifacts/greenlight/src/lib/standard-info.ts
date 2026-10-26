/**
 * Plain-words explainers for the standards and their levels, shown from the
 * ⓘ buttons on the Start page. Greenlight's own words; no standards text is
 * reproduced here, only clause-free descriptions of what a choice means.
 */
export type LevelInfo = { value: string; label: string; means: string; pick: string };
export type StandardInfo = {
  /** The plain-English name shown on the Standards screen. */
  plain: string;
  what: string;
  who: string;
  levelName?: string;
  levels?: LevelInfo[];
};

export const STANDARD_INFO: Record<string, StandardInfo> = {
  asvs5: {
    plain: 'Web app security',
    what: 'The OWASP checklist for securing web applications and APIs: sign-in, sessions, input handling, cryptography, logging and so on.',
    who: 'Any web-facing software. The most widely used application-security yardstick.',
    levelName: 'Level',
    levels: [
      { value: '1', label: 'Level 1 · baseline', means: 'The minimum for any application: checks that catch the most common, easily exploited weaknesses.', pick: 'Low-risk internal tools or a first pass.' },
      { value: '2', label: 'Level 2 · standard', means: 'For software that handles sensitive data or business-critical functions. Adds defence in depth and stricter session, access and data rules.', pick: 'Most applications, including anything handling personal or government data. The usual target.' },
      { value: '3', label: 'Level 3 · advanced', means: 'The most demanding tier, for systems where failure has serious consequences: deeper verification of architecture, cryptography and resilience.', pick: 'Critical national infrastructure, defence, health and high-value financial systems.' },
    ],
  },
  iso27001: {
    plain: 'Security management',
    what: 'The international standard for managing information security: policies, risk assessment, access control, logging, incident handling and continual improvement.',
    who: 'Organisations that need to show auditors and customers that security is managed, not improvised.',
  },
  'nist-ssdf': {
    plain: 'Secure development',
    what: 'NIST’s Secure Software Development Framework: practices for preparing the organisation, protecting the code, producing secure software and responding to vulnerabilities.',
    who: 'Anyone supplying software to government or large enterprises; increasingly a contract requirement.',
  },
  'ism-e8': {
    plain: 'Australian government',
    what: 'The Australian Government Information Security Manual plus the Essential Eight mitigation strategies from the Australian Signals Directorate.',
    who: 'Software used by, or supplied to, Australian government and defence.',
    levelName: 'Classification and maturity',
    levels: [
      { value: 'classification', label: 'Classification', means: 'The sensitivity of the data the software handles, from Non-classified through OFFICIAL: Sensitive and PROTECTED to SECRET and TOP SECRET. A higher classification brings more controls into scope.', pick: 'Match the highest classification of data the system will hold. PROTECTED is typical for defence-adjacent business systems.' },
      { value: 'maturity', label: 'Essential Eight maturity', means: 'How well the eight mitigations are implemented. Maturity Level One defends against commodity attacks, Level Two against adversaries willing to invest more in a target, Level Three against adaptive adversaries with advanced tradecraft.', pick: 'Level Two is the common baseline for government systems; Level Three for high-value or classified ones.' },
    ],
  },
  ed153: {
    plain: 'Air-traffic software safety',
    what: 'EUROCAE guidance for software safety assurance in air navigation services: what evidence must exist that software of a given criticality was specified, built, verified and maintained correctly.',
    who: 'Air-traffic and aviation ground software, and anyone adopting that rigour for safety-related systems.',
    levelName: 'Software Assurance Level (SWAL)',
    levels: [
      { value: '1', label: 'SWAL 1 · most demanding', means: 'For software whose failure could contribute to a catastrophic outcome. Every objective applies with full independence of verification.', pick: 'Safety-critical control functions.' },
      { value: '2', label: 'SWAL 2', means: 'For software whose failure could contribute to a hazardous outcome. Most objectives apply, with independence on the key ones.', pick: 'Primary operational systems.' },
      { value: '3', label: 'SWAL 3 · typical', means: 'For software whose failure could contribute to a major but recoverable outcome. A substantial set of objectives, with lighter independence.', pick: 'Situational-awareness, planning and supervisory tools. The usual starting point.' },
      { value: '4', label: 'SWAL 4 · lightest', means: 'For software whose failure has minor effect. The smallest set of objectives.', pick: 'Advisory and support tools with no operational dependence.' },
    ],
  },
  mil882e: {
    plain: 'System safety',
    what: 'The US Department of Defense standard practice for system safety: identifying hazards, assessing risk, assigning software criticality and recording acceptance.',
    who: 'Defence programs and their suppliers.',
  },
  iso42001: {
    plain: 'Responsible AI',
    what: 'The international standard for managing AI systems responsibly: governance, risk, data, transparency and oversight of AI in a product.',
    who: 'Software that embeds AI models or decisions. Off by default because many systems have none.',
  },
};

export function levelDisplay(standardId: string, value: string): string {
  if (/ed153/i.test(standardId)) return `SWAL ${value}`;
  if (/asvs/i.test(standardId)) return `Level ${value}`;
  return value;
}

/** The plain-English name of a standard, falling back to its short name. */
export function plainName(id: string, short: string): string {
  return STANDARD_INFO[id]?.plain ?? short;
}

/** The level buttons on the Strictness screen: real names, one plain word each. */
export type LevelChoice = { value: string; label: string; hint: string };
export const LEVEL_CHOICES: Record<string, { question: string; sets: string; choices: LevelChoice[] }> = {
  asvs5: {
    question: 'How deep should the web-security check go?',
    sets: 'Picks how many ASVS clauses apply',
    choices: [{ value: '1', label: 'Level 1', hint: 'basics' }, { value: '2', label: 'Level 2', hint: 'sensitive data' }, { value: '3', label: 'Level 3', hint: 'critical systems' }],
  },
  ed153: {
    question: "If the software fails, what's the worst that happens?",
    sets: 'Sets the software assurance level (SWAL)',
    choices: [{ value: '4', label: 'SWAL 4', hint: 'minor' }, { value: '3', label: 'SWAL 3', hint: 'major' }, { value: '2', label: 'SWAL 2', hint: 'hazardous' }, { value: '1', label: 'SWAL 1', hint: 'catastrophic' }],
  },
};
export const CLASSIFICATION_CHOICES: LevelChoice[] = [
  { value: 'Non-classified', label: 'Unclassified', hint: 'public' },
  { value: 'OFFICIAL: Sensitive', label: 'OFFICIAL: Sensitive', hint: 'everyday' },
  { value: 'PROTECTED', label: 'PROTECTED', hint: 'the usual' },
  { value: 'SECRET', label: 'SECRET', hint: 'most rules' },
  { value: 'TOP SECRET', label: 'TOP SECRET', hint: 'all rules' },
];
export const MATURITY_CHOICES: LevelChoice[] = [
  { value: '1', label: 'Level 1', hint: 'basic hygiene' },
  { value: '2', label: 'Level 2', hint: 'the usual' },
  { value: '3', label: 'Level 3', hint: 'hardened' },
];
