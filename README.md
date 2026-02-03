# Custom Energy Sources Card

[![hacs_badge](https://img.shields.io/badge/HACS-Custom-orange.svg)](https://github.com/hacs/integration)

A customizable energy sources table card for Home Assistant with emoji icons, custom labels, and flexible cost calculations. Integrates seamlessly with the Energy Dashboard date selector.

## Features

- **Energy Dashboard Integration**: Automatically syncs with Home Assistant's energy dashboard date selector
- **Custom Energy Sources**: Configure any combination of solar, battery, grid, gas, water, or custom sources
- **Flexible Cost Calculations**: Use entity-based rates (e.g., real-time electricity prices) or static rates
- **Net Metering Support**: Track grid import/export with costs that can go negative for export credits
- **Emoji Icons**: Replace boring color boxes with customizable emojis
- **Custom Labels**: Name your sources however you want
- **Custom Formulas**: Advanced cost calculation formulas for complex scenarios

## Installation

### HACS (Recommended)

1. Open HACS in your Home Assistant instance
2. Click the three dots in the top right corner
3. Select "Custom repositories"
4. Add this repository URL: `https://github.com/CornHead764/ha-energy-sources`
5. Select "Lovelace" as the category
6. Click "Add"
7. Find "Custom Energy Sources Card" in the list and click "Download"
8. Restart Home Assistant

### Manual Installation

1. Download `custom-energy-sources-card.js` from the `dist` folder
2. Copy it to your `config/www` folder
3. Add the resource in your Lovelace configuration:

```yaml
resources:
  - url: /local/custom-energy-sources-card.js
    type: module
```

## Configuration

### Basic Example

```yaml
type: custom:custom-energy-sources-card
title: My Energy
sources:
  - type: solar
    entity: sensor.solar_energy_production
    rate_entity: sensor.electricity_rate
```

### Full Solar + Battery + Grid + Net Metering Example

This example shows a complete setup for tracking solar production, battery usage, grid import/export, and net metering:

```yaml
type: custom:custom-energy-sources-card
title: Energy Overview
currency: "$"
decimal_places: 2
cost_decimal_places: 2
show_header: true
show_total: true

sources:
  # Solar Production
  - type: solar
    entity: sensor.solar_energy_production_today
    label: "Solar Generated"
    emoji: "☀️"
    unit: "kWh"
    rate_entity: sensor.electricity_rate_per_kwh
    show_cost: true

  # Battery Charged (from solar)
  - type: battery_in
    entity: sensor.battery_energy_charged
    label: "Battery Charged"
    emoji: "🔋"
    unit: "kWh"
    show_cost: false

  # Battery Discharged (used in home)
  - type: battery_out
    entity: sensor.battery_energy_discharged
    label: "Battery Used"
    emoji: "🪫"
    unit: "kWh"
    rate_entity: sensor.electricity_rate_per_kwh
    show_cost: true

  # Grid Import
  - type: grid_import
    entity: sensor.grid_energy_import
    label: "Grid Import"
    emoji: "🏭"
    unit: "kWh"
    rate_entity: sensor.electricity_rate_per_kwh
    show_cost: true

  # Grid Export (sold back)
  - type: grid_export
    entity: sensor.grid_energy_export
    label: "Grid Export"
    emoji: "💰"
    unit: "kWh"
    rate_entity: sensor.electricity_rate_per_kwh
    invert_cost: true  # Makes cost negative (credit)
    show_cost: true

# Net Metering - shows the net grid usage (import - export)
# Negative value = you exported more than imported (credit!)
net_metering:
  import_entity: sensor.grid_energy_import
  export_entity: sensor.grid_energy_export
  rate_entity: sensor.electricity_rate_per_kwh
  label: "Grid Net (Metered)"
  emoji: "⚡"
  unit: "kWh"
```

### Adding Gas and Water

```yaml
type: custom:custom-energy-sources-card
title: Utility Usage
sources:
  # ... your energy sources ...

  # Gas Usage
  - type: gas
    entity: sensor.gas_consumption_today
    label: "Natural Gas"
    emoji: "🔥"
    unit: "m³"
    rate_static: 0.85  # Static rate per m³
    show_cost: true

  # Water Usage
  - type: water
    entity: sensor.water_consumption_today
    label: "Water"
    emoji: "💧"
    unit: "gal"
    rate_static: 0.005  # Static rate per gallon
    show_cost: true
```

### Calculated Sources (Grid Net without separate entity)

If you don't have a dedicated net grid sensor, you can calculate it:

```yaml
sources:
  - type: grid_net
    label: "Grid Net"
    emoji: "⚡"
    unit: "kWh"
    calculate_from:
      import: sensor.grid_energy_import
      export: sensor.grid_energy_export
    rate_entity: sensor.electricity_rate_per_kwh
    show_cost: true
```

### Custom Cost Formulas

For complex pricing scenarios (tiered rates, demand charges, etc.):

```yaml
sources:
  - type: grid_import
    entity: sensor.grid_energy_import
    label: "Grid Import"
    emoji: "🏭"
    unit: "kWh"
    # Formula can use 'value' (energy) and 'rate' (from rate_entity)
    cost_formula: "value * rate * 1.1"  # Add 10% for taxes/fees
    rate_entity: sensor.electricity_rate_per_kwh
    show_cost: true
```

## Configuration Options

### Card Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `title` | string | "Energy Sources" | Card title |
| `show_header` | boolean | true | Show the card header |
| `show_total` | boolean | true | Show total cost row |
| `currency` | string | "$" | Currency symbol |
| `decimal_places` | number | 2 | Decimal places for energy values |
| `cost_decimal_places` | number | 2 | Decimal places for cost values |
| `sources` | array | required | List of energy sources |
| `net_metering` | object | null | Net metering configuration |

### Source Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `type` | string | "default" | Source type (solar, battery_in, battery_out, grid_import, grid_export, grid_net, gas, water) |
| `entity` | string | required* | Entity ID for the energy sensor |
| `label` | string | auto | Custom label for display |
| `emoji` | string | auto | Emoji icon (based on type if not specified) |
| `unit` | string | auto | Unit of measurement |
| `rate_entity` | string | null | Entity ID for dynamic rate ($/kWh) |
| `rate_static` | number | null | Static rate value |
| `cost_formula` | string | null | Custom formula using `value` and `rate` |
| `invert_cost` | boolean | false | Make cost negative (for exports/credits) |
| `show_cost` | boolean | true | Show cost column |
| `hide_if_zero` | boolean | false | Hide row if value is zero |
| `calculate_from` | object | null | Calculate from import/export entities |

*Required unless using `calculate_from`

### Net Metering Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `import_entity` | string | required | Grid import entity |
| `export_entity` | string | required | Grid export entity |
| `rate_entity` | string | null | Dynamic rate entity |
| `rate_static` | number | null | Static rate |
| `label` | string | "Grid Net (Metered)" | Display label |
| `emoji` | string | "⚡" | Display emoji |
| `unit` | string | "kWh" | Unit of measurement |

## Default Emojis by Type

| Type | Emoji |
|------|-------|
| solar | ☀️ |
| battery_in | 🔋 |
| battery_out | 🪫 |
| grid_import | 🏭 |
| grid_export | 💰 |
| grid_net | ⚡ |
| gas | 🔥 |
| water | 💧 |
| default | 📊 |

## How It Works

### Energy Dashboard Integration

The card subscribes to Home Assistant's `energy/subscribe_date_selection` WebSocket API. When you change the date range in the Energy Dashboard, the card automatically updates to show data for that period.

### Statistics Fetching

Energy data is fetched using the `recorder/statistics_during_period` WebSocket API, which retrieves hourly statistics for the selected time range. The card calculates the total energy used by computing the difference between the start and end values.

### Cost Calculation

1. **Rate Source**: Gets the rate from either `rate_entity` (current state) or `rate_static`
2. **Calculation**: Multiplies energy value by rate
3. **Inversion**: If `invert_cost` is true, the result is negated (for export credits)
4. **Custom Formula**: If `cost_formula` is provided, it's evaluated with `value` and `rate` variables

## Tips

1. **Entity Selection**: Use energy sensors that track cumulative totals, not instantaneous power readings
2. **Rate Entities**: If your utility provides time-of-use rates, create a template sensor that reflects the current rate
3. **Net Metering**: The net metering feature shows import minus export - negative means you're a net exporter!
4. **Hide Zero Values**: Use `hide_if_zero: true` to hide sources with no activity for cleaner displays

## Troubleshooting

### Card shows "No energy data available"

- Ensure your entities are recording statistics (check Developer Tools > Statistics)
- Verify the entity IDs are correct
- Make sure you're on the Energy Dashboard or have selected a valid date range

### Cost calculations are wrong

- Check that your rate entity is providing the correct units ($/kWh, not ¢/kWh)
- Verify the entity state is a number, not "unavailable" or "unknown"

### Card doesn't update with date selector

- The card must be placed on the Energy Dashboard or a view that includes the energy date selector
- Try refreshing the page

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.
