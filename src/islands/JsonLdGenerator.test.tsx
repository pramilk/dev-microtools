import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/preact';
import JsonLdGenerator from './JsonLdGenerator';

const outputText = () => document.querySelector<HTMLElement>('.output')?.textContent ?? '';
const selectType = (label: string) => fireEvent.change(screen.getByLabelText('Schema type'), { target: { value: label } });

describe('<JsonLdGenerator />', () => {
  it('starts empty on the Article tab with a placeholder and no error', () => {
    render(<JsonLdGenerator />);

    expect((screen.getByLabelText('Schema type') as HTMLSelectElement).value).toBe('Article');
    expect(document.querySelector('.output--empty')).not.toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('typing a headline produces Article JSON-LD', () => {
    render(<JsonLdGenerator />);

    fireEvent.input(screen.getByLabelText('Headline'), { target: { value: 'My Post' } });

    expect(outputText()).toContain('"@type": "Article"');
    expect(outputText()).toContain('"headline": "My Post"');
    expect(document.querySelector('.output--empty')).toBeNull();
  });

  it('shows a visible error for a malformed image URL, once a headline is present', () => {
    render(<JsonLdGenerator />);

    fireEvent.input(screen.getByLabelText('Headline'), { target: { value: 'My Post' } });
    fireEvent.input(screen.getByLabelText('Image URL'), { target: { value: 'not-a-url' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/not a full URL/i);
  });

  it('shows no error for an untouched form', () => {
    render(<JsonLdGenerator />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('switches to the Product tab and builds an offer', () => {
    render(<JsonLdGenerator />);
    selectType('Product');

    fireEvent.input(screen.getByLabelText('Product name'), { target: { value: 'Widget' } });
    fireEvent.input(screen.getByLabelText('Price'), { target: { value: '19.99' } });

    expect(outputText()).toContain('"@type": "Product"');
    expect(outputText()).toContain('"price": "19.99"');
  });

  it('warns about fabricated ratings once both rating fields are set on the Product tab', () => {
    render(<JsonLdGenerator />);
    selectType('Product');
    fireEvent.input(screen.getByLabelText('Product name'), { target: { value: 'Widget' } });

    fireEvent.input(screen.getByLabelText('Rating value (1-5)'), { target: { value: '4.5' } });
    fireEvent.input(screen.getByLabelText('Review count'), { target: { value: '10' } });

    expect(screen.getByText(/fabricated or unverifiable/)).toBeInTheDocument();
  });

  it('builds FAQPage schema from question/answer rows and can add another row', () => {
    render(<JsonLdGenerator />);
    selectType('FAQPage');

    fireEvent.input(screen.getByLabelText('Question'), { target: { value: 'What is this?' } });
    fireEvent.input(screen.getByLabelText('Answer'), { target: { value: 'A tool.' } });

    expect(outputText()).toContain('"@type": "FAQPage"');
    expect(outputText()).toContain('What is this?');

    fireEvent.click(screen.getByRole('button', { name: '+ Add question' }));
    expect(screen.getAllByLabelText('Question')).toHaveLength(2);
  });

  it('always shows the Google FAQ rich-result caveat', () => {
    render(<JsonLdGenerator />);
    selectType('FAQPage');
    fireEvent.input(screen.getByLabelText('Question'), { target: { value: 'What is this?' } });
    fireEvent.input(screen.getByLabelText('Answer'), { target: { value: 'A tool.' } });

    expect(screen.getByText(/2023/)).toBeInTheDocument();
  });

  it('builds HowTo schema with at least one step, and can add another step', () => {
    render(<JsonLdGenerator />);
    selectType('HowTo');

    fireEvent.input(screen.getByLabelText('Title'), { target: { value: 'Make tea' } });
    fireEvent.input(screen.getByLabelText('Step instructions'), { target: { value: 'Boil the water.' } });

    expect(outputText()).toContain('"@type": "HowTo"');
    expect(outputText()).toContain('Boil the water.');

    fireEvent.click(screen.getByRole('button', { name: '+ Add step' }));
    expect(screen.getAllByLabelText('Step instructions')).toHaveLength(2);
  });

  it('builds Organization schema with sameAs from newline-separated URLs', () => {
    render(<JsonLdGenerator />);
    selectType('Organization');

    fireEvent.input(screen.getByLabelText('Organization name'), { target: { value: 'Acme' } });
    fireEvent.input(screen.getByLabelText('Social profile URLs (one per line)'), {
      target: { value: 'https://twitter.com/acme' },
    });

    expect(outputText()).toContain('"@type": "Organization"');
    expect(outputText()).toContain('https://twitter.com/acme');
  });

  it('builds BreadcrumbList schema with positions', () => {
    render(<JsonLdGenerator />);
    selectType('BreadcrumbList');

    const names = screen.getAllByLabelText('Name');
    fireEvent.input(names[0]!, { target: { value: 'Home' } });

    expect(outputText()).toContain('"@type": "BreadcrumbList"');
    expect(outputText()).toContain('"position": 1');
  });

  it('loads a worked example for the active tab', () => {
    render(<JsonLdGenerator />);

    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));

    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).not.toBe('');
    expect(outputText()).toContain('"@type": "Article"');
  });

  it('clear resets the active tab back to empty', () => {
    render(<JsonLdGenerator />);
    fireEvent.click(screen.getByRole('button', { name: 'Load example' }));
    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).not.toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));

    expect((screen.getByLabelText('Headline') as HTMLInputElement).value).toBe('');
    expect(document.querySelector('.output--empty')).not.toBeNull();
  });

  it('offers copy, download and share-link controls once there is output', () => {
    render(<JsonLdGenerator />);
    fireEvent.input(screen.getByLabelText('Headline'), { target: { value: 'My Post' } });

    expect(screen.getByRole('button', { name: 'Copy' })).toBeEnabled();
    expect(screen.getByRole('button', { name: /download/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /copy link/i })).toBeInTheDocument();
  });

  it('escapes </script> so embedding the output cannot terminate the tag early', () => {
    render(<JsonLdGenerator />);
    fireEvent.input(screen.getByLabelText('Headline'), { target: { value: 'My Post' } });
    fireEvent.input(screen.getByLabelText('Description'), { target: { value: 'Ends with </script> on purpose' } });

    expect(outputText()).toContain('\\u003c/script>');
    expect(outputText()).not.toContain('</script> on purpose"');
  });
});
