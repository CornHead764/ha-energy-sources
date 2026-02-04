/**
 * Custom Energy Sources Card
 * A HACS-compatible custom Lovelace card for Home Assistant
 * Version 1.3.0
 */

const CARD_VERSION = '1.3.0';

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

const SOURCE_TYPES = [
  { value: 'solar', label: 'Solar' },
  { value: 'battery_in', label: 'Battery Charge' },
  { value: 'battery_out', label: 'Battery Discharge' },
  { value: 'grid_import', label: 'Grid Import' },
  { value: 'grid_export', label: 'Grid Export' },
  { value: 'grid_net', label: 'Grid Net' },
  { value: 'gas', label: 'Gas' },
  { value: 'water', label: 'Water' },
  { value: 'default', label: 'Custom' }
];

const PERIOD_OPTIONS = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'year', label: 'This Year' }
];

// ============================================================================
// MAIN CARD
// ============================================================================

class CustomEnergySourcesCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = null;
    this._hass = null;
    this._energyData = {};
    this._unsubscribe = null;
    this._dateRange = null;
    this._initialized = false;
  }

  static getConfigElement() {
    return document.createElement('custom-energy-sources-card-editor');
  }

  static getStubConfig(hass) {
    const solarEntity = Object.keys(hass?.states || {}).find(e =>
      e.includes('solar') && e.includes('energy')
    );

    return {
      title: 'Energy Sources',
      show_header: true,
      show_total: true,
      currency: '$',
      sources: [
        {
          type: 'solar',
          entity: solarEntity || '',
          label: 'Solar Production',
          emoji: '☀️'
        }
      ]
    };
  }

  setConfig(config) {
    if (!config.sources || !Array.isArray(config.sources) || config.sources.length === 0) {
      throw new Error('Please add at least one energy source');
    }

    this._config = {
      title: config.title || 'Energy Sources',
      show_header: config.show_header !== false,
      show_total: config.show_total !== false,
      currency: config.currency || '$',
      decimal_places: config.decimal_places ?? 2,
      cost_decimal_places: config.cost_decimal_places ?? 2,
      period: config.period || 'today',
      period_entity: config.period_entity || null,
      sources: config.sources.map(source => this._normalizeSource(source)),
      net_metering: config.net_metering || null
    };

    this.render();
  }

  _normalizeSource(source) {
    const type = source.type || 'default';
    return {
      type: type,
      entity: source.entity || '',
      label: source.label || DEFAULT_LABELS[type] || DEFAULT_LABELS.default,
      emoji: source.emoji || DEFAULT_EMOJIS[type] || DEFAULT_EMOJIS.default,
      unit: source.unit || DEFAULT_UNITS[type] || DEFAULT_UNITS.default,
      rate_entity: source.rate_entity || '',
      rate_static: source.rate_static ?? null,
      cost_formula: source.cost_formula || '',
      invert_cost: source.invert_cost || false,
      show_cost: source.show_cost !== false,
      hide_if_zero: source.hide_if_zero || false,
      calculate_from: source.calculate_from || null
    };
  }

  set hass(hass) {
    this._hass = hass;

    if (!this._initialized && hass?.connection) {
      this._initialized = true;
      this._subscribeToEnergyDate();
    }

    this._updateData();
  }

  async _subscribeToEnergyDate() {
    if (!this._hass?.connection) return;

    try {
      this._unsubscribe = await this._hass.connection.subscribeMessage(
        (msg) => {
          console.debug('[Energy Card] Date selection message:', msg);
          // Handle both possible message formats
          this._dateRange = {
            start: msg.start_date || msg.start,
            end: msg.end_date || msg.end
          };
          console.debug('[Energy Card] Using date range:', this._dateRange);
          this._updateData();
        },
        { type: 'energy/subscribe_date_selection' }
      );
      console.debug('[Energy Card] Successfully subscribed to energy date selection');
    } catch (e) {
      console.warn('[Energy Card] Energy date subscription failed, using today:', e.message);
      this._dateRange = this._getDateRangeForPeriod(this._getConfiguredPeriod());
      this._updateData();
    }
  }

  _getDateRangeForPeriod(period) {
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    let start, end;

    switch (period) {
      case 'yesterday':
        start = new Date(today);
        start.setDate(start.getDate() - 1);
        end = new Date(today);
        break;
      case 'week':
        start = new Date(today);
        start.setDate(start.getDate() - start.getDay()); // Start of week (Sunday)
        end = now;
        break;
      case 'month':
        start = new Date(today.getFullYear(), today.getMonth(), 1);
        end = now;
        break;
      case 'year':
        start = new Date(today.getFullYear(), 0, 1);
        end = now;
        break;
      case 'today':
      default:
        start = today;
        end = now;
        break;
    }

    return {
      start: start.toISOString(),
      end: end.toISOString()
    };
  }

  _getConfiguredPeriod() {
    // Check if period_entity is set and has a valid value
    if (this._config?.period_entity && this._hass?.states?.[this._config.period_entity]) {
      const entityState = this._hass.states[this._config.period_entity].state;
      // Map common values to our period options
      const stateMap = {
        'today': 'today',
        'yesterday': 'yesterday',
        'week': 'week',
        'this_week': 'week',
        'month': 'month',
        'this_month': 'month',
        'year': 'year',
        'this_year': 'year'
      };
      if (stateMap[entityState.toLowerCase()]) {
        return stateMap[entityState.toLowerCase()];
      }
    }
    return this._config?.period || 'today';
  }

  async _updateData() {
    if (!this._hass || !this._config) return;

    // Use energy dashboard date range if available, otherwise use configured period
    const dateRange = this._dateRange || this._getDateRangeForPeriod(this._getConfiguredPeriod());
    const startTime = new Date(dateRange.start);
    const endTime = dateRange.end ? new Date(dateRange.end) : new Date();

    const entityIds = [];

    this._config.sources.forEach(source => {
      if (source.entity) entityIds.push(source.entity);
      if (source.calculate_from?.import) entityIds.push(source.calculate_from.import);
      if (source.calculate_from?.export) entityIds.push(source.calculate_from.export);
    });

    if (this._config.net_metering) {
      if (this._config.net_metering.import_entity) entityIds.push(this._config.net_metering.import_entity);
      if (this._config.net_metering.export_entity) entityIds.push(this._config.net_metering.export_entity);
    }

    const uniqueEntityIds = [...new Set(entityIds.filter(Boolean))];

    if (uniqueEntityIds.length === 0) {
      this._energyData = {};
      this.render();
      return;
    }

    try {
      const statistics = await this._fetchStatistics(uniqueEntityIds, startTime, endTime);
      this._energyData = this._processStatistics(statistics);
      this.render();
    } catch (e) {
      console.error('Error fetching energy statistics:', e);
      this._energyData = {};
      this.render();
    }
  }

  async _fetchStatistics(entityIds, startTime, endTime) {
    if (!this._hass?.callWS) return {};

    try {
      return await this._hass.callWS({
        type: 'recorder/statistics_during_period',
        start_time: startTime.toISOString(),
        end_time: endTime.toISOString(),
        statistic_ids: entityIds,
        period: 'hour',
        types: ['sum', 'change']
      });
    } catch (e) {
      console.error('Statistics fetch failed:', e);
      return {};
    }
  }

  _processStatistics(statistics) {
    const data = {};

    for (const [entityId, stats] of Object.entries(statistics || {})) {
      if (!stats || !Array.isArray(stats) || stats.length === 0) {
        data[entityId] = { value: 0 };
        continue;
      }

      let totalValue = 0;
      const firstStat = stats[0];
      const lastStat = stats[stats.length - 1];

      if (typeof firstStat.sum === 'number' && typeof lastStat.sum === 'number') {
        totalValue = lastStat.sum - firstStat.sum;
      } else if (typeof firstStat.change === 'number') {
        totalValue = stats.reduce((acc, stat) => acc + (stat.change || 0), 0);
      }

      data[entityId] = { value: totalValue };
    }

    return data;
  }

  _getValue(source) {
    if (source.calculate_from) {
      const importVal = this._energyData[source.calculate_from.import]?.value || 0;
      const exportVal = this._energyData[source.calculate_from.export]?.value || 0;
      return importVal - exportVal;
    }
    return this._energyData[source.entity]?.value || 0;
  }

  _calculateCost(source, value) {
    if (!source.show_cost) return null;

    let rate = null;
    let rateSource = 'none';

    // Try to get rate from entity first
    if (source.rate_entity) {
      const entityState = this._hass?.states?.[source.rate_entity];
      if (entityState) {
        const parsedRate = parseFloat(entityState.state);
        if (!isNaN(parsedRate)) {
          rate = parsedRate;
          rateSource = 'entity';
        } else {
          console.debug(`[Energy Card] Rate entity "${source.rate_entity}" has non-numeric state: "${entityState.state}"`);
        }
      } else {
        console.debug(`[Energy Card] Rate entity "${source.rate_entity}" not found in Home Assistant states`);
      }
    }

    // Fall back to static rate
    if (rate === null && typeof source.rate_static === 'number') {
      rate = source.rate_static;
      rateSource = 'static';
    }

    // If still no rate, default to 0 but log it
    if (rate === null) {
      if (source.rate_entity || source.rate_static !== null) {
        console.debug(`[Energy Card] No valid rate found for "${source.label}", using 0`);
      }
      rate = 0;
    }

    if (source.cost_formula) {
      try {
        const formula = source.cost_formula
          .replace(/\bvalue\b/g, String(value))
          .replace(/\brate\b/g, String(rate));
        const result = new Function('return ' + formula)();
        return source.invert_cost ? -result : result;
      } catch (e) {
        console.error(`[Energy Card] Cost formula error for "${source.label}":`, e);
        return null;
      }
    }

    const cost = value * rate;
    return source.invert_cost ? -cost : cost;
  }

  _formatNumber(value, decimals = 2) {
    if (typeof value !== 'number' || isNaN(value)) return '0.00';
    return value.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
  }

  _formatCost(cost, decimals = 2) {
    if (cost === null) return '';
    if (typeof cost !== 'number' || isNaN(cost)) {
      console.debug('[Energy Card] Invalid cost value:', cost);
      return '';
    }
    const currency = this._config?.currency || '$';
    const absValue = Math.abs(cost);
    const formatted = absValue.toLocaleString(undefined, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals
    });
    return cost < 0 ? `-${currency}${formatted}` : `${currency}${formatted}`;
  }

  render() {
    if (!this._config) {
      this.shadowRoot.innerHTML = '<ha-card><div style="padding:16px">Loading...</div></ha-card>';
      return;
    }

    const sources = this._config.sources || [];
    let totalCost = 0;
    let hasAnyCost = false;

    const rows = sources.map(source => {
      const value = this._getValue(source);
      if (source.hide_if_zero && value === 0) return null;

      const cost = this._calculateCost(source, value);
      if (cost !== null && !isNaN(cost)) {
        totalCost += cost;
        hasAnyCost = true;
      }

      // Check if rate entity is configured but not working
      let rateWarning = null;
      if (source.show_cost && source.rate_entity) {
        const entityState = this._hass?.states?.[source.rate_entity];
        if (!entityState) {
          rateWarning = 'Entity not found';
        } else if (isNaN(parseFloat(entityState.state))) {
          rateWarning = `Invalid: ${entityState.state}`;
        }
      }

      return {
        emoji: source.emoji || '📊',
        label: source.label || 'Energy',
        value: this._formatNumber(value, this._config.decimal_places),
        unit: source.unit || 'kWh',
        cost: cost,
        costFormatted: this._formatCost(cost, this._config.cost_decimal_places),
        rateWarning: rateWarning,
        isNegative: value < 0,
        isCostCredit: cost !== null && cost < 0
      };
    }).filter(Boolean);

    let netMeteringRow = null;
    if (this._config.net_metering) {
      const nm = this._config.net_metering;
      const importVal = this._energyData[nm.import_entity]?.value || 0;
      const exportVal = this._energyData[nm.export_entity]?.value || 0;
      const netValue = importVal - exportVal;

      let rate = 0;
      if (nm.rate_entity && this._hass?.states?.[nm.rate_entity]) {
        rate = parseFloat(this._hass.states[nm.rate_entity].state) || 0;
      } else if (typeof nm.rate_static === 'number') {
        rate = nm.rate_static;
      }

      const cost = netValue * rate;
      totalCost += cost;
      hasAnyCost = true;

      netMeteringRow = {
        emoji: nm.emoji || '⚡',
        label: nm.label || 'Grid Net (Metered)',
        value: this._formatNumber(netValue, this._config.decimal_places),
        unit: nm.unit || 'kWh',
        cost: cost,
        costFormatted: this._formatCost(cost, this._config.cost_decimal_places),
        isNegative: netValue < 0,
        isCredit: cost < 0
      };
    }

    this.shadowRoot.innerHTML = `
      <style>
        :host { display: block; }
        ha-card { padding: 16px; }
        .card-header {
          font-size: 1.2em;
          font-weight: 500;
          padding-bottom: 12px;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-bottom: 12px;
        }
        .energy-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 8px 0;
          border-bottom: 1px solid var(--divider-color, rgba(0,0,0,0.12));
        }
        .energy-row:last-child { border-bottom: none; }
        .energy-row.total {
          font-weight: bold;
          border-top: 2px solid var(--divider-color, rgba(0,0,0,0.12));
          margin-top: 8px;
          padding-top: 12px;
        }
        .source-info {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .emoji { font-size: 1.4em; width: 28px; text-align: center; }
        .label { color: var(--primary-text-color); }
        .values {
          display: flex;
          flex-direction: column;
          align-items: flex-end;
          text-align: right;
        }
        .value { font-weight: 500; color: var(--primary-text-color); }
        .value.negative { color: var(--error-color, #db4437); }
        .value.credit { color: var(--success-color, #43a047); }
        .cost { font-size: 0.85em; color: var(--secondary-text-color); }
        .cost.credit { color: var(--success-color, #43a047); }
        .cost.warning { color: var(--warning-color, #ff9800); font-size: 0.75em; }
        .unit { font-size: 0.85em; color: var(--secondary-text-color); margin-left: 4px; }
        .no-data { text-align: center; color: var(--secondary-text-color); padding: 20px; }
        .net-metering-row {
          background: var(--secondary-background-color, rgba(0,0,0,0.05));
          border-radius: 8px;
          margin: 8px 0;
          padding: 8px 12px !important;
        }
        .net-metering-row.credit { background: rgba(67, 160, 71, 0.1); }
        .net-metering-row.debit { background: rgba(219, 68, 55, 0.1); }
      </style>
      <ha-card>
        ${this._config.show_header ? `<div class="card-header">${this._config.title || 'Energy Sources'}</div>` : ''}
        <div class="energy-content">
          ${rows.length === 0 && !netMeteringRow ? `
            <div class="no-data">No energy data available</div>
          ` : `
            ${rows.map(row => `
              <div class="energy-row">
                <div class="source-info">
                  <span class="emoji">${row.emoji}</span>
                  <span class="label">${row.label}</span>
                </div>
                <div class="values">
                  <span class="value ${row.isNegative ? 'negative' : ''}">${row.value}<span class="unit">${row.unit}</span></span>
                  ${row.rateWarning ? `<span class="cost warning" title="${row.rateWarning}">⚠️ ${row.rateWarning}</span>` :
                    (row.costFormatted ? `<span class="cost ${row.isCostCredit ? 'credit' : ''}">${row.costFormatted}</span>` : '')}
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
                  ${netMeteringRow.costFormatted ? `<span class="cost ${netMeteringRow.isCredit ? 'credit' : ''}">${netMeteringRow.costFormatted}</span>` : ''}
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
    return 1 + (this._config?.sources?.length || 1);
  }
}

// ============================================================================
// VISUAL CONFIG EDITOR
// ============================================================================

class CustomEnergySourcesCardEditor extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: 'open' });
    this._config = {};
    this._hass = null;
  }

  set hass(hass) {
    this._hass = hass;
    if (this._rendered) {
      this._updateEntityPickers();
    }
  }

  setConfig(config) {
    this._config = {
      type: config.type,  // Preserve the card type for config-changed events
      title: config.title || 'Energy Sources',
      show_header: config.show_header !== false,
      show_total: config.show_total !== false,
      currency: config.currency || '$',
      decimal_places: config.decimal_places ?? 2,
      period: config.period || 'today',
      sources: config.sources || []
    };
    this.render();
  }

  _fireConfigChanged() {
    // Create a clean config without internal properties
    const cleanConfig = {
      ...this._config,
      sources: (this._config.sources || []).map(source => {
        const clean = { ...source };
        // Remove internal tracking properties
        delete clean._labelCustomized;
        delete clean._emojiCustomized;
        return clean;
      })
    };

    const event = new CustomEvent('config-changed', {
      detail: { config: cleanConfig },
      bubbles: true,
      composed: true
    });
    this.dispatchEvent(event);
  }

  _updateEntityPickers() {
    if (!this._hass) return;
    const sources = this._config.sources || [];

    // Update all entity pickers with hass and their values
    this.shadowRoot.querySelectorAll('.source-entity').forEach(picker => {
      picker.hass = this._hass;
      const index = parseInt(picker.dataset.index);
      if (sources[index]) {
        picker.value = sources[index].entity || '';
      }
    });

    this.shadowRoot.querySelectorAll('.source-rate-entity').forEach(picker => {
      picker.hass = this._hass;
      const index = parseInt(picker.dataset.index);
      if (sources[index]) {
        picker.value = sources[index].rate_entity || '';
      }
    });
  }

  render() {
    const sources = this._config.sources || [];

    this.shadowRoot.innerHTML = `
      <style>
        .editor { padding: 8px 0; }
        .section { margin-bottom: 24px; }
        .section-title {
          font-weight: 500;
          font-size: 14px;
          margin-bottom: 12px;
          color: var(--primary-text-color);
          border-bottom: 1px solid var(--divider-color);
          padding-bottom: 8px;
        }
        .row {
          display: flex;
          gap: 12px;
          margin-bottom: 12px;
          align-items: flex-end;
        }
        .row > * { flex: 1; }
        .field {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .field label {
          font-size: 12px;
          color: var(--secondary-text-color);
        }
        .field input, .field select {
          padding: 8px;
          border: 1px solid var(--divider-color);
          border-radius: 4px;
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color);
          font-size: 14px;
        }
        .field input:focus, .field select:focus {
          outline: none;
          border-color: var(--primary-color);
        }
        .switch-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          padding: 8px 0;
        }
        .switch-row label { font-size: 14px; }
        .source-card {
          background: var(--secondary-background-color, rgba(0,0,0,0.05));
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 12px;
        }
        .source-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }
        .source-title {
          font-weight: 500;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        .remove-btn {
          background: var(--error-color, #db4437);
          color: white;
          border: none;
          border-radius: 4px;
          padding: 4px 12px;
          cursor: pointer;
          font-size: 12px;
        }
        .remove-btn:hover { opacity: 0.8; }
        .add-btn {
          background: var(--primary-color);
          color: white;
          border: none;
          border-radius: 4px;
          padding: 10px 20px;
          cursor: pointer;
          font-size: 14px;
          width: 100%;
          margin-top: 8px;
        }
        .add-btn:hover { opacity: 0.9; }
        ha-entity-picker { display: block; width: 100%; }
        .emoji-input {
          width: 60px !important;
          flex: 0 0 60px !important;
          text-align: center;
          font-size: 18px;
        }
        .checkbox-row {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
        }
        .checkbox-row input[type="checkbox"] { width: 18px; height: 18px; }
        .checkbox-row label { font-size: 13px; color: var(--secondary-text-color); }
      </style>

      <div class="editor">
        <div class="section">
          <div class="section-title">General Settings</div>
          <div class="field" style="margin-bottom: 12px;">
            <label>Card Title</label>
            <input type="text" id="title" value="${this._config.title || ''}" placeholder="Energy Sources">
          </div>
          <div class="row">
            <div class="field">
              <label>Currency Symbol</label>
              <input type="text" id="currency" value="${this._config.currency || '$'}" style="width: 60px;">
            </div>
            <div class="field">
              <label>Decimal Places</label>
              <input type="number" id="decimal_places" value="${this._config.decimal_places ?? 2}" min="0" max="4" style="width: 60px;">
            </div>
            <div class="field">
              <label>Time Period</label>
              <select id="period">
                ${PERIOD_OPTIONS.map(p => `<option value="${p.value}" ${this._config.period === p.value ? 'selected' : ''}>${p.label}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="switch-row">
            <label>Show Header</label>
            <input type="checkbox" id="show_header" ${this._config.show_header !== false ? 'checked' : ''}>
          </div>
          <div class="switch-row">
            <label>Show Total Cost</label>
            <input type="checkbox" id="show_total" ${this._config.show_total !== false ? 'checked' : ''}>
          </div>
        </div>

        <div class="section">
          <div class="section-title">Energy Sources</div>
          <div id="sources-container">
            ${sources.map((source, index) => this._renderSourceCard(source, index)).join('')}
          </div>
          <button class="add-btn" id="add-source">+ Add Energy Source</button>
        </div>
      </div>
    `;

    this._rendered = true;
    this._attachEventListeners();
    // Delay entity picker update to ensure elements are in DOM
    requestAnimationFrame(() => {
      this._updateEntityPickers();
    });
  }

  _renderSourceCard(source, index) {
    const type = source.type || 'default';
    const emoji = source.emoji || DEFAULT_EMOJIS[type] || '📊';
    const label = source.label || DEFAULT_LABELS[type] || 'Energy';

    return `
      <div class="source-card" data-index="${index}">
        <div class="source-header">
          <div class="source-title">
            <span>${emoji}</span>
            <span>${label}</span>
          </div>
          <button class="remove-btn" data-index="${index}">Remove</button>
        </div>

        <div class="row">
          <div class="field">
            <label>Type</label>
            <select class="source-type" data-index="${index}">
              ${SOURCE_TYPES.map(t => `<option value="${t.value}" ${type === t.value ? 'selected' : ''}>${t.label}</option>`).join('')}
            </select>
          </div>
          <div class="field emoji-input">
            <label>Icon</label>
            <input type="text" class="source-emoji" data-index="${index}" value="${emoji}" maxlength="2">
          </div>
        </div>

        <div class="field" style="margin-bottom: 12px;">
          <label>Label</label>
          <input type="text" class="source-label" data-index="${index}" value="${label}" placeholder="Source name">
        </div>

        <div class="field" style="margin-bottom: 12px;">
          <label>Energy Entity (sensor with kWh, m³, etc.)</label>
          <ha-entity-picker
            class="source-entity"
            data-index="${index}"
            allow-custom-entity
          ></ha-entity-picker>
        </div>

        <div class="field" style="margin-bottom: 12px;">
          <label>Unit</label>
          <input type="text" class="source-unit" data-index="${index}" value="${source.unit || DEFAULT_UNITS[type] || 'kWh'}" placeholder="kWh">
        </div>

        <div class="row">
          <div class="field">
            <label>Rate Entity ($/unit)</label>
            <ha-entity-picker
              class="source-rate-entity"
              data-index="${index}"
              allow-custom-entity
            ></ha-entity-picker>
          </div>
          <div class="field" style="flex: 0 0 80px;">
            <label>Or Static Rate</label>
            <input type="number" class="source-rate-static" data-index="${index}" value="${source.rate_static ?? ''}" step="0.01" placeholder="0.12">
          </div>
        </div>

        <div class="checkbox-row">
          <input type="checkbox" class="source-show-cost" data-index="${index}" ${source.show_cost !== false ? 'checked' : ''}>
          <label>Show cost</label>
        </div>

        <div class="checkbox-row">
          <input type="checkbox" class="source-invert-cost" data-index="${index}" ${source.invert_cost ? 'checked' : ''}>
          <label>Invert cost (for exports/credits)</label>
        </div>

        <div class="checkbox-row">
          <input type="checkbox" class="source-hide-zero" data-index="${index}" ${source.hide_if_zero ? 'checked' : ''}>
          <label>Hide when zero</label>
        </div>
      </div>
    `;
  }

  _attachEventListeners() {
    this.shadowRoot.getElementById('title').addEventListener('input', (e) => {
      this._config.title = e.target.value;
      this._fireConfigChanged();
    });

    this.shadowRoot.getElementById('currency').addEventListener('input', (e) => {
      this._config.currency = e.target.value;
      this._fireConfigChanged();
    });

    this.shadowRoot.getElementById('decimal_places').addEventListener('input', (e) => {
      this._config.decimal_places = parseInt(e.target.value) || 2;
      this._fireConfigChanged();
    });

    this.shadowRoot.getElementById('period').addEventListener('change', (e) => {
      this._config.period = e.target.value;
      this._fireConfigChanged();
    });

    this.shadowRoot.getElementById('show_header').addEventListener('change', (e) => {
      this._config.show_header = e.target.checked;
      this._fireConfigChanged();
    });

    this.shadowRoot.getElementById('show_total').addEventListener('change', (e) => {
      this._config.show_total = e.target.checked;
      this._fireConfigChanged();
    });

    this.shadowRoot.getElementById('add-source').addEventListener('click', () => {
      this._config.sources = this._config.sources || [];
      this._config.sources.push({
        type: 'default',
        entity: '',
        label: 'New Source',
        emoji: '📊',
        unit: 'kWh',
        show_cost: true
      });
      this._fireConfigChanged();
      this.render();
    });

    this.shadowRoot.querySelectorAll('.remove-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources.splice(index, 1);
        this._fireConfigChanged();
        this.render();
      });
    });

    this.shadowRoot.querySelectorAll('.source-type').forEach(select => {
      select.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        const type = e.target.value;
        this._config.sources[index].type = type;
        if (!this._config.sources[index]._labelCustomized) {
          this._config.sources[index].label = DEFAULT_LABELS[type] || 'Energy';
        }
        if (!this._config.sources[index]._emojiCustomized) {
          this._config.sources[index].emoji = DEFAULT_EMOJIS[type] || '📊';
        }
        this._config.sources[index].unit = DEFAULT_UNITS[type] || 'kWh';
        this._fireConfigChanged();
        this.render();
      });
    });

    this.shadowRoot.querySelectorAll('.source-emoji').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources[index].emoji = e.target.value;
        this._config.sources[index]._emojiCustomized = true;
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-label').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources[index].label = e.target.value;
        this._config.sources[index]._labelCustomized = true;
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-entity').forEach(picker => {
      picker.addEventListener('value-changed', (e) => {
        const index = parseInt(picker.dataset.index);
        this._config.sources[index].entity = e.detail.value || '';
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-unit').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources[index].unit = e.target.value;
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-rate-entity').forEach(picker => {
      picker.addEventListener('value-changed', (e) => {
        const index = parseInt(picker.dataset.index);
        this._config.sources[index].rate_entity = e.detail.value || '';
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-rate-static').forEach(input => {
      input.addEventListener('input', (e) => {
        const index = parseInt(e.target.dataset.index);
        const val = e.target.value;
        this._config.sources[index].rate_static = val ? parseFloat(val) : null;
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-show-cost').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources[index].show_cost = e.target.checked;
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-invert-cost').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources[index].invert_cost = e.target.checked;
        this._fireConfigChanged();
      });
    });

    this.shadowRoot.querySelectorAll('.source-hide-zero').forEach(input => {
      input.addEventListener('change', (e) => {
        const index = parseInt(e.target.dataset.index);
        this._config.sources[index].hide_if_zero = e.target.checked;
        this._fireConfigChanged();
      });
    });
  }
}

// ============================================================================
// REGISTER COMPONENTS
// ============================================================================

customElements.define('custom-energy-sources-card', CustomEnergySourcesCard);
customElements.define('custom-energy-sources-card-editor', CustomEnergySourcesCardEditor);

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
  'color: white; background: #039be5; font-weight: bold;',
  'color: #039be5; background: white; font-weight: bold;'
);
