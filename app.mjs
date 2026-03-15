import { buildLewisStructure } from "./lewis-svg.mjs";

const STYLE_DEFAULTS = Object.freeze({
  gridStep: 80,
  margin: 50,
  atomRadius: 26,
  bondGap: 9,
  dotDistance: Object.freeze({
    top: 23,
    right: 25,
    bottom: 25,
    left: 25,
  }),
  dotGap: 10,
  dotRadius: 3,
  fontFamily: "'Times New Roman', 'Cambria', serif",
  atomFontSize: 36,
  chargeFontSize: 25,
  bondWidth: 4,
});

const FONT_PRESETS = Object.freeze({
  classic: "'Times New Roman', 'Cambria', serif",
  academic: "'STIX Two Text', 'Garamond', 'Palatino Linotype', serif",
  modern: "'Baskerville', 'Georgia', serif",
  mono: "'IBM Plex Mono', 'SFMono-Regular', Menlo, Consolas, monospace",
});

const EXAMPLES = {
  CO2: `C, central, bonds[double-left, double-right]
O, left[C], pairs[top, bottom]
O, right[C], pairs[top, bottom]`,
  H2O: `O, central, pairs[top-right, top-left]
H, bottom-left[O], bonds[single-top-right]
H, bottom-right[O], bonds[single-top-left]`,
  NH3: `N, central, pairs[top]
H, left[N], bonds[single-right]
H, bottom[N], bonds[single-top]
H, right[N], bonds[single-left]`,
  N: `N, central, unpairs[top, bottom, left], pairs[right]`,
  C2H4: `C, central, bonds[single-top-left, single-bottom-left]
C, right[C1], bonds[single-top-right, single-bottom-right, double-left]
H, top-left[C1]
H, bottom-left[C1]
H, top-right[C2]
H, bottom-right[C2]`,
  CO3_2_minus: `#ion[2-]
C, central, bonds[single-left, single-right, double-top]
O, top[C], pairs[right, left]
O, left[C], pairs[top, bottom, left]
O, right[C], pairs[top, bottom, right]`,
};

const dslInput = document.querySelector("#dslInput");
const exampleSelect = document.querySelector("#exampleSelect");
const generateButton = document.querySelector("#generateBtn");
const downloadButton = document.querySelector("#downloadBtn");
const svgContainer = document.querySelector("#svgContainer");
const errorBox = document.querySelector("#errorBox");
const warningBox = document.querySelector("#warningBox");
const fontPresetSelect = document.querySelector("#fontPreset");
const fontFamilyInput = document.querySelector("#fontFamilyInput");
const resetStyleButton = document.querySelector("#resetStyleBtn");
const dotDistanceInput = document.querySelector("#dotDistanceInput");

const styleInputMap = Object.freeze({
  gridStep: document.querySelector("#gridStepInput"),
  margin: document.querySelector("#marginInput"),
  atomRadius: document.querySelector("#atomRadiusInput"),
  atomFontSize: document.querySelector("#atomFontSizeInput"),
  chargeFontSize: document.querySelector("#chargeFontSizeInput"),
  bondWidth: document.querySelector("#bondWidthInput"),
  bondGap: document.querySelector("#bondGapInput"),
  dotGap: document.querySelector("#dotGapInput"),
  dotRadius: document.querySelector("#dotRadiusInput"),
});

const DOT_DISTANCE_KEYS = Object.freeze(["top", "right", "bottom", "left"]);
const DOT_DISTANCE_MIN = 4;
const DOT_DISTANCE_MAX = 80;

let currentSvg = "";

function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function readNumericStyleInput(input, fallback) {
  const parsed = Number.parseFloat(input.value);
  if (!Number.isFinite(parsed)) {
    input.value = String(fallback);
    return fallback;
  }

  const min = input.min ? Number.parseFloat(input.min) : Number.NEGATIVE_INFINITY;
  const max = input.max ? Number.parseFloat(input.max) : Number.POSITIVE_INFINITY;
  const clamped = clampNumber(parsed, min, max);

  input.value = String(clamped);
  return clamped;
}

function formatDotDistanceValue(dotDistance) {
  return DOT_DISTANCE_KEYS.map((side) => String(dotDistance[side])).join(", ");
}

function parseDotDistanceInput(input, fallback) {
  const normalizedFallback = DOT_DISTANCE_KEYS.reduce((result, side) => {
    const value = Number.parseFloat(fallback[side]);
    result[side] = Number.isFinite(value) ? value : 25.5;
    return result;
  }, {});

  const restoreFallback = () => {
    input.value = formatDotDistanceValue(normalizedFallback);
    return { ...normalizedFallback };
  };

  const values = input.value
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  if (values.length === 0) {
    return restoreFallback();
  }

  let parsedValues = [];

  if (values.length === 1) {
    const singleValue = Number.parseFloat(values[0]);
    if (!Number.isFinite(singleValue)) {
      return restoreFallback();
    }
    parsedValues = [singleValue, singleValue, singleValue, singleValue];
  } else if (values.length === 4) {
    parsedValues = values.map((value) => Number.parseFloat(value));
    if (parsedValues.some((value) => !Number.isFinite(value))) {
      return restoreFallback();
    }
  } else {
    return restoreFallback();
  }

  const [top, right, bottom, left] = parsedValues.map((value) =>
    clampNumber(value, DOT_DISTANCE_MIN, DOT_DISTANCE_MAX),
  );

  const parsedDistance = {
    top,
    right,
    bottom,
    left,
  };

  input.value = formatDotDistanceValue(parsedDistance);
  return parsedDistance;
}

function setPresetFromFontValue(fontValue) {
  const matchedPreset = Object.entries(FONT_PRESETS).find(([, value]) => value === fontValue);
  fontPresetSelect.value = matchedPreset ? matchedPreset[0] : "custom";
}

function applyStyleDefaults() {
  for (const [key, input] of Object.entries(styleInputMap)) {
    input.value = String(STYLE_DEFAULTS[key]);
  }

  dotDistanceInput.value = formatDotDistanceValue(STYLE_DEFAULTS.dotDistance);

  fontFamilyInput.value = STYLE_DEFAULTS.fontFamily;
  setPresetFromFontValue(STYLE_DEFAULTS.fontFamily);
}

function getRenderOptionsFromUi() {
  const options = {};

  for (const [key, input] of Object.entries(styleInputMap)) {
    options[key] = readNumericStyleInput(input, STYLE_DEFAULTS[key]);
  }

  options.dotDistance = parseDotDistanceInput(dotDistanceInput, STYLE_DEFAULTS.dotDistance);

  const fontFamily = fontFamilyInput.value.trim();
  options.fontFamily = fontFamily || STYLE_DEFAULTS.fontFamily;

  return options;
}

function hideMessages() {
  errorBox.hidden = true;
  warningBox.hidden = true;
  errorBox.textContent = "";
  warningBox.textContent = "";
}

function renderStructure() {
  hideMessages();

  try {
    const renderOptions = getRenderOptionsFromUi();
    const { svg, diagnostics } = buildLewisStructure(dslInput.value, renderOptions);
    currentSvg = svg;
    svgContainer.innerHTML = svg;
    downloadButton.disabled = false;

    const warnings = diagnostics.filter((item) => item.severity === "warning");
    if (warnings.length > 0) {
      warningBox.hidden = false;
      warningBox.textContent = warnings
        .map((warning) => {
          const where = warning.line > 0 ? `line ${warning.line}` : "input";
          return `${where}: ${warning.message}`;
        })
        .join("\n");
    }
  } catch (error) {
    currentSvg = "";
    svgContainer.innerHTML = "";
    downloadButton.disabled = true;
    errorBox.hidden = false;
    errorBox.textContent = error.message;
  }
}

function loadExample(exampleKey) {
  dslInput.value = EXAMPLES[exampleKey] ?? "";
  renderStructure();
}

for (const [key] of Object.entries(EXAMPLES)) {
  const option = document.createElement("option");
  option.value = key;
  option.textContent = key.replaceAll("_", " ");
  exampleSelect.append(option);
}

applyStyleDefaults();

exampleSelect.value = "CO2";
loadExample("CO2");

generateButton.addEventListener("click", renderStructure);

exampleSelect.addEventListener("change", () => {
  loadExample(exampleSelect.value);
});

dslInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    renderStructure();
  }
});

for (const input of Object.values(styleInputMap)) {
  input.addEventListener("input", renderStructure);
}

dotDistanceInput.addEventListener("input", renderStructure);

fontPresetSelect.addEventListener("change", () => {
  if (fontPresetSelect.value === "custom") {
    return;
  }

  const preset = FONT_PRESETS[fontPresetSelect.value];
  if (!preset) {
    return;
  }

  fontFamilyInput.value = preset;
  renderStructure();
});

fontFamilyInput.addEventListener("input", () => {
  setPresetFromFontValue(fontFamilyInput.value.trim());
  renderStructure();
});

resetStyleButton.addEventListener("click", () => {
  applyStyleDefaults();
  renderStructure();
});

downloadButton.addEventListener("click", () => {
  if (!currentSvg) {
    return;
  }

  const blob = new Blob([currentSvg], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "lewis-structure.svg";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();

  URL.revokeObjectURL(url);
});
