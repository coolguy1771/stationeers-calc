// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type * as React from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import type { DataQuality, ModelStatus, Severity, TopologyStatus } from '@stationeers/domain';
import { DataQualityBadge } from './DataQualityBadge';
import { IntentStatusChip } from './IntentStatusChip';
import { ModelStatusBadge } from './ModelStatusBadge';
import { ResultStatusSummary } from './ResultStatusSummary';
import { SeverityBadge } from './SeverityBadge';
import { TopologyStatusBadge } from './TopologyStatusBadge';
import { resultVerdict, type IntentTopologyStatus } from './statusConfig';

const MODEL_STATUSES: ModelStatus[] = ['verified', 'unverified', 'unsupported', 'incompatible'];
const TOPOLOGY_STATUSES: TopologyStatus[] = ['buildable', 'conceptual'];
const DATA_QUALITIES: DataQuality[] = [
  'extracted-and-validated',
  'extracted-unverified',
  'inferred',
  'missing',
  'conflicting',
];
const SEVERITIES: Severity[] = ['error', 'warning', 'info'];

afterEach(cleanup);

describe('ModelStatusBadge (spec 5.2)', () => {
  it.each(MODEL_STATUSES)('renders the %s state', (status) => {
    render(<ModelStatusBadge status={status} />);
    const badge = screen.getByText(MODEL_STATUS_LABELS[status]).closest('[data-model-status]');
    expect(badge).toBeInTheDocument();
    // The chip carries its status as data for tests and future automation.
    expect(badge).toHaveAttribute('data-model-status', status);
  });

  it('styles Verified as success and Unverified as experimental — never the same visual treatment', () => {
    const verified = renderClass(<ModelStatusBadge status="verified" />);
    const unverified = renderClass(<ModelStatusBadge status="unverified" />);
    expect(verified).toContain('emerald');
    expect(unverified).toContain('amber');
    // Dashed border = experimental; the two chips must not share a class list.
    expect(unverified).toContain('border-dashed');
    expect(verified).not.toContain('border-dashed');
    expect(unverified).not.toBe(verified);
  });

  it('styles Unsupported as neutral (muted, not red) and Incompatible as red', () => {
    const unsupported = renderClass(<ModelStatusBadge status="unsupported" />);
    const incompatible = renderClass(<ModelStatusBadge status="incompatible" />);
    expect(unsupported).toContain('muted');
    expect(incompatible).toContain('red');
    expect(unsupported).not.toContain('red');
  });
});

describe('TopologyStatusBadge (spec 3.5)', () => {
  it.each(TOPOLOGY_STATUSES)('renders the %s state', (status) => {
    render(<TopologyStatusBadge status={status} />);
    expect(
      screen.getByText(TOPOLOGY_STATUS_LABELS[status]).closest('[data-topology-status]'),
    ).toHaveAttribute('data-topology-status', status);
  });

  it('uses outline styling distinct from the filled model-status language', () => {
    const buildable = renderClass(<TopologyStatusBadge status="buildable" />);
    const modelVerified = renderClass(<ModelStatusBadge status="verified" />);
    expect(buildable).toContain('bg-transparent');
    expect(modelVerified).not.toContain('bg-transparent');
  });

  it('visually separates Buildable from Conceptual (dotted outline = assumed)', () => {
    const buildable = renderClass(<TopologyStatusBadge status="buildable" />);
    const conceptual = renderClass(<TopologyStatusBadge status="conceptual" />);
    expect(conceptual).toContain('border-dotted');
    expect(buildable).not.toContain('border-dotted');
    expect(conceptual).not.toBe(buildable);
  });
});

describe('DataQualityBadge (spec 6.5, 13 #3)', () => {
  it.each(DATA_QUALITIES)('renders the %s level', (quality) => {
    render(<DataQualityBadge quality={quality} />);
    const chip = screen.getByText(DATA_QUALITY_LABELS[quality]).closest('[data-quality]');
    expect(chip).toHaveAttribute('data-quality', quality);
  });

  it('gives every level its own marker class', () => {
    const classes = DATA_QUALITIES.map((quality) => {
      const { container, unmount } = render(<DataQualityBadge quality={quality} />);
      const dot = container.querySelector('span[aria-hidden]');
      const value = dot?.className ?? '';
      unmount();
      return value;
    });
    expect(new Set(classes).size).toBe(DATA_QUALITIES.length);
  });
});

describe('SeverityBadge (spec 8)', () => {
  it.each(SEVERITIES)('renders the %s severity', (severity) => {
    render(<SeverityBadge severity={severity} />);
    const chip = screen.getByText(SEVERITY_LABELS[severity]).closest('[data-severity]');
    expect(chip).toHaveAttribute('data-severity', severity);
  });

  it('distinguishes error from warning from info', () => {
    const classes = SEVERITIES.map((severity) => renderClass(<SeverityBadge severity={severity} />));
    expect(new Set(classes).size).toBe(SEVERITIES.length);
  });
});

describe('IntentStatusChip (spec 3.5, derived)', () => {
  it.each(['unrouted', 'routed', 'conflicting', 'not-buildable'] as const)('renders %s', (status) => {
    render(<IntentStatusChip status={status} />);
    const chip = screen.getByText(INTENT_STATUS_LABELS[status]).closest('[data-intent-status]');
    expect(chip).toHaveAttribute('data-intent-status', status);
  });
});

describe('ResultStatusSummary — the honest-pairing rule (spec 3.5)', () => {
  it('labels Verified + Buildable as the only exact combination', () => {
    const { container, unmount } = render(
      <ResultStatusSummary modelStatus="verified" topologyStatus="buildable" />,
    );
    expect(container.querySelector('[data-exact="true"]')).toBeInTheDocument();
    expect(screen.getByText('Exact')).toBeInTheDocument();
    unmount();
  });

  it('renders Verified + Conceptual as “correct mechanics, assumed topology” — never exact', () => {
    const { container, unmount } = render(
      <ResultStatusSummary modelStatus="verified" topologyStatus="conceptual" />,
    );
    expect(container.querySelector('[data-exact="false"]')).toBeInTheDocument();
    expect(screen.getByText('Correct mechanics — assumed topology')).toBeInTheDocument();
    expect(screen.queryByText('Exact')).not.toBeInTheDocument();
    unmount();
  });

  it('verdicts agree with the config function for every combination', () => {
    for (const model of MODEL_STATUSES) {
      for (const topology of TOPOLOGY_STATUSES) {
        expect(resultVerdict(model, topology).exact).toBe(model === 'verified' && topology === 'buildable');
      }
    }
  });
});

/** Render a component and return the class attribute of its root chip. */
function renderClass(element: React.ReactElement): string {
  const { container, unmount } = render(element);
  const value = container.firstElementChild?.className ?? '';
  unmount();
  return value;
}

const MODEL_STATUS_LABELS: Record<ModelStatus, string> = {
  verified: 'Verified',
  unverified: 'Unverified',
  unsupported: 'Unsupported',
  incompatible: 'Incompatible',
};

const TOPOLOGY_STATUS_LABELS: Record<TopologyStatus, string> = {
  buildable: 'Buildable',
  conceptual: 'Conceptual',
};

const DATA_QUALITY_LABELS: Record<DataQuality, string> = {
  'extracted-and-validated': 'Validated',
  'extracted-unverified': 'Extracted (unverified)',
  inferred: 'Inferred',
  missing: 'Missing',
  conflicting: 'Conflicting',
};

const SEVERITY_LABELS: Record<Severity, string> = {
  error: 'Error',
  warning: 'Warning',
  info: 'Info',
};

const INTENT_STATUS_LABELS: Record<IntentTopologyStatus, string> = {
  unrouted: 'Unrouted',
  routed: 'Routed',
  'routed-with-warnings': 'Routed · warnings',
  conflicting: 'Conflicting',
  'not-buildable': 'Not buildable',
};
