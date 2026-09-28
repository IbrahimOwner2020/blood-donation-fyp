import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { FileBlob, PresentationFile } from '@oai/artifact-tool';

const workspaceDir = '/Users/kidibra/ucc/blood-donation';
const sourcePath = '/Users/kidibra/Downloads/DOC-20260923-WA0009.pptx';
const SKILL_DIR = '/Users/kidibra/.codex/plugins/cache/openai-primary-runtime/presentations/26.904.11930/skills/presentations';
const RUNTIME_PYTHON = '/Users/kidibra/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3';
const stagingDir = path.join(workspaceDir, '.codex-artifacts', 'build');
const FINAL_PPTX = path.join(workspaceDir, 'outputs', 'NBTS-System-Design-Updated-v2.pptx');

const { finalizePresentation } = await import(pathToFileURL(
  path.join(SKILL_DIR, 'container_tools/artifact_tool_utils.mjs'),
).href);

await fs.mkdir(stagingDir, { recursive: true });
await fs.mkdir(path.dirname(FINAL_PPTX), { recursive: true });

const presentation = await PresentationFile.importPptx(await FileBlob.load(sourcePath));

const W = 1279.9679790026248;
const H = 720;
const FONT = 'Calibri';
const C = {
  maroon: '#8A1F2D',
  maroonDark: '#721826',
  maroonPale: '#F8ECEE',
  navy: '#253E73',
  navyPale: '#EEF2F8',
  gold: '#C79011',
  goldPale: '#FBF5E6',
  green: '#368A58',
  greenPale: '#ECF6F0',
  ink: '#181B20',
  text: '#30343B',
  muted: '#6B7078',
  line: '#D9DDE3',
  pale: '#F5F6F8',
  white: '#FFFFFF',
};

function addText(slide, text, left, top, width, height, options = {}) {
  const shape = slide.shapes.add({
    geometry: 'textbox',
    name: options.name,
    position: { left, top, width, height },
    fill: 'none',
    line: { fill: 'none', width: 0 },
  });
  shape.text = text;
  shape.text.style = {
    typeface: FONT,
    fontSize: options.fontSize ?? 18,
    bold: options.bold ?? false,
    italic: options.italic ?? false,
    color: options.color ?? C.text,
    alignment: options.alignment ?? 'left',
    verticalAlignment: options.verticalAlignment ?? 'top',
    autoFit: options.autoFit ?? 'shrinkText',
    insets: options.insets ?? { top: 0, right: 0, bottom: 0, left: 0 },
  };
  return shape;
}

function addBox(slide, left, top, width, height, options = {}) {
  return slide.shapes.add({
    geometry: options.geometry ?? 'roundRect',
    name: options.name,
    position: { left, top, width, height },
    fill: options.fill ?? C.white,
    line: options.line ?? { style: 'solid', fill: C.line, width: 1 },
    borderRadius: options.borderRadius ?? 12,
    shadow: options.shadow ?? 'shadow-none',
  });
}

function addHeader(slide, title) {
  addText(slide, 'SYSTEM DESIGN', 58, 39, 760, 26, {
    fontSize: 12,
    bold: true,
    color: C.maroon,
  });
  addText(slide, title, 58, 65, 1162, 66, {
    fontSize: 34,
    bold: true,
    color: C.ink,
    verticalAlignment: 'middle',
  });
}

function addPageNumber(slide, number) {
  addText(slide, String(number), 1208, 681, 48, 28, {
    fontSize: 11,
    color: '#9A9DA3',
    alignment: 'center',
    verticalAlignment: 'middle',
  });
}

function addSectionBox(slide, { left, top, width, height, fill, accent, title, body, count }) {
  addBox(slide, left, top, width, height, { fill, line: { style: 'solid', fill: accent, width: 1.25 } });
  if (count) {
    const countBox = addBox(slide, left + width - 58, top + 14, 40, 30, {
      fill: accent,
      line: { fill: 'none', width: 0 },
      borderRadius: 15,
    });
    countBox.text = count;
    countBox.text.style = {
      typeface: FONT,
      fontSize: 14,
      bold: true,
      color: C.white,
      alignment: 'center',
      verticalAlignment: 'middle',
      autoFit: 'shrinkText',
      insets: { top: 0, right: 0, bottom: 0, left: 0 },
    };
  }
  addText(slide, title, left + 20, top + 16, width - 82, 32, {
    fontSize: 19,
    bold: true,
    color: accent,
  });
  addText(slide, body, left + 20, top + 57, width - 40, height - 70, {
    fontSize: 16,
    color: C.text,
  });
}

function clearSlide(slide) {
  slide.shapes.deleteAll();
  for (const image of [...slide.images.items]) slide.images.deleteById(image.id);
  for (const table of [...slide.tables.items]) slide.tables.deleteById(table.id);
  for (const chart of [...slide.charts.items]) slide.charts.deleteById(chart.id);
  slide.background.fill = C.white;
}

function connect(slide, from, to, options = {}) {
  return slide.shapes.connect(from, to, {
    kind: options.kind ?? 'elbow',
    fromSide: options.fromSide,
    toSide: options.toSide,
    line: { style: options.dashed ? 'dashed' : 'solid', fill: options.color ?? '#9AA1AA', width: options.width ?? 2 },
    tail: options.noHead ? undefined : { type: 'triangle', width: 'sm', length: 'sm' },
  });
}

// Slide 2: current seeded role count is three.
presentation.resolve('sh/t8byxkn2').text = '3';

// Slide 5: current runtime architecture.
{
  const slide = presentation.slides.getItem(4);
  clearSlide(slide);
  addHeader(slide, 'Current application architecture');

  const web = addBox(slide, 64, 205, 250, 150, { fill: C.maroonPale, line: { style: 'solid', fill: C.maroon, width: 1.5 } });
  addText(slide, 'Web application', 86, 226, 205, 30, { fontSize: 21, bold: true, color: C.maroon });
  addText(slide, 'React Router 7 and React 19\nTailwind CSS presentation\nSession-aware API client', 86, 270, 205, 66, { fontSize: 16 });

  const api = addBox(slide, 405, 180, 400, 200, { fill: C.navyPale, line: { style: 'solid', fill: C.navy, width: 1.8 } });
  addText(slide, 'Hono API on Bun', 431, 205, 348, 34, { fontSize: 24, bold: true, color: C.navy, alignment: 'center' });
  addText(slide, 'Authentication and HTTP-only sessions\nPermission checks and facility scope\nBusiness rules, Drizzle queries, audit records\nAI and notification orchestration', 439, 258, 332, 100, { fontSize: 17, alignment: 'center' });

  const db = addBox(slide, 900, 195, 300, 130, { fill: C.greenPale, line: { style: 'solid', fill: C.green, width: 1.5 } });
  addText(slide, 'MariaDB 11', 925, 219, 250, 32, { fontSize: 22, bold: true, color: C.green, alignment: 'center' });
  addText(slide, '21 relational tables\nForeign keys and indexed lookups', 925, 267, 250, 48, { fontSize: 16, alignment: 'center' });

  const ai = addBox(slide, 405, 446, 300, 120, { fill: C.goldPale, line: { style: 'solid', fill: C.gold, width: 1.5 } });
  addText(slide, 'FastAPI AI service', 428, 466, 254, 30, { fontSize: 20, bold: true, color: '#9A6E00', alignment: 'center' });
  addText(slide, 'Training, evaluation and forecast generation', 428, 509, 254, 42, { fontSize: 16, alignment: 'center' });

  const providers = addBox(slide, 900, 446, 300, 120, { fill: C.pale, line: { style: 'solid', fill: '#7D838C', width: 1.25 } });
  addText(slide, 'Messaging providers', 924, 466, 252, 30, { fontSize: 20, bold: true, color: '#555B64', alignment: 'center' });
  addText(slide, 'SMTP email and NextSMS or mock SMS', 924, 509, 252, 42, { fontSize: 16, alignment: 'center' });

  connect(slide, web, api, { fromSide: 'right', toSide: 'left', color: C.maroon });
  connect(slide, api, db, { fromSide: 'right', toSide: 'left', color: C.navy });
  connect(slide, api, ai, { fromSide: 'bottom', toSide: 'top', color: C.gold });
  connect(slide, api, providers, { fromSide: 'right', toSide: 'left', color: '#7D838C' });

  addText(slide, 'The API owns authorization, business decisions and database access. The AI service receives only the inputs needed for a forecast.', 65, 614, 1135, 36, { fontSize: 16, color: C.muted, alignment: 'center', verticalAlignment: 'middle' });
  addPageNumber(slide, 5);
  slide.speakerNotes.textFrame.setText([
    'Source: docs/02-system-architecture.md',
    'Source: api/package.json and web/package.json',
    'Source: docker-compose.yml',
    'Current checkout reviewed on 24 September 2026.',
  ].join('\n'));
}

// Slide 6: current seeded roles and enforcement model.
{
  const slide = presentation.slides.getItem(5);
  clearSlide(slide);
  addHeader(slide, 'Three roles with explicit access boundaries');

  const columns = [
    {
      left: 58,
      color: C.maroon,
      fill: C.maroonPale,
      role: 'Administrator',
      scope: 'System-wide',
      body: 'All 25 permissions. Manages users, roles and facilities, plus every operational, reporting and audit function.',
      boundary: 'No facility restriction',
    },
    {
      left: 439,
      color: C.navy,
      fill: C.navyPale,
      role: 'Blood Bank Staff',
      scope: 'Blood-bank operations',
      body: 'Manages donors, donations, stock, requests, alerts, notifications and operational reports.',
      boundary: 'No user, role or configuration administration',
    },
    {
      left: 820,
      color: C.gold,
      fill: C.goldPale,
      role: 'Hospital Staff',
      scope: 'Assigned facility',
      body: 'Views and updates facility inventory, creates and updates blood requests, and reads facility reports.',
      boundary: 'API forces the user facility on every scoped operation',
    },
  ];

  for (const item of columns) {
    addBox(slide, item.left, 176, 340, 330, { fill: item.fill, line: { style: 'solid', fill: item.color, width: 1.5 } });
    addText(slide, item.role, item.left + 24, 202, 292, 38, { fontSize: 24, bold: true, color: item.color, alignment: 'center' });
    addText(slide, item.scope.toUpperCase(), item.left + 24, 251, 292, 25, { fontSize: 12, bold: true, color: item.color, alignment: 'center' });
    addText(slide, item.body, item.left + 30, 304, 280, 104, { fontSize: 17, alignment: 'center', verticalAlignment: 'middle' });
    addText(slide, item.boundary, item.left + 28, 437, 284, 45, { fontSize: 14, bold: true, color: item.color, alignment: 'center', verticalAlignment: 'middle' });
  }

  const steps = [
    ['Session', 90],
    ['User roles', 300],
    ['Permissions', 510],
    ['API route', 720],
    ['Facility filter', 930],
  ];
  const stepShapes = [];
  for (const [label, left] of steps) {
    const box = addBox(slide, left, 565, 160, 48, { fill: C.white, line: { style: 'solid', fill: C.line, width: 1 } });
    addText(slide, label, left + 10, 577, 140, 25, { fontSize: 15, bold: true, alignment: 'center', verticalAlignment: 'middle' });
    stepShapes.push(box);
  }
  for (let i = 0; i < stepShapes.length - 1; i += 1) {
    connect(slide, stepShapes[i], stepShapes[i + 1], { kind: 'straight', fromSide: 'right', toSide: 'left', color: '#9AA1AA', width: 1.5 });
  }
  addText(slide, 'Authorization runs in the API before business logic and database queries.', 233, 631, 814, 28, { fontSize: 16, color: C.muted, alignment: 'center' });
  addPageNumber(slide, 6);
  slide.speakerNotes.textFrame.setText([
    'Source: api/src/db/seed/permission-codes.ts',
    'Source: api/src/db/seed/roles-permissions-data.ts',
    'Source: api/src/middleware/require-permission.ts',
    'Source: api/src/modules/auth/access-scope.ts',
    'The current worktree seeds Administrator, Blood Bank Staff and Hospital Staff.',
  ].join('\n'));
}

// Slide 7: database table groups and core relationships.
{
  const slide = presentation.slides.getItem(6);
  clearSlide(slide);
  addHeader(slide, 'Database architecture: 21 relational tables');

  addSectionBox(slide, {
    left: 58, top: 176, width: 350, height: 170,
    fill: C.maroonPale, accent: C.maroon, title: 'Identity and access', count: '6',
    body: 'users, sessions\nroles, permissions\nuser_roles, role_permissions',
  });
  addSectionBox(slide, {
    left: 465, top: 176, width: 350, height: 170,
    fill: C.navyPale, accent: C.navy, title: 'Donor and collection', count: '4',
    body: 'blood_groups\ndonors, donations\ndonation_centres',
  });
  addSectionBox(slide, {
    left: 872, top: 176, width: 350, height: 170,
    fill: C.greenPale, accent: C.green, title: 'Inventory and demand', count: '4',
    body: 'healthcare_facilities\nblood_inventory\nblood_requests, demand_records',
  });
  addSectionBox(slide, {
    left: 238, top: 415, width: 380, height: 170,
    fill: C.goldPale, accent: C.gold, title: 'Forecasting and alerts', count: '5',
    body: 'ai_predictions\nai_analysis_runs, ai_analysis_settings\nshortage_alerts, inventory_alerts',
  });
  addSectionBox(slide, {
    left: 662, top: 415, width: 380, height: 170,
    fill: C.pale, accent: '#656B74', title: 'Notifications and audit', count: '2',
    body: 'notifications\nactivity_logs',
  });

  const donor = slide.shapes.items.find((s) => s.text?.toString?.().includes('Donor and collection')) ?? slide.shapes.items[0];
  // Relationship lines are deliberately simple so table groups remain readable.
  const identityBox = slide.shapes.items.find((s) => s.position?.left === 58 && s.position?.top === 176);
  const donorBox = slide.shapes.items.find((s) => s.position?.left === 465 && s.position?.top === 176);
  const inventoryBox = slide.shapes.items.find((s) => s.position?.left === 872 && s.position?.top === 176);
  const forecastBox = slide.shapes.items.find((s) => s.position?.left === 238 && s.position?.top === 415);
  const notifyBox = slide.shapes.items.find((s) => s.position?.left === 662 && s.position?.top === 415);
  if (identityBox && donorBox) connect(slide, identityBox, donorBox, { kind: 'straight', fromSide: 'right', toSide: 'left', color: C.maroon, width: 1.5 });
  if (donorBox && inventoryBox) connect(slide, donorBox, inventoryBox, { kind: 'straight', fromSide: 'right', toSide: 'left', color: C.navy, width: 1.5 });
  if (inventoryBox && forecastBox) connect(slide, inventoryBox, forecastBox, { fromSide: 'bottom', toSide: 'top', color: C.green, width: 1.5 });
  if (forecastBox && notifyBox) connect(slide, forecastBox, notifyBox, { kind: 'straight', fromSide: 'right', toSide: 'left', color: C.gold, width: 1.5 });

  addText(slide, 'Foreign keys preserve the path from users, donors and facility requests to inventory, forecasts, alerts, messages and audit history.', 91, 622, 1098, 38, { fontSize: 16, color: C.muted, alignment: 'center', verticalAlignment: 'middle' });
  addPageNumber(slide, 7);
  slide.speakerNotes.textFrame.setText([
    'Source: api/src/db/schema/index.ts and every schema module exported from it.',
    'The current schema contains 21 mysqlTable declarations.',
    'Core foreign keys link donors to users and blood groups, donations to donors and centres, inventory to donations and facilities, requests and demand to facilities, predictions to blood groups and facilities, alerts to predictions, and notifications to donors and alerts.',
  ].join('\n'));
}

// Slide 8: operational data lifecycle across the database and services.
{
  const slide = presentation.slides.getItem(7);
  clearSlide(slide);
  addHeader(slide, 'Operational data flow');

  const steps = [
    { x: 62, title: '1  Capture events', body: 'Donations, hospital requests and inventory status changes', color: C.maroon, fill: C.maroonPale },
    { x: 304, title: '2  Persist records', body: 'MariaDB stores inventory units, demand history and user activity', color: C.navy, fill: C.navyPale },
    { x: 546, title: '3  Generate forecast', body: 'The API sends selected demand data to the FastAPI service', color: C.gold, fill: C.goldPale },
    { x: 788, title: '4  Evaluate supply', body: 'The API compares forecast demand with available, valid stock', color: C.green, fill: C.greenPale },
    { x: 1030, title: '5  Act and report', body: 'Alerts, donor messages, dashboards and reports use stored results', color: '#656B74', fill: C.pale },
  ];
  const boxes = [];
  for (const item of steps) {
    const box = addBox(slide, item.x, 210, 190, 240, { fill: item.fill, line: { style: 'solid', fill: item.color, width: 1.5 } });
    addText(slide, item.title, item.x + 18, 233, 154, 55, { fontSize: 19, bold: true, color: item.color, alignment: 'center', verticalAlignment: 'middle' });
    addText(slide, item.body, item.x + 20, 314, 150, 108, { fontSize: 16, alignment: 'center', verticalAlignment: 'middle' });
    boxes.push(box);
  }
  for (let i = 0; i < boxes.length - 1; i += 1) {
    connect(slide, boxes[i], boxes[i + 1], { kind: 'straight', fromSide: 'right', toSide: 'left', color: '#959BA4', width: 1.75 });
  }

  addBox(slide, 130, 515, 1020, 88, { fill: C.white, line: { style: 'solid', fill: C.line, width: 1 }, borderRadius: 10 });
  addText(slide, 'Controls applied throughout', 157, 536, 210, 36, { fontSize: 17, bold: true, color: C.maroon, verticalAlignment: 'middle' });
  addText(slide, 'Permission checks and facility scope', 395, 536, 230, 36, { fontSize: 15, bold: true, color: C.navy, alignment: 'center', verticalAlignment: 'middle' });
  addText(slide, 'Expiry and status rules', 650, 536, 205, 36, { fontSize: 15, bold: true, color: C.green, alignment: 'center', verticalAlignment: 'middle' });
  addText(slide, 'Activity logs and notification history', 878, 536, 245, 36, { fontSize: 15, bold: true, color: '#656B74', alignment: 'center', verticalAlignment: 'middle' });
  addText(slide, 'The AI service predicts demand. The API decides what the system stores, exposes and sends.', 185, 628, 910, 30, { fontSize: 16, color: C.muted, alignment: 'center' });
  addPageNumber(slide, 8);
  slide.speakerNotes.textFrame.setText([
    'Source: docs/02-system-architecture.md',
    'Source: api/src/modules and api/src/db/schema',
    'The API remains authoritative for authorization, stock rules, alert creation, donor matching, notifications and persistence.',
  ].join('\n'));
}

// Slide 12: remove the retired registered-donor role testing recommendation.
presentation.resolve('sh/a543mx4r').text.replace(
  'Add a donor-role test account to complete role-restriction testing',
  'Complete Hospital Staff facility-scope and live notification-provider testing',
);

const candidatePath = path.join(stagingDir, 'candidate.pptx');
await (await PresentationFile.exportPptx(presentation)).save(candidatePath);

const referenceSha256 = crypto.createHash('sha256').update(await fs.readFile(sourcePath)).digest('hex');
const requirements = {
  explicitTotalSlideCount: 13,
  requiredNativeTableOwnerSlides: [],
  requiredNativeChartOwnerSlides: [],
};

const result = await finalizePresentation({
  ...requirements,
  workspaceDir,
  candidatePath,
  finalPath: FINAL_PPTX,
  pythonExecutable: RUNTIME_PYTHON,
  integrityValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_package_integrity.py'),
  layoutValidatorPath: path.join(SKILL_DIR, 'container_tools/inspect_presentation_layout_geometry.py'),
  layoutArgs: [
    '--expected-slide-size-emu', '12191695,6858000',
    '--validate-bullet-geometry',
    '--validate-heading-fit',
  ],
  requiredNativeTableOwnerSlides: [],
  fontPolicy: {
    basis: 'reference',
    families: [FONT, 'Cambria'],
    referencePath: sourcePath,
    referenceSha256,
  },
  verifyArtifactToolImport: true,
  receiptPath: path.join(stagingDir, 'NBTS-System-Design-Updated-v2.validation.json'),
});

console.log(JSON.stringify({ finalPath: FINAL_PPTX, result }, null, 2));
