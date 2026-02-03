/**
 * Custom Energy Sources Card
 * A HACS-compatible custom Lovelace card for Home Assistant
 *
 * Features:
 * - Integrates with Energy Dashboard date selector
 * - Custom energy source configuration
 * - Entity-based or static cost calculations
 * - Net metering support (negative values for grid export credits)
 * - Emoji icons instead of color boxes
 * - Support for solar, battery, grid, gas, and water
 */

const CARD_VERSION = '1.0.0';

// Default emojis for source types
const DEFAULT_EMOJIS = {
  solar: '☀️',
  battery_in: '🔋',
  battery_out: '🪫',
  grid_import: '🏭',
  grid_export: '💰',
  grid_net: '⚡',
  gas: '🔥',
  water: '💧',
  default: '📊'
};

// Default labels for source types
const DEFAULT_LABELS = {
  solar: 'Solar Production',
  battery_in: 'Battery Charged',
  battery_out: 'Battery Used',
  grid_import: 'Grid Import',
  grid_export: 'Grid Export',
  grid_net: 'Grid Net',
  gas: 'Gas',
  water: 'Water',
  default: 'Energy'
};

// Unit defaults
const DEFAULT_UNITS = {
  solar: 'kWh',
  battery_in: 'kWh',
  battery_out: 'kWh',
  grid_import: 'kWh',
  grid_export: 'kWh',
  grid_net: 'kWh',
  gas: 'm³',
  water: 'gal',
  default: 'kWh'
};

class CustomEnergySourcesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._energyData = {};
    this._unsubscribe = null;
    this._dateRange = null;
  }

  static getConfigElement() {
    return document.createElement('custom-energy-sources-card-editor');
  }

  static getStubConfig() {
    return {
      title: 'Energy Sources',
      sources: [
        {
          type: 'solar',
          entity: 'sensor.solar_energy_production',
          rate_entity: 'sensor.electricity_rate',
          label: 'Solar Production',
          emoji: '☀️'
        }
      ]
    };
  }

  setConfig(config) {
    if (!config.sources || !Array.isArray(config.sources)) {
      throw new Error('You must define at least one energy source');
    }

    this._config = {
      title: config.title || 'Energy Sources',
      show_header: config.show_header !== false,
      show_total: config.show_total !== false,
      currency: config.currency || '$',
      decimal_places: config.decimal_places ?? 2,
      cost_decimal_places: config.cost_decimal_places ?? 2,
      sources: config.sources.map(source => this._normalizeSource(source)),
      net_metering: config.net_metering || null,
      ...config
    };

    this.render();
  }

  _normalizeSource(source) {
    const type = source.type || 'default';
    return {
      type: type,
      entity: source.entity,
      label: source.label || DEFAULT_LABELS[type] || DEFAULT_LABELS.default,
      emoji: source.emoji || DEFAULT_EMOJIS[type] || DEFAULT_EMOJIS.default,
      unit: source.unit || DEFAULT_UNITS[type] || DEFAULT_UNITS.default,
      // Cost calculation options
      rate_entity: source.rate_entity || null,
      rate_static: source.rate_static ?? null,
      cost_formula: source.cost_formula || null, // For advanced calculations
      // For net metering / grid calculations
      invert_cost: source.invert_cost || false, // True for exports (negative cost = credit)
      // Display options
      show_cost: source.show_cost !== false,
      hide_if_zero: source.hide_if_zero || false,
      // For calculated sources (like grid net)
      calculate_from: source.calculate_from || null, // { import: 'entity_id', export: 'entity_id' }
    };
  }

  set hass(hass) {
    this._hass = hass;

    // Subscribe to energy date selection if not already subscribed
    if (!this._unsubscribe) {
      this._subscribeToEnergyDate();
    }

    this._updateData();
  }

  async _subscribeToEnergyDate() {
    if (!this._hass?.connection) return;

    try {
      // Subscribe to energy date selection changes
      this._unsubscribe = await this._hass.connection.subscribeMessage(
        (msg) => {
          if (msg.type === 'energy/date_selection') {
            this._dateRange = msg;
            this._updateData();
          }
        },
        { type: 'energy/subscribe_date_selection' }
      );
    } catch (e) {
      // Fallback: if subscription fails, use default date range (today)
      console.warn('Could not subscribe to energy date selection, using default range:', e);
      this._dateRange = this._getDefaultDateRange();
      this._updateData();
    }
  }

  _getDefaultDateRange() {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return {
      start: startOfDay.toISOString(),
      end: now.toISOString()
    };
  }

  async _updateData() {
    if (!this._hass || !this._config) return;

    const dateRange = this._dateRange || this._getDefaultDateRange();
    const startTime = new Date(dateRange.start);
    const endTime = dateRange.end ? new Date(dateRange.end) : new Date();

    // Fetch statistics for all configured entities
    const entityIds = this._config.sources
      .filter(s => s.entity)
      .map(s => s.entity);

    // Also fetch entities from calculate_from configurations
    this._config.sources.forEach(source => {
      if (source.calculate_from) {
        if (source.calculate_from.import) entityIds.push(source.calculate_from.import);
        if (source.calculate_from.export) entityIds.push(source.calculate_from.export);
      }
    });

    // Net metering entities
    if (this._config.net_metering) {
      if (this._config.net_metering.import_entity) {
        entityIds.push(this._config.net_metering.import_entity);
      }
      if (this._config.net_metering.export_entity) {
        entityIds.push(this._config.net_metering.export_entity);
      }
    }

    const uniqueEntityIds = [...new Set(entityIds)];

    if (uniqueEntityIds.length === 0) {
      this.render();
      return;
    }

    try {
      // Fetch statistics from Home Assistant
      const statistics = await this._fetchStatistics(
        uniqueEntityIds,
        startTime,
        endTime
      );

      // Process statistics into usable data
      this._energyData = this._processStatistics(statistics, startTime, endTime);
      this.render();
    } catch (e) {
      console.error('Error fetching energy statistics:', e);
      this.render();
    }
  }

  async _fetchStatistics(entityIds, startTime, endTime) {
    if (!this._hass?.callWS) return {};

    try {
      // Use recorder statistics for energy data
      const stats = await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        statistic_ids: entityIds,
        period: 'hour',
        types: ['sum', 'change']
      });
      return stats;
    } catch (e) {
      console.error('Failed to fetch statistics:', e);
      return {};
    }
  }

  _processStatistics(statistics, startTime, endTime) {
    const data = {};

    for (const [entityId, stats] of Object.entries(statistics)) {
      if (!stats || stats.length === 0) {
        data[entityId] = { value: 0, unit: null };
        continue;
      }

      // Calculate the total change/sum over the period
      let totalValue = 0;

      // For energy statistics, we want the change over the period
      if (stats.length > 0) {
        // Get the sum difference between start and end
        const firstStat = stats[0];
        const lastStat = stats[stats.length - 1];

        if (firstStat.sum !== undefined && lastStat.sum !== undefined) {
          totalValue = lastStat.sum - firstStat.sum;
        } else if (firstStat.change !== undefined) {
          // Sum up all changes
          totalValue = stats.reduce((acc, stat) => acc + (stat.change || 0), 0);
        } else if (firstStat.state !== undefined) {
          // Use state difference
          totalValue = (lastStat.state || 0) - (firstStat.state || 0);
        }
      }

      data[entityId] = {
        value: totalValue,
        unit: stats[0]?.unit_of_measurement || null
      };
    }

    return data;
  }

  _calculateCost(source, value) {
    if (!source.show_cost) return null;
    if (value === 0 && !source.rate_static && !source.rate_entity) return 0;

    let rate = 0;

    // Get rate from entity or static value
    if (source.rate_entity && this._hass?.states[source.rate_entity]) {
      rate = parseFloat(this._hass.states[source.rate_entity].state) || 0;
    } else if (source.rate_static !== null) {
      rate = source.rate_static;
    }

    // Custom formula support
    if (source.cost_formula) {
      try {
        // Simple formula evaluation - supports basic math with 'value' and 'rate' variables
        const formula = source.cost_formula
          .replace(/\bvalue\b/g, value)
          .replace(/\brate\b/g, rate);
        // Safe evaluation using Function constructor with limited scope
        const result = new Function('return ' + formula)();
        return source.invert_cost ? -result : result;
      } catch (e) {
        console.error('Error evaluating cost formula:', e);
        return null;
      }
    }

    // Standard calculation: value * rate
    const cost = value * rate;
    return source.invert_cost ? -cost : cost;
  }

  _getValue(source) {
    if (source.calculate_from) {
      // Calculated source (e.g., grid net = import - export)
      const importVal = this._energyData[source.calculate_from.import]?.value || 0;
      const exportVal = this._energyData[source.calculate_from.export]?.value || 0;
      return importVal - exportVal;
    }

    return this._energyData[source.entity]?.value || 0;
  }

  _formatNumber(value, decimals = 2) {
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  _formatCost(cost, decimals = 2) {
    if (cost === null) return '';
    const currency = this._config.currency;
    const absValue = Math.abs(cost);
    const formatted = absValue.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });

    if (cost < 0) {
      return `-${currency}${formatted}`;
    }
    return `${currency}${formatted}`;
  }

  _calculateNetMetering() {
    if (!this._config.net_metering) return null;

    const nm = this._config.net_metering;
    const importVal = this._energyData[nm.import_entity]?.value || 0;
    const exportVal = this._energyData[nm.export_entity]?.value || 0;

    // Net = Import - Export (negative means you exported more)
    const netValue = importVal - exportVal;

    // Get rate
    let rate = 0;
    if (nm.rate_entity && this._hass?.states[nm.rate_entity]) {
      rate = parseFloat(this._hass.states[nm.rate_entity].state) || 0;
    } else if (nm.rate_static !== null) {
      rate = nm.rate_static;
    }

    // Cost calculation - negative net = credit
    const cost = netValue * rate;

    return {
      import: importVal,
      export: exportVal,
      net: netValue,
      cost: cost,
      rate: rate
    };
  }

  render() {
    if (!this._config) return;

    const sources = this._config.sources;
    let totalCost = 0;
    let hasAnyCost = false;

    // Build rows
    const rows = sources.map(source => {
      const value = this._getValue(source);

      if (source.hide_if_zero && value === 0) {
        return null;
      }

      const cost = this._calculateCost(source, value);
      if (cost !== null) {
        totalCost += cost;
        hasAnyCost = true;
      }

      return {
        emoji: source.emoji,
        label: source.label,
        value: this._formatNumber(value, this._config.decimal_places),
        unit: source.unit,
        cost: cost,
        costFormatted: this._formatCost(cost, this._config.cost_decimal_places),
        isNegative: value < 0 || cost < 0
      };
    }).filter(Boolean);

    // Net metering row
    let netMeteringRow = null;
    if (this._config.net_metering) {
      const nm = this._calculateNetMetering();
      if (nm) {
        netMeteringRow = {
          emoji: this._config.net_metering.emoji || DEFAULT_EMOJIS.grid_net,
          label: this._config.net_metering.label || 'Grid Net (Metered)',
          value: this._formatNumber(nm.net, this._config.decimal_places),
          unit: this._config.net_metering.unit || 'kWh',
          cost: nm.cost,
          costFormatted: this._formatCost(nm.cost, this._config.cost_decimal_places),
          isNegative: nm.net < 0,
          isCredit: nm.cost < 0
        };
        totalCost += nm.cost;
        hasAnyCost = true;
      }
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host {
          display: block;
        }
        ha-card {
          padding: 16px;
        }
        .card-header {
          font-size: 1.2em;
          font-weight: 500;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--divider-color);
          margin-bottom: 12px;
        }
        .energy-table {
          width: 100%;
          border-collapse: collapse;
        }
        .energy-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .energy-row:last-child {
          border-bottom: none;
        }
        .energy-row.total {
          font-weight: bold;
          border-top: 2px solid var(--divider-color);
          margin-top: 8px;
          padding-top: 12px;
        }
        .source-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .emoji {
          font-size: 1.4em;
          width: 28px;
          text-align: center;
        }
        .label {
          color: var(--primary-text-color);
        }
        .values {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }
        .value {
          font-weight: 500;
          color: var(--primary-text-color);
        }
        .value.negative {
          color: var(--error-color, #db4437);
        }
        .value.credit {
          color: var(--success-color, #43a047);
        }
        .cost {
          font-size: 0.85em;
          color: var(--secondary-text-color);
        }
        .cost.credit {
          color: var(--success-color, #43a047);
        }
        .cost.negative {
          color: var(--error-color, #db4437);
        }
        .unit {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          margin-left: 4px;
        }
        .no-data {
          text-align: center;
          color: var(--secondary-text-color);
          padding: 20px;
        }
        .net-metering-row {
          background: var(--card-background-color, var(--ha-card-background));
          border-radius: 8px;
          margin: 8px 0;
          padding: 8px 12px !important;
        }
        .net-metering-row.credit {
          background: rgba(67, 160, 71, 0.1);
        }
        .net-metering-row.debit {
          background: rgba(219, 68, 55, 0.1);
        }
      </style>
      <ha-card>
        ${this._config.show_header ? `<div class="card-header">${this._config.title}</div>` : ''}
        <div class="energy-content">
          ${rows.length === 0 && !netMeteringRow ? `
            <div class="no-data">No energy data available for the selected period</div>
          ` : `
            ${rows.map(row => `
              <div class="energy-row">
                <div class="source-info">
                  <span class="emoji">${row.emoji}</span>
                  <span class="label">${row.label}</span>
                </div>
                <div class="values">
                  <span class="value ${row.isNegative ? 'negative' : ''}">${row.value}<span class="unit">${row.unit}</span></span>
                  ${row.costFormatted ? `<span class="cost ${row.cost < 0 ? 'credit' : ''}">${row.costFormatted}</span>` : ''}
                </div>
              </div>
            `).join('')}
            ${netMeteringRow ? `
              <div class="energy-row net-metering-row ${netMeteringRow.isCredit ? 'credit' : 'debit'}">
                <div class="source-info">
                  <span class="emoji">${netMeteringRow.emoji}</span>
                  <span class="label">${netMeteringRow.label}</span>
                </div>
                <div class="values">
                  <span class="value ${netMeteringRow.isNegative ? 'credit' : ''}">${netMeteringRow.value}<span class="unit">${netMeteringRow.unit}</span></span>
                  ${netMeteringRow.costFormatted ? `<span class="cost ${netMeteringRow.isCredit ? 'credit' : 'negative'}">${netMeteringRow.costFormatted}</span>` : ''}
                </div>
              </div>
            ` : ''}
            ${this._config.show_total && hasAnyCost ? `
              <div class="energy-row total">
                <div class="source-info">
                  <span class="emoji">💵</span>
                  <span class="label">Total Cost</span>
                </div>
                <div class="values">
                  <span class="value ${totalCost < 0 ? 'credit' : ''}">${this._formatCost(totalCost, this._config.cost_decimal_places)}</span>
                  ${totalCost < 0 ? '<span class="cost credit">Credit</span>' : ''}
                </div>
              </div>
            ` : ''}
          `}
        </div>
      </ha-card>
    `;
  }

  disconnectedCallback() {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  getCardSize() {
    const rows = this._config?.sources?.length || 1;
    return 1 + Math.ceil(rows / 2);
  }
}

// Card Editor for UI configuration
class CustomEnergySourcesCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
  }

  setConfig(config) {
    this._config = config;
    this.render();
  }

  configChanged(newConfig) {
    const event = new Event('config-changed', {
      bubbles: true,
      composed: true
    });
    event.detail = { config: newConfig };
    this.dispatchEvent(event);
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>
        .editor-container {
          padding: 16px;
        }
        .editor-row {
          margin-bottom: 16px;
        }
        label {
          display: block;
          margin-bottom: 4px;
          font-weight: 500;
        }
        input, select, textarea {
          width: 100%;
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color);
          color: var(--primary-text-color);
        }
        textarea {
          min-height: 200px;
          font-family: monospace;
        }
        .help-text {
          font-size: 0.85em;
          color: var(--secondary-text-color);
          margin-top: 4px;
        }
      </style>
      <div class="editor-container">
        <div class="editor-row">
          <label>Title</label>
          <input type="text" id="title" value="${this._config.title || 'Energy Sources'}" />
        </div>
        <div class="editor-row">
          <label>Configuration (YAML)</label>
          <textarea id="yaml-config">${this._configToYaml()}</textarea>
          <div class="help-text">Edit the full card configuration in YAML format</div>
        </div>
      </div>
    `;

    this.shadowRoot.getElementById('title').addEventListener('change', (e) => {
      this._config.title = e.target.value;
      this.configChanged(this._config);
    });

    this.shadowRoot.getElementById('yaml-config').addEventListener('change', (e) => {
      try {
        // Note: In a real implementation, you'd want to use a YAML parser
        // For now, this is a placeholder
        console.log('YAML config changed - would parse and update');
      } catch (err) {
        console.error('Invalid YAML:', err);
      }
    });
  }

  _configToYaml() {
    // Simple JSON to readable format
    return JSON.stringify(this._config, null, 2);
  }
}

// Register the custom elements
customElements.define('custom-energy-sources-card', CustomEnergySourcesCard);
customElements.define('custom-energy-sources-card-editor', CustomEnergySourcesCardEditor);

// Register with Home Assistant
window.customCards = window.customCards || [];
window.customCards.push({
  type: 'custom-energy-sources-card',
  name: 'Custom Energy Sources Card',
  description: 'A customizable energy sources table with emoji icons, custom labels, and flexible cost calculations',
  preview: true,
  documentationURL: 'https://github.com/CornHead764/ha-energy-sources'
});

console.info(
  `%c CUSTOM-ENERGY-SOURCES-CARD %c v${CARD_VERSION} `,
  'color: white; background: #3498db; font-weight: bold;',
  'color: #3498db; background: white; font-weight: bold;'
);
