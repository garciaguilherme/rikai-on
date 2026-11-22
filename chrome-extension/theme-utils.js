/**
 * Shared theme application & custom theme builder helpers for Rikai On.
 */
window.RIKAI_CUSTOM_THEME_DEFAULTS = {
  bg: "#12121a",
  surface: "#1b1b26",
  elevated: "#272736",
  text: "#f3f4f6",
  muted: "#a1a1aa",
  accent: "#f43f5e",
  accentContrast: "#18151b",
  accent2: "#38bdf8",
  border: "#3f3f46",
  borderStyle: "solid",
  radius: 14,
  rowRadius: 10,
  btnRadius: 12,
  font: '"Roboto", "Noto Sans JP", system-ui, sans-serif',
  overlayBg: "#0f0f14",
  overlayOpacity: 85,
  overlayText: "#ffffff",
  leechBorder: "#fbbf24",
  hardBorder: "#f43f5e",
  youngBorder: "#38bdf8",
  matureBorder: "#4ade80",
  extraCss: "",
};

(function () {
  const MANAGED_VARS = [
    "--rk-bg", "--rk-surface", "--rk-elevated", "--rk-text", "--rk-muted",
    "--rk-accent", "--rk-accent-contrast", "--rk-accent2", "--rk-border",
    "--rk-border-style", "--rk-radius", "--rk-row-radius", "--rk-btn-radius",
    "--rk-font", "--rk-overlay-bg", "--rk-overlay-text", "--rk-overlay-shadow",
    "--rk-leech-bg", "--rk-leech-border", "--rk-leech-text",
    "--rk-hard-bg", "--rk-hard-border", "--rk-hard-text",
    "--rk-young-bg", "--rk-young-border", "--rk-young-text",
    "--rk-mature-bg", "--rk-mature-border", "--rk-mature-text",
    "--rk-active-border-left",
  ];

  function hexToRgba(hex, alpha) {
    const clean = String(hex || "").replace("#", "");
    if (!/^[0-9a-fA-F]{6}$/.test(clean)) return `rgba(0, 0, 0, ${alpha})`;
    const n = parseInt(clean, 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
  }

  function applyExtraVars(el, extraCss) {
    const applied = [];
    String(extraCss || "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .forEach((decl) => {
        const idx = decl.indexOf(":");
        if (idx <= 0) return;
        const prop = decl.slice(0, idx).trim();
        const val = decl.slice(idx + 1).trim();
        if (prop.startsWith("--rk-") && val) {
          el.style.setProperty(prop, val);
          applied.push(prop);
        }
      });
    return applied;
  }

  window.rikaiApplyTheme = function rikaiApplyTheme(elements, themeName, customTheme) {
    const theme = themeName || "rikai-red";
    const list = (Array.isArray(elements) ? elements : [elements]).filter(Boolean);
    const rawCustom = customTheme && typeof customTheme === "object" ? customTheme : {};
    const isCorruptBlack = rawCustom.bg === "#000000" && rawCustom.surface === "#000000" && rawCustom.text === "#000000";
    const ct = isCorruptBlack
      ? { ...window.RIKAI_CUSTOM_THEME_DEFAULTS }
      : { ...window.RIKAI_CUSTOM_THEME_DEFAULTS, ...rawCustom };

    list.forEach((el) => {
      el.setAttribute("data-theme", theme);
      el.setAttribute("data-rikai-theme", theme);

      MANAGED_VARS.forEach((v) => el.style.removeProperty(v));
      if (Array.isArray(el._rikaiExtraVars)) {
        el._rikaiExtraVars.forEach((v) => el.style.removeProperty(v));
      }
      el._rikaiExtraVars = [];

      if (theme !== "custom") return;

      const op = Math.min(100, Math.max(20, Number(ct.overlayOpacity ?? 85))) / 100;
      const vars = {
        "--rk-bg": ct.bg,
        "--rk-surface": ct.surface,
        "--rk-elevated": ct.elevated,
        "--rk-text": ct.text,
        "--rk-muted": ct.muted,
        "--rk-accent": ct.accent,
        "--rk-accent-contrast": ct.accentContrast,
        "--rk-accent2": ct.accent2,
        "--rk-border": ct.border,
        "--rk-border-style": ct.borderStyle || "solid",
        "--rk-radius": `${Number(ct.radius ?? 14)}px`,
        "--rk-row-radius": `${Number(ct.rowRadius ?? 10)}px`,
        "--rk-btn-radius": `${Number(ct.btnRadius ?? 12)}px`,
        "--rk-font": ct.font || window.RIKAI_CUSTOM_THEME_DEFAULTS.font,
        "--rk-overlay-bg": hexToRgba(ct.overlayBg, op),
        "--rk-overlay-text": ct.overlayText,
        "--rk-overlay-shadow": `0 6px 20px ${hexToRgba(ct.accent, 0.25)}`,
        "--rk-active-border-left": `4px solid ${ct.accent}`,
        "--rk-leech-bg": hexToRgba(ct.leechBorder, 0.24),
        "--rk-leech-border": ct.leechBorder,
        "--rk-leech-text": ct.text,
        "--rk-hard-bg": hexToRgba(ct.hardBorder, 0.24),
        "--rk-hard-border": ct.hardBorder,
        "--rk-hard-text": ct.text,
        "--rk-young-bg": hexToRgba(ct.youngBorder, 0.2),
        "--rk-young-border": ct.youngBorder,
        "--rk-young-text": ct.text,
        "--rk-mature-bg": hexToRgba(ct.matureBorder, 0.2),
        "--rk-mature-border": ct.matureBorder,
        "--rk-mature-text": ct.text,
      };
      Object.entries(vars).forEach(([k, v]) => {
        if (v !== undefined && v !== null) el.style.setProperty(k, String(v));
      });
      el._rikaiExtraVars = applyExtraVars(el, ct.extraCss);
    });
  };
})();
