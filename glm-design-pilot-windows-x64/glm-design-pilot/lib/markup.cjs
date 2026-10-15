'use strict';
// Single entry point for rich model markup (spec section 4). Presentation code
// calls expandMarkup(html, budget) on sanitized, stored screen HTML (after
// {{reference:N}} substitution) and appends MARKUP_CSS to the page styles.
const icons = require('./icons.cjs');
const charts = require('./charts.cjs');

module.exports = {
  expandMarkup: charts.expandMarkup,
  MARKUP_CSS: charts.MARKUP_CSS,
  expandIcons: icons.expandIcons,
  iconNames: icons.iconNames,
  resolveIcon: icons.resolveIcon,
  iconSVG: icons.iconSVG,
  ICON_PROMPT_NAMES: icons.ICON_PROMPT_NAMES,
  expandCharts: charts.expandCharts,
  chartBudget: charts.chartBudget,
  validateChart: charts.validateChart,
  chartSVG: charts.chartSVG,
  chartHTML: charts.chartHTML,
  CHART_TYPES: charts.CHART_TYPES,
};
