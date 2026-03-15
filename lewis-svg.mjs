const DIRECTION_VECTORS = Object.freeze({
  top: [0, -1],
  bottom: [0, 1],
  left: [-1, 0],
  right: [1, 0],
  "top-left": [-1, -1],
  "top-right": [1, -1],
  "bottom-left": [-1, 1],
  "bottom-right": [1, 1],
});

const BOND_ORDER = Object.freeze({
  single: 1,
  double: 2,
  triple: 3,
});

const DEFAULT_RENDER_OPTIONS = Object.freeze({
  gridStep: 80,
  margin: 120,
  atomRadius: 26,
  bondGap: 9,
  dotDistance: 25.5,
  dotGap: 10,
  dotRadius: 3,
  fontFamily: "'Times New Roman', 'Cambria', serif",
  atomFontSize: 36,
  chargeFontSize: 25,
  bondWidth: 4,
});

function formatNumber(value) {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.00$/, "");
}

function escapeXml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function splitTopLevelCommas(text) {
  const parts = [];
  let current = "";
  let bracketDepth = 0;

  for (const char of text) {
    if (char === "[") {
      bracketDepth += 1;
      current += char;
      continue;
    }

    if (char === "]") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      current += char;
      continue;
    }

    if (char === "," && bracketDepth === 0) {
      const trimmed = current.trim();
      if (trimmed) {
        parts.push(trimmed);
      }
      current = "";
      continue;
    }

    current += char;
  }

  const lastPart = current.trim();
  if (lastPart) {
    parts.push(lastPart);
  }

  return parts;
}

function normalizeDslInput(input) {
  if (typeof input !== "string") {
    throw new Error("Input must be a string.");
  }

  const trimmed = input.trim();
  if (!trimmed) {
    return "";
  }

  const fenceMatches = [...trimmed.matchAll(/```(?:[A-Za-z0-9_-]+)?\s*([\s\S]*?)```/g)];
  if (fenceMatches.length > 0) {
    return fenceMatches[0][1].trim();
  }

  return trimmed;
}

function resolveAtomReference(refText, atomsById, atomsBySymbol, diagnostics, line) {
  const reference = refText.trim();
  if (!reference) {
    diagnostics.push({
      severity: "error",
      line,
      message: "Placement reference cannot be empty.",
    });
    return null;
  }

  const directId = atomsById.get(reference);
  if (directId) {
    return directId;
  }

  const referenceLower = reference.toLowerCase();
  for (const [id, atom] of atomsById.entries()) {
    if (id.toLowerCase() === referenceLower) {
      return atom;
    }
  }

  const symbolMatches = atomsBySymbol.get(referenceLower) ?? [];
  if (symbolMatches.length === 1) {
    return symbolMatches[0];
  }

  if (symbolMatches.length > 1) {
    diagnostics.push({
      severity: "warning",
      line,
      message: `Reference \"${reference}\" is ambiguous. Using ${symbolMatches[0].id}.`,
    });
    return symbolMatches[0];
  }

  diagnostics.push({
    severity: "error",
    line,
    message: `Unknown atom reference \"${reference}\".`,
  });
  return null;
}

function parseBondSpec(token) {
  const normalized = token.toLowerCase();
  const firstDash = normalized.indexOf("-");

  if (firstDash === -1) {
    return { order: 1, direction: normalized };
  }

  const maybeType = normalized.slice(0, firstDash);
  const maybeDirection = normalized.slice(firstDash + 1);

  if (BOND_ORDER[maybeType]) {
    return {
      order: BOND_ORDER[maybeType],
      direction: maybeDirection,
    };
  }

  return {
    order: 1,
    direction: normalized,
  };
}

function getGridKey(x, y) {
  return `${x},${y}`;
}

function addOrUpdateBond(bondMap, atomA, atomB, order, inferred = false) {
  if (!atomA || !atomB || atomA.id === atomB.id) {
    return;
  }

  const [left, right] = atomA.id < atomB.id ? [atomA, atomB] : [atomB, atomA];
  const key = `${left.id}|${right.id}`;

  const existing = bondMap.get(key);
  if (!existing) {
    bondMap.set(key, {
      key,
      aId: left.id,
      bId: right.id,
      order,
      inferred,
    });
    return;
  }

  const higherOrder = Math.max(existing.order, order);
  const shouldReplaceInferred = existing.inferred && !inferred;

  if (higherOrder !== existing.order || shouldReplaceInferred) {
    existing.order = higherOrder;
    existing.inferred = existing.inferred && inferred;
  }
}

function parseLewisDsl(input) {
  const source = normalizeDslInput(input);
  const diagnostics = [];
  const atoms = [];
  const directives = {};

  if (!source) {
    diagnostics.push({ severity: "error", line: 0, message: "Input is empty." });
    return {
      atoms,
      bonds: [],
      directives,
      diagnostics,
    };
  }

  const lines = source.split(/\r?\n/);
  const symbolCounter = new Map();

  for (let i = 0; i < lines.length; i += 1) {
    const lineNumber = i + 1;
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (!line || line.startsWith("```")) {
      continue;
    }

    if (line.startsWith("#")) {
      const ionMatch = line.match(/^#ion\[(.+)\]$/i);
      if (ionMatch) {
        directives.ion = ionMatch[1].trim();
      }
      continue;
    }

    const parts = splitTopLevelCommas(line);
    if (parts.length === 0) {
      continue;
    }

    const rawSymbol = parts[0].trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(rawSymbol)) {
      diagnostics.push({
        severity: "error",
        line: lineNumber,
        message: `Invalid atom symbol \"${rawSymbol}\".`,
      });
      continue;
    }

    const symbol = rawSymbol.charAt(0).toUpperCase() + rawSymbol.slice(1).toLowerCase();
    const index = (symbolCounter.get(symbol) ?? 0) + 1;
    symbolCounter.set(symbol, index);

    const atom = {
      id: `${symbol}${index}`,
      symbol,
      line: lineNumber,
      placement: null,
      placementReference: null,
      pairs: [],
      unpairs: [],
      bonds: [],
      grid: null,
      anchorId: null,
    };

    for (const tokenRaw of parts.slice(1)) {
      const token = tokenRaw.trim();
      if (!token) {
        continue;
      }

      const dataMatch = token.match(/^(bonds|pairs|unpairs)\[(.*)\]$/i);
      if (dataMatch) {
        const key = dataMatch[1].toLowerCase();
        const values = splitTopLevelCommas(dataMatch[2])
          .map((entry) => entry.trim().toLowerCase())
          .filter(Boolean);

        if (key === "bonds") {
          atom.bonds.push(...values);
        } else if (key === "pairs") {
          atom.pairs.push(...values);
        } else {
          atom.unpairs.push(...values);
        }

        continue;
      }

      const placementMatch = token.match(
        /^(central|top|bottom|left|right|top-left|top-right|bottom-left|bottom-right)(?:\[(.+)\])?$/i,
      );

      if (placementMatch) {
        const placementDirection = placementMatch[1].toLowerCase();
        const placementRef = placementMatch[2] ? placementMatch[2].trim() : "";

        if (placementDirection === "central") {
          atom.placement = { type: "central" };
          atom.placementReference = null;
        } else {
          if (!placementRef) {
            diagnostics.push({
              severity: "error",
              line: lineNumber,
              message: `Placement \"${placementDirection}\" requires a reference atom.`,
            });
            continue;
          }

          atom.placement = { type: "relative", direction: placementDirection };
          atom.placementReference = placementRef;
        }

        continue;
      }

      diagnostics.push({
        severity: "error",
        line: lineNumber,
        message: `Unrecognized token \"${token}\".`,
      });
    }

    atoms.push(atom);
  }

  if (atoms.length === 0) {
    diagnostics.push({ severity: "error", line: 0, message: "No atoms found in input." });
    return {
      atoms,
      bonds: [],
      directives,
      diagnostics,
    };
  }

  const atomsById = new Map();
  const atomsBySymbol = new Map();

  for (const atom of atoms) {
    atomsById.set(atom.id, atom);
    const key = atom.symbol.toLowerCase();
    const list = atomsBySymbol.get(key) ?? [];
    list.push(atom);
    atomsBySymbol.set(key, list);
  }

  if (!atoms.some((atom) => atom.placement && atom.placement.type === "central") && !atoms[0].placement) {
    atoms[0].placement = { type: "central" };
  }

  let centralCount = 0;
  for (const atom of atoms) {
    if (atom.placement && atom.placement.type === "central") {
      atom.grid = { x: centralCount * 2, y: 0 };
      if (centralCount > 0) {
        diagnostics.push({
          severity: "warning",
          line: atom.line,
          message: "Multiple central atoms were provided. Additional central atoms are offset to avoid overlap.",
        });
      }
      centralCount += 1;
    }
  }

  for (const atom of atoms) {
    if (atom.placement && atom.placement.type === "relative") {
      const resolved = resolveAtomReference(
        atom.placementReference,
        atomsById,
        atomsBySymbol,
        diagnostics,
        atom.line,
      );
      if (resolved) {
        atom.anchorId = resolved.id;
      }
    }
  }

  let placedInPass = true;
  while (placedInPass) {
    placedInPass = false;

    for (const atom of atoms) {
      if (atom.grid || !atom.placement || atom.placement.type !== "relative") {
        continue;
      }

      const anchor = atom.anchorId ? atomsById.get(atom.anchorId) : null;
      if (!anchor || !anchor.grid) {
        continue;
      }

      const vector = DIRECTION_VECTORS[atom.placement.direction];
      if (!vector) {
        diagnostics.push({
          severity: "error",
          line: atom.line,
          message: `Unknown placement direction \"${atom.placement.direction}\".`,
        });
        continue;
      }

      atom.grid = {
        x: anchor.grid.x + vector[0],
        y: anchor.grid.y + vector[1],
      };
      placedInPass = true;
    }
  }

  for (const atom of atoms) {
    if (atom.grid) {
      continue;
    }

    if (!atom.placement) {
      diagnostics.push({
        severity: "error",
        line: atom.line,
        message: "Atom has no placement. Use central or a relative placement like right[C1].",
      });
      continue;
    }

    if (atom.placement.type === "relative") {
      diagnostics.push({
        severity: "error",
        line: atom.line,
        message: `Could not place atom ${atom.id} because anchor ${atom.placementReference} was not resolved to a positioned atom.`,
      });
    }
  }

  const placedAtoms = atoms.filter((atom) => atom.grid);
  const atomAtCoordinate = new Map();

  for (const atom of placedAtoms) {
    const key = getGridKey(atom.grid.x, atom.grid.y);
    if (atomAtCoordinate.has(key)) {
      const occupied = atomAtCoordinate.get(key);
      diagnostics.push({
        severity: "warning",
        line: atom.line,
        message: `Atom ${atom.id} overlaps with ${occupied.id} at ${key}.`,
      });
      continue;
    }
    atomAtCoordinate.set(key, atom);
  }

  const bondMap = new Map();

  for (const atom of placedAtoms) {
    for (const bondToken of atom.bonds) {
      const parsedBond = parseBondSpec(bondToken);
      const vector = DIRECTION_VECTORS[parsedBond.direction];

      if (!vector) {
        diagnostics.push({
          severity: "error",
          line: atom.line,
          message: `Unknown bond direction in \"${bondToken}\".`,
        });
        continue;
      }

      const targetKey = getGridKey(atom.grid.x + vector[0], atom.grid.y + vector[1]);
      const target = atomAtCoordinate.get(targetKey);

      if (!target) {
        diagnostics.push({
          severity: "warning",
          line: atom.line,
          message: `Bond \"${bondToken}\" from ${atom.id} does not point to a placed atom.`,
        });
        continue;
      }

      addOrUpdateBond(bondMap, atom, target, parsedBond.order, false);
    }
  }

  for (const atom of placedAtoms) {
    if (!atom.anchorId) {
      continue;
    }

    const anchor = atomsById.get(atom.anchorId);
    if (!anchor || !anchor.grid) {
      continue;
    }

    addOrUpdateBond(bondMap, atom, anchor, 1, true);
  }

  return {
    atoms,
    bonds: [...bondMap.values()],
    directives,
    diagnostics,
  };
}

function renderBondLines(startX, startY, endX, endY, order, options) {
  const dx = endX - startX;
  const dy = endY - startY;
  const length = Math.hypot(dx, dy);

  if (length === 0) {
    return [];
  }

  const ux = dx / length;
  const uy = dy / length;
  const px = -uy;
  const py = ux;

  const fromX = startX + ux * options.atomRadius;
  const fromY = startY + uy * options.atomRadius;
  const toX = endX - ux * options.atomRadius;
  const toY = endY - uy * options.atomRadius;

  if (order === 1) {
    return [[fromX, fromY, toX, toY]];
  }

  if (order === 2) {
    const offset = options.bondGap / 2;
    return [
      [fromX + px * offset, fromY + py * offset, toX + px * offset, toY + py * offset],
      [fromX - px * offset, fromY - py * offset, toX - px * offset, toY - py * offset],
    ];
  }

  const offset = options.bondGap;
  return [
    [fromX, fromY, toX, toY],
    [fromX + px * offset, fromY + py * offset, toX + px * offset, toY + py * offset],
    [fromX - px * offset, fromY - py * offset, toX - px * offset, toY - py * offset],
  ];
}

function renderElectronDots(atomX, atomY, direction, count, options) {
  const vector = DIRECTION_VECTORS[direction];
  if (!vector) {
    return [];
  }

  const [dx, dy] = vector;
  const length = Math.hypot(dx, dy);
  const ux = dx / length;
  const uy = dy / length;

  const baseX = atomX + ux * options.dotDistance;
  const baseY = atomY + uy * options.dotDistance;
  const perpX = -uy;
  const perpY = ux;

  if (count === 1) {
    return [[baseX, baseY]];
  }

  const spread = options.dotGap / 2;
  return [
    [baseX + perpX * spread, baseY + perpY * spread],
    [baseX - perpX * spread, baseY - perpY * spread],
  ];
}

function buildDiagnosticMessage(diagnostics) {
  return diagnostics
    .map((item) => {
      const prefix = item.line > 0 ? `line ${item.line}` : "input";
      return `${prefix}: ${item.message}`;
    })
    .join("\n");
}

function assertUiOnlyRuntime() {
  const isBrowserRuntime =
    typeof window !== "undefined" &&
    typeof document !== "undefined" &&
    typeof document.createElement === "function";

  if (!isBrowserRuntime) {
    throw new Error(
      "JavaScript generation outside the browser UI is currently disabled. Open index.html and generate SVG from the UI.",
    );
  }
}

export function buildLewisStructure(input, renderOptions = {}) {
  assertUiOnlyRuntime();

  const parsed = parseLewisDsl(input);
  const errors = parsed.diagnostics.filter((item) => item.severity === "error");

  if (errors.length > 0) {
    throw new Error(`Could not build Lewis structure:\n${buildDiagnosticMessage(errors)}`);
  }

  const options = {
    ...DEFAULT_RENDER_OPTIONS,
    ...renderOptions,
  };

  const atoms = parsed.atoms.filter((atom) => atom.grid);
  const byId = new Map(atoms.map((atom) => [atom.id, atom]));

  const gridXs = atoms.map((atom) => atom.grid.x);
  const gridYs = atoms.map((atom) => atom.grid.y);
  const minGridX = Math.min(...gridXs);
  const minGridY = Math.min(...gridYs);

  const positionedAtoms = atoms.map((atom) => ({
    ...atom,
    x: (atom.grid.x - minGridX) * options.gridStep + options.margin,
    y: (atom.grid.y - minGridY) * options.gridStep + options.margin,
  }));

  const positionedById = new Map(positionedAtoms.map((atom) => [atom.id, atom]));

  const bondElements = [];
  for (const bond of parsed.bonds) {
    const atomA = positionedById.get(bond.aId);
    const atomB = positionedById.get(bond.bId);
    if (!atomA || !atomB) {
      continue;
    }

    const lines = renderBondLines(atomA.x, atomA.y, atomB.x, atomB.y, bond.order, options);
    for (const [x1, y1, x2, y2] of lines) {
      bondElements.push(
        `<line class="bond" x1="${formatNumber(x1)}" y1="${formatNumber(y1)}" x2="${formatNumber(x2)}" y2="${formatNumber(y2)}" />`,
      );
    }
  }

  const electronElements = [];
  for (const atom of positionedAtoms) {
    for (const direction of atom.pairs) {
      const dots = renderElectronDots(atom.x, atom.y, direction, 2, options);
      if (dots.length === 0) {
        continue;
      }

      for (const [x, y] of dots) {
        electronElements.push(
          `<circle class="electron" cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="${formatNumber(options.dotRadius)}" />`,
        );
      }
    }

    for (const direction of atom.unpairs) {
      const dots = renderElectronDots(atom.x, atom.y, direction, 1, options);
      if (dots.length === 0) {
        continue;
      }

      const [x, y] = dots[0];
      electronElements.push(
        `<circle class="electron" cx="${formatNumber(x)}" cy="${formatNumber(y)}" r="${formatNumber(options.dotRadius)}" />`,
      );
    }
  }

  const atomElements = positionedAtoms.map(
    (atom) =>
      `<text class="atom" x="${formatNumber(atom.x)}" y="${formatNumber(atom.y)}" dy="0.04em">${escapeXml(atom.symbol)}</text>`,
  );

  const allXs = positionedAtoms.map((atom) => atom.x);
  const allYs = positionedAtoms.map((atom) => atom.y);

  let minX = Math.min(...allXs) - options.margin;
  let maxX = Math.max(...allXs) + options.margin;
  let minY = Math.min(...allYs) - options.margin;
  let maxY = Math.max(...allYs) + options.margin;

  const ionElements = [];
  if (parsed.directives.ion) {
    const bracketPadding = 32;
    const tabLength = 14;

    const left = Math.min(...allXs) - bracketPadding;
    const right = Math.max(...allXs) + bracketPadding;
    const top = Math.min(...allYs) - bracketPadding;
    const bottom = Math.max(...allYs) + bracketPadding;

    ionElements.push(
      `<path class="ion-bracket" d="M ${formatNumber(left + tabLength)} ${formatNumber(top)} H ${formatNumber(left)} V ${formatNumber(bottom)} H ${formatNumber(left + tabLength)}" />`,
    );

    ionElements.push(
      `<path class="ion-bracket" d="M ${formatNumber(right - tabLength)} ${formatNumber(top)} H ${formatNumber(right)} V ${formatNumber(bottom)} H ${formatNumber(right - tabLength)}" />`,
    );

    const chargeX = right + 10;
    const chargeY = top + 10;
    ionElements.push(
      `<text class="ion-charge" x="${formatNumber(chargeX)}" y="${formatNumber(chargeY)}">${escapeXml(parsed.directives.ion)}</text>`,
    );

    minX = Math.min(minX, left - 16);
    maxX = Math.max(maxX, right + 52);
    minY = Math.min(minY, top - 18);
    maxY = Math.max(maxY, bottom + 16);
  }

  const width = Math.max(140, maxX - minX);
  const height = Math.max(140, maxY - minY);

  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${formatNumber(minX)} ${formatNumber(minY)} ${formatNumber(width)} ${formatNumber(height)}" width="${formatNumber(width)}" height="${formatNumber(height)}" role="img" aria-label="Lewis structure">`,
    "  <style>",
    `    .bond { stroke: #1f2a44; stroke-width: ${formatNumber(options.bondWidth)}; stroke-linecap: round; }`,
    "    .atom { fill: #111827; font-weight: 500; text-anchor: middle; dominant-baseline: central; }",
    "    .electron { fill: #0f172a; }",
    "    .ion-bracket { fill: none; stroke: #1f2a44; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }",
    "    .ion-charge { fill: #111827; font-weight: 600; dominant-baseline: middle; }",
    "  </style>",
    `  <g style="font-family: ${escapeXml(options.fontFamily)}; font-size: ${formatNumber(options.atomFontSize)}px;">`,
    ...bondElements.map((line) => `    ${line}`),
    ...electronElements.map((dot) => `    ${dot}`),
    ...atomElements.map((label) => `    ${label}`),
    "  </g>",
    `  <g style="font-family: ${escapeXml(options.fontFamily)}; font-size: ${formatNumber(options.chargeFontSize)}px;">`,
    ...ionElements.map((item) => `    ${item}`),
    "  </g>",
    "</svg>",
  ].join("\n");

  return {
    svg,
    diagnostics: parsed.diagnostics,
    model: {
      atoms,
      bonds: parsed.bonds.map((bond) => ({
        ...bond,
        a: byId.get(bond.aId),
        b: byId.get(bond.bId),
      })),
      directives: parsed.directives,
    },
  };
}

export function generateLewisSvg(input, renderOptions = {}) {
  return buildLewisStructure(input, renderOptions).svg;
}
