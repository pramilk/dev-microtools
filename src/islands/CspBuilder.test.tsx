import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import CspBuilder from './CspBuilder';

const outputText = () => document.querySelector<HTMLElement>('.output')?.textContent ?? '';

describe('<CspBuilder />', () => {
  it('starts empty in build mode with a placeholder and no error', () => {
    render(<CspBuilder />);

    expect(document.querySelector('.output--empty')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('filling default-src produces a header', () => {
    render(<CspBuilder />);

    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });

    expect(outputText()).toContain("Content-Security-Policy: default-src 'self';");
    expect(document.querySelector('.output--empty')).toBeNull();
  });

  it('toggles report-only mode into the header name', () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });

    fireEvent.click(screen.getByRole('button', { name: 'Report-only' }));

    expect(outputText()).toContain('Content-Security-Policy-Report-Only:');
  });

  it('adds upgrade-insecure-requests when checked', () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });

    fireEvent.click(screen.getByLabelText('upgrade-insecure-requests'));

    expect(outputText()).toContain('upgrade-insecure-requests');
  });

  it('shows a visible error for a malformed report-uri', () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });
    fireEvent.input(screen.getByLabelText('Report collector URL'), { target: { value: 'not a url' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/not a valid report-uri URL/i);
  });

  it('generates Reporting-Endpoints and Report-To headers once a report URL is set', () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });
    fireEvent.input(screen.getByLabelText('Report collector URL'), {
      target: { value: 'https://example.com/csp-reports' },
    });
    fireEvent.input(screen.getByLabelText('Reporting group name'), { target: { value: 'csp-endpoint' } });

    expect(screen.getByText(/Reporting-Endpoints: csp-endpoint="https:\/\/example\.com\/csp-reports"/)).toBeInTheDocument();
    expect(screen.getByText(/Report-To: /)).toBeInTheDocument();
  });

  it("warns when script-src allows 'unsafe-inline'", () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('script-src'), { target: { value: "'self' 'unsafe-inline'" } });

    expect(screen.getByText(/allows 'unsafe-inline'/)).toBeInTheDocument();
  });

  it('shows a clean result when the checklist finds nothing', () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });
    fireEvent.input(screen.getByLabelText('script-src'), { target: { value: "'self'" } });
    fireEvent.input(screen.getByLabelText('object-src'), { target: { value: "'none'" } });
    fireEvent.input(screen.getByLabelText('base-uri'), { target: { value: "'self'" } });
    fireEvent.input(screen.getByLabelText('frame-ancestors'), { target: { value: "'none'" } });
    fireEvent.input(screen.getByLabelText('form-action'), { target: { value: "'self'" } });
    fireEvent.input(screen.getByLabelText('Report collector URL'), {
      target: { value: 'https://example.com/csp-reports' },
    });

    expect(screen.getByText(/No issues found by this checklist/)).toBeInTheDocument();
  });

  it('loads a worked example with output and a reporting section', () => {
    render(<CspBuilder />);

    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));

    expect((screen.getByLabelText('default-src') as HTMLInputElement).value).not.toBe('');
    expect(outputText()).toContain('Content-Security-Policy:');
    expect(screen.getByText(/Reporting-Endpoints:/)).toBeInTheDocument();
  });

  it('clear resets every field back to empty', () => {
    render(<CspBuilder />);
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    expect((screen.getByLabelText('default-src') as HTMLInputElement).value).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect((screen.getByLabelText('default-src') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('.output--empty')).not.toBeNull();
  });

  it('offers copy, download and share-link controls once there is output', () => {
    render(<CspBuilder />);
    fireEvent.input(screen.getByLabelText('default-src'), { target: { value: "'self'" } });

    expect(screen.getAllByRole('button', { name: 'Copy' })[0]).toBeEnabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('switches to analyze mode and parses a pasted header', () => {
    render(<CspBuilder />);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    fireEvent.input(screen.getByLabelText(/Paste a Content-Security-Policy header/i), {
      target: {
        value: "Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline'; object-src *",
      },
    });

    expect(screen.getByText(/default-src 'self'/)).toBeInTheDocument();
    expect(screen.getByText(/allows 'unsafe-inline'/)).toBeInTheDocument();
    expect(screen.getByText(/object-src allows "\*"/)).toBeInTheDocument();
  });

  it('flags a directive repeated in a pasted header', () => {
    render(<CspBuilder />);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    fireEvent.input(screen.getByLabelText(/Paste a Content-Security-Policy header/i), {
      target: { value: "default-src 'self'; default-src 'none'" },
    });

    expect(screen.getByText(/"default-src" appears more than once/)).toBeInTheDocument();
  });

  it('finds the CSP line inside a full curl -I style multi-header paste', () => {
    render(<CspBuilder />);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    const dump = [
      'HTTP/2 200',
      'date: Thu, 03 Sep 2026 12:00:00 GMT',
      'content-type: text/html; charset=utf-8',
      "content-security-policy: default-src 'self'; object-src 'none'",
      'x-frame-options: DENY',
    ].join('\n');
    fireEvent.input(screen.getByLabelText(/Paste a Content-Security-Policy header/i), { target: { value: dump } });

    expect(screen.getByText(/default-src 'self'/)).toBeInTheDocument();
    expect(screen.getByText(/Found 2 directives/)).toBeInTheDocument();
  });

  it('shows a clear error rather than nothing when no CSP directives are found', () => {
    render(<CspBuilder />);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    fireEvent.input(screen.getByLabelText(/Paste a Content-Security-Policy header/i), {
      target: { value: 'sorry, this is not a CSP header at all' },
    });

    expect(screen.getByRole('alert')).toHaveTextContent(/doesn't contain anything recognizable/i);
  });

  it('shows a summary count of directives, sources, warnings and notes', () => {
    render(<CspBuilder />);
    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));

    fireEvent.input(screen.getByLabelText(/Paste a Content-Security-Policy header/i), {
      target: { value: "default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.example.com" },
    });

    expect(screen.getByText(/Found 2 directives \(4 sources total\)/)).toBeInTheDocument();
  });

  it('loads a parsed policy into the builder', () => {
    render(<CspBuilder />);

    fireEvent.click(screen.getByRole('button', { name: 'Analyze' }));
    fireEvent.input(screen.getByLabelText(/Paste a Content-Security-Policy header/i), {
      target: { value: "default-src 'self'; script-src 'self' https://cdn.example.com" },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Edit in builder' }));

    expect((screen.getByLabelText('default-src') as HTMLInputElement).value).toBe("'self'");
    expect((screen.getByLabelText('script-src') as HTMLInputElement).value).toBe("'self' https://cdn.example.com");
  });
});
