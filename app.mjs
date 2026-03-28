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

const CODE_STORAGE_KEY = "lewis.dsl.input.v1";

const dslInput = document.querySelector("#dslInput");
const exampleButtons = document.querySelector("#exampleButtons");
const downloadSvgButton = document.querySelector("#downloadSvgBtn");
const downloadPngButton = document.querySelector("#downloadPngBtn");
const svgContainer = document.querySelector("#svgContainer");
const errorBox = document.querySelector("#errorBox");
const warningBox = document.querySelector("#warningBox");
const confirmOverlay = document.querySelector("#confirmOverlay");
const confirmAcceptButton = document.querySelector("#confirmAcceptBtn");
const confirmCancelButton = document.querySelector("#confirmCancelBtn");
const fontPresetSelect = document.querySelector("#fontPreset");
const fontFamilyInput = document.querySelector("#fontFamilyInput");
const resetStyleButton = document.querySelector("#resetStyleBtn");
const dotDistanceInputMap = Object.freeze({
  top: document.querySelector("#dotDistanceTopInput"),
  right: document.querySelector("#dotDistanceRightInput"),
  bottom: document.querySelector("#dotDistanceBottomInput"),
  left: document.querySelector("#dotDistanceLeftInput"),
});

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
const STYLE_LABELS = Object.freeze({
  gridStep: "Grid step",
  margin: "Margin",
  atomRadius: "Atom radius",
  atomFontSize: "Atom font size",
  chargeFontSize: "Charge font size",
  bondWidth: "Bond width",
  bondGap: "Bond gap",
  dotGap: "Electron gap",
  dotRadius: "Electron radius",
});
const DOT_DISTANCE_LABELS = Object.freeze({
  top: "Electron distance (top)",
  right: "Electron distance (right)",
  bottom: "Electron distance (bottom)",
  left: "Electron distance (left)",
});

let currentSvg = "";
let activeExampleKey = null;
let hasTypedCustomInput = false;

function setDownloadButtonsEnabled(enabled) {
  downloadSvgButton.disabled = !enabled;
  downloadPngButton.disabled = !enabled;
}

function debounce(fn, waitMs) {
  let timeoutId = null;

  return (...args) => {
    if (timeoutId) {
      window.clearTimeout(timeoutId);
    }

    timeoutId = window.setTimeout(() => {
      fn(...args);
    }, waitMs);
  };
}

function extractErrorLineNumbers(errorMessage) {
  const lineNumbers = new Set();

  for (const match of String(errorMessage).matchAll(/line\s+(\d+):/gi)) {
    const parsed = Number.parseInt(match[1], 10);
    if (Number.isFinite(parsed) && parsed > 0) {
      lineNumbers.add(parsed);
    }
  }

  return [...lineNumbers].sort((a, b) => a - b);
}

function saveCodeDraft() {
  try {
    window.localStorage.setItem(CODE_STORAGE_KEY, dslInput.value);
  } catch {
    // Ignore storage failures (private mode, quota, etc.).
  }
}

function loadSavedCodeDraft() {
  try {
    return window.localStorage.getItem(CODE_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function confirmReplaceInApp() {
  return new Promise((resolve) => {
    const onAccept = () => {
      cleanup();
      resolve(true);
    };

    const onCancel = () => {
      cleanup();
      resolve(false);
    };

    const onOverlayClick = (event) => {
      if (event.target === confirmOverlay) {
        onCancel();
      }
    };

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        onCancel();
      }
    };

    function cleanup() {
      confirmOverlay.hidden = true;
      confirmAcceptButton.removeEventListener("click", onAccept);
      confirmCancelButton.removeEventListener("click", onCancel);
      confirmOverlay.removeEventListener("click", onOverlayClick);
      window.removeEventListener("keydown", onKeyDown);
    }

    confirmAcceptButton.addEventListener("click", onAccept);
    confirmCancelButton.addEventListener("click", onCancel);
    confirmOverlay.addEventListener("click", onOverlayClick);
    window.addEventListener("keydown", onKeyDown);

    confirmOverlay.hidden = false;
    confirmAcceptButton.focus();
  });
}

function readNumericStyleInput(input, label) {
  const parsed = Number.parseFloat(input.value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a valid number.`);
  }

  input.value = String(parsed);
  return parsed;
}

function readDotDistanceInputs(inputMap) {
  const dotDistance = {};

  for (const side of DOT_DISTANCE_KEYS) {
    const input = inputMap[side];
    dotDistance[side] = readNumericStyleInput(input, DOT_DISTANCE_LABELS[side]);
  }

  return dotDistance;
}

function setPresetFromFontValue(fontValue) {
  const matchedPreset = Object.entries(FONT_PRESETS).find(([, value]) => value === fontValue);
  fontPresetSelect.value = matchedPreset ? matchedPreset[0] : "custom";
}

function applyStyleDefaults() {
  for (const [key, input] of Object.entries(styleInputMap)) {
    input.value = String(STYLE_DEFAULTS[key]);
  }

  for (const side of DOT_DISTANCE_KEYS) {
    dotDistanceInputMap[side].value = String(STYLE_DEFAULTS.dotDistance[side]);
  }

  fontFamilyInput.value = STYLE_DEFAULTS.fontFamily;
  setPresetFromFontValue(STYLE_DEFAULTS.fontFamily);
}

function getRenderOptionsFromUi() {
  const options = {};

  for (const [key, input] of Object.entries(styleInputMap)) {
    options[key] = readNumericStyleInput(input, STYLE_LABELS[key] ?? key);
  }

  options.dotDistance = readDotDistanceInputs(dotDistanceInputMap);

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

function setActiveExampleButton(exampleKey) {
  activeExampleKey = exampleKey;

  for (const button of exampleButtons.querySelectorAll(".example-btn")) {
    button.classList.toggle("is-active", button.dataset.exampleKey === exampleKey);
  }
}

function buildWithSkippedInvalidLines(renderOptions) {
  const originalLines = dslInput.value.split(/\r?\n/);
  let activeLines = [...originalLines];
  let activeLineMap = originalLines.map((_, index) => index + 1);
  const skippedOriginalLineNumbers = new Set();

  for (let pass = 0; pass < originalLines.length; pass += 1) {
    const activeSource = activeLines.join("\n");

    if (!activeSource.trim()) {
      throw new Error("Could not build Lewis structure: no valid lines remain after skipping invalid or incomplete lines.");
    }

    try {
      const result = buildLewisStructure(activeSource, renderOptions);
      return {
        result,
        skippedLineNumbers: [...skippedOriginalLineNumbers].sort((a, b) => a - b),
      };
    } catch (error) {
      const failedCurrentLineNumbers = extractErrorLineNumbers(error.message);

      if (failedCurrentLineNumbers.length === 0) {
        throw error;
      }

      const toRemove = new Set();
      for (const currentLineNumber of failedCurrentLineNumbers) {
        const zeroBasedIndex = currentLineNumber - 1;
        if (zeroBasedIndex >= 0 && zeroBasedIndex < activeLines.length) {
          toRemove.add(zeroBasedIndex);
        }
      }

      if (toRemove.size === 0) {
        throw error;
      }

      const nextLines = [];
      const nextLineMap = [];

      for (let i = 0; i < activeLines.length; i += 1) {
        if (toRemove.has(i)) {
          skippedOriginalLineNumbers.add(activeLineMap[i]);
          continue;
        }

        nextLines.push(activeLines[i]);
        nextLineMap.push(activeLineMap[i]);
      }

      activeLines = nextLines;
      activeLineMap = nextLineMap;
    }
  }

  throw new Error("Could not build Lewis structure after skipping invalid or incomplete lines.");
}

function renderStructure() {
  hideMessages();

  try {
    const renderOptions = getRenderOptionsFromUi();
    const { result, skippedLineNumbers } = buildWithSkippedInvalidLines(renderOptions);
    const { svg, diagnostics } = result;
    currentSvg = svg;
    svgContainer.innerHTML = svg;
    setDownloadButtonsEnabled(true);

    const warnings = diagnostics.filter((item) => item.severity === "warning");
    if (skippedLineNumbers.length > 0) {
      warnings.push({
        severity: "warning",
        line: 0,
        message: `Skipped invalid/incomplete line(s): ${skippedLineNumbers.join(", ")}.`,
      });
    }

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
    setDownloadButtonsEnabled(false);
    errorBox.hidden = false;
    errorBox.textContent = error.message;
  }
}

function loadExample(exampleKey) {
  if (!EXAMPLES[exampleKey]) {
    return;
  }

  dslInput.value = EXAMPLES[exampleKey] ?? "";
  saveCodeDraft();
  setActiveExampleButton(exampleKey);
  hasTypedCustomInput = false;
  renderStructure();
}

for (const [key] of Object.entries(EXAMPLES)) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "example-btn";
  button.dataset.exampleKey = key;
  button.textContent = key.replaceAll("_", " ");
  button.addEventListener("click", async () => {
    if (hasTypedCustomInput) {
      const shouldReplace = await confirmReplaceInApp();
      if (!shouldReplace) {
        return;
      }
    }

    if (activeExampleKey === key) {
      return;
    }

    loadExample(key);
  });
  exampleButtons.append(button);
}

const scheduleRender = debounce(renderStructure, 160);

applyStyleDefaults();

const savedDsl = loadSavedCodeDraft();
if (savedDsl.trim()) {
  dslInput.value = savedDsl;
  setActiveExampleButton(null);
  hasTypedCustomInput = true;
  renderStructure();
} else {
  loadExample("CO2");
}

dslInput.addEventListener("input", () => {
  hasTypedCustomInput = true;
  setActiveExampleButton(null);
  saveCodeDraft();
  scheduleRender();
});

for (const input of Object.values(styleInputMap)) {
  input.addEventListener("input", scheduleRender);
}

for (const input of Object.values(dotDistanceInputMap)) {
  input.addEventListener("input", scheduleRender);
}

fontPresetSelect.addEventListener("change", () => {
  if (fontPresetSelect.value === "custom") {
    return;
  }

  const preset = FONT_PRESETS[fontPresetSelect.value];
  if (!preset) {
    return;
  }

  fontFamilyInput.value = preset;
  scheduleRender();
});

fontFamilyInput.addEventListener("input", () => {
  setPresetFromFontValue(fontFamilyInput.value.trim());
  scheduleRender();
});

resetStyleButton.addEventListener("click", () => {
  applyStyleDefaults();
  scheduleRender();
});

downloadSvgButton.addEventListener("click", () => {
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

downloadPngButton.addEventListener("click", async () => {
  if (!currentSvg) {
    return;
  }

  const svgBlob = new Blob([currentSvg], { type: "image/svg+xml;charset=utf-8" });
  const svgUrl = URL.createObjectURL(svgBlob);

  try {
    const image = new Image();
    const loaded = new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
    });

    image.src = svgUrl;
    await loaded;

    const width = Math.max(1, Math.round(image.naturalWidth || 1200));
    const height = Math.max(1, Math.round(image.naturalHeight || 900));
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas is not available for PNG export.");
    }

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, width, height);
    context.drawImage(image, 0, 0, width, height);

    const pngUrl = canvas.toDataURL("image/png");
    const anchor = document.createElement("a");
    anchor.href = pngUrl;
    anchor.download = "lewis-structure.png";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  } catch (error) {
    errorBox.hidden = false;
    errorBox.textContent = error.message || "PNG export failed.";
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
});
